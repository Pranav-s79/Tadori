import path from "node:path";
import {
  diffSnapshotEdges,
  getActiveSnapshot,
  type Database,
  type EdgeDiffRow
} from "@tadori/store";
import { IncrementalRepositoryIndexer } from "./incremental.js";

export interface WorkingTreeDiffResult {
  repoRoot: string;
  baseSnapshotId: number;
  headSnapshotId: number;
  changed: boolean;
  edges: EdgeDiffRow[];
}

/**
 * Implements the frozen `tadori diff .` edge-diff surface. The deterministic
 * base is the currently served working-tree head, falling back to the current
 * commit head when this repository has not yet captured a working tree.
 * Current disk state is reconciled and atomically published before comparison.
 */
export async function diffWorkingTree(
  db: Database,
  rootPath: string
): Promise<WorkingTreeDiffResult> {
  const root = path.resolve(rootPath);
  const normalizedRoot = root.split(path.sep).join("/");
  const repo = db
    .prepare("SELECT id FROM repositories WHERE root_path = ?")
    .get(normalizedRoot) as { id: number } | undefined;
  const base = repo
    ? getActiveSnapshot(db, repo.id, "working_tree") ?? getActiveSnapshot(db, repo.id, "commit")
    : undefined;

  const indexer = new IncrementalRepositoryIndexer(db, root);
  try {
    const initialized = await indexer.initialize();
    await indexer.waitForIdle();
    const state = indexer.state();
    if (state.snapshotId === null) {
      throw new Error("Working-tree reconciliation produced no active snapshot");
    }
    const baseSnapshotId = base?.id ?? initialized.snapshot.id;
    const edges = diffSnapshotEdges(db, baseSnapshotId, state.snapshotId).sort((left, right) =>
      [left.change_kind, left.source, left.relation, left.destination]
        .join("\0")
        .localeCompare([right.change_kind, right.source, right.relation, right.destination].join("\0"))
    );
    return {
      repoRoot: normalizedRoot,
      baseSnapshotId,
      headSnapshotId: state.snapshotId,
      changed: baseSnapshotId !== state.snapshotId || edges.length > 0,
      edges
    };
  } finally {
    await indexer.stop();
  }
}
