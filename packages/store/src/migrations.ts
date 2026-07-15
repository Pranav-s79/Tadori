/**
 * Tadori database migrations. Versions 1-5 are copied verbatim from
 * "Tadori v2.1 - Frozen Implementation Corrections", section 9. Do not edit
 * those migrations. Later additive migrations must cite a proven defect in
 * the implementation status document.
 */

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const migration001: Migration = {
  version: 1,
  name: "repositories, snapshots, stable entities, memberships, evidence",
  sql: `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

BEGIN IMMEDIATE;

CREATE TABLE repositories (
    id INTEGER PRIMARY KEY,
    root_path TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE repository_snapshots (
    id INTEGER PRIMARY KEY,
    repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('commit','working_tree','staged','patch')),
    label TEXT,
    base_commit_sha TEXT,
    workspace_hash TEXT NOT NULL,
    parent_snapshot_id INTEGER REFERENCES repository_snapshots(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1)),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pruned')),
    UNIQUE (repo_id, kind, workspace_hash)
);

CREATE INDEX idx_snapshots_repo_created ON repository_snapshots(repo_id, created_at);

CREATE TABLE file_entities (
    id INTEGER PRIMARY KEY,
    repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    file_key TEXT NOT NULL,
    origin_identity TEXT NOT NULL,
    collision_index INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (repo_id, file_key),
    UNIQUE (repo_id, origin_identity)
);

CREATE TABLE snapshot_files (
    snapshot_id INTEGER NOT NULL REFERENCES repository_snapshots(id) ON DELETE CASCADE,
    file_id INTEGER NOT NULL REFERENCES file_entities(id) ON DELETE RESTRICT,
    path TEXT NOT NULL,
    normalized_path TEXT NOT NULL,
    package_name TEXT,
    language TEXT,
    content_hash TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    is_generated INTEGER NOT NULL DEFAULT 0 CHECK (is_generated IN (0,1)),
    is_binary INTEGER NOT NULL DEFAULT 0 CHECK (is_binary IN (0,1)),
    PRIMARY KEY (snapshot_id, file_id),
    UNIQUE (snapshot_id, normalized_path)
);

CREATE INDEX idx_snapshot_files_path ON snapshot_files(snapshot_id, normalized_path);
CREATE INDEX idx_snapshot_files_package ON snapshot_files(snapshot_id, package_name);

CREATE TABLE node_entities (
    id INTEGER PRIMARY KEY,
    repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    entity_key TEXT NOT NULL,
    canonical_identity TEXT NOT NULL,
    collision_index INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL CHECK (kind IN (
        'package','file','function','method','class','interface','type','route','test',
        'adr','doc_section','external_dep','unresolved'
    )),
    qualified_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (repo_id, entity_key),
    UNIQUE (repo_id, canonical_identity)
);

CREATE INDEX idx_node_entities_name ON node_entities(repo_id, qualified_name);
CREATE INDEX idx_node_entities_kind ON node_entities(repo_id, kind);

CREATE TABLE snapshot_nodes (
    snapshot_id INTEGER NOT NULL,
    node_id INTEGER NOT NULL REFERENCES node_entities(id) ON DELETE RESTRICT,
    file_id INTEGER,
    display_name TEXT NOT NULL,
    span_start INTEGER,
    span_end INTEGER,
    line_start INTEGER,
    line_end INTEGER,
    signature TEXT,
    body_hash TEXT,
    exported INTEGER NOT NULL DEFAULT 0 CHECK (exported IN (0,1)),
    analyzer_version TEXT NOT NULL,
    PRIMARY KEY (snapshot_id, node_id),
    FOREIGN KEY (snapshot_id) REFERENCES repository_snapshots(id) ON DELETE CASCADE,
    FOREIGN KEY (snapshot_id, file_id) REFERENCES snapshot_files(snapshot_id, file_id) ON DELETE CASCADE,
    CHECK ((span_start IS NULL AND span_end IS NULL) OR
           (span_start IS NOT NULL AND span_end IS NOT NULL AND span_end >= span_start))
);

CREATE INDEX idx_snapshot_nodes_file ON snapshot_nodes(snapshot_id, file_id);
CREATE INDEX idx_snapshot_nodes_lines ON snapshot_nodes(snapshot_id, file_id, line_start, line_end);

CREATE TABLE edge_entities (
    id INTEGER PRIMARY KEY,
    repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    entity_key TEXT NOT NULL,
    canonical_identity TEXT NOT NULL,
    collision_index INTEGER NOT NULL DEFAULT 0,
    src_node_id INTEGER NOT NULL REFERENCES node_entities(id) ON DELETE RESTRICT,
    dst_node_id INTEGER NOT NULL REFERENCES node_entities(id) ON DELETE RESTRICT,
    relation TEXT NOT NULL CHECK (relation IN (
        'contains','imports','exports','references','calls','implements','extends',
        'tests','routes_to','documents','changed_with'
    )),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (repo_id, entity_key),
    UNIQUE (repo_id, canonical_identity)
);

CREATE INDEX idx_edge_entities_src ON edge_entities(src_node_id, relation);
CREATE INDEX idx_edge_entities_dst ON edge_entities(dst_node_id, relation);

CREATE TABLE snapshot_edges (
    snapshot_id INTEGER NOT NULL REFERENCES repository_snapshots(id) ON DELETE CASCADE,
    edge_id INTEGER NOT NULL REFERENCES edge_entities(id) ON DELETE RESTRICT,
    origin TEXT NOT NULL CHECK (origin IN ('compiler','heuristic','git','doc','human','llm')),
    confidence TEXT NOT NULL CHECK (confidence IN ('certain','likely','inferred')),
    resolution TEXT NOT NULL CHECK (resolution IN ('resolved','partial','unresolved')),
    analyzer_version TEXT NOT NULL,
    PRIMARY KEY (snapshot_id, edge_id)
);

CREATE INDEX idx_snapshot_edges_snapshot ON snapshot_edges(snapshot_id, edge_id);
CREATE INDEX idx_snapshot_edges_origin ON snapshot_edges(snapshot_id, origin, confidence, resolution);

CREATE TABLE evidence_items (
    id INTEGER PRIMARY KEY,
    snapshot_id INTEGER NOT NULL,
    file_id INTEGER NOT NULL,
    evidence_kind TEXT NOT NULL CHECK (evidence_kind IN (
        'source','documentation','git','human_annotation','tool_event'
    )),
    line_start INTEGER,
    line_end INTEGER,
    column_start INTEGER,
    column_end INTEGER,
    commit_sha TEXT,
    excerpt_hash TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (snapshot_id, file_id) REFERENCES snapshot_files(snapshot_id, file_id) ON DELETE CASCADE,
    CHECK ((line_start IS NULL AND line_end IS NULL) OR
           (line_start IS NOT NULL AND line_end IS NOT NULL AND line_end >= line_start))
);

CREATE TABLE node_evidence (
    snapshot_id INTEGER NOT NULL,
    node_id INTEGER NOT NULL,
    evidence_id INTEGER NOT NULL REFERENCES evidence_items(id) ON DELETE CASCADE,
    PRIMARY KEY (snapshot_id, node_id, evidence_id),
    FOREIGN KEY (snapshot_id, node_id) REFERENCES snapshot_nodes(snapshot_id, node_id) ON DELETE CASCADE
);

CREATE TABLE edge_evidence (
    snapshot_id INTEGER NOT NULL,
    edge_id INTEGER NOT NULL,
    evidence_id INTEGER NOT NULL REFERENCES evidence_items(id) ON DELETE CASCADE,
    PRIMARY KEY (snapshot_id, edge_id, evidence_id),
    FOREIGN KEY (snapshot_id, edge_id) REFERENCES snapshot_edges(snapshot_id, edge_id) ON DELETE CASCADE
);

INSERT INTO schema_migrations(version) VALUES (1);
COMMIT;
`
};

