import { sha256Hex } from "@tadori/core";
import type { Relation } from "@tadori/core";
import { MultiUndirectedGraph } from "graphology";
import * as forceAtlas2Module from "graphology-layout-forceatlas2";
import { foreignKeyCheck, type Database } from "./database.js";
import {
  findDanglingEndpoints,
  type StoredSnapshotGraph
} from "./snapshots.js";

export type LayoutLevel = "package" | "file" | "symbol";

export interface LayoutPosition {
  entityKey: string;
  x: number;
  y: number;
  z: number;
  pinned: boolean;
  anchorGroup: string | null;
}

export interface LayoutReadResult {
  positions: LayoutPosition[];
  layoutVersion: number;
}

export type LayoutWriteMode = "replace" | "append_missing";

export class LayoutIntegrityError extends Error {
  override readonly name = "LayoutIntegrityError";
}

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface LayoutEngineNode {
  entityKey: string;
  fixedPosition: LayoutPoint | null;
  initialPosition: LayoutPoint | null;
}

export interface LayoutEngineEdge {
  entityKey: string;
  relation: Relation;
  srcEntityKey: string;
  dstEntityKey: string;
}

export interface ComputeLayoutOptions {
  repoId: number;
  level: LayoutLevel;
  viewKey: string;
  layoutVersion: number;
  iterations: number;
}

export const CURRENT_LAYOUT_VERSION = 1;
const APPEND_RELAXATION_RADIUS = 25;

const LAYOUT_LEVELS = new Set<LayoutLevel>(["package", "file", "symbol"]);
const ENTITY_KEY = /^[0-9a-f]{64}$/;
// These are part of layout version 1. In particular, scalingRatio=10 keeps
// deterministic circle seeds separated without relying on inferred settings;
// changing any value requires a reviewed CURRENT_LAYOUT_VERSION bump.
const FORCE_ATLAS_SETTINGS = Object.freeze({
  adjustSizes: false,
  barnesHutOptimize: false,
  barnesHutTheta: 0.5,
  edgeWeightInfluence: 1,
  gravity: 1,
  linLogMode: false,
  outboundAttractionDistribution: false,
  scalingRatio: 10,
  slowDown: 1,
  strongGravityMode: false
});
const runForceAtlas2 = forceAtlas2Module.default as unknown as
  (typeof import("graphology-layout-forceatlas2"))["default"];

interface SnapshotValidationRow {
  id: number;
  repo_id: number;
  status: "active" | "pruned";
}

interface LayoutRow {
  entity_key: string;
  x: number;
  y: number;
  z: number;
  pinned: number;
  anchor_group: string | null;
  layout_version: number;
}

interface Topology {
  nodes: readonly LayoutEngineNode[];
  edges: readonly LayoutEngineEdge[];
  packageByNode: Map<string, string | null>;
}

