import type {
  Confidence,
  Evidence,
  EvidenceKind,
  GraphEdge,
  GraphFile,
  GraphNode,
  NodeKind,
  Origin,
  Relation,
  RepoStateKind,
  Resolution,
  SnapshotGraph
} from "@tadori/core";
import { entityKey } from "@tadori/core";
import type { Database } from "./database.js";

export interface SnapshotRow {
  id: number;
  repo_id: number;
  kind: RepoStateKind;
  label: string | null;
  base_commit_sha: string | null;
  workspace_hash: string;
  parent_snapshot_id: number | null;
  created_at: string;
  pinned: number;
  status: "active" | "pruned";
}

export interface DanglingEndpointRow {
  snapshot_id: number;
  edge_id: number;
  src_node_id: number;
  dst_node_id: number;
  missing_source_membership: number;
  missing_destination_membership: number;
}

export class DanglingEndpointError extends Error {
  constructor(
    public readonly snapshotId: number,
    public readonly rows: DanglingEndpointRow[]
  ) {
    super(
      `Snapshot ${snapshotId} has ${rows.length} edge membership(s) with missing endpoint ` +
        `node membership(s); the snapshot was rejected and rolled back. First offending ` +
        `edge_id: ${rows[0]?.edge_id ?? "n/a"}`
    );
    this.name = "DanglingEndpointError";
  }
}

export function ensureRepository(db: Database, rootPath: string): number {
  const existing = db
    .prepare("SELECT id FROM repositories WHERE root_path = ?")
    .get(rootPath) as { id: number } | undefined;
  if (existing) {
    return existing.id;
  }
  const result = db.prepare("INSERT INTO repositories (root_path) VALUES (?)").run(rootPath);
  return Number(result.lastInsertRowid);
}

interface EntityRow {
  id: number;
  canonical_identity?: string;
  origin_identity?: string;
}

/**
 * Inserts a stable entity keyed by its canonical identity, handling true
 * SHA-256 collisions by appending a collision index and rehashing (frozen
 * corrections §1). Returns the entity row id.
 */
function ensureKeyedEntity(
  db: Database,
  opts: {
    selectByCanonical: string;
    insert: string;
    repoId: number;
    canonical: string;
    extra: Record<string, string | number | null>;
    keyExists: (key: string) => boolean;
  }
): number {
  const existing = db.prepare(opts.selectByCanonical).get(opts.repoId, opts.canonical) as
    | EntityRow
    | undefined;
  if (existing) {
    return existing.id;
  }
  for (let collisionIndex = 0; collisionIndex < 1000; collisionIndex += 1) {
    const key = entityKey(opts.canonical, collisionIndex);
    if (opts.keyExists(key)) {
      continue;
    }
    const result = db
      .prepare(opts.insert)
      .run({ repoId: opts.repoId, key, canonical: opts.canonical, collisionIndex, ...opts.extra });
    return Number(result.lastInsertRowid);
  }
  throw new Error(
    `Exhausted 1000 collision indexes for canonical identity ${JSON.stringify(opts.canonical)}`
  );
}

export function ensureFileEntity(db: Database, repoId: number, originIdentity: string): number {
  const keyTaken = db.prepare(
    "SELECT 1 FROM file_entities WHERE repo_id = ? AND file_key = ?"
  );
  return ensureKeyedEntity(db, {
    selectByCanonical: "SELECT id FROM file_entities WHERE repo_id = ? AND origin_identity = ?",
    insert:
      "INSERT INTO file_entities (repo_id, file_key, origin_identity, collision_index) " +
      "VALUES (@repoId, @key, @canonical, @collisionIndex)",
    repoId,
    canonical: originIdentity,
    extra: {},
    keyExists: (key) => keyTaken.get(repoId, key) !== undefined
  });
}

export function ensureNodeEntity(
  db: Database,
  repoId: number,
  canonical: string,
  kind: NodeKind,
  qualifiedName: string
): number {
  const keyTaken = db.prepare(
    "SELECT 1 FROM node_entities WHERE repo_id = ? AND entity_key = ?"
  );
  return ensureKeyedEntity(db, {
    selectByCanonical: "SELECT id FROM node_entities WHERE repo_id = ? AND canonical_identity = ?",
    insert:
      "INSERT INTO node_entities (repo_id, entity_key, canonical_identity, collision_index, kind, qualified_name) " +
      "VALUES (@repoId, @key, @canonical, @collisionIndex, @kind, @qualifiedName)",
    repoId,
    canonical,
    extra: { kind, qualifiedName },
    keyExists: (key) => keyTaken.get(repoId, key) !== undefined
  });
}

