# Tadori Systems Architecture (Step-2 global pass)

Planning artifact. Resolves cross-phase contracts BEFORE Wave 1-4 blueprints
are drafted. No production code exists for `packages/server`, `packages/cli`,
`apps/viz`, `packages/hooks`, `packages/bench` (verified: `ls packages/` =
core, fixtures, harness, indexer, mcp, store). Every contract below is a
proposal keyed to an owning blueprint ID. Where an idea contradicts the
evidence pack (`blueprints/research/EVIDENCE-BASELINE.md`), the evidence wins
and the contradiction is called out.

Frozen (never reopened here): six MCP tools only; the HTTP server is NOT an
MCP tool; stable 2D default (Sigma.js/WebGL, seeded frozen layout, semantic
zoom packages -> files -> exported symbols); `127.0.0.1` only; no cloud;
invalid snapshots never served; evidence/origin/confidence/resolution visible
everywhere; fixtures authoritative; TS/JS only; no runtime tracing; hooks are
a narrow evidence receiver, never an orchestrator/runtime; deps allowlist =
react, sigma, graphology, fastify, simple-git, R3F (experiment flag only),
Vite tooling; dev command `pnpm tadori serve .`; Phase 12 ships an installable
bin.

**Two corrections to the plan-of-record, forced by the evidence, stated once
here so every downstream blueprint inherits them:**

- **C-1 (layout table already exists).** Frozen **migration 004** already
  creates `layout_positions` with columns
  `(repo_id, abstraction_level, view_key, node_id, x, y, z, pinned,
  anchor_group, layout_version, last_snapshot_id, updated_at)` and index
  `idx_layout_level` (`packages/store/src/migrations.ts:442-458`). Grep shows
  **no production reader/writer** of it yet (only migrations, its own test,
  and specs). Therefore **there is no migration 007.** A-102 is REFUTED as
  written (see Section 6 / Section 12). BACKLOG 08-01 and INDEX 08-01 text
  ("additive migration 007 `layout` table") must be read as "populate the
  existing frozen migration-004 `layout_positions` table" — no schema change.
- **C-2 (observation store already exists).** Frozen **migration 003** already
  creates `tasks`, `agent_events`, `agent_event_targets`, `retrieval_events`,
  `test_runs`, `test_run_cases`, and `packages/mcp/src/events.ts` `EventLog`
  already writes them with honesty semantics (`observation_coverage` defaults
  `partial`). Hooks (Phase 8-08) and observation overlays (08-09) target this
  existing surface; no new observation schema is introduced (see Section 7).

---

## 1. Package topology

Five new workspace members. Dependency direction is strict and one-way; the
viz app never touches the store or a SQLite handle.

```
apps/viz        (React+Vite+Sigma)  --HTTP/WS only-->  packages/server
packages/cli    (tadori serve .)    -------->  packages/server, @tadori/indexer, @tadori/store
packages/server (Fastify 127.0.0.1) -------->  @tadori/mcp (GraphService), @tadori/store, @tadori/indexer
packages/hooks  (evidence receiver) -------->  packages/server (HTTP POST)   [DECIDED: not a direct store writer]
packages/bench  (task runner)       -------->  @tadori/store, @tadori/indexer, spawns MCP + serve as subjects
```

| Package | Owns | May import | Must NOT import |
|---|---|---|---|
| `packages/server` | HTTP+WS read API, source-slice reads, observation ingest endpoint, layout materialization trigger | `@tadori/mcp` (GraphService, ConcurrentRefreshController, EventLog), `@tadori/store`, `@tadori/indexer`, `@tadori/core`, fastify | React, sigma, DOM |
| `packages/cli` | `tadori serve .` lifecycle, flag parsing, browser launch, teardown, `.tadori/` layout | `packages/server`, `@tadori/indexer`, `@tadori/store`, `@tadori/core`, simple-git | React/sigma; MCP protocol transport |
| `apps/viz` | 2D/2.5D/3D-experiment UI, layout render, panels, overlays | react, sigma, graphology (client render only), server HTTP/WS | **any `@tadori/*` node package, better-sqlite3, fs** |
| `packages/hooks` | Claude Code hook receivers -> normalized observation events -> POST to server | `@tadori/core` (types only), node http client | `@tadori/store` directly (see Section 7 DECIDE) |
| `packages/bench` | benchmark task runner, metrics capture | `@tadori/store`, `@tadori/indexer`; spawns serve/MCP as black boxes | viz |

