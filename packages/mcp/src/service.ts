import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import type { GraphEdge, GraphNode, NodeKind, Relation, RepoStateKind } from "@tadori/core";
import { computeWorkspaceHash, scanRepository } from "@tadori/indexer";
import {
  getActiveSnapshot,
  ensureSnapshotFts,
  loadSnapshotGraph,
  searchNodeFts,
  type Database,
  type FtsSearchResult,
  type SnapshotRow,
  type StoredSnapshotGraph
} from "@tadori/store";

/** Incoming relations that count toward a node's fan-in (structural containment excluded). */
const FAN_IN_RELATIONS: ReadonlySet<Relation> = new Set([
  "imports",
  "references",
  "calls",
  "implements",
  "extends",
  "routes_to"
]);

export interface EntityResolution {
  node: GraphNode | null;
  candidates: GraphNode[];
}

export type FreshnessStatus = "fresh" | "stale" | "unknown";

export interface FreshnessResult {
  status: FreshnessStatus;
  stale: boolean;
  reason:
    | "matches_snapshot"
    | "content_changed"
    | "refresh_pending"
    | "unreadable"
    | "outside_repository"
    | "not_in_snapshot";
}

export interface RefreshFreshnessOverlay {
  isPathStaleForSnapshot(snapshotId: number, normalizedPath: string): boolean;
  isSnapshotStale(snapshotId: number): boolean;
}

export interface BodyReadResult {
  body: string | null;
  status: FreshnessStatus;
  stale: boolean;
  reason:
    | FreshnessResult["reason"]
    | "no_source_span";
}

/**
 * In-memory view over the served snapshot: node/edge indexes, adjacency,
 * fan-in, and staleness against the current working tree. The snapshot on
 * disk is never mutated; an invalid snapshot is never selected (the store's
 * getActiveSnapshot enforces that).
 */
export class GraphService {
  readonly snapshot: SnapshotRow;
  readonly repoId: number;
  readonly graph: StoredSnapshotGraph;
  readonly nodesByKey = new Map<string, GraphNode>();
  readonly nodesByQualifiedName = new Map<string, GraphNode[]>();
  readonly nodesByDisplayName = new Map<string, GraphNode[]>();
  readonly outEdges = new Map<string, GraphEdge[]>();
  readonly inEdges = new Map<string, GraphEdge[]>();
  private readonly fanInByKey = new Map<string, number>();
  private readonly filesByPath = new Map<string, StoredSnapshotGraph["files"][number]>();
  private readonly nativeRepoRoot: string;
  private readonly realRepoRoot: string;

  constructor(
    private readonly db: Database,
    readonly repoRoot: string,
    snapshot: SnapshotRow,
    graph?: StoredSnapshotGraph,
    private readonly refreshOverlay?: RefreshFreshnessOverlay
  ) {
    this.nativeRepoRoot = path.resolve(repoRoot);
    this.realRepoRoot = realpathSync.native(this.nativeRepoRoot);
    this.snapshot = snapshot;
    this.repoId = snapshot.repo_id;
    this.graph = graph ?? loadSnapshotGraph(db, snapshot.id);
    for (const file of this.graph.files) {
      this.filesByPath.set(file.normalizedPath, file);
    }
    for (const node of this.graph.nodes) {
      this.nodesByKey.set(node.entityKey, node);
      const sameQualifiedName = this.nodesByQualifiedName.get(node.qualifiedName) ?? [];
      sameQualifiedName.push(node);
      this.nodesByQualifiedName.set(node.qualifiedName, sameQualifiedName);
      const sameName = this.nodesByDisplayName.get(node.displayName) ?? [];
      sameName.push(node);
      this.nodesByDisplayName.set(node.displayName, sameName);
    }
    for (const edge of this.graph.edges) {
      const out = this.outEdges.get(edge.srcEntityKey) ?? [];
      out.push(edge);
      this.outEdges.set(edge.srcEntityKey, out);
      const incoming = this.inEdges.get(edge.dstEntityKey) ?? [];
      incoming.push(edge);
      this.inEdges.set(edge.dstEntityKey, incoming);
      if (FAN_IN_RELATIONS.has(edge.relation)) {
        this.fanInByKey.set(
          edge.dstEntityKey,
          (this.fanInByKey.get(edge.dstEntityKey) ?? 0) + 1
        );
      }
    }
  }