export function ensureEdgeEntity(
  db: Database,
  repoId: number,
  canonical: string,
  srcNodeId: number,
  dstNodeId: number,
  relation: Relation
): number {
  const keyTaken = db.prepare(
    "SELECT 1 FROM edge_entities WHERE repo_id = ? AND entity_key = ?"
  );
  return ensureKeyedEntity(db, {
    selectByCanonical: "SELECT id FROM edge_entities WHERE repo_id = ? AND canonical_identity = ?",
    insert:
      "INSERT INTO edge_entities (repo_id, entity_key, canonical_identity, collision_index, src_node_id, dst_node_id, relation) " +
      "VALUES (@repoId, @key, @canonical, @collisionIndex, @srcNodeId, @dstNodeId, @relation)",
    repoId,
    canonical,
    extra: { srcNodeId, dstNodeId, relation },
    keyExists: (key) => keyTaken.get(repoId, key) !== undefined
  });
}

/** Frozen corrections §10: dangling endpoint membership validation. */
export function findDanglingEndpoints(db: Database, snapshotId?: number): DanglingEndpointRow[] {
  const sql = `
SELECT
    se.snapshot_id,
    se.edge_id,
    ee.src_node_id,
    ee.dst_node_id,
    CASE WHEN src.node_id IS NULL THEN 1 ELSE 0 END AS missing_source_membership,
    CASE WHEN dst.node_id IS NULL THEN 1 ELSE 0 END AS missing_destination_membership
FROM snapshot_edges AS se
JOIN edge_entities AS ee ON ee.id = se.edge_id
LEFT JOIN snapshot_nodes AS src
  ON src.snapshot_id = se.snapshot_id AND src.node_id = ee.src_node_id
LEFT JOIN snapshot_nodes AS dst
  ON dst.snapshot_id = se.snapshot_id AND dst.node_id = ee.dst_node_id
WHERE (src.node_id IS NULL OR dst.node_id IS NULL)`;
  if (snapshotId === undefined) {
    return db.prepare(sql).all() as DanglingEndpointRow[];
  }
  return db.prepare(`${sql} AND se.snapshot_id = ?`).all(snapshotId) as DanglingEndpointRow[];
}

export interface InsertSnapshotOptions {
  parentSnapshotId?: number | null;
  pinned?: boolean;
  /**
   * Test-only escape hatch: persists the snapshot without endpoint validation
   * so serving-side rejection can be exercised. Never use in production paths.
   */
  dangerouslySkipValidation?: boolean;
}

export interface InsertSnapshotResult {
  repoId: number;
  snapshotId: number;
}

/**
 * Inserts one extracted snapshot graph in a single transaction. Stable
 * entities are created on first sight and reused afterwards; per-snapshot
 * state lands in membership rows. If any edge membership lacks an endpoint
 * node membership the transaction is rolled back (frozen corrections §10).
 */