const migration002: Migration = {
  version: 2,
  name: "boundaries and explicit decisions",
  sql: `
PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;

CREATE TABLE boundary_entities (
    id INTEGER PRIMARY KEY,
    repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    boundary_key TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (repo_id, boundary_key),
    UNIQUE (repo_id, name)
);

CREATE TABLE snapshot_boundaries (
    snapshot_id INTEGER NOT NULL REFERENCES repository_snapshots(id) ON DELETE CASCADE,
    boundary_id INTEGER NOT NULL REFERENCES boundary_entities(id) ON DELETE RESTRICT,
    rule_kind TEXT NOT NULL CHECK (rule_kind IN ('allow','deny','layer','ownership')),
    rule_json TEXT NOT NULL CHECK (json_valid(rule_json)),
    origin TEXT NOT NULL CHECK (origin IN ('config','documentation','human')),
    confidence TEXT NOT NULL CHECK (confidence IN ('certain','likely')),
    source_file_id INTEGER,
    PRIMARY KEY (snapshot_id, boundary_id),
    FOREIGN KEY (snapshot_id, source_file_id) REFERENCES snapshot_files(snapshot_id, file_id) ON DELETE SET NULL
);

CREATE TABLE boundary_evidence (
    snapshot_id INTEGER NOT NULL,
    boundary_id INTEGER NOT NULL,
    evidence_id INTEGER NOT NULL REFERENCES evidence_items(id) ON DELETE CASCADE,
    PRIMARY KEY (snapshot_id, boundary_id, evidence_id),
    FOREIGN KEY (snapshot_id, boundary_id) REFERENCES snapshot_boundaries(snapshot_id, boundary_id) ON DELETE CASCADE
);

CREATE TABLE decision_entities (
    id INTEGER PRIMARY KEY,
    repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    decision_key TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('adr','doc','annotation')),
    title TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (repo_id, decision_key)
);

CREATE TABLE snapshot_decisions (
    snapshot_id INTEGER NOT NULL REFERENCES repository_snapshots(id) ON DELETE CASCADE,
    decision_id INTEGER NOT NULL REFERENCES decision_entities(id) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK (status IN ('proposed','accepted','deprecated','superseded','unknown')),
    source_file_id INTEGER,
    body_excerpt TEXT,
    content_hash TEXT,
    PRIMARY KEY (snapshot_id, decision_id),
    FOREIGN KEY (snapshot_id, source_file_id) REFERENCES snapshot_files(snapshot_id, file_id) ON DELETE SET NULL
);

CREATE TABLE decision_evidence (
    snapshot_id INTEGER NOT NULL,
    decision_id INTEGER NOT NULL,
    evidence_id INTEGER NOT NULL REFERENCES evidence_items(id) ON DELETE CASCADE,
    PRIMARY KEY (snapshot_id, decision_id, evidence_id),
    FOREIGN KEY (snapshot_id, decision_id) REFERENCES snapshot_decisions(snapshot_id, decision_id) ON DELETE CASCADE
);

CREATE TABLE decision_links (
    id INTEGER PRIMARY KEY,
    snapshot_id INTEGER NOT NULL,
    decision_id INTEGER NOT NULL,
    node_id INTEGER,
    edge_id INTEGER,
    boundary_id INTEGER,
    confidence TEXT NOT NULL CHECK (confidence IN ('certain','likely')),
    evidence_id INTEGER NOT NULL REFERENCES evidence_items(id) ON DELETE CASCADE,
    FOREIGN KEY (snapshot_id, decision_id) REFERENCES snapshot_decisions(snapshot_id, decision_id) ON DELETE CASCADE,
    FOREIGN KEY (snapshot_id, node_id) REFERENCES snapshot_nodes(snapshot_id, node_id) ON DELETE CASCADE,
    FOREIGN KEY (snapshot_id, edge_id) REFERENCES snapshot_edges(snapshot_id, edge_id) ON DELETE CASCADE,
    FOREIGN KEY (snapshot_id, boundary_id) REFERENCES snapshot_boundaries(snapshot_id, boundary_id) ON DELETE CASCADE,
    CHECK ((node_id IS NOT NULL) + (edge_id IS NOT NULL) + (boundary_id IS NOT NULL) = 1)
);

CREATE UNIQUE INDEX idx_decision_link_node ON decision_links(snapshot_id, decision_id, node_id) WHERE node_id IS NOT NULL;
CREATE UNIQUE INDEX idx_decision_link_edge ON decision_links(snapshot_id, decision_id, edge_id) WHERE edge_id IS NOT NULL;
CREATE UNIQUE INDEX idx_decision_link_boundary ON decision_links(snapshot_id, decision_id, boundary_id) WHERE boundary_id IS NOT NULL;

INSERT INTO schema_migrations(version) VALUES (2);
COMMIT;
`
};

