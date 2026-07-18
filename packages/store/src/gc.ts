import type { Database } from "./database.js";
import { foreignKeyCheck } from "./database.js";
import { getSnapshot, getSnapshotHead } from "./snapshots.js";

export interface GcResult {
  deletedEdgeEntities: number;
  deletedNodeEntities: number;
  deletedFileEntities: number;
  deletedBoundaryEntities: number;
  deletedDecisionEntities: number;
}

/**
 * Frozen corrections §13: foreign-key-safe orphan-entity garbage collection.
 * Each DELETE's guard conditions are copied verbatim from the corrections
 * document; the statements run inside one immediate transaction and the
 * post-collection `foreign_key_check` must return zero rows.
 */
export function collectOrphanEntities(db: Database): GcResult {
  const run = db.transaction((): GcResult => {
    const edges = db
      .prepare(
        `DELETE FROM edge_entities
WHERE NOT EXISTS (SELECT 1 FROM snapshot_edges WHERE snapshot_edges.edge_id = edge_entities.id)
  AND NOT EXISTS (SELECT 1 FROM retrieval_result_edges WHERE retrieval_result_edges.edge_id = edge_entities.id)
  AND NOT EXISTS (SELECT 1 FROM retrieval_omissions WHERE retrieval_omissions.edge_id = edge_entities.id)
  AND NOT EXISTS (SELECT 1 FROM decision_links WHERE decision_links.edge_id = edge_entities.id)`
      )
      .run();

    const nodes = db
      .prepare(
        `DELETE FROM node_entities
WHERE NOT EXISTS (SELECT 1 FROM snapshot_nodes WHERE snapshot_nodes.node_id = node_entities.id)
  AND NOT EXISTS (SELECT 1 FROM retrieval_result_nodes WHERE retrieval_result_nodes.node_id = node_entities.id)
  AND NOT EXISTS (SELECT 1 FROM retrieval_omissions WHERE retrieval_omissions.node_id = node_entities.id)
  AND NOT EXISTS (SELECT 1 FROM agent_event_targets WHERE agent_event_targets.node_id = node_entities.id)
  AND NOT EXISTS (SELECT 1 FROM decision_links WHERE decision_links.node_id = node_entities.id)
  AND NOT EXISTS (
      SELECT 1 FROM edge_entities
      WHERE edge_entities.src_node_id = node_entities.id
         OR edge_entities.dst_node_id = node_entities.id
  )`
      )
      .run();

    const files = db
      .prepare(
        `DELETE FROM file_entities
WHERE NOT EXISTS (SELECT 1 FROM snapshot_files WHERE snapshot_files.file_id = file_entities.id)
  AND NOT EXISTS (SELECT 1 FROM agent_event_targets WHERE agent_event_targets.file_id = file_entities.id)
  AND NOT EXISTS (SELECT 1 FROM change_set_files WHERE change_set_files.file_id = file_entities.id)`
      )
      .run();

    const boundaries = db
      .prepare(
        `DELETE FROM boundary_entities
WHERE NOT EXISTS (SELECT 1 FROM snapshot_boundaries WHERE snapshot_boundaries.boundary_id = boundary_entities.id)
  AND NOT EXISTS (SELECT 1 FROM decision_links WHERE decision_links.boundary_id = boundary_entities.id)`
      )
      .run();

    const decisions = db
      .prepare(
        `DELETE FROM decision_entities
WHERE NOT EXISTS (SELECT 1 FROM snapshot_decisions WHERE snapshot_decisions.decision_id = decision_entities.id)`
      )
      .run();

    return {
      deletedEdgeEntities: edges.changes,
      deletedNodeEntities: nodes.changes,
      deletedFileEntities: files.changes,
      deletedBoundaryEntities: boundaries.changes,
      deletedDecisionEntities: decisions.changes
    };
  });
  const result = run();

  const violations = foreignKeyCheck(db);
  if (violations.length > 0) {
    throw new Error(
      `foreign_key_check reported ${violations.length} violation(s) after garbage collection: ` +
        JSON.stringify(violations.slice(0, 5))
    );
  }
  return result;
}

/**
 * Snapshot pruning foundation: removes a snapshot's membership rows and marks
 * the snapshot pruned. Pinned snapshots are refused. Stable entities survive
 * (other snapshots may reference them); reclaim them with
 * `collectOrphanEntities` afterwards.
 */
export function pruneSnapshot(db: Database, snapshotId: number): void {
  const run = db.transaction(() => {
    const snapshot = getSnapshot(db, snapshotId);
    if (!snapshot) {
      throw new Error(`No snapshot with id ${snapshotId}`);
    }
    if (snapshot.pinned === 1) {
      throw new Error(`Snapshot ${snapshotId} is pinned and cannot be pruned`);
    }
    const activeTask = db
      .prepare("SELECT id FROM tasks WHERE base_snapshot_id = ? AND status = 'active' LIMIT 1")
      .get(snapshotId) as { id: number } | undefined;
    if (activeTask) {
      throw new Error(
        `Snapshot ${snapshotId} backs active task ${activeTask.id} and cannot be pruned`
      );
    }
    const head = getSnapshotHead(db, snapshot.repo_id, snapshot.kind);
    if (head?.snapshot.id === snapshotId) {
      throw new Error(`Snapshot ${snapshotId} is the current ${snapshot.kind} head and cannot be pruned`);
    }
    // Membership deletion order respects the composite foreign keys:
    // edges and nodes first, then files (which cascades evidence_items).
    db.prepare("DELETE FROM snapshot_edges WHERE snapshot_id = ?").run(snapshotId);
    db.prepare("DELETE FROM snapshot_nodes WHERE snapshot_id = ?").run(snapshotId);
    db.prepare("DELETE FROM snapshot_files WHERE snapshot_id = ?").run(snapshotId);
    db.prepare("DELETE FROM node_fts WHERE snapshot_id = ?").run(snapshotId);
    db.prepare("UPDATE repository_snapshots SET status = 'pruned' WHERE id = ?").run(snapshotId);
  });
  run.immediate();
}
