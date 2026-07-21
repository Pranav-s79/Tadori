import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { GraphEdge, GraphNode } from "@tadori/core";
import {
  captureStagedTree,
  indexRepositoryIntoStore,
  InvalidRepositorySourceError,
  WorkspaceChangedDuringIndexError
} from "@tadori/indexer";
import {
  loadSnapshotGraph,
  openDatabase,
  runMigrations,
  type Database,
  type EdgeDiffRow
} from "@tadori/store";

/**
 * The two live comparison kinds. `working_tree` indexes the current on-disk
 * contents; `staged` indexes the git index (via `captureStagedTree`). Both diff
 * the freshly captured HEAD against the server's active BASE snapshot.
 */
export type LiveComparisonKind = "working_tree" | "staged";

/** Raised when the live capture cannot be indexed into a comparison snapshot. */
export class LiveCaptureFailedError extends Error {
  constructor(
    public readonly kind: LiveComparisonKind,
    detail: string,
    cause?: unknown
  ) {
    super(`failed to capture the ${kind} comparison: ${detail}`);
    this.name = "LiveCaptureFailedError";
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

export interface LiveComparisonResult {
  nodesAdded: GraphNode[];
  nodesRemoved: GraphNode[];
  edges: EdgeDiffRow[];
}

/**
 * In-memory expression of the frozen §11 three-way edge set-difference plus
 * node add/remove, keyed on stable entity keys. Both graphs come from
 * `loadSnapshotGraph`, so entity keys are directly comparable across DBs (the
 * canonical identity → entity key mapping is deterministic and repo-relative).
 * Output ordering is deterministic so the same two snapshots always produce the
 * same page.
 */
export function diffGraphs(
  base: { nodes: GraphNode[]; edges: GraphEdge[] },
  head: { nodes: GraphNode[]; edges: GraphEdge[] }
): LiveComparisonResult {
  const baseNodeKeys = new Set(base.nodes.map((node) => node.entityKey));
  const headNodeKeys = new Set(head.nodes.map((node) => node.entityKey));
  const nodesAdded = head.nodes.filter((node) => !baseNodeKeys.has(node.entityKey));
  const nodesRemoved = base.nodes.filter((node) => !headNodeKeys.has(node.entityKey));

  // entityKey → qualifiedName for edge endpoints, from the union of both sides
  // (an edge endpoint may exist only on one side of the diff).
  const qualifiedByKey = new Map<string, string>();
  for (const node of [...base.nodes, ...head.nodes]) {
    qualifiedByKey.set(node.entityKey, node.qualifiedName);
  }
  const qn = (key: string): string => qualifiedByKey.get(key) ?? key;

  const baseEdges = new Map(base.edges.map((edge) => [edge.entityKey, edge]));
  const headEdges = new Map(head.edges.map((edge) => [edge.entityKey, edge]));

  const rows: EdgeDiffRow[] = [];
  for (const [key, edge] of headEdges) {
    if (!baseEdges.has(key)) {
      rows.push({
        change_kind: "added",
        source: qn(edge.srcEntityKey),
        relation: edge.relation,
        destination: qn(edge.dstEntityKey),
        before_origin: null,
        before_confidence: null,
        before_resolution: null,
        after_origin: edge.origin,
        after_confidence: edge.confidence,
        after_resolution: edge.resolution
      });
    }
  }
  for (const [key, edge] of baseEdges) {
    if (!headEdges.has(key)) {
      rows.push({
        change_kind: "removed",
        source: qn(edge.srcEntityKey),
        relation: edge.relation,
        destination: qn(edge.dstEntityKey),
        before_origin: edge.origin,
        before_confidence: edge.confidence,
        before_resolution: edge.resolution,
        after_origin: null,
        after_confidence: null,
        after_resolution: null
      });
    }
  }
  for (const [key, headEdge] of headEdges) {
    const baseEdge = baseEdges.get(key);
    if (!baseEdge) {
      continue;
    }
    if (
      baseEdge.origin !== headEdge.origin ||
      baseEdge.confidence !== headEdge.confidence ||
      baseEdge.resolution !== headEdge.resolution
    ) {
      rows.push({
        change_kind: "resolution_or_provenance_changed",
        source: qn(headEdge.srcEntityKey),
        relation: headEdge.relation,
        destination: qn(headEdge.dstEntityKey),
        before_origin: baseEdge.origin,
        before_confidence: baseEdge.confidence,
        before_resolution: baseEdge.resolution,
        after_origin: headEdge.origin,
        after_confidence: headEdge.confidence,
        after_resolution: headEdge.resolution
      });
    }
  }

  const nodeSort = (a: GraphNode, b: GraphNode): number => a.entityKey.localeCompare(b.entityKey);
  const edgeSort = (a: EdgeDiffRow, b: EdgeDiffRow): number =>
    [a.change_kind, a.source, a.relation, a.destination]
      .join("\0")
      .localeCompare([b.change_kind, b.source, b.relation, b.destination].join("\0"));

  return {
    nodesAdded: nodesAdded.sort(nodeSort),
    nodesRemoved: nodesRemoved.sort(nodeSort),
    edges: rows.sort(edgeSort)
  };
}

/**
 * Capture the live `working_tree` / `staged` state, index it into an ISOLATED
 * temporary database (never the served DB — so the served active snapshot is
 * never rotated and the working tree / git index are never mutated), and diff
 * that captured HEAD against the served active BASE snapshot in memory.
 *
 * All temporary resources (staged temp dir, temp DB + its file) are disposed in
 * `finally`. Indexing failures surface as typed errors; git-availability /
 * not-a-repo / invalid-index errors from `captureStagedTree` propagate
 * unchanged so the route can map them to honest HTTP codes.
 */
export async function computeLiveComparison(
  servedDb: Database,
  repoRoot: string,
  activeSnapshotId: number,
  kind: LiveComparisonKind
): Promise<LiveComparisonResult> {
  const disposers: Array<() => void> = [];
  try {
    let capturePath = repoRoot;
    if (kind === "staged") {
      const staged = await captureStagedTree(repoRoot);
      disposers.push(staged.dispose);
      capturePath = staged.dir;
    }

    const tempDbDir = mkdtempSync(path.join(tmpdir(), "tadori-live-diff-"));
    disposers.push(() => rmSync(tempDbDir, { recursive: true, force: true }));
    const tempDb = openDatabase(path.join(tempDbDir, "compare.sqlite"));
    disposers.push(() => tempDb.close());
    runMigrations(tempDb);

    let headSnapshotId: number;
    try {
      const indexed = indexRepositoryIntoStore(tempDb, capturePath, { kind });
      headSnapshotId = indexed.snapshotId;
    } catch (err) {
      if (
        err instanceof InvalidRepositorySourceError ||
        err instanceof WorkspaceChangedDuringIndexError
      ) {
        throw new LiveCaptureFailedError(kind, err.message, err);
      }
      throw err;
    }

    const headGraph = loadSnapshotGraph(tempDb, headSnapshotId);
    const baseGraph = loadSnapshotGraph(servedDb, activeSnapshotId);
    return diffGraphs(baseGraph, headGraph);
  } finally {
    // Dispose in reverse acquisition order (close DB before removing its dir).
    for (const dispose of disposers.reverse()) {
      try {
        dispose();
      } catch {
        // Best-effort cleanup; a failed disposer must not mask the real result.
      }
    }
  }
}