function assertLevel(level: LayoutLevel): void {
  if (!LAYOUT_LEVELS.has(level)) {
    throw new Error(`invalid layout level: ${String(level)}`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}

function assertViewKey(viewKey: string): void {
  if (viewKey.length === 0) {
    throw new Error("viewKey must not be empty");
  }
}

function assertFinitePoint(point: { x: number; y: number }, label: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error(`${label} must contain finite x/y coordinates`);
  }
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateSnapshot(db: Database, repoId: number, snapshotId: number): void {
  assertPositiveInteger(repoId, "repoId");
  assertPositiveInteger(snapshotId, "snapshotId");
  const snapshot = db
    .prepare("SELECT id, repo_id, status FROM repository_snapshots WHERE id = ?")
    .get(snapshotId) as SnapshotValidationRow | undefined;
  if (!snapshot) {
    throw new Error(`unknown snapshot: ${snapshotId}`);
  }
  if (snapshot.repo_id !== repoId) {
    throw new Error(`snapshot ${snapshotId} does not belong to repository ${repoId}`);
  }
  if (snapshot.status !== "active") {
    throw new Error(`snapshot ${snapshotId} is not active`);
  }
}

function levelPredicate(level: LayoutLevel, alias: string): string {
  if (level === "package") return `${alias}.kind = 'package'`;
  if (level === "file") return `${alias}.kind = 'file'`;
  return `${alias}.kind NOT IN ('package', 'file')`;
}

function selectRows(
  db: Database,
  repoId: number,
  snapshotId: number,
  level: LayoutLevel,
  viewKey: string
): LayoutRow[] {
  return db
    .prepare(
      `SELECT ne.entity_key, lp.x, lp.y, lp.z, lp.pinned, lp.anchor_group,
              lp.layout_version
       FROM layout_positions AS lp
       JOIN node_entities AS ne
         ON ne.id = lp.node_id AND ne.repo_id = lp.repo_id
       JOIN snapshot_nodes AS sn
         ON sn.snapshot_id = @snapshotId AND sn.node_id = lp.node_id
       WHERE lp.repo_id = @repoId
         AND lp.abstraction_level = @level
         AND lp.view_key = @viewKey
         AND ${levelPredicate(level, "ne")}
       ORDER BY ne.entity_key`
    )
    .all({ repoId, snapshotId, level, viewKey }) as LayoutRow[];
}

function rowsToResult(rows: LayoutRow[]): LayoutReadResult | null {
  if (rows.length === 0) return null;
  validateLayoutRows(rows);
  const versions = new Set(rows.map((row) => row.layout_version));
  if (versions.size !== 1) {
    throw new LayoutIntegrityError("layout slice contains mixed layout versions");
  }
  return {
    positions: rows.map((row) => {
      return {
        entityKey: row.entity_key,
        x: row.x,
        y: row.y,
        z: row.z,
        pinned: row.pinned === 1,
        anchorGroup: row.anchor_group
      };
    }),
    layoutVersion: rows[0]!.layout_version
  };
}

function validateLayoutRows(rows: readonly LayoutRow[]): void {
  for (const row of rows) {
    if (!Number.isFinite(row.x) || !Number.isFinite(row.y) || !Object.is(row.z, 0)) {
      throw new LayoutIntegrityError(`layout row ${row.entity_key} has invalid coordinates`);
    }
    if (row.pinned !== 0 && row.pinned !== 1) {
      throw new LayoutIntegrityError(`layout row ${row.entity_key} has invalid pinned state`);
    }
  }
}

function requireCompleteLayout(
  result: LayoutReadResult | null,
  expectedKeys: ReadonlySet<string>,
  layoutVersion: number
): LayoutReadResult {
  if (result === null || result.layoutVersion !== layoutVersion) {
    throw new LayoutIntegrityError("layout write did not produce the requested version");
  }
  const actualKeys = new Set(result.positions.map((position) => position.entityKey));
  if (
    actualKeys.size !== expectedKeys.size ||
    [...expectedKeys].some((entityKey) => !actualKeys.has(entityKey))
  ) {
    throw new LayoutIntegrityError("layout write did not produce a complete snapshot slice");
  }
  return result;
}

export function deriveLayoutSeed(
  repoId: number,
  level: LayoutLevel,
  viewKey: string,
  layoutVersion: number
): number {
  assertPositiveInteger(repoId, "repoId");
  assertLevel(level);
  assertViewKey(viewKey);
  assertPositiveInteger(layoutVersion, "layoutVersion");
  return Number.parseInt(sha256Hex(`${repoId}:${level}:${viewKey}:${layoutVersion}`).slice(0, 8), 16);
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function computeLayout(
  nodes: readonly LayoutEngineNode[],
  edges: readonly LayoutEngineEdge[],
  options: ComputeLayoutOptions
): Map<string, { x: number; y: number }> {
  assertPositiveInteger(options.repoId, "repoId");
  assertLevel(options.level);
  assertViewKey(options.viewKey);
  assertPositiveInteger(options.layoutVersion, "layoutVersion");
  if (!Number.isSafeInteger(options.iterations) || options.iterations < 0) {
    throw new Error("iterations must be a non-negative safe integer");
  }

  const sortedNodes = [...nodes].sort((left, right) => compareKeys(left.entityKey, right.entityKey));
  const nodeKeys = new Set<string>();
  for (const node of sortedNodes) {
    if (!ENTITY_KEY.test(node.entityKey)) throw new Error(`invalid entity key: ${node.entityKey}`);
    if (nodeKeys.has(node.entityKey)) throw new Error(`duplicate layout node: ${node.entityKey}`);
    nodeKeys.add(node.entityKey);
    if (node.fixedPosition !== null && node.initialPosition !== null) {
      throw new Error(`layout node ${node.entityKey} has both fixed and initial positions`);
    }
    if (node.fixedPosition !== null) assertFinitePoint(node.fixedPosition, `fixed position for ${node.entityKey}`);
    if (node.initialPosition !== null) assertFinitePoint(node.initialPosition, `initial position for ${node.entityKey}`);
  }
  const random = mulberry32(
    deriveLayoutSeed(options.repoId, options.level, options.viewKey, options.layoutVersion)
  );
  const radius = Math.max(10, Math.sqrt(sortedNodes.length) * 10);
  const graph = new MultiUndirectedGraph<{
    x: number;
    y: number;
    fixed?: boolean;
  }, { relation: Relation; weight: number }>();
  for (const [index, node] of sortedNodes.entries()) {
    const angle = (2 * Math.PI * index) / sortedNodes.length;
    const seeded = {
      x: Math.cos(angle) * radius + (random() - 0.5),
      y: Math.sin(angle) * radius + (random() - 0.5)
    };
    const point = node.fixedPosition ?? node.initialPosition ?? seeded;
    graph.addNode(node.entityKey, {
      x: point.x,
      y: point.y,
      ...(node.fixedPosition !== null ? { fixed: true } : {})
    });
  }

  const edgeKeys = new Set<string>();
  const sortedEdges = [...edges].sort((left, right) => compareKeys(left.entityKey, right.entityKey));
  for (const edge of sortedEdges) {
    if (!ENTITY_KEY.test(edge.entityKey)) throw new Error(`invalid edge entity key: ${edge.entityKey}`);
    if (edgeKeys.has(edge.entityKey)) throw new Error(`duplicate layout edge: ${edge.entityKey}`);
    edgeKeys.add(edge.entityKey);
    if (!nodeKeys.has(edge.srcEntityKey) || !nodeKeys.has(edge.dstEntityKey)) {
      throw new Error(`layout edge ${edge.entityKey} has an endpoint outside the node set`);
    }
    if (edge.srcEntityKey === edge.dstEntityKey) continue;
    graph.addUndirectedEdgeWithKey(edge.entityKey, edge.srcEntityKey, edge.dstEntityKey, {
      relation: edge.relation,
      weight: 1
    });
  }

  const free = sortedNodes.filter((node) => node.fixedPosition === null);
  if (free.length === 0) return new Map();
  if (options.iterations > 0 && graph.order > 1) {
    runForceAtlas2.assign(graph, {
      iterations: options.iterations,
      settings: FORCE_ATLAS_SETTINGS,
      getEdgeWeight: () => 1
    });
  }
  const result = new Map<string, { x: number; y: number }>();
  for (const node of free) {
    const point = graph.getNodeAttributes(node.entityKey);
    assertFinitePoint(point, `computed position for ${node.entityKey}`);
    result.set(node.entityKey, { x: point.x, y: point.y });
  }
  return result;
}

export function readLayout(
  db: Database,
  repoId: number,
  snapshotId: number,
  level: LayoutLevel,
  viewKey: string
): LayoutReadResult | null {
  assertLevel(level);
  assertViewKey(viewKey);
  validateSnapshot(db, repoId, snapshotId);
  return rowsToResult(selectRows(db, repoId, snapshotId, level, viewKey));
}

function validatePositions(positions: readonly LayoutPosition[]): void {
  const seen = new Set<string>();
  for (const position of positions) {
    if (!ENTITY_KEY.test(position.entityKey)) {
      throw new Error(`invalid entity key: ${position.entityKey}`);
    }
    if (seen.has(position.entityKey)) {
      throw new Error(`duplicate layout position: ${position.entityKey}`);
    }
    seen.add(position.entityKey);
    assertFinitePoint(position, `position for ${position.entityKey}`);
    if (!Object.is(position.z, 0) && !Object.is(position.z, -0)) {
      throw new Error(`position for ${position.entityKey} must have z=0`);
    }
    if (typeof position.pinned !== "boolean") {
      throw new Error(`position for ${position.entityKey} has invalid pinned value`);
    }
    if (position.anchorGroup !== null && typeof position.anchorGroup !== "string") {
      throw new Error(`position for ${position.entityKey} has invalid anchor group`);
    }
  }
}

export function writeLayout(
  db: Database,
  repoId: number,
  snapshotId: number,
  level: LayoutLevel,
  viewKey: string,
  layoutVersion: number,
  positions: readonly LayoutPosition[],
  mode: LayoutWriteMode
): void {
  assertLevel(level);
  assertViewKey(viewKey);
  assertPositiveInteger(layoutVersion, "layoutVersion");
  if (mode !== "replace" && mode !== "append_missing") {
    throw new Error(`invalid layout write mode: ${String(mode)}`);
  }
  validatePositions(positions);

  const transaction = db.transaction((): void => {
    validateSnapshot(db, repoId, snapshotId);
    const resolveNode = db.prepare(
      `SELECT ne.id
       FROM node_entities AS ne
       JOIN snapshot_nodes AS sn ON sn.node_id = ne.id AND sn.snapshot_id = @snapshotId
       WHERE ne.repo_id = @repoId AND ne.entity_key = @entityKey
         AND ${levelPredicate(level, "ne")}`
    );
    const resolved = positions.map((position) => {
      const row = resolveNode.get({ repoId, snapshotId, entityKey: position.entityKey }) as
        | { id: number }
        | undefined;
      if (!row) throw new Error(`unknown entity key: ${position.entityKey}`);
      return { position, nodeId: row.id };
    });

    if (mode === "replace") {
      const expected = db
        .prepare(
          `SELECT ne.entity_key
           FROM snapshot_nodes AS sn JOIN node_entities AS ne ON ne.id = sn.node_id
           WHERE sn.snapshot_id = @snapshotId AND ne.repo_id = @repoId
             AND ${levelPredicate(level, "ne")}
           ORDER BY ne.entity_key`
        )
        .all({ snapshotId, repoId }) as Array<{ entity_key: string }>;
      const suppliedKeys = positions.map((position) => position.entityKey).sort();
      if (
        expected.length !== suppliedKeys.length ||
        expected.some((row, index) => row.entity_key !== suppliedKeys[index])
      ) {
        throw new Error(`replace layout positions must exactly match snapshot ${snapshotId} ${level} membership`);
      }
      db.prepare(
        `DELETE FROM layout_positions
         WHERE repo_id = @repoId
           AND abstraction_level = @level
           AND view_key = @viewKey
           AND node_id IN (
             SELECT sn.node_id
             FROM snapshot_nodes AS sn
             JOIN node_entities AS ne ON ne.id = sn.node_id
             WHERE sn.snapshot_id = @snapshotId
               AND ne.repo_id = @repoId
               AND ${levelPredicate(level, "ne")}
           )`
      ).run({ repoId, snapshotId, level, viewKey });
    }
    const insert = db.prepare(
      `INSERT INTO layout_positions
         (repo_id, abstraction_level, view_key, node_id, x, y, z, pinned,
          anchor_group, layout_version, last_snapshot_id)
       VALUES
         (@repoId, @level, @viewKey, @nodeId, @x, @y, 0, @pinned,
          @anchorGroup, @layoutVersion, @snapshotId)`
    );
    for (const { position, nodeId } of resolved) {
      const inserted = insert.run({
        repoId,
        level,
        viewKey,
        nodeId,
        x: position.x,
        y: position.y,
        pinned: position.pinned ? 1 : 0,
        anchorGroup: position.anchorGroup,
        layoutVersion,
        snapshotId
      });
      if (inserted.changes !== 1) {
        throw new LayoutIntegrityError(`layout row ${position.entityKey} was not inserted`);
      }
    }
  });
  transaction.immediate();
}

function validateStoredGraph(db: Database, graph: StoredSnapshotGraph): void {
  const { snapshot } = graph;
  validateSnapshot(db, snapshot.repo_id, snapshot.id);
  const foreignKeys = foreignKeyCheck(db);
  if (foreignKeys.length > 0) {
    throw new Error(`snapshot ${snapshot.id} cannot materialize layout with foreign-key violations`);
  }
  const dangling = findDanglingEndpoints(db, snapshot.id);
  if (dangling.length > 0) {
    throw new Error(`snapshot ${snapshot.id} cannot materialize layout with dangling endpoints`);
  }
  const stored = db
    .prepare("SELECT * FROM repository_snapshots WHERE id = ?")
    .get(snapshot.id) as Record<string, unknown> | undefined;
  const snapshotMatches = stored !== undefined &&
    Object.entries(snapshot).every(([key, value]) => stored[key] === value);
  if (!snapshotMatches) {
    throw new Error(`stored graph snapshot metadata does not match snapshot ${snapshot.id}`);
  }

  const nodeKeys = db
    .prepare(
      `SELECT ne.entity_key
       FROM snapshot_nodes AS sn JOIN node_entities AS ne ON ne.id = sn.node_id
       WHERE sn.snapshot_id = ? ORDER BY ne.entity_key`
    )
    .all(snapshot.id) as Array<{ entity_key: string }>;
  const expectedNodes = [...graph.nodes].map((node) => node.entityKey).sort();
  if (
    nodeKeys.length !== expectedNodes.length ||
    nodeKeys.some((row, index) => row.entity_key !== expectedNodes[index])
  ) {
    throw new Error(`stored graph node membership does not match snapshot ${snapshot.id}`);
  }
  const edgeKeys = db
    .prepare(
      `SELECT ee.entity_key
       FROM snapshot_edges AS se JOIN edge_entities AS ee ON ee.id = se.edge_id
       WHERE se.snapshot_id = ? ORDER BY ee.entity_key`
    )
    .all(snapshot.id) as Array<{ entity_key: string }>;
  const expectedEdges = [...graph.edges].map((edge) => edge.entityKey).sort();
  if (
    edgeKeys.length !== expectedEdges.length ||
    edgeKeys.some((row, index) => row.entity_key !== expectedEdges[index])
  ) {
    throw new Error(`stored graph edge membership does not match snapshot ${snapshot.id}`);
  }
}

function uniqueMap<K, V>(
  entries: readonly (readonly [K, V])[],
  label: string
): Map<K, V> {
  const result = new Map<K, V>();
  for (const [key, value] of entries) {
    if (result.has(key)) {
      throw new LayoutIntegrityError(`stored graph contains duplicate ${label}`);
    }
    result.set(key, value);
  }
  return result;
}

function buildTopology(graph: StoredSnapshotGraph, level: LayoutLevel): Topology {
  const uniqueNodeKeys = new Set(graph.nodes.map((node) => node.entityKey));
  const uniqueEdgeKeys = new Set(graph.edges.map((edge) => edge.entityKey));
  if (uniqueNodeKeys.size !== graph.nodes.length) {
    throw new LayoutIntegrityError("stored graph contains duplicate node entity keys");
  }
  if (uniqueEdgeKeys.size !== graph.edges.length) {
    throw new LayoutIntegrityError("stored graph contains duplicate edge entity keys");
  }
  const packageNodes = uniqueMap(
    graph.nodes
      .filter((node) => node.kind === "package")
      .map((node) => [node.qualifiedName, node] as const),
    "package qualified name"
  );
  const fileNodes = uniqueMap(
    graph.nodes
      .filter((node) => node.kind === "file" && node.file !== null)
      .map((node) => [node.file!, node] as const),
    "file-node path"
  );
  const packageNameByPath = uniqueMap(
    graph.files.map((file) => [file.normalizedPath, file.packageName] as const),
    "snapshot-file path"
  );
  const representative = new Map<string, string>();
  const packageByNode = new Map<string, string | null>();

  for (const node of graph.nodes) {
    const packageName =
      node.kind === "package"
        ? node.qualifiedName
        : node.file === null
          ? null
          : (packageNameByPath.get(node.file) ?? null);
    const packageKey = packageName === null ? null : (packageNodes.get(packageName)?.entityKey ?? null);
    let representativeKey: string | undefined;
    if (level === "package") representativeKey = packageKey ?? undefined;
    else if (level === "file") {
      representativeKey = node.kind === "file" ? node.entityKey : fileNodes.get(node.file ?? "")?.entityKey;
    } else if (node.kind !== "package" && node.kind !== "file") {
      representativeKey = node.entityKey;
    }
    if (representativeKey) representative.set(node.entityKey, representativeKey);
  }

  const selected = graph.nodes
    .filter((node) =>
      level === "package"
        ? node.kind === "package"
        : level === "file"
          ? node.kind === "file"
          : node.kind !== "package" && node.kind !== "file"
    )
    .sort((left, right) => compareKeys(left.entityKey, right.entityKey));
  for (const node of selected) {
    const packageName =
      node.kind === "package"
        ? node.qualifiedName
        : node.file === null
          ? null
          : (packageNameByPath.get(node.file) ?? null);
    packageByNode.set(
      node.entityKey,
      packageName === null ? null : (packageNodes.get(packageName)?.entityKey ?? null)
    );
  }

  const edges: LayoutEngineEdge[] = [];
  for (const edge of [...graph.edges].sort((a, b) => compareKeys(a.entityKey, b.entityKey))) {
    const src = representative.get(edge.srcEntityKey);
    const dst = representative.get(edge.dstEntityKey);
    if (!src || !dst || src === dst) continue;
    edges.push({
      entityKey: edge.entityKey,
      relation: edge.relation,
      srcEntityKey: src,
      dstEntityKey: dst
    });
  }
  return {
    nodes: selected.map((node) => ({
      entityKey: node.entityKey,
      fixedPosition: null,
      initialPosition: null
    })),
    edges,
    packageByNode
  };
}

function meanPosition(positions: LayoutPosition[]): { x: number; y: number } {
  if (positions.length === 0) return { x: 0, y: 0 };
  return {
    x: positions.reduce((total, position) => total + position.x, 0) / positions.length,
    y: positions.reduce((total, position) => total + position.y, 0) / positions.length
  };
}

function boundedPoint(
  origin: { x: number; y: number },
  point: { x: number; y: number },
  radius: number
): { x: number; y: number } {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= radius || distance === 0) return point;
  return { x: origin.x + (dx / distance) * radius, y: origin.y + (dy / distance) * radius };
}

export function ensureLayout(
  db: Database,
  graph: StoredSnapshotGraph,
  level: LayoutLevel,
  viewKey = "base"
): LayoutReadResult {
  assertLevel(level);
  assertViewKey(viewKey);
  validateStoredGraph(db, graph);
  const topology = buildTopology(graph, level);
  if (topology.nodes.length === 0) {
    return { positions: [], layoutVersion: CURRENT_LAYOUT_VERSION };
  }

  const rows = selectRows(db, graph.snapshot.repo_id, graph.snapshot.id, level, viewKey);
  validateLayoutRows(rows);
  const versions = new Set(rows.map((row) => row.layout_version));
  const existing = versions.size === 1 && versions.has(CURRENT_LAYOUT_VERSION)
    ? rowsToResult(rows)
    : null;
  const requiredKeys = new Set(topology.nodes.map((node) => node.entityKey));
  if (existing && existing.positions.length === requiredKeys.size) return existing;

  if (!existing) {
    const pinnedByKey = new Map(
      rows
        .filter((row) => row.pinned === 1)
        .map((row) => [row.entity_key, row] as const)
    );
    const computed = computeLayout(
      topology.nodes.map((node) => {
        const pinned = pinnedByKey.get(node.entityKey);
        return pinned
          ? {
              entityKey: node.entityKey,
              fixedPosition: { x: pinned.x, y: pinned.y },
              initialPosition: null
            }
          : node;
      }),
      topology.edges,
      {
      repoId: graph.snapshot.repo_id,
      level,
      viewKey,
      layoutVersion: CURRENT_LAYOUT_VERSION,
      iterations: 200
      }
    );
    const positions = topology.nodes.map((node) => {
      const pinned = pinnedByKey.get(node.entityKey);
      if (pinned) {
        return {
          entityKey: node.entityKey,
          x: pinned.x,
          y: pinned.y,
          z: 0,
          pinned: true,
          anchorGroup: pinned.anchor_group
        };
      }
      const point = computed.get(node.entityKey)!;
      return {
        entityKey: node.entityKey,
        x: point.x,
        y: point.y,
        z: 0,
        pinned: false,
        anchorGroup: null
      };
    });
    writeLayout(
      db,
      graph.snapshot.repo_id,
      graph.snapshot.id,
      level,
      viewKey,
      CURRENT_LAYOUT_VERSION,
      positions,
      "replace"
    );
    return requireCompleteLayout(
      readLayout(db, graph.snapshot.repo_id, graph.snapshot.id, level, viewKey),
      requiredKeys,
      CURRENT_LAYOUT_VERSION
    );
  }

  const existingByKey = new Map(existing.positions.map((position) => [position.entityKey, position]));
  const missing = topology.nodes.filter((node) => !existingByKey.has(node.entityKey));
  if (missing.length === 0) return existing;
  const wholeCentroid = meanPosition(existing.positions);
  const initialByKey = new Map<string, { x: number; y: number }>();
  const centroidByKey = new Map<string, { x: number; y: number }>();
  const appendRandom = mulberry32(
    deriveLayoutSeed(
      graph.snapshot.repo_id,
      level,
      viewKey,
      CURRENT_LAYOUT_VERSION
    )
  );
  for (const node of missing) {
    const packageKey = topology.packageByNode.get(node.entityKey) ?? null;
    const siblings = packageKey === null
      ? []
      : existing.positions.filter(
          (position) => topology.packageByNode.get(position.entityKey) === packageKey
        );
    const centroid = siblings.length > 0 ? meanPosition(siblings) : wholeCentroid;
    centroidByKey.set(node.entityKey, centroid);
    initialByKey.set(node.entityKey, {
      x: centroid.x + (appendRandom() - 0.5),
      y: centroid.y + (appendRandom() - 0.5)
    });
  }
  const engineNodes: LayoutEngineNode[] = topology.nodes.map((node) => {
    const existingPosition = existingByKey.get(node.entityKey);
    if (existingPosition) {
      return {
        entityKey: node.entityKey,
        fixedPosition: { x: existingPosition.x, y: existingPosition.y },
        initialPosition: null
      };
    }
    return {
      entityKey: node.entityKey,
      fixedPosition: null,
      initialPosition: initialByKey.get(node.entityKey)!
    };
  });
  const relaxed = computeLayout(engineNodes, topology.edges, {
    repoId: graph.snapshot.repo_id,
    level,
    viewKey,
    layoutVersion: CURRENT_LAYOUT_VERSION,
    iterations: 50
  });
  const newPositions = missing.map((node) => {
    const centroid = centroidByKey.get(node.entityKey)!;
    const point = boundedPoint(
      centroid,
      relaxed.get(node.entityKey)!,
      APPEND_RELAXATION_RADIUS
    );
    return {
      entityKey: node.entityKey,
      x: point.x,
      y: point.y,
      z: 0,
      pinned: false,
      anchorGroup: null
    };
  });
  writeLayout(
    db,
    graph.snapshot.repo_id,
    graph.snapshot.id,
    level,
    viewKey,
    CURRENT_LAYOUT_VERSION,
    newPositions,
    "append_missing"
  );
  return requireCompleteLayout(
    readLayout(db, graph.snapshot.repo_id, graph.snapshot.id, level, viewKey),
    requiredKeys,
    CURRENT_LAYOUT_VERSION
  );
}
