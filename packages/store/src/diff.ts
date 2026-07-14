import type { Confidence, Origin, Relation, Resolution } from "@tadori/core";
import type { Database } from "./database.js";

export interface EdgeDiffRow {
  change_kind: "added" | "removed" | "resolution_or_provenance_changed";
  source: string;
  relation: Relation;
  destination: string;
  before_origin: Origin | null;
  before_confidence: Confidence | null;
  before_resolution: Resolution | null;
  after_origin: Origin | null;
  after_confidence: Confidence | null;
  after_resolution: Resolution | null;
}

/**
 * Frozen corrections §11: exact three-way set difference between two stored
 * snapshot edge sets (added, removed, membership-property changed).
 */
export function diffSnapshotEdges(
  db: Database,
  baseSnapshotId: number,
  headSnapshotId: number
): EdgeDiffRow[] {
  const sql = `
WITH edge_diff AS (
    SELECT
        'added' AS change_kind,
        head.edge_id,
        NULL AS before_origin,
        NULL AS before_confidence,
        NULL AS before_resolution,
        head.origin AS after_origin,
        head.confidence AS after_confidence,
        head.resolution AS after_resolution
    FROM snapshot_edges AS head
    WHERE head.snapshot_id = :head_snapshot
      AND NOT EXISTS (
          SELECT 1 FROM snapshot_edges AS base
          WHERE base.snapshot_id = :base_snapshot
            AND base.edge_id = head.edge_id
      )

    UNION ALL

    SELECT
        'removed',
        base.edge_id,
        base.origin,
        base.confidence,
        base.resolution,
        NULL,
        NULL,
        NULL
    FROM snapshot_edges AS base
    WHERE base.snapshot_id = :base_snapshot
      AND NOT EXISTS (
          SELECT 1 FROM snapshot_edges AS head
          WHERE head.snapshot_id = :head_snapshot
            AND head.edge_id = base.edge_id
      )

    UNION ALL

    SELECT
        'resolution_or_provenance_changed',
        head.edge_id,
        base.origin,
        base.confidence,
        base.resolution,
        head.origin,
        head.confidence,
        head.resolution
    FROM snapshot_edges AS base
    JOIN snapshot_edges AS head
      ON head.edge_id = base.edge_id
     AND head.snapshot_id = :head_snapshot
    WHERE base.snapshot_id = :base_snapshot
      AND (
          base.origin <> head.origin OR
          base.confidence <> head.confidence OR
          base.resolution <> head.resolution
      )
)
SELECT
    d.change_kind,
    src.qualified_name AS source,
    e.relation,
    dst.qualified_name AS destination,
    d.before_origin,
    d.before_confidence,
    d.before_resolution,
    d.after_origin,
    d.after_confidence,
    d.after_resolution
FROM edge_diff AS d
JOIN edge_entities AS e ON e.id = d.edge_id
JOIN node_entities AS src ON src.id = e.src_node_id
JOIN node_entities AS dst ON dst.id = e.dst_node_id`;
  return db
    .prepare(sql)
    .all({ base_snapshot: baseSnapshotId, head_snapshot: headSnapshotId }) as EdgeDiffRow[];
}