const migration003: Migration = {
  version: 3,
  name: "tasks, retrieval, observed events, changes, tests",
  sql: `
PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;

CREATE TABLE tasks (
    id INTEGER PRIMARY KEY,
    repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    base_snapshot_id INTEGER NOT NULL REFERENCES repository_snapshots(id) ON DELETE RESTRICT,
    agent TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','aborted','deleted')),
    observation_coverage TEXT NOT NULL DEFAULT 'partial' CHECK (
        observation_coverage IN ('complete_for_registered_sources','partial','unknown')
    ),
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TEXT
);

CREATE INDEX idx_tasks_repo_started ON tasks(repo_id, started_at);

CREATE TABLE retrieval_events (
    id INTEGER PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    snapshot_id INTEGER NOT NULL REFERENCES repository_snapshots(id) ON DELETE RESTRICT,
    tool TEXT NOT NULL CHECK (tool IN (
        'repo_overview','find_symbol','symbol_context','find_tests','impact','path'
    )),
    args_json TEXT NOT NULL CHECK (json_valid(args_json)),
    requested_token_budget INTEGER,
    estimated_response_tokens INTEGER,
    truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0,1)),
    next_cursor TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_retrieval_events_task ON retrieval_events(task_id, created_at);

CREATE TABLE retrieval_result_nodes (
    event_id INTEGER NOT NULL REFERENCES retrieval_events(id) ON DELETE CASCADE,
    node_id INTEGER NOT NULL REFERENCES node_entities(id) ON DELETE RESTRICT,
    rank_position INTEGER NOT NULL,
    score REAL,
    representation TEXT NOT NULL CHECK (representation IN ('body','signature','name','aggregate')),
    stale INTEGER NOT NULL DEFAULT 0 CHECK (stale IN (0,1)),
    PRIMARY KEY (event_id, node_id)
);

CREATE TABLE retrieval_result_edges (
    event_id INTEGER NOT NULL REFERENCES retrieval_events(id) ON DELETE CASCADE,
    edge_id INTEGER NOT NULL REFERENCES edge_entities(id) ON DELETE RESTRICT,
    rank_position INTEGER NOT NULL,
    score REAL,
    stale INTEGER NOT NULL DEFAULT 0 CHECK (stale IN (0,1)),
    PRIMARY KEY (event_id, edge_id)
);

CREATE TABLE retrieval_omissions (
    id INTEGER PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES retrieval_events(id) ON DELETE CASCADE,
    target_kind TEXT NOT NULL CHECK (target_kind IN ('node','edge')),
    node_id INTEGER REFERENCES node_entities(id) ON DELETE RESTRICT,
    edge_id INTEGER REFERENCES edge_entities(id) ON DELETE RESTRICT,
    rank_position INTEGER NOT NULL,
    score REAL,
    reason TEXT NOT NULL,
    CHECK ((target_kind = 'node' AND node_id IS NOT NULL AND edge_id IS NULL) OR
           (target_kind = 'edge' AND edge_id IS NOT NULL AND node_id IS NULL))
);

CREATE TABLE agent_events (
    id INTEGER PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    snapshot_id INTEGER REFERENCES repository_snapshots(id) ON DELETE RESTRICT,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'file_read_observed','plan_mentioned','modified','test_selected','test_executed','capture_interrupted'
    )),
    source TEXT NOT NULL CHECK (source IN ('claude_hook','codex_log','transcript','manual')),
    payload_json TEXT CHECK (payload_json IS NULL OR json_valid(payload_json)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE agent_event_targets (
    id INTEGER PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES agent_events(id) ON DELETE CASCADE,
    target_kind TEXT NOT NULL CHECK (target_kind IN ('file','node')),
    file_id INTEGER REFERENCES file_entities(id) ON DELETE RESTRICT,
    node_id INTEGER REFERENCES node_entities(id) ON DELETE RESTRICT,
    CHECK ((target_kind = 'file' AND file_id IS NOT NULL AND node_id IS NULL) OR
           (target_kind = 'node' AND node_id IS NOT NULL AND file_id IS NULL))
);

CREATE UNIQUE INDEX idx_agent_event_target_file
    ON agent_event_targets(event_id, file_id)
    WHERE target_kind = 'file' AND file_id IS NOT NULL;

CREATE UNIQUE INDEX idx_agent_event_target_node
    ON agent_event_targets(event_id, node_id)
    WHERE target_kind = 'node' AND node_id IS NOT NULL;

CREATE TABLE change_sets (
    id INTEGER PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    base_snapshot_id INTEGER NOT NULL REFERENCES repository_snapshots(id) ON DELETE RESTRICT,
    head_snapshot_id INTEGER NOT NULL REFERENCES repository_snapshots(id) ON DELETE RESTRICT,
    kind TEXT NOT NULL CHECK (kind IN ('working_tree','staged','commit','patch')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (base_snapshot_id <> head_snapshot_id)
);

CREATE TABLE change_set_files (
    change_set_id INTEGER NOT NULL REFERENCES change_sets(id) ON DELETE CASCADE,
    file_id INTEGER NOT NULL REFERENCES file_entities(id) ON DELETE RESTRICT,
    change_kind TEXT NOT NULL CHECK (change_kind IN ('added','modified','deleted','renamed')),
    before_hash TEXT,
    after_hash TEXT,
    old_path TEXT,
    new_path TEXT,
    PRIMARY KEY (change_set_id, file_id)
);

CREATE TABLE test_runs (
    id INTEGER PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    snapshot_id INTEGER NOT NULL REFERENCES repository_snapshots(id) ON DELETE RESTRICT,
    command_redacted TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running','passed','failed','cancelled','unknown')),
    exit_code INTEGER,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TEXT,
    output_retained INTEGER NOT NULL DEFAULT 0 CHECK (output_retained IN (0,1))
);

CREATE TABLE test_run_cases (
    id INTEGER PRIMARY KEY,
    test_run_id INTEGER NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
    test_node_id INTEGER REFERENCES node_entities(id) ON DELETE SET NULL,
    test_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('passed','failed','skipped','unknown')),
    duration_ms INTEGER
);

INSERT INTO schema_migrations(version) VALUES (3);
COMMIT;
`
};