**DECISION AD-001 — hooks write via server, not direct store.** `packages/hooks`
POSTs to `packages/server`; it does not open the SQLite DB. Rationale: the
frozen constraint says hooks are a "narrow evidence receiver, never
orchestrator/runtime"; a second writer to a WAL DB while `serve` runs a
refresh worker invites lock contention and a second copy of the honesty
invariants that `EventLog` already enforces. The server owns the single write
path (`EventLog`). Rejected: hooks own a `better-sqlite3` writer — rejected
because it duplicates `EventLog`'s validation and creates a third concurrent
writer (worker + server-ingest + hooks). Owner: 07-01 (endpoint), 08-08
(receiver).

**Workspace wiring (proposals, owned by 07-01 unless noted):**

`pnpm-workspace.yaml` — add four lines under the existing five; `apps/viz` is a
new glob root:
```yaml
packages:
  - "packages/core"
  - "packages/store"
  - "packages/indexer"
  - "packages/harness"
  - "packages/mcp"
  - "packages/server"   # 07-01
  - "packages/cli"      # 07-02
  - "packages/hooks"    # 08-08
  - "packages/bench"    # 11-01
  - "apps/viz"          # 08-02
```
`tsconfig.json` `include` — add `packages/{server,cli,hooks,bench}/{src,test}/**/*.ts`.
`apps/viz` is a **separate tsconfig** (`apps/viz/tsconfig.json`, DOM lib, JSX,
Vite) and is **excluded** from the root Node tsconfig so browser types never
leak into node packages (mirrors how `packages/fixtures` is excluded today).
`tsconfig.base.json` `paths` — add `@tadori/server` -> its `src/index.ts`.
**Do not add `allowJs`/`checkJs`** to the base config — that is 00-01A's
decision surface, not this one (evidence pack Section 4). New packages are
`.ts`-only.

---

## 2. Server-to-store/mcp seam

**DECISION AD-002 — reuse `GraphService` in place; do NOT extract a new shared
query package.** Evidence pack Section 8 verifies `GraphService`
(`packages/mcp/src/service.ts:66-355`) has **no MCP-protocol dependency**: it
imports only `@tadori/core`, `@tadori/indexer`, `@tadori/store`. The
MCP-specific pieces (`StdioServerTransport`, `createTadoriMcpServer`,
`TadoriTools`) are all downstream of it, never required by it. The server
imports `GraphService` from the `@tadori/mcp` barrel and constructs it exactly
as stdio does.

Functions/classes reused verbatim (all already exported from `@tadori/mcp`):

| Symbol | Source | Server use |
|---|---|---|
| `GraphService.open(db, repoRoot, overlay?, kind?)` | `service.ts:120` | session read view |
| `GraphService` fields `snapshot`, `repoId`, `graph`, `nodesByKey`, `outEdges`, `inEdges` | `service.ts:67-118` | nodes/edges/adjacency endpoints |
| `.fanIn(key)`, `.searchNodes(q, limit, kind?, offset?)`, `.resolveEntity(input)`, `.readBody(node)`, `.fileFreshness/.nodeFreshness/.edgeFreshness/.snapshotFreshness()` | `service.ts:155-354` | fan-in, FTS, resolve, source-slice, freshness |
| `ConcurrentRefreshController.start(db, repoRoot, {onError})` | `concurrentRefresh.ts:64` | the worker + `RefreshFreshnessOverlay` for `refresh_pending` |
| `EventLog` | `events.ts:65` | observation write path (Section 7) |
| store: `listSnapshots`, `getSnapshot`, `getActiveSnapshot`, `loadSnapshotGraph`, `diffSnapshotEdges`, `searchNodeFts`, `ensureSnapshotFts`, `openDatabase`, `runMigrations` | `@tadori/store` barrel | snapshot list/pin, diff, search |

**Does `GraphService` need extraction?** No, for Phase 7-8. It is already a
standalone factory over a `better-sqlite3` handle. **The six-tool MCP surface
stays exactly six** because the server calls `GraphService` directly, never
`TadoriTools` and never `createTadoriMcpServer` — the HTTP endpoints are a
parallel consumer of the same read view, not a seventh tool.

