import type { NodeKind } from "@tadori/core";
import type { Database } from "./database.js";

export interface FtsMatchRow {
  node_id: number;
  entity_key: string;
  kind: NodeKind;
  qualified_name: string;
  display_name: string;
  signature: string | null;
  file_path: string | null;
  line_start: number | null;
  line_end: number | null;
  exported: number;
  rank: number;
  exact_match: number;
}

export interface FtsSearchResult {
  matches: FtsMatchRow[];
  total: number;
}

/**
 * Turns free text into a safe FTS5 prefix query: each token is quoted (so
 * user input can never inject FTS syntax) and given a prefix wildcard.
 */
export function toFtsQuery(query: string): string | null {
  const tokens = query
    .split(/[^\p{L}\p{N}_$]+/u)
    .filter((t) => t.length > 0)
    .map((t) => `"${t.replace(/"/g, "")}"*`);
  return tokens.length > 0 ? tokens.join(" ") : null;
}

/**
 * FTS5 search over one snapshot's nodes (frozen spec §5: FTS5 plus
 * exact-match boost, applied by the caller). Returns at most `limit` rows
 * ordered by FTS rank.
 */
export function ensureSnapshotFts(db: Database, snapshotId: number): void {
  const integrity = db
    .prepare(
      `SELECT COUNT(*) AS bad_count
       FROM (
         SELECT sn.node_id
         FROM snapshot_nodes sn
         LEFT JOIN node_fts f
           ON f.snapshot_id = sn.snapshot_id AND f.node_id = sn.node_id
         WHERE sn.snapshot_id = ?
         GROUP BY sn.node_id
         HAVING COUNT(f.node_id) <> 1
         UNION ALL
         SELECT f.node_id
         FROM node_fts f
         LEFT JOIN snapshot_nodes sn
           ON sn.snapshot_id = f.snapshot_id AND sn.node_id = f.node_id
         WHERE f.snapshot_id = ? AND sn.node_id IS NULL
       )`
    )
    .get(snapshotId, snapshotId) as { bad_count: number };
  if (integrity.bad_count === 0) {
    return;
  }

  const rebuild = db.transaction(() => {
    db.prepare("DELETE FROM node_fts WHERE snapshot_id = ?").run(snapshotId);
    db.prepare(
      `INSERT INTO node_fts (snapshot_id, node_id, display_name, qualified_name, signature, path)
       SELECT sn.snapshot_id, sn.node_id, sn.display_name, ne.qualified_name,
              COALESCE(sn.signature, ''), COALESCE(sf.normalized_path, '')
       FROM snapshot_nodes sn
       JOIN node_entities ne ON ne.id = sn.node_id
       LEFT JOIN snapshot_files sf
         ON sf.snapshot_id = sn.snapshot_id AND sf.file_id = sn.file_id
       WHERE sn.snapshot_id = ?
       ORDER BY ne.entity_key`
    ).run(snapshotId);
  });
  rebuild();
}

export function searchNodeFts(
  db: Database,
  snapshotId: number,
  query: string,
  limit: number,
  kind?: NodeKind,
  offset = 0
): FtsSearchResult {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError("FTS search limit must be an integer from 1 to 100");
  }
  if (!Number.isInteger(offset) || offset < 0 || offset > 1_000_000) {
    throw new RangeError("FTS search offset must be an integer from 0 to 1000000");
  }
  const ftsQuery = toFtsQuery(query);
  if (ftsQuery === null) {
    return { matches: [], total: 0 };
  }
  ensureSnapshotFts(db, snapshotId);
  const params = {
    ftsQuery,
    snapshotId,
    query: query.trim(),
    kind: kind ?? null,
    limit,
    offset
  };
  const matches = db
    .prepare(
      `SELECT f.node_id, ne.entity_key, ne.kind, ne.qualified_name,
              sn.display_name, sn.signature, sf.normalized_path AS file_path,
              sn.line_start, sn.line_end, sn.exported, f.rank,
              CASE
                WHEN lower(sn.display_name) = lower(@query)
                  OR lower(ne.qualified_name) = lower(@query)
                  OR lower(COALESCE(sn.signature, '')) = lower(@query)
                  OR lower(COALESCE(sf.normalized_path, '')) = lower(@query)
                THEN 1 ELSE 0
              END AS exact_match
       FROM node_fts AS f
       JOIN node_entities ne ON ne.id = f.node_id
       JOIN snapshot_nodes sn ON sn.snapshot_id = f.snapshot_id AND sn.node_id = f.node_id
       LEFT JOIN snapshot_files sf ON sf.snapshot_id = sn.snapshot_id AND sf.file_id = sn.file_id
       WHERE node_fts MATCH @ftsQuery AND f.snapshot_id = @snapshotId
         AND (@kind IS NULL OR ne.kind = @kind)
       ORDER BY exact_match DESC, f.rank, ne.entity_key
       LIMIT @limit OFFSET @offset`
    )
    .all(params) as FtsMatchRow[];
  const total = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM node_fts AS f
       JOIN node_entities ne ON ne.id = f.node_id
       JOIN snapshot_nodes sn ON sn.snapshot_id = f.snapshot_id AND sn.node_id = f.node_id
       WHERE node_fts MATCH @ftsQuery AND f.snapshot_id = @snapshotId
         AND (@kind IS NULL OR ne.kind = @kind)`
    )
    .get(params) as { count: number };
  return { matches, total: total.count };
}