export function insertSnapshotGraph(
  db: Database,
  graph: SnapshotGraph,
  options: InsertSnapshotOptions = {}
): InsertSnapshotResult {
  const run = db.transaction((): InsertSnapshotResult => {
    const repoId = ensureRepository(db, graph.repoRootPath);

    const snapshotResult = db
      .prepare(
        `INSERT INTO repository_snapshots
           (repo_id, kind, label, base_commit_sha, workspace_hash, parent_snapshot_id, pinned)
         VALUES (@repoId, @kind, @label, @baseCommitSha, @workspaceHash, @parentSnapshotId, @pinned)`
      )
      .run({
        repoId,
        kind: graph.kind,
        label: graph.label,
        baseCommitSha: graph.baseCommitSha,
        workspaceHash: graph.workspaceHash,
        parentSnapshotId: options.parentSnapshotId ?? null,
        pinned: options.pinned ? 1 : 0
      });
    const snapshotId = Number(snapshotResult.lastInsertRowid);

    const fileIdByPath = new Map<string, number>();
    const insertSnapshotFile = db.prepare(
      `INSERT INTO snapshot_files
         (snapshot_id, file_id, path, normalized_path, package_name, language,
          content_hash, size_bytes, is_generated, is_binary)
       VALUES (@snapshotId, @fileId, @path, @normalizedPath, @packageName, @language,
               @contentHash, @sizeBytes, @isGenerated, @isBinary)`
    );
    for (const file of graph.files) {
      const fileId = ensureFileEntity(db, repoId, file.originIdentity);
      fileIdByPath.set(file.normalizedPath, fileId);
      insertSnapshotFile.run({
        snapshotId,
        fileId,
        path: file.path,
        normalizedPath: file.normalizedPath,
        packageName: file.packageName,
        language: file.language,
        contentHash: file.contentHash,
        sizeBytes: file.sizeBytes,
        isGenerated: file.isGenerated ? 1 : 0,
        isBinary: file.isBinary ? 1 : 0
      });
    }

    const insertEvidence = db.prepare(
      `INSERT INTO evidence_items
         (snapshot_id, file_id, evidence_kind, line_start, line_end, column_start, column_end,
          commit_sha, excerpt_hash)
       VALUES (@snapshotId, @fileId, @kind, @lineStart, @lineEnd, @columnStart, @columnEnd,
               @commitSha, @excerptHash)`
    );
    const insertEvidenceItem = (evidence: Evidence): number => {
      const fileId = fileIdByPath.get(evidence.file);
      if (fileId === undefined) {
        throw new Error(
          `Evidence references ${JSON.stringify(evidence.file)} which is not a member of this snapshot`
        );
      }
      const result = insertEvidence.run({
        snapshotId,
        fileId,
        kind: evidence.kind,
        lineStart: evidence.lineStart,
        lineEnd: evidence.lineEnd,
        columnStart: evidence.columnStart ?? null,
        columnEnd: evidence.columnEnd ?? null,
        commitSha: evidence.commitSha ?? null,
        excerptHash: evidence.excerptHash ?? null
      });
      return Number(result.lastInsertRowid);
    };

    const nodeIdByEntityKey = new Map<string, number>();
    const insertSnapshotNode = db.prepare(
      `INSERT INTO snapshot_nodes
         (snapshot_id, node_id, file_id, display_name, span_start, span_end,
          line_start, line_end, signature, body_hash, exported, analyzer_version)
       VALUES (@snapshotId, @nodeId, @fileId, @displayName, @spanStart, @spanEnd,
               @lineStart, @lineEnd, @signature, @bodyHash, @exported, @analyzerVersion)`
    );
    const insertNodeEvidence = db.prepare(
      "INSERT INTO node_evidence (snapshot_id, node_id, evidence_id) VALUES (?, ?, ?)"
    );
    for (const node of graph.nodes) {
      const nodeId = ensureNodeEntity(db, repoId, node.canonicalIdentity, node.kind, node.qualifiedName);
      nodeIdByEntityKey.set(node.entityKey, nodeId);
      const fileId = node.file === null ? null : (fileIdByPath.get(node.file) ?? null);
      if (node.file !== null && fileId === null) {
        throw new Error(
          `Node ${node.qualifiedName} references file ${node.file} which is not a snapshot member`
        );
      }
      insertSnapshotNode.run({
        snapshotId,
        nodeId,
        fileId,
        displayName: node.displayName,
        spanStart: node.spanStart,
        spanEnd: node.spanEnd,
        lineStart: node.lineStart,
        lineEnd: node.lineEnd,
        signature: node.signature,
        bodyHash: node.bodyHash,
        exported: node.exported ? 1 : 0,
        analyzerVersion: graph.analyzerVersion
      });
      for (const evidence of node.evidence) {
        insertNodeEvidence.run(snapshotId, nodeId, insertEvidenceItem(evidence));
      }
    }

    const insertSnapshotEdge = db.prepare(
      `INSERT INTO snapshot_edges (snapshot_id, edge_id, origin, confidence, resolution, analyzer_version)
       VALUES (@snapshotId, @edgeId, @origin, @confidence, @resolution, @analyzerVersion)`
    );
    const insertEdgeEvidence = db.prepare(
      "INSERT INTO edge_evidence (snapshot_id, edge_id, evidence_id) VALUES (?, ?, ?)"
    );
    const selectNodeByKey = db.prepare(
      "SELECT id FROM node_entities WHERE repo_id = ? AND entity_key = ?"
    );
    // Edge endpoints may be stable entities first seen in an earlier snapshot;
    // membership validation below still requires them in THIS snapshot.
    const resolveEndpoint = (key: string): number | undefined => {
      const fromPayload = nodeIdByEntityKey.get(key);
      if (fromPayload !== undefined) {
        return fromPayload;
      }
      const row = selectNodeByKey.get(repoId, key) as { id: number } | undefined;
      return row?.id;
    };
    for (const edge of graph.edges) {
      const srcNodeId = resolveEndpoint(edge.srcEntityKey);
      const dstNodeId = resolveEndpoint(edge.dstEntityKey);
      if (srcNodeId === undefined || dstNodeId === undefined) {
        throw new Error(
          `Edge ${edge.canonicalIdentity} references node keys unknown to this repository`
        );
      }
      const edgeId = ensureEdgeEntity(
        db,
        repoId,
        edge.canonicalIdentity,
        srcNodeId,
        dstNodeId,
        edge.relation
      );
      insertSnapshotEdge.run({
        snapshotId,
        edgeId,
        origin: edge.origin,
        confidence: edge.confidence,
        resolution: edge.resolution,
        analyzerVersion: graph.analyzerVersion
      });
      for (const evidence of edge.evidence) {
        insertEdgeEvidence.run(snapshotId, edgeId, insertEvidenceItem(evidence));
      }
    }

    if (!options.dangerouslySkipValidation) {
      const dangling = findDanglingEndpoints(db, snapshotId);
      if (dangling.length > 0) {
        throw new DanglingEndpointError(snapshotId, dangling);
      }
    }

    return { repoId, snapshotId };
  });
  return run();
}