Rejected: new `packages/query` extracting `GraphService`. Rejected because it
is a no-value move today (one consumer becomes two, both in-repo) and risks
disturbing the frozen MCP package's tests. **Re-evaluate only if** Phase 9
review or Phase 11 bench needs a graph read the MCP package must not carry; at
that point extract the class unchanged into `@tadori/query` and re-export it
from `@tadori/mcp` (keeps the six-tool file layout intact). Owner: 07-01.

**Freshness caveat (from evidence pack Section 10):** `GraphService.open(...,
"working_tree")` silently falls back to any kind if no working-tree snapshot
exists (`service.ts:137-139`). The server must surface the actual served
`snapshot.kind` in every response `context` (mirrors `responseContextSchema`,
`contracts.ts:110`) rather than assuming working_tree.

---

## 3. HTTP API (packages/server, Fastify on 127.0.0.1)

**Version prefix:** all routes under `/api/v1`. Static viz bundle served at
`/`. WS at `/api/v1/ws`. Bind `127.0.0.1` only (never `0.0.0.0`), no CORS
allowlist beyond same-origin (offline, localhost). All GET endpoints are
read-only; the sole write is `POST /observations` (trust boundary below).

Shared response envelope (server-owned, mirrors `contracts.ts`
`responseContextSchema` so viz reuses one context renderer):

```ts
interface ApiContext {
  repository: string;
  snapshotId: number;
  snapshotKind: "commit" | "working_tree" | "staged" | "patch";
  baseCommitSha: string | null;
  workspaceHash: string;
  freshness: "fresh" | "stale" | "unknown";
  stale: boolean;
  staleReason: "matches_snapshot" | "content_changed" | "refresh_pending"
    | "unreadable" | "outside_repository" | "not_in_snapshot";
  refreshPending: boolean;          // ConcurrentRefreshController.isSnapshotStale
}
interface Page<T> { items: T[]; nextCursor: string | null; total: number | null; }
interface ApiError { error: string; code: string; detail?: string; } // never leaks abs paths
```

Node/edge item shapes reuse the frozen `toolNodeSchema`/`toolEdgeSchema`
(`contracts.ts:49-88`) verbatim so viz and MCP agree on one wire shape.

| # | Method | Path | Params | Response | Errors | Owner |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/v1/snapshot` | — | `{ context: ApiContext; analyzerVersion: string; counts: {files,nodes,edges} }` | 404 no_active_snapshot | 07-01 |
| 2 | GET | `/api/v1/snapshots` | — | `SnapshotRow[]` (id, kind, label, base_commit_sha, workspace_hash, pinned, status, created_at) | — | 07-01 |
| 3 | POST | `/api/v1/snapshots/:id/pin` | body `{pinned:boolean}` | `SnapshotRow` | 404, 409 invalid_snapshot | 07-01 |
| 4 | GET | `/api/v1/nodes` | `level=package\|file\|symbol`, `packageName?`, `file?`, `kind?`, `exported?`, `cursor?`, `limit<=500` | `Page<ToolNode>` | 400 bad_level | 07-01 / 10 |
| 5 | GET | `/api/v1/edges` | `relation?`, `origin?`, `confidence?`, `resolution?`, `srcKey?`, `dstKey?`, `cursor?`, `limit<=1000` | `Page<ToolEdge>` | 400 | 07-01 |
| 6 | GET | `/api/v1/nodes/:entityKey` | — | `ToolNode & { outEdges: ToolEdge[]; inEdges: ToolEdge[]; fanIn: number }` | 404 unknown_entity, 409 ambiguous | 07-01 |
| 7 | GET | `/api/v1/nodes/:entityKey/evidence` | — | `{ evidence: Evidence[]; freshness }` | 404 | 07-01 |
| 8 | GET | `/api/v1/source` | `file` (repo-relative), `lineStart?`, `lineEnd?` | `{ body: string\|null; freshness; staleReason }` | 403 outside_repository, 404 not_in_snapshot, 409 content_changed | 07-01 |
| 9 | GET | `/api/v1/search` | `q`, `kind?`, `limit<=100`, `offset<=1000000` | `FtsSearchResult` (rows + total) | 400 empty_query | 07-01 / 08-05 |
| 10 | GET | `/api/v1/path` | `from`, `to`, `maxDepth?` | `{ nodes: ToolNode[]; edges: ToolEdge[]; found:boolean }` | 404 unknown_endpoint | 07-01 |
| 11 | GET | `/api/v1/tests` | `for?` (entityKey) | `{ tests: ToolNode[]; observed:false; note:"not observed inspected" }` | — | 08-07 |
| 12 | GET | `/api/v1/routes` | — | `{ routes: ToolNode[] }` | — | 08-07 |
| 13 | GET | `/api/v1/docs` | `for?` (entityKey) | `{ docs: {node:ToolNode; body:string\|null}[] }` (ADR/doc bodies, root-confined) | — | 08-07 |
| 14 | GET | `/api/v1/refresh` | — | `{ phase:"idle"\|"dirty"\|"refreshing"\|"failed"\|"stopped"; generation:number; dirtyPaths:string[]; snapshotId:number\|null; lastError:string\|null }` | — | 07-01 |
| 15 | GET | `/api/v1/layout` | `level=package\|file\|symbol`, `viewKey=base` | `{ positions: {entityKey:string; x:number; y:number; z:number; pinned:boolean}[]; layoutVersion:number }` | 404 layout_not_materialized | 08-01 |
| 16 | GET | `/api/v1/overview` | — | deterministic subsystem overview (Section 8) | — | 08B-01 |
| 17 | GET | `/api/v1/tour` | `id?` | tour + steps (Section 8) | 404 | 08B-02 |
| 18 | GET/PUT | `/api/v1/tour/progress` | body `{tourId,stepIndex}` | progress echo (persisted `.tadori/`, Section 8) | — | 08B-02 |
| 19 | GET | `/api/v1/review/diff` | `base`, `head` (ids \| `working_tree`), `coalesce=raw\|coalesced` | `ReviewDiff` (Section 9) | 400, 404 | 09-01 |
| 20 | POST | `/api/v1/observations` | body `ObservationEvent[]` (Section 7) | `{accepted:number}` | 400 schema, 409 no_active_task | 07-01/08-08 |