  static open(
    db: Database,
    repoRoot: string,
    refreshOverlay?: RefreshFreshnessOverlay,
    preferredKind?: RepoStateKind
  ): GraphService {
    const resolvedRoot = path.resolve(repoRoot).split(path.sep).join("/");
    const loadActive = db.transaction((): {
      snapshot: SnapshotRow;
      graph: StoredSnapshotGraph;
    } => {
      const repo = db
        .prepare("SELECT id FROM repositories WHERE root_path = ?")
        .get(resolvedRoot) as { id: number } | undefined;
      if (!repo) {
        throw new Error(`Repository ${resolvedRoot} has no indexed snapshots in this database`);
      }
      const snapshot =
        getActiveSnapshot(db, repo.id, preferredKind) ??
        (preferredKind === undefined ? undefined : getActiveSnapshot(db, repo.id));
      if (!snapshot) {
        throw new Error(
          `Repository ${resolvedRoot} has no valid active snapshot; run the indexer first`
        );
      }
      return { snapshot, graph: loadSnapshotGraph(db, snapshot.id) };
    });
    const loaded = loadActive.deferred();
    // Repair legacy/missing search rows once at session initialization. Normal
    // MCP requests remain read-only, including while another connection
    // publishes a replacement snapshot under WAL.
    ensureSnapshotFts(db, loaded.snapshot.id);
    return new GraphService(db, resolvedRoot, loaded.snapshot, loaded.graph, refreshOverlay);
  }

  fanIn(entityKey: string): number {
    return this.fanInByKey.get(entityKey) ?? 0;
  }

  searchNodes(
    query: string,
    limit: number,
    kind?: NodeKind,
    offset = 0
  ): FtsSearchResult {
    return searchNodeFts(this.db, this.snapshot.id, query, limit, kind, offset);
  }