export function getSnapshot(db: Database, snapshotId: number): SnapshotRow | undefined {
  return db.prepare("SELECT * FROM repository_snapshots WHERE id = ?").get(snapshotId) as
    | SnapshotRow
    | undefined;
}

export function listSnapshots(db: Database, repoId: number): SnapshotRow[] {
  return db
    .prepare("SELECT * FROM repository_snapshots WHERE repo_id = ? ORDER BY id")
    .all(repoId) as SnapshotRow[];
}

/**
 * Returns the newest active snapshot that passes dangling-endpoint
 * validation. Invalid snapshots are never served (frozen corrections §10).
 */
export function getActiveSnapshot(
  db: Database,
  repoId: number,
  kind?: RepoStateKind
): SnapshotRow | undefined {
  const rows = db
    .prepare(
      `SELECT * FROM repository_snapshots
       WHERE repo_id = ? AND status = 'active' AND (@kind IS NULL OR kind = @kind)
       ORDER BY id DESC`
    )
    .all(repoId, { kind: kind ?? null }) as SnapshotRow[];
  for (const row of rows) {
    if (findDanglingEndpoints(db, row.id).length === 0) {
      return row;
    }
  }
  return undefined;
}

export interface StoredSnapshotGraph {
  snapshot: SnapshotRow;
  files: GraphFile[];
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface StoredEvidenceRow {
  normalized_path: string;
  evidence_kind: EvidenceKind;
  line_start: number | null;
  line_end: number | null;
  column_start: number | null;
  column_end: number | null;
  commit_sha: string | null;
  excerpt_hash: string | null;
}

function rowToEvidence(row: StoredEvidenceRow): Evidence {
  return {
    file: row.normalized_path,
    kind: row.evidence_kind,
    lineStart: row.line_start ?? 1,
    lineEnd: row.line_end ?? 1,
    ...(row.column_start !== null ? { columnStart: row.column_start } : {}),
    ...(row.column_end !== null ? { columnEnd: row.column_end } : {}),
    ...(row.commit_sha !== null ? { commitSha: row.commit_sha } : {}),
    ...(row.excerpt_hash !== null ? { excerptHash: row.excerpt_hash } : {})
  };
}

/** Loads a stored snapshot back into the shared graph shape for comparison. */
export function loadSnapshotGraph(db: Database, snapshotId: number): StoredSnapshotGraph {
  const snapshot = getSnapshot(db, snapshotId);
  if (!snapshot) {
    throw new Error(`No snapshot with id ${snapshotId}`);
  }

  const files = (
    db
      .prepare(
        `SELECT sf.*, fe.origin_identity, fe.file_key
         FROM snapshot_files sf JOIN file_entities fe ON fe.id = sf.file_id
         WHERE sf.snapshot_id = ? ORDER BY sf.normalized_path`
      )
      .all(snapshotId) as Array<{
      path: string;
      normalized_path: string;
      origin_identity: string;
      file_key: string;
      package_name: string | null;
      language: string | null;
      content_hash: string;
      size_bytes: number;
      is_generated: number;
      is_binary: number;
    }>
  ).map(
    (row): GraphFile => ({
      path: row.path,
      normalizedPath: row.normalized_path,
      originIdentity: row.origin_identity,
      fileKey: row.file_key,
      packageName: row.package_name,
      language: row.language,
      contentHash: row.content_hash,
      sizeBytes: row.size_bytes,
      isGenerated: row.is_generated === 1,
      isBinary: row.is_binary === 1
    })
  );

  const nodeEvidence = db.prepare(
    `SELECT sf.normalized_path, ei.evidence_kind, ei.line_start, ei.line_end,
            ei.column_start, ei.column_end, ei.commit_sha, ei.excerpt_hash
     FROM node_evidence ne
     JOIN evidence_items ei ON ei.id = ne.evidence_id
     JOIN snapshot_files sf ON sf.snapshot_id = ei.snapshot_id AND sf.file_id = ei.file_id
     WHERE ne.snapshot_id = ? AND ne.node_id = ?
     ORDER BY ei.id`
  );

  const nodes = (
    db
      .prepare(
        `SELECT sn.*, ne.entity_key, ne.canonical_identity, ne.kind, ne.qualified_name,
                sf.normalized_path AS file_path
         FROM snapshot_nodes sn
         JOIN node_entities ne ON ne.id = sn.node_id
         LEFT JOIN snapshot_files sf ON sf.snapshot_id = sn.snapshot_id AND sf.file_id = sn.file_id
         WHERE sn.snapshot_id = ? ORDER BY ne.entity_key`
      )
      .all(snapshotId) as Array<{
      node_id: number;
      entity_key: string;
      canonical_identity: string;
      kind: NodeKind;
      qualified_name: string;
      file_path: string | null;
      display_name: string;
      span_start: number | null;
      span_end: number | null;
      line_start: number | null;
      line_end: number | null;
      signature: string | null;
      body_hash: string | null;
      exported: number;
    }>
  ).map(
    (row): GraphNode => ({
      kind: row.kind,
      qualifiedName: row.qualified_name,
      displayName: row.display_name,
      canonicalIdentity: row.canonical_identity,
      entityKey: row.entity_key,
      file: row.file_path,
      exported: row.exported === 1,
      spanStart: row.span_start,
      spanEnd: row.span_end,
      lineStart: row.line_start,
      lineEnd: row.line_end,
      signature: row.signature,
      bodyHash: row.body_hash,
      evidence: (nodeEvidence.all(snapshotId, row.node_id) as StoredEvidenceRow[]).map(
        rowToEvidence
      )
    })
  );

  const edgeEvidence = db.prepare(
    `SELECT sf.normalized_path, ei.evidence_kind, ei.line_start, ei.line_end,
            ei.column_start, ei.column_end, ei.commit_sha, ei.excerpt_hash
     FROM edge_evidence ee
     JOIN evidence_items ei ON ei.id = ee.evidence_id
     JOIN snapshot_files sf ON sf.snapshot_id = ei.snapshot_id AND sf.file_id = ei.file_id
     WHERE ee.snapshot_id = ? AND ee.edge_id = ?
     ORDER BY ei.id`
  );

  const edges = (
    db
      .prepare(
        `SELECT se.*, ed.entity_key, ed.canonical_identity, ed.relation,
                src.entity_key AS src_entity_key, dst.entity_key AS dst_entity_key
         FROM snapshot_edges se
         JOIN edge_entities ed ON ed.id = se.edge_id
         JOIN node_entities src ON src.id = ed.src_node_id
         JOIN node_entities dst ON dst.id = ed.dst_node_id
         WHERE se.snapshot_id = ? ORDER BY ed.entity_key`
      )
      .all(snapshotId) as Array<{
      edge_id: number;
      entity_key: string;
      canonical_identity: string;
      relation: Relation;
      src_entity_key: string;
      dst_entity_key: string;
      origin: Origin;
      confidence: Confidence;
      resolution: Resolution;
    }>
  ).map(
    (row): GraphEdge => ({
      srcEntityKey: row.src_entity_key,
      relation: row.relation,
      dstEntityKey: row.dst_entity_key,
      canonicalIdentity: row.canonical_identity,
      entityKey: row.entity_key,
      origin: row.origin,
      confidence: row.confidence,
      resolution: row.resolution,
      evidence: (edgeEvidence.all(snapshotId, row.edge_id) as StoredEvidenceRow[]).map(
        rowToEvidence
      )
    })
  );

  return { snapshot, files, nodes, edges };
}