Endpoints 4-6 are the LOD data path (Section 10). Pagination is opaque decimal
cursor (offset), matching MCP's `cursorSchema` (`contracts.ts:24`). `total`
may be `null` when counting is not free.

---

## 4. WebSocket contract

One WS at `/api/v1/ws`, owned by **07-01** (server pushes) with the observation
overlay events owned by **08-09**. JSON envelope:

```ts
type ServerEvent =
  | { type: "snapshot_replaced"; snapshotId: number; snapshotKind: string; generation: number; workspaceHash: string }
  | { type: "refresh_pending";  phase: "dirty"|"refreshing"; dirtyPaths: string[]; generation: number }
  | { type: "refresh_settled";  phase: "idle"|"failed"; snapshotId: number|null; lastError: string|null; generation: number }
  | { type: "watcher_error";    message: string }               // non-fatal; server keeps serving last valid
  | { type: "observation";      event: ObservationEvent };       // 08-09 overlay feed
interface ClientEvent { type: "subscribe"; channels: ("refresh"|"observation")[] }
```

Source of truth: the server polls/observes `ConcurrentRefreshController` state
(`serializedRefreshState`: phase/generation/dirtyPaths/snapshotId, from
`concurrentRefresh.ts`) and emits `refresh_pending` / `refresh_settled` on
change; `snapshot_replaced` fires when `generation` advances with a new
`snapshotId`. **Reconnect:** client reconnects with exponential backoff (cap
5s); on reconnect it re-fetches `/api/v1/snapshot` + `/api/v1/refresh` (WS is a
change signal, not the state of record) and re-subscribes. No server-side
per-client state; missed events are recovered by the re-fetch. Invalid
snapshots are never announced (server only emits `snapshot_replaced` for a
snapshot `getActiveSnapshot` already validated).

---

## 5. CLI lifecycle (packages/cli, `tadori serve .`)

Owner: **07-02** (steps), **07-03** (hardening). Maps 1:1 to the 9 frozen
`CLI_CONTRACT.md` steps:

| Contract step | Implementation |
|---|---|
| 1 resolve repo | `path.resolve(argPath)`; `normalizePath` reuse; fail with actionable message if no `package.json`/`tsconfig` (`exit 2`) |
| 2 load config | read `.gitignore`/`.tadoriignore`/`tadori.rules.json`; scanner already honors ignores |
| 3 reuse/refresh snapshot | open `.tadori/tadori.sqlite`; `runMigrations`; `getActiveSnapshot(working_tree)`; if stale or `--reindex`, run `IncrementalRepositoryIndexer.initialize()` / full `indexRepositoryIntoStore` |
| 4 validate | `getActiveSnapshot` already enforces dangling-endpoint validation; add `foreignKeyCheck(db)`; **invalid -> keep last valid, print `stale`** |
| 5 start API | `packages/server` fastify listen on `127.0.0.1:<port>` |
| 6 start viz | serve prebuilt `apps/viz` static bundle from the server (2D default; `--mode` selects entry) |
| 7 open browser | `open` the URL unless `--no-open`; launch failure prints URL, non-fatal |
| 8 print startup facts | repo root, snapshotId, index state (fresh/refreshed/rebuilt/stale), mode, URL |
| 9 Ctrl+C teardown | see teardown order below |