  private resolveSnapshotPath(normalizedPath: string): string | null {
    if (path.isAbsolute(normalizedPath)) {
      return null;
    }
    const absolute = path.resolve(this.nativeRepoRoot, normalizedPath);
    const relative = path.relative(this.nativeRepoRoot, absolute);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return null;
    }
    let realCandidate: string;
    try {
      realCandidate = realpathSync.native(absolute);
    } catch {
      return absolute;
    }
    const realRelative = path.relative(this.realRepoRoot, realCandidate);
    if (
      realRelative === ".." ||
      realRelative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(realRelative)
    ) {
      return null;
    }
    return realCandidate;
  }

  private loadSnapshotFile(normalizedPath: string): FreshnessResult & { contents: Buffer | null } {
    const snapshotFile = this.filesByPath.get(normalizedPath);
    if (!snapshotFile) {
      return { status: "unknown", stale: true, reason: "not_in_snapshot", contents: null };
    }
    if (this.refreshOverlay?.isPathStaleForSnapshot(this.snapshot.id, normalizedPath)) {
      return { status: "stale", stale: true, reason: "refresh_pending", contents: null };
    }
    const absolute = this.resolveSnapshotPath(normalizedPath);
    if (absolute === null) {
      return { status: "unknown", stale: true, reason: "outside_repository", contents: null };
    }
    let contents: Buffer;
    try {
      contents = readFileSync(absolute);
    } catch {
      return { status: "unknown", stale: true, reason: "unreadable", contents: null };
    }
    const currentHash = createHash("sha256").update(contents).digest("hex");
    if (currentHash !== snapshotFile.contentHash) {
      return { status: "stale", stale: true, reason: "content_changed", contents: null };
    }
    return { status: "fresh", stale: false, reason: "matches_snapshot", contents };
  }

  fileFreshness(normalizedPath: string): FreshnessResult {
    const { contents: _contents, ...freshness } = this.loadSnapshotFile(normalizedPath);
    return freshness;
  }

  private freshnessForPaths(paths: readonly string[]): FreshnessResult {
    const unique = [...new Set(paths)];
    if (unique.length === 0) {
      return { status: "fresh", stale: false, reason: "matches_snapshot" };
    }
    let unknown: FreshnessResult | null = null;
    for (const file of unique) {
      const result = this.fileFreshness(file);
      if (result.status === "stale") {
        return result;
      }
      if (result.status === "unknown") {
        unknown = result;
      }
    }
    return unknown ?? { status: "fresh", stale: false, reason: "matches_snapshot" };
  }

  nodeFreshness(node: GraphNode): FreshnessResult {
    return this.freshnessForPaths([
      ...(node.file === null ? [] : [node.file]),
      ...node.evidence.map((evidence) => evidence.file)
    ]);
  }

  edgeFreshness(edge: GraphEdge): FreshnessResult {
    const source = this.nodesByKey.get(edge.srcEntityKey);
    const destination = this.nodesByKey.get(edge.dstEntityKey);
    return this.freshnessForPaths([
      ...(source?.file ? [source.file] : []),
      ...(destination?.file ? [destination.file] : []),
      ...edge.evidence.map((evidence) => evidence.file)
    ]);
  }

  snapshotFreshness(): FreshnessResult {
    if (this.refreshOverlay?.isSnapshotStale(this.snapshot.id)) {
      return { status: "stale", stale: true, reason: "refresh_pending" };
    }
    try {
      const scan = scanRepository(this.nativeRepoRoot);
      const files = [...scan.indexedFiles, ...scan.supportFiles].map((file) => ({
        normalizedPath: file.normalizedPath,
        contentHash: createHash("sha256").update(readFileSync(file.absolutePath)).digest("hex")
      }));
      if (computeWorkspaceHash(files) !== this.snapshot.workspace_hash) {
        return { status: "stale", stale: true, reason: "content_changed" };
      }
      return { status: "fresh", stale: false, reason: "matches_snapshot" };
    } catch {
      return { status: "unknown", stale: true, reason: "unreadable" };
    }
  }

  isStale(): boolean {
    return this.snapshotFreshness().stale;
  }

  /**
   * Resolves a user-supplied entity reference while preserving ambiguity:
   * entity key, exact qualified name, then display name. Multiple display
   * name matches return candidates instead of silently picking one.
   */
  resolveEntity(input: string): EntityResolution {
    if (/^[0-9a-f]{64}$/.test(input)) {
      const byKey = this.nodesByKey.get(input);
      return { node: byKey ?? null, candidates: byKey ? [byKey] : [] };
    }
    const byQualified = this.nodesByQualifiedName.get(input) ?? [];
    if (byQualified.length === 1 && byQualified[0] !== undefined) {
      return { node: byQualified[0], candidates: byQualified };
    }
    if (byQualified.length > 1) {
      return { node: null, candidates: byQualified };
    }
    const byName = this.nodesByDisplayName.get(input) ?? [];
    if (byName.length === 1 && byName[0] !== undefined) {
      return { node: byName[0], candidates: byName };
    }
    return { node: null, candidates: byName };
  }

  /** node_entities row id for event logging. */
  nodeEntityId(entityKey: string): number | null {
    const row = this.db
      .prepare(
        `SELECT ne.id
         FROM node_entities ne
         JOIN snapshot_nodes sn ON sn.node_id = ne.id
         WHERE ne.repo_id = ? AND ne.entity_key = ? AND sn.snapshot_id = ?`
      )
      .get(this.repoId, entityKey, this.snapshot.id) as { id: number } | undefined;
    return row?.id ?? null;
  }

  /** edge_entities row id for event logging. */
  edgeEntityId(entityKey: string): number | null {
    const row = this.db
      .prepare(
        `SELECT ee.id
         FROM edge_entities ee
         JOIN snapshot_edges se ON se.edge_id = ee.id
         WHERE ee.repo_id = ? AND ee.entity_key = ? AND se.snapshot_id = ?`
      )
      .get(this.repoId, entityKey, this.snapshot.id) as { id: number } | undefined;
    return row?.id ?? null;
  }

  /** Source lines only when the live file still matches the served snapshot. */
  readBody(node: GraphNode): BodyReadResult {
    if (node.file === null || node.lineStart === null || node.lineEnd === null) {
      const freshness = this.nodeFreshness(node);
      return {
        body: null,
        status: freshness.status,
        stale: freshness.stale,
        reason: freshness.status === "fresh" ? "no_source_span" : freshness.reason
      };
    }
    const loaded = this.loadSnapshotFile(node.file);
    if (loaded.contents === null) {
      const { contents: _contents, ...freshness } = loaded;
      return { body: null, ...freshness };
    }
    const lines = loaded.contents
      .toString("utf8")
      .split(/\r?\n/)
      .slice(node.lineStart - 1, node.lineEnd);
    const { contents: _contents, ...freshness } = loaded;
    return { body: lines.length > 0 ? lines.join("\n") : null, ...freshness };
  }
}

/** Rough token estimate used for response budgeting (~4 chars per token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