const migration004: Migration = {
  version: 4,
  name: "layouts and quarantined summaries",
  sql: `
PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;

CREATE TABLE layout_positions (
    repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    abstraction_level TEXT NOT NULL CHECK (abstraction_level IN ('package','file','symbol')),
    view_key TEXT NOT NULL DEFAULT 'base',
    node_id INTEGER NOT NULL REFERENCES node_entities(id) ON DELETE CASCADE,
    x REAL NOT NULL,
    y REAL NOT NULL,
    z REAL NOT NULL DEFAULT 0,
    pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1)),
    anchor_group TEXT,
    layout_version INTEGER NOT NULL DEFAULT 1,
    last_snapshot_id INTEGER REFERENCES repository_snapshots(id) ON DELETE SET NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (repo_id, abstraction_level, view_key, node_id)
);

CREATE INDEX idx_layout_level ON layout_positions(repo_id, abstraction_level, view_key);

CREATE TABLE summaries (
    id INTEGER PRIMARY KEY,
    snapshot_id INTEGER NOT NULL REFERENCES repository_snapshots(id) ON DELETE CASCADE,
    node_id INTEGER NOT NULL REFERENCES node_entities(id) ON DELETE CASCADE,
    model TEXT NOT NULL,
    prompt_hash TEXT NOT NULL,
    summary_text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (snapshot_id, node_id, model, prompt_hash)
);

INSERT INTO schema_migrations(version) VALUES (4);
COMMIT;
`
};