**DECISION AD-003 — in-process server + reused isolated refresh worker.** The
CLI runs **one** Node process hosting the Fastify server; snapshot refresh runs
in the **already-existing** isolated worker via
`ConcurrentRefreshController.start()` (the same worker stdio uses,
`concurrentRefresh.ts`, evidence pack Section 3/8). Rationale: the evidence
pack confirms production stdio already isolates compiler/watcher/writer in a
worker so reads stay responsive under WAL; reusing it gives orphan-free
supervision for free and avoids a second process-management scheme. Rejected:
a separate long-lived indexer process supervised by the CLI — rejected as
duplicate machinery; the worker thread already provides isolation and a clean
`stop()`.

**Port selection:** `--port` if given (fail `exit 4` if occupied, actionable
message); else ask the OS for an open port (listen on `0` -> read
`.address().port`). **Browser launch** after "listening" event only.

**Teardown order (SIGINT/SIGTERM):** (1) stop accepting new HTTP/WS; (2) close
WS clients; (3) `await refresh.stop()` (terminates worker); (4) `server.close()`;
(5) `db.close()`; (6) `exit 0`. Mirrors `stdio.ts`'s
finalize/close/`refresh.stop()`/`db.close()` sequence. **Exit codes:** 0 clean;
2 unsupported repo; 3 invalid/unservable snapshot with no valid fallback; 4
port unavailable; 1 unexpected.

**DECISION AD-004 — canonical `.tadori/` layout, default DB path.** `tadori
serve .` and `tadori diff` default the DB to `<root>/.tadori/tadori.sqlite`
(matching `scripts/tadori.mts:15`), creating `.tadori/` with
`mkdirSync(recursive)`. This reconciles the inconsistency: `scripts/tadori.mts`
already defaults it; only `packages/mcp/src/cli.ts` requires explicit
`--db`/`--repo` (that CLI is the machine-facing MCP transport and stays
explicit — do not change it). The unified `tadori` bin defaults the path;
`--db` overrides. Canonical layout:
```
.tadori/
  tadori.sqlite        # the store (migrations 001-006 today)
  layout/              # reserved; positions live in the DB layout_positions table
  progress.json        # tour progress (Section 8)
```
Owner: 07-02 (serve default), 07-03 (conflict paths).

---

## 6. Layout persistence

**A-102 REFUTED as written (see C-1).** No migration 007. The frozen
**migration 004** `layout_positions` table already has every needed column:

```
layout_positions(
  repo_id, abstraction_level IN ('package','file','symbol'), view_key DEFAULT 'base',
  node_id -> node_entities(id), x, y, z DEFAULT 0, pinned IN (0,1),
  anchor_group, layout_version DEFAULT 1, last_snapshot_id -> repository_snapshots(id),
  updated_at,  PRIMARY KEY (repo_id, abstraction_level, view_key, node_id))
```
`abstraction_level` = the three semantic-zoom levels; `view_key='base'` = the
default view; `layout_version` = the algorithm version column the task asks
for; `last_snapshot_id ON DELETE SET NULL` = the snapshot the positions were
computed against; `pinned` supports manual pins. **Frozen migrations 001-006
are not altered.** The only thing 08-01 adds is a **writer** (new store
function, additive, no schema change):

```ts
// new export in @tadori/store (additive), owned by 08-01
interface LayoutPosition { entityKey: string; x: number; y: number; z: number; pinned: boolean; anchorGroup: string | null; }
function readLayout(db, repoId, level, viewKey): { positions: LayoutPosition[]; layoutVersion: number } | null;
function writeLayout(db, repoId, level, viewKey, snapshotId, layoutVersion, positions): void; // upsert, transactional
```

**DECISION AD-005 — server materializes layout once, on first serve of a
snapshot; the layout engine is a pure function.** `apps/viz` never computes
layout (it must not import graphology-on-node or the store). On first
`/api/v1/layout` request for a `(repoId, level, viewKey)` with no row for the
active `layout_version`, the **server** runs the deterministic seeded
force-directed pass (graphology, fixed seed, run-once) and persists via
`writeLayout`. Subsequent reads return the stored bytes -> **byte-identical
reload** guaranteed by reading persisted `x/y/z`, never recomputing.
Determinism: fixed RNG seed + fixed iteration count + sorted node input =>
identical output; store `REAL` round-trips the doubles exactly.

**New-node placement / invalidation:** on `snapshot_replaced`, positions keyed
by `node_id` (stable entity) survive; a node present in the new snapshot but
absent from `layout_positions` is placed at its **package centroid** (mean of
its package peers' stored positions) with bounded local relaxation, then
persisted — existing nodes never move (frozen coordinates). If
`layout_version` (algorithm) changes, all rows for that `(repo, level, view)`
are treated as stale and recomputed once. Owner: 08-01 (engine + store
writer), 07-01 (serve-time trigger).

Rejected: viz computes layout client-side each load — rejected because it
breaks byte-identical reload and pushes graphology-on-node into the browser
bundle. Rejected: new migration 007 — refuted by C-1, the table exists.

---

## 7. Hooks event contract (packages/hooks)

**C-2: the observation store already exists** (migration 003 +
`packages/mcp/src/events.ts` `EventLog`). Hooks do not invent schema; they feed
the existing `agent_events` / `agent_event_targets` write path through the
server.

**DECISION (restates AD-001) — hooks POST to server; server writes via
`EventLog`.** Trust boundary: the server is inside the localhost trust domain
and already holds the only write connection; hooks are untrusted producers that
send normalized JSON over `POST /api/v1/observations`. The server validates
against the schema, resolves entity keys via the live `GraphService`
(`nodeEntityId`/`edgeEntityId`, `service.ts:307/320` — unknown keys are
rejected, never fabricated), and records honesty fields. Hooks hold no DB
handle.

Event schema (server-validated; mirrors `events.ts` `AgentEventType` /
`AgentEventSource`, which already include `claude_hook`):

```ts
type ObservationEventType =
  | "task_start" | "plan_mentioned" | "file_read_observed"
  | "modified" | "test_selected" | "test_executed" | "capture_interrupted";
interface ObservationEvent {
  type: ObservationEventType;
  source: "claude_hook";
  at: string;                       // ISO timestamp, producer-supplied, server re-stamps
  targets?: { kind: "file" | "node" | "edge"; ref: string }[]; // ref = path or entityKey
  detail?: string;                  // e.g. test name; never a claim of correctness
}
```

**Honesty semantics (frozen, enforced server-side):** observation != knowledge.
`tasks.observation_coverage` stays `partial` by default and can only be
`complete_for_registered_sources` when every registered source produced an
event; a `capture_interrupted` event forces it back to `partial` and records
the interruption (this is exactly `EventLog`'s existing invariant,
`events.ts:58-64`). Likely-test and unobserved displays render "not observed
inspected" (Section 3 #11). Coverage vocabulary:
`complete_for_registered_sources | partial | unknown`.

**Retention (Phase 12-01 purge):** rows are snapshot/task-scoped and deleted by
the existing FK cascades when a snapshot/task is pruned; the purge command
(12-01) additionally offers `DELETE FROM agent_events WHERE task_id IN (...)`
plus redaction of `detail`. No new retention table. Owner: 08-08 (receiver +
endpoint client), 07-01 (endpoint), 12-01 (purge).

---

## 8. Tour data model (Phase 8B)

Deterministic, offline, evidence-backed, no LLM (A-105). Derivation inputs
(all already in the graph): packages (`repo_overview` package nodes), entry
points, routes (`routes_to` edges / route nodes), fan-in
(`GraphService.fanIn`). Owner: 08B-01 (overview/derivation), 08B-02 (engine +
progress), 08B-03 (walkthroughs).

```ts
interface OverviewSentence { text: string; evidence: Evidence[]; }      // every sentence backed
interface Subsystem { packageName: string; role: string | null; roleStatus: "derived_from_graph"; fanIn: number; entryPoints: string[] /*entityKeys*/; }
interface RepoOverview { context: ApiContext; summary: OverviewSentence[]; subsystems: Subsystem[]; }

type TourKind = "entry_point" | "route_request" | "dependency" | "test";
interface TourStep { index: number; title: string; focusEntityKeys: string[]; narration: OverviewSentence; cameraViewKey: "base"; }
interface Tour { id: string; kind: TourKind; title: string; steps: TourStep[]; deterministicSeed: string; }
interface TourProgress { tourId: string; stepIndex: number; updatedAt: string; }
```

**Progress persistence:** `.tadori/progress.json` (per AD-004 layout), written
by the server on `PUT /api/v1/tour/progress`; resume reads it on load. Steps
are ordered by a deterministic key (package topo order, then fan-in desc, then
entityKey) so the same repo yields the same tour every run. Every narration
sentence carries `evidence[]` — no sentence ships without a `file:line` anchor.

---

## 9. Review diff model (Phase 9)

Reuses the store three-way edge diff verbatim. Owner: 09-01 (API + raw UI),
09-02 (coalescing), 09-04 (`changed_with`).

`diffSnapshotEdges(db, base, head)` (`diff.ts:21`) returns `EdgeDiffRow[]`
(`change_kind: "added" | "removed" | "resolution_or_provenance_changed"`, plus
before/after origin/confidence/resolution). The API wraps it; node-level
add/remove is derived by set-differencing the two `loadSnapshotGraph` node
sets. Working-tree and staged comparisons build a head snapshot the same way
`diffWorkingTree` does (`indexer/src/diffWorkingTree.ts`) and diff against the
chosen base.

```ts
interface ReviewDiff {
  context: ApiContext; base: SnapshotRefInfo; head: SnapshotRefInfo;
  nodesAdded: ToolNode[]; nodesRemoved: ToolNode[];
  edges: EdgeDiffRow[];              // raw
  coalesced?: CoalescedChange[];     // present when coalesce=coalesced
  presentation: "raw" | "coalesced";
}
interface CoalescedChange { kind: "rename" | "move" | "modify"; fromKey: string | null; toKey: string | null; rawRowIndexes: number[]; }
```

**Raw-vs-coalesced rule:** raw is the default and the source of truth; coalesced
is a **view** derived by Stage A (identity match) + Stage B (body-hash /
signature match) over the raw rows and always references the raw rows it
collapses (`rawRowIndexes`) so the user can expand back. Fixture 04's
`expected/raw-diff.json` + `expected/coalesced-diff.json` are the acceptance
oracle. **`changed_with` activation note:** the co-change relation is a
**deferred relation activated in 09-04** via simple-git churn; it is additive
to the harness (un-defer) and must not alter the frozen edge diff — it appears
as ordinary edges once extracted. Owner: 09-04.

---

## 10. Viz data-loading contract (apps/viz)

Owner: 08-02 (scaffold), 08-03/08-04 (zoom), 08-05 (search), 08-10 (budgets).
`apps/viz` is HTTP/WS-only; **no `@tadori/*` import, no fs, no better-sqlite3**
(Section 1).

**Level-of-detail request pattern** (three frozen zoom levels):

1. Package level (initial): `GET /api/v1/nodes?level=package` + `GET
   /api/v1/edges?relation=imports` + `GET /api/v1/layout?level=package`.
2. File level (on package expand): `GET /api/v1/nodes?level=file&packageName=X`
   + `GET /api/v1/layout?level=file` — **no global movement** (positions are
   read from store, Section 6).
3. Symbol level (on file/task-region expand): `GET
   /api/v1/nodes?level=symbol&file=Y` + `GET /api/v1/layout?level=symbol`.

**Budgets:** `limit` capped per level (package<=500, file<=500, symbol<=1000);
`cursor` paginates; 08-10 enforces cold 150k LOC -> interactive < 5s by
loading package level first and lazily fetching deeper levels. **Offline
bundle rule:** Vite build with everything inlined; **no CDN, no external
fetch** at runtime except the local server (matches the artifact-style CSP
discipline and the "no cloud" constraint). **State ownership:** server owns
graph data, layout, snapshot state (source of truth); React owns only view
state (current level, selection, open panels, active overlays, filter
toggles). Reloading the page re-fetches identical data + identical layout ->
identical picture.

**Provenance edge legend (fixed, frozen):** solid = `origin` structural/direct
(e.g. imports, extends, implements), dashed = heuristic/`likely` confidence,
dotted = inferred/aggregate; **doc-sourced and git-sourced edges rendered
muted** regardless of line style. Encoding is derived from the edge's
`origin`/`confidence`/`resolution` fields (already on every `ToolEdge`), so the
legend is data-driven and visible in every mode (frozen non-negotiable).

---

## 11. Packaging (Phase 12)

Owner: 12-03. `npm pack` produces one installable `tadori` bin. **Bin layout:**
`packages/cli` declares `"bin": { "tadori": "./dist/cli.js" }`; the published
tarball bundles `@tadori/cli` + `@tadori/server` + the **prebuilt `apps/viz`
static assets copied into `packages/server/dist/public`** (so the server serves
the UI with zero external hosting — matches offline/no-cloud). `@tadori/mcp`,
`@tadori/store`, `@tadori/indexer`, `@tadori/core` ship as normal deps.
`better-sqlite3` is a real dependency needing prebuilt binaries — pin Node 22
(A-002, `.npmrc use-node-version=22.14.0`); document that `npx tadori` requires
a Node with better-sqlite3 prebuilds. **Cross-platform:** Windows primary,
Linux CI, macOS pilot smoke (A-004); path handling already normalizes to
forward-slash (`normalizePath`); browser-launch uses a cross-platform `open`.
`--mode 3d-experiment` (R3F) is a lazy-loaded chunk absent from the default
bundle (zero cost to 2D, per 10-02).

---

## 12. Assumption verdicts

- **A-101 — CONFIRMED (amended).** `packages/server` reuses store snapshot
  selection (`getActiveSnapshot`/`loadSnapshotGraph`) and the MCP package's
  `GraphService` query service rather than reimplementing reads. **Amendment:**
  the exact seam is *reuse in place* (AD-002), not extraction; the six-tool MCP
  surface is untouched because the server consumes `GraphService` directly, not
  `TadoriTools`. Evidence: `service.ts:66-355` has no MCP-protocol import
  (evidence pack Section 8).
- **A-102 — REFUTED as written; corrected.** Layout persistence is **not** a
  new migration 007. The `layout_positions` table already exists in **frozen
  migration 004** (`migrations.ts:442-458`) with all required columns and is
  currently unused by production code. Layout work (08-01) populates the
  existing frozen table via an additive store writer — **no schema change,
  frozen migrations 001-006 untouched.** This satisfies A-102's *intent*
  (additive, snapshot/entity-keyed, never mutate frozen migrations) while
  correcting its *mechanism*. Update A-102 and BACKLOG/INDEX 08-01 wording
  accordingly.

---

## 13. Decision log

| ID | Decision | Owner blueprint | Rejected alternative |
|---|---|---|---|
| AD-001 | Hooks POST to server; server is the single observation writer via `EventLog` | 07-01, 08-08 | Hooks own a direct `better-sqlite3` writer (dup invariants, 3rd concurrent writer) |
| AD-002 | Reuse `GraphService` in place; no new query package; MCP stays exactly six tools | 07-01 | Extract `packages/query` now (no-value move, risks frozen MCP tests) |
| AD-003 | CLI = one in-process Fastify server + reused isolated `ConcurrentRefreshController` worker | 07-02 | Separate supervised indexer process (duplicate machinery) |
| AD-004 | Canonical `.tadori/tadori.sqlite` default for `tadori serve`/`diff`; MCP stdio CLI stays explicit | 07-02 | Unify by making MCP CLI default too (it is machine-facing, must stay explicit) |
| AD-005 | Server materializes seeded layout once on first serve; viz never computes; persist for byte-identical reload | 08-01, 07-01 | Client-side layout each load (breaks byte-identical reload, bloats bundle) |
| AD-006 (C-1) | No migration 007; populate existing frozen migration-004 `layout_positions` | 08-01 | New migration 007 (table already exists) |
| AD-007 (C-2) | No new observation schema; hooks feed existing migration-003 `agent_events` via `EventLog` | 08-08 | New hooks schema/tables (duplicates frozen migration 003) |
| AD-008 | `/api/v1` prefix; viz item shapes reuse frozen `toolNodeSchema`/`toolEdgeSchema` | 07-01 | Bespoke server node/edge shapes (two wire formats to keep in sync) |
| AD-009 | Viz is HTTP/WS-only; no `@tadori/*`/fs/sqlite import; offline bundle, no CDN | 08-02 | Viz reads store directly / fetches remote assets (breaks localhost/no-cloud) |
| AD-010 | WS is a change-signal only; state of record is re-fetched on reconnect | 07-01, 08-09 | Server-side per-client event replay buffers (stateful, fragile) |
```