const migration005: Migration = {
  version: 5,
  name: "full-text search",
  sql: `
PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;

CREATE VIRTUAL TABLE node_fts USING fts5(
    snapshot_id UNINDEXED,
    node_id UNINDEXED,
    display_name,
    qualified_name,
    signature,
    path,
    tokenize = 'unicode61'
);

INSERT INTO schema_migrations(version) VALUES (5);
COMMIT;
`
};

/**
 * Defect correction: UNIQUE(repo_id, kind, workspace_hash) means a working
 * tree that changes A -> B -> A cannot publish A again by inserting another
 * snapshot. Immutable activation events make publication explicit and let an
 * already validated snapshot become current again without mutating it.
 */
const migration006: Migration = {
  version: 6,
  name: "atomic immutable snapshot activation events",
  sql: `
PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;

CREATE TABLE snapshot_activations (
    id INTEGER PRIMARY KEY,
    repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('commit','working_tree','staged','patch')),
    snapshot_id INTEGER NOT NULL REFERENCES repository_snapshots(id) ON DELETE RESTRICT,
    previous_snapshot_id INTEGER REFERENCES repository_snapshots(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_snapshot_activations_current
    ON snapshot_activations(repo_id, kind, id DESC);
CREATE INDEX idx_snapshot_activations_snapshot
    ON snapshot_activations(snapshot_id);

CREATE TRIGGER snapshot_activations_validate_insert
BEFORE INSERT ON snapshot_activations
WHEN NOT EXISTS (
    SELECT 1 FROM repository_snapshots
    WHERE id = NEW.snapshot_id AND repo_id = NEW.repo_id AND kind = NEW.kind
)
BEGIN
    SELECT RAISE(ABORT, 'snapshot activation repo/kind mismatch');
END;

CREATE TRIGGER snapshot_activations_validate_update
BEFORE UPDATE ON snapshot_activations
WHEN NOT EXISTS (
    SELECT 1 FROM repository_snapshots
    WHERE id = NEW.snapshot_id AND repo_id = NEW.repo_id AND kind = NEW.kind
)
BEGIN
    SELECT RAISE(ABORT, 'snapshot activation repo/kind mismatch');
END;

INSERT INTO snapshot_activations(repo_id, kind, snapshot_id, previous_snapshot_id)
SELECT current.repo_id,
       current.kind,
       current.id,
       (
         SELECT MAX(previous.id)
         FROM repository_snapshots AS previous
         WHERE previous.repo_id = current.repo_id
           AND previous.kind = current.kind
           AND previous.status = 'active'
           AND previous.id < current.id
       )
FROM repository_snapshots AS current
WHERE current.status = 'active'
ORDER BY current.id;

INSERT INTO schema_migrations(version) VALUES (6);
COMMIT;
`
};

export const MIGRATIONS: readonly Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006
];
