# BLUEPRINT 07-01: `packages/server` graph API

## 1. Header

- ID / Title / Phase: 07-01 — `packages/server` graph API (Fastify) — Phase 7
- Status: review
- Primary builder: Claude Sonnet — new package with a well-bounded read-mostly
  HTTP surface over an already-tested query seam (`GraphService`); no novel
  concurrency design (that is 07-03).
- Reviewer roles: Spec Guardian (endpoint table / non-negotiables), API
  Contract Reviewer (schema fidelity to `toolNodeSchema`/`toolEdgeSchema`),
  Security Reviewer (localhost bind, path confinement, write-endpoint trust
  boundary).
- Complexity: M
- Depends on / Unlocks: Depends on 00-01A (allowJs scanner fix — the server's
  own dev-loop indexes this repo, which has root `.js` config files) and no
  Phase 7 predecessor. Unlocks 07-02 (CLI wraps this server), 08-01/08-02
  (viz consumes these endpoints), 08-08 (hooks POST target), 09-01 (review
  diff endpoint).
- Estimated sessions: 1. **Split candidate if it slips**: if the builder
  finds the WS reconnect/change-signal wiring (Section 4) plus the 20-route
  table exceeds one session, split along the natural seam — land routes
  #1-#10 + #14 + #20 (snapshot/nodes/edges/evidence/source/search/path/
  refresh/observations) as 07-01a, and #11-#13/#16-#19 (tests/routes/docs/
  overview/tour/review) as 07-01b once their owning blueprints (08-07, 08B-01,
  08B-02, 09-01) are ready to consume them. This blueprint targets the full
  table in one session because #11-#13/#16-#19 are thin passthroughs with no
  new logic (see §9); if the builder's context is tight, cut those six routes
  first — they have no other Phase-7 consumer yet.
- Related frozen-spec sections: `docs/CLI_CONTRACT.md` non-negotiables
  (localhost-only, invalid snapshots never served, evidence always visible,
  six-tool MCP interface stays separate); ARCHITECTURE.md AD-001, AD-002,
  AD-008, AD-010; Section 3 (HTTP API table), Section 4 (WS contract),
  Section 7 (hooks event contract).

## 2. Objective

`packages/server` exists as a new pnpm workspace member exposing a
read-mostly Fastify HTTP+WS API on `127.0.0.1` that serves the current
snapshot's nodes/edges/evidence/search/source over the existing
`GraphService` seam, plus exactly one write endpoint
(`POST /api/v1/observations`), with zero new MCP tools.

## 3. Why this matters

- User value: this is the only server the eventual `tadori serve .` process
  runs; without it there is no data path for any browser UI (Phase 8+).
- System value: proves `GraphService` (built for MCP stdio) is reusable
  verbatim for a second consumer, validating AD-002's "no extraction needed
  yet" call before more packages depend on the assumption.
- Downstream: 07-02 (CLI lifecycle wraps this server's `listen`/`close`),
  08-01..08-11 (every viz data fetch), 08-08 (hooks' only write path),
  09-01 (review diff reuses the same route registration pattern).

## 4. Current repository evidence

Verified current (2026-07-17), see `blueprints/research/EVIDENCE-BASELINE.md`
Section 8 and ARCHITECTURE.md Section 2:

- `packages/server` does not exist (`ls packages/` = core, fixtures, harness,
  indexer, mcp, store). No Fastify dependency anywhere in the repo today
  (grep of all `package.json` files: only `@tadori/mcp` depends on
  `@modelcontextprotocol/sdk` + `zod`; no `fastify` in any `package.json`).
- `GraphService` (`packages/mcp/src/service.ts:66-355`) is a standalone class
  with **no import of `@modelcontextprotocol/sdk`, `StdioServerTransport`, or
  `TadoriTools`** — verified by reading the file's import block (lines 1-15):
  only `node:crypto`, `node:fs`, `node:path`, `@tadori/core`, `@tadori/indexer`,
  `@tadori/store`. `GraphService.open(db, repoRoot, refreshOverlay?,
  preferredKind?)` (`service.ts:120-153`) is the exact factory the server
  calls.
- `GraphService` public surface used here: `.snapshot: SnapshotRow`,
  `.repoId: number`, `.graph: StoredSnapshotGraph` (`{snapshot,
  analyzerVersion, files, nodes, edges}`), `.nodesByKey: Map<string,
  GraphNode>`, `.outEdges`/`.inEdges: Map<string, GraphEdge[]>`,
  `.fanIn(entityKey): number`, `.searchNodes(query, limit, kind?, offset?):
  FtsSearchResult`, `.resolveEntity(input): EntityResolution`,
  `.readBody(node): BodyReadResult`, `.fileFreshness/.nodeFreshness/
  .edgeFreshness/.snapshotFreshness(): FreshnessResult`,
  `.nodeEntityId(entityKey): number | null`, `.edgeEntityId(entityKey):
  number | null` (all read `service.ts:155-354`).
- `ConcurrentRefreshController` (`packages/mcp/src/concurrentRefresh.ts:52`)
  implements `RefreshFreshnessOverlay`; `.state(): SerializedRefreshState`
  (`{phase, generation, dirtyPaths, affectedPaths, snapshotId, activationId,
  lastError}`, `concurrentRefresh.ts:144-151`) is the exact shape the
  `/api/v1/refresh` endpoint and WS `refresh_pending`/`refresh_settled`
  events surface. `.start(db, repoRoot, {onError})` (`concurrentRefresh.ts:
  64-81`) requires a **file-backed** database (`db.memory` check,
  line 69-71) — in-memory DBs cannot back this server.
- `EventLog` (`packages/mcp/src/events.ts:65-360`): constructor
  `(db, service: GraphService, agent: string, description: string)` creates
  one `tasks` row and throws if `service.snapshot` is no longer the active
  snapshot (`events.ts:74-80`) — **the observations endpoint therefore needs
  one EventLog per server-lifetime task, not per-request**; see §8 decision.
  `recordAgentEvent(type, source, payload?, targets?)` (`events.ts:276-345`)
  — **verified `AgentEventType` union is `"file_read_observed" |
  "plan_mentioned" | "modified" | "test_selected" | "test_executed" |
  "capture_interrupted"` (`events.ts:12-18`) — there is NO `"task_start"`
  member.** Task creation already happens in the `EventLog` constructor
  itself. **CONTRADICTION with ARCHITECTURE.md Section 7**: the proposed
  `ObservationEventType` includes `"task_start"` as a seventh member; the
  live `EventLog` has no such event type and task start is implicit
  (constructor side effect). Also, `recordAgentEvent`'s `targets` parameter
  type is `Array<{ kind: "file" | "node"; entityId: number }>`
  (`events.ts:280`) — **only two target kinds, no `"edge"`** — while
  ARCHITECTURE.md Section 7's `ObservationEvent.targets` proposes
  `kind: "file" | "node" | "edge"`. **Reported, not silently resolved**: this
  blueprint's `POST /observations` contract (§10) maps to the real
  `AgentEventType`/`targets` union (drops `task_start` as an event type,
  routes it to task lifecycle instead; drops `"edge"` from targets to match
  `recordAgentEvent`'s actual signature) and flags both deltas for
  ARCHITECTURE.md correction in a follow-up pass — 08-08 (the hooks
  consumer) must read this note before implementing its client.
- `@tadori/store` barrel exports directly usable without `GraphService`:
  `listSnapshots(db, repoId)`, `getSnapshot(db, snapshotId)`,
  `getActiveSnapshot(db, repoId, kind?)`, `loadSnapshotGraph(db, snapshotId)`,
  `diffSnapshotEdges(db, base, head)`, `searchNodeFts(db, snapshotId, query,
  limit, kind?, offset?)`, `openDatabase(path)`, `runMigrations(db)`
  (all confirmed exported, `EVIDENCE-BASELINE.md` Section 3 table).
  `SnapshotRow` fields (from `snapshots.ts:19-35`, read to confirm pin/status
  columns exist): includes `id`, `repo_id`, `kind`, `label`, `base_commit_sha`,
  `workspace_hash`, `pinned`, `status`, `created_at` — matches the
  `SnapshotRow` shape ARCHITECTURE.md Section 3 route #2 assumes.
- `toolNodeSchema`/`toolEdgeSchema` (`packages/mcp/src/contracts.ts:49-88`)
  are zod `.strict()` schemas; their inferred TS types `ToolNode`/`ToolEdge`
  (`contracts.ts:430-431`) are the exact reusable wire shapes (AD-008).
  `responseContextSchema` (`contracts.ts:110-121`) is the shape
  ARCHITECTURE.md's `ApiContext` mirrors — same field set
  (`repository, snapshotId, snapshotKind, baseCommitSha, workspaceHash,
  freshness, stale, staleReason`) plus one addition, `refreshPending`, which
  is server-only (not in the MCP schema because MCP responses are per-call,
  not long-lived).
- Workspace/tooling verified current: `pnpm-workspace.yaml` lists exactly 5
  packages (no `server` entry); `tsconfig.json` `include` lists exactly 5
  packages' `{src,test}` globs; `tsconfig.base.json` `paths` maps exactly 5
  `@tadori/*` names, **no `allowJs`/`checkJs` key present anywhere**
  (verified absent). `packages/mcp/package.json` dependency block
  (`@modelcontextprotocol/sdk`, `@tadori/core`, `@tadori/indexer`,
  `@tadori/store`, `zod`) is the pattern this blueprint's new
  `packages/server/package.json` follows.
- No test framework beyond `vitest` exists; no `supertest` or `undici`
  fetch-testing helper is installed. Fastify's own `fastify.inject()` API
  (built into the `fastify` package, zero extra dependency) is the frozen
  testing seam per the task brief.
- Benchmark ground truth (`scripts/benchmark-incremental.mts`, corpus
  `FILE_COUNT=250 × LINES_PER_FILE=1000` ≈ 250k LOC,
  `IMPLEMENTATION_STATUS.md` line 67-75): single-file refresh p95
  1257.685 ms (< 2000 ms gate). No existing HTTP-layer latency benchmark
  exists; this blueprint introduces the first one (§16).
- Files to read first: `packages/mcp/src/service.ts`,
  `packages/mcp/src/concurrentRefresh.ts`, `packages/mcp/src/events.ts`,
  `packages/mcp/src/contracts.ts`, `packages/mcp/src/stdio.ts` (as the
  closest existing "wire GraphService + refresh + EventLog together" example
  to mirror), `packages/store/src/snapshots.ts`,
  `packages/store/src/search.ts`, `blueprints/ARCHITECTURE.md` Sections 1-4
  and 7.
- Gotchas: `GraphService.open`'s fallback (`service.ts:137-139`) silently
  serves a non-`working_tree` snapshot if none exists — every response must
  echo the real `snapshot.kind`, never assume `working_tree` (ARCHITECTURE.md
  Section 2 freshness caveat). `db.name` (better-sqlite3) is required
  file-backed for `ConcurrentRefreshController.start` — an in-memory test DB
  cannot exercise the refresh worker; tests for refresh-adjacent endpoints
  use a temp-file DB, not `:memory:`.

## 5. Scope

1. New `packages/server` workspace package: Fastify app factory, HTTP routes
   #1-#20 per ARCHITECTURE.md Section 3 table, WS channel per Section 4.
2. `GraphService` construction + `ConcurrentRefreshController` wiring
   identical in spirit to `stdio.ts` (one service instance per server
   process, refreshed via the same overlay mechanism).
3. Response envelope types (`ApiContext`, `Page<T>`, `ApiError`) as exported
   TS interfaces, reusing `toolNodeSchema`/`toolEdgeSchema`-derived
   `ToolNode`/`ToolEdge` for item shapes.
4. The one write endpoint, `POST /api/v1/observations`, with its trust
   boundary (server is the sole DB writer per AD-001; hooks/other localhost
   clients are untrusted producers).
5. `pnpm-workspace.yaml` + `tsconfig.json` + `tsconfig.base.json` wiring for
   the new package.
6. `fastify` dependency addition to the repo, justified against the deps
   allowlist.
7. Localhost-bind test, pagination cursor contract, error code table,
   fastify.inject-based test plan.
8. Performance budget: package-level `/nodes` page < 200 ms on the
   250k-LOC benchmark DB.

## 6. Non-goals

- **Not a seventh MCP tool.** This server never imports
  `@modelcontextprotocol/sdk`, `StdioServerTransport`, `createTadoriMcpServer`,
  or `TadoriTools`. It is a parallel HTTP consumer of `GraphService`, exactly
  as ARCHITECTURE.md AD-002 states. The six MCP tool names
  (`packages/mcp/src/contracts.ts:12-19`) are untouched and this blueprint
  adds none.
- Not port-conflict/fallback logic, browser-launch, or process supervision —
  deferred to 07-03 (this blueprint assumes a single fixed port is available
  in its own tests via port `0` auto-assignment).
- Not the CLI (`tadori serve .` flag parsing, lifecycle, `.tadori/` default
  path resolution) — that is 07-02.
- Not layout materialization logic (route #15 `/layout` is a thin store read;
  the seeded force-directed computation itself is 08-01's scope — this
  blueprint stubs the "not yet materialized" 404 path only).
- Not the viz static bundle serving (07-02 §6/08-02 own that); this
  blueprint's server has no `/` static route yet — it is pure `/api/v1/*`.
- Not the tour/overview *derivation logic* (08B-01/08B-02 own the
  content-generation algorithms); routes #16-#18 here are thin
  passthrough/persistence stubs returning honest "not yet available" bodies
  until those blueprints land their engines.
- Not `changed_with`/`co-change` extraction (09-04) or coalescing (09-02) —
  route #19 (`/review/diff`) returns the raw `diffSnapshotEdges` shape only.

## 7. Dependencies and prerequisites

- **00-01A** (allowJs scanner fix) must be `built`/`validated` before this
  blueprint's own dev-loop testing against the Tadori repo itself succeeds
  (the repo has root `.js` config files). The server's *code* has no
  dependency on 00-01A; its *test fixtures*, if they index the live repo
  rather than a synthetic fixture DB, do. This blueprint's tests use
  synthetic/fixture-backed databases (per §13), so 00-01A is a soft, not
  hard, blocker — recorded because BACKLOG.md's Phase 7 row lists it as a
  dependency.
- No other blueprint dependency. This is the first Phase 7 item.

## 8. Architectural decisions

- **AD-002 applied as-is: reuse `GraphService` in place.** No new
  `packages/query` extraction (ARCHITECTURE.md explicitly rejects this for
  Phase 7-8). The server imports `GraphService`, `ConcurrentRefreshController`,
  `EventLog` directly from `@tadori/mcp`'s barrel. Rejected: forking a copy
  of `GraphService` into `packages/server` — duplicates the freshness/
  fallback logic and diverges from MCP stdio's behavior over time.
- **One `GraphService` instance per server process, refreshed via overlay,
  not re-opened per request.** Mirrors `stdio.ts`'s pattern exactly: `open()`
  once at startup, hold the instance, let `ConcurrentRefreshController`
  report staleness through the `RefreshFreshnessOverlay` interface. On
  `snapshot_replaced` (new snapshot published), the server calls
  `GraphService.open` again to load the new snapshot and swaps the reference
  atomically (single-threaded Node event loop makes this safe without a
  lock). Rejected: opening a fresh `GraphService` per HTTP request — correct
  but wastes the `loadSnapshotGraph` full-graph reconstruction cost on every
  request; the existing overlay mechanism already gives freshness-per-read
  without re-loading.
- **One `EventLog` (one task) per server process lifetime, not per HTTP
  request.** `EventLog`'s constructor creates a `tasks` row and requires the
  bound `service.snapshot` to still be active (`events.ts:74-80`); creating
  one per `POST /observations` call would flood the `tasks` table with
  one-event tasks and contradict the "one task = one session" comment in
  `events.ts:58-64`. The server creates one `EventLog` at startup (agent
  `"tadori-serve"`, description `"tadori serve HTTP session"`), reuses it for
  every accepted observation, and calls `.endTask()` in server teardown (see
  07-02 §11 teardown order). When the bound snapshot rotates
  (`snapshot_replaced`), the server ends the old task and opens a new
  `EventLog` bound to the new `GraphService` instance (a `tasks` row is
  scoped to one `base_snapshot_id`, `events.ts:83-86`, so it cannot span a
  snapshot swap). Rejected: a stateless per-request `EventLog` — violates
  the "no active snapshot" precondition check in the constructor and
  produces meaningless one-off tasks; rejected: no `EventLog` at all
  (bypasses the only honesty-tracked write path, defeating AD-001).
- **`POST /observations` request/response shape follows the *real*
  `EventLog.recordAgentEvent` signature, not ARCHITECTURE.md's proposed
  superset** (see §4 contradiction note). Concretely: no `"task_start"`
  event type (task already exists at server-lifetime scope); `targets` is
  `{kind: "file" | "node"; ref: string}[]` only (no `"edge"` target kind).
  Rejected: extending `EventLog`/`AgentEventType` to add `"task_start"` and
  edge targets to unblock a literal ARCHITECTURE.md match — out of scope for
  this blueprint (touches a frozen-adjacent Phase 3-5 file with its own
  tests, `packages/mcp/test/events.test.ts`); the correct owner for that
  change, if wanted, is a future 08-08-adjacent blueprint after explicit
  instruction, not a silent scope-creep here.
- **Response item shapes reuse `ToolNode`/`ToolEdge` types verbatim (AD-008).**
  The server never redefines a node/edge wire shape; it imports the zod-
  inferred types from `@tadori/mcp`'s `contracts.ts` barrel. Rejected:
  bespoke server DTOs — creates two wire formats (MCP tool responses, HTTP
  responses) that must be kept in sync by hand.
- **Pagination is an opaque decimal-offset cursor string**, matching MCP's
  `cursorSchema` (`/^\d+$/`, `contracts.ts:24`). `nextCursor` is `null` when
  no more rows exist. Rejected: keyset pagination on `entityKey` — the store
  layer's `searchNodeFts`/`loadSnapshotGraph` do not expose a keyset-
  compatible ordering today; offset pagination against an already-loaded
  in-memory `GraphService.graph` array is O(1) slicing and correct for the
  page sizes involved (≤ 1000 rows/page).
- **`/nodes` and `/edges` serve from the in-memory `GraphService.graph`
  arrays (already loaded), filtered/sliced in JS — not a fresh SQL query per
  request.** The whole snapshot graph is already resident (that is what
  `GraphService.open` does); re-querying SQL per paginated request would be
  slower than array filtering for typical snapshot sizes and would
  re-introduce a second read path alongside the in-memory one. Rejected: SQL
  `LIMIT`/`OFFSET` per page — would require bypassing `GraphService` and
  querying `snapshot_nodes`/`snapshot_edges` directly, duplicating freshness/
  evidence assembly logic `loadSnapshotGraph` already does once.
- **WS is a change-signal only (AD-010).** The server holds no per-client
  replay buffer; on reconnect the client re-fetches `/snapshot` +
  `/refresh`. The server pushes `snapshot_replaced`, `refresh_pending`,
  `refresh_settled`, `watcher_error` by diffing the last-known
  `ConcurrentRefreshController.state()` against the previous poll on every
  state-change callback opportunity (the controller's internal worker
  `message` events already drive `stateValue` updates — the server layers a
  "did generation/phase change" check on top and broadcasts only on change,
  never polling on a timer). Rejected: stateful per-client event queues —
  adds failure modes (queue overflow, ordering bugs) the re-fetch-on-connect
  design avoids entirely.
- **Localhost-only, hard-coded.** `fastify().listen({host: "127.0.0.1", port})`
  — never configurable to `0.0.0.0`, no CORS allowlist beyond same-origin.
  This is a frozen non-negotiable (CLI_CONTRACT.md, ARCHITECTURE.md); no
  alternative considered.
- **`fastify` dependency addition is justified**: it is the one HTTP
  framework named in the locked deps allowlist (BACKLOG.md "Decisions locked
  2026-07-15": "react, sigma, graphology, fastify, simple-git; R3F behind
  experiment flag only" + Vite tooling). No alternative (raw `node:http`,
  `express`, `koa`, `hono`) is on the allowlist; using anything else would
  require a new allowlist justification round, which this blueprint avoids
  by using the pre-approved dependency. `@fastify/websocket` (the official
  Fastify WS plugin) is added alongside it — it is the natural in-ecosystem
  companion for route #WS and is not a separate framework choice; if a
  reviewer considers this a second new dependency requiring its own
  allowlist line, the fallback is Node's built-in `ws`-free
  `node:http`+manual upgrade handling, which is more code for no benefit
  given `@fastify/websocket` is maintained by the same team as the allowed
  `fastify` package.
- **Error responses never leak absolute filesystem paths** (`ApiError.detail`
  is repo-relative or a fixed code string only) — a security/privacy
  requirement carried from ARCHITECTURE.md Section 3's `ApiError` comment.

## 9. Exact file plan

- `packages/server/package.json` — create. `name: "@tadori/server"`,
  `type: "module"`, `main`/`types`: `./src/index.ts`. `dependencies`:
  `fastify: "^5.x"`, `@fastify/websocket: "^11.x"`, `@tadori/core:
  workspace:*`, `@tadori/store: workspace:*`, `@tadori/indexer: workspace:*`,
  `@tadori/mcp: workspace:*`. Pin exact minor versions the builder resolves
  at implementation time (record resolved versions in §21).
- `packages/server/src/index.ts` — create. Barrel: `export * from "./app.js"`,
  `export * from "./types.js"`.
- `packages/server/src/types.ts` — create. `ApiContext`, `Page<T>`,
  `ApiError`, `SnapshotRow`-derived response DTOs, `ObservationEvent`
  request type (per §10). No logic, types only.
- `packages/server/src/app.ts` — create. `createServerApp(options:
  ServerAppOptions): Promise<FastifyInstance>` — builds the Fastify instance,
  registers `@fastify/websocket`, registers all route modules, does **not**
  call `.listen()` (that is the caller's job — 07-02 and this blueprint's
  own tests both call `.listen()`/`.inject()` on the returned instance).
- `packages/server/src/graphState.ts` — create. `GraphState` class: owns the
  current `GraphService` instance, the `ConcurrentRefreshController`, the
  current `EventLog`, and the WS broadcast hook; exposes `.current():
  GraphService`, `.refreshState(): SerializedRefreshState`, `.onChange(cb)`
  for the WS layer to subscribe, `.recordObservation(event)`, `.close():
  Promise<void>` (ends task, stops refresh controller — does not close the
  `db` handle itself, that stays owned by whoever opened it, per 07-02's
  teardown order).
- `packages/server/src/routes/snapshots.ts` — create. Routes #1-#3
  (`/snapshot`, `/snapshots`, `/snapshots/:id/pin`).
- `packages/server/src/routes/graph.ts` — create. Routes #4-#7 (`/nodes`,
  `/edges`, `/nodes/:entityKey`, `/nodes/:entityKey/evidence`).
- `packages/server/src/routes/source.ts` — create. Route #8 (`/source`).
- `packages/server/src/routes/search.ts` — create. Route #9 (`/search`).
- `packages/server/src/routes/path.ts` — create. Route #10 (`/path`).
- `packages/server/src/routes/derived.ts` — create. Routes #11-#13, #16-#18
  (`/tests`, `/routes`, `/docs`, `/overview`, `/tour`, `/tour/progress`) —
  thin honest-stub bodies until 08-07/08B-01/08B-02 land (see §10).
- `packages/server/src/routes/refresh.ts` — create. Route #14 (`/refresh`).
- `packages/server/src/routes/layout.ts` — create. Route #15 (`/layout`) —
  404 `layout_not_materialized` stub until 08-01 lands the writer.
- `packages/server/src/routes/review.ts` — create. Route #19
  (`/review/diff`) — raw `diffSnapshotEdges` wrapper only (no coalescing).
- `packages/server/src/routes/observations.ts` — create. Route #20
  (`POST /observations`).
- `packages/server/src/ws.ts` — create. `/api/v1/ws` handler; subscribes to
  `GraphState.onChange`, filters by the client's declared `channels`,
  serializes `ServerEvent` per ARCHITECTURE.md Section 4.
- `packages/server/src/errors.ts` — create. Shared `ApiError` helpers:
  `notFound(code, detail?)`, `badRequest(code, detail?)`, `conflict(code,
  detail?)`, `forbidden(code, detail?)` — each returns `{statusCode,
  payload: ApiError}` for Fastify's `reply.code().send()`.
- `packages/server/test/localhost-bind.test.ts` — create.
- `packages/server/test/snapshots.test.ts` — create.
- `packages/server/test/graph.test.ts` — create.
- `packages/server/test/source.test.ts` — create.
- `packages/server/test/search.test.ts` — create.
- `packages/server/test/observations.test.ts` — create.
- `packages/server/test/ws.test.ts` — create.
- `packages/server/test/refresh.test.ts` — create.
- `packages/server/test/performance.test.ts` — create.
- `packages/server/test/fixtures/buildTestDb.ts` — create. Test helper:
  builds a temp-file SQLite DB (not `:memory:` — `ConcurrentRefreshController`
  requires file-backed), runs migrations, indexes a small fixture repo
  (reuses `packages/fixtures/01-core-symbols`) via
  `indexRepositoryIntoStore`, returns `{dbPath, db, repoRoot}`.
- `pnpm-workspace.yaml` — modify. Add `"packages/server"` line.
- `tsconfig.json` — modify. Add `packages/server/{src,test}/**/*.ts` to
  `include`.
- `tsconfig.base.json` — modify. Add `"@tadori/server": ["packages/server/src/index.ts"]`
  to `paths`.
- `eslint.config.js` — no change needed (flat config already applies to all
  non-ignored `.ts`; `packages/server` is not in the ignore list).

## 10. Exact contracts

```ts
// packages/server/src/types.ts
import type { ToolNode, ToolEdge } from "@tadori/mcp";

export interface ApiContext {
  repository: string;
  snapshotId: number;
  snapshotKind: "commit" | "working_tree" | "staged" | "patch";
  baseCommitSha: string | null;
  workspaceHash: string;
  freshness: "fresh" | "stale" | "unknown";
  stale: boolean;
  staleReason:
    | "matches_snapshot" | "content_changed" | "refresh_pending"
    | "unreadable" | "outside_repository" | "not_in_snapshot";
  refreshPending: boolean;
}

export interface Page<T> { items: T[]; nextCursor: string | null; total: number | null; }
export interface ApiError { error: string; code: string; detail?: string; }

export interface SnapshotRowDto {
  id: number; kind: string; label: string | null; baseCommitSha: string | null;
  workspaceHash: string; pinned: boolean; status: string; createdAt: string;
}
// `pinned` MUST be converted at the DTO boundary with `Boolean(row.pinned)` —
// the store's SnapshotRow.pinned is a SQLite integer 0/1 (snapshots.ts:28);
// serializing the raw number violates the wire contract.

export type ObservationEventType =
  | "plan_mentioned" | "file_read_observed" | "modified"
  | "test_selected" | "test_executed" | "capture_interrupted";
  // NOTE: no "task_start" — see §4/§8 contradiction note; the server's one
  // long-lived EventLog task already exists at process-lifetime scope.

export interface ObservationEvent {
  type: ObservationEventType;
  source: "claude_hook";
  at: string;                                 // ISO 8601; server re-stamps, does not trust producer clock for ordering
  targets?: { kind: "file" | "node"; ref: string }[]; // NOTE: no "edge" — matches EventLog.recordAgentEvent's real signature
  detail?: string;
}

export interface ObservationsResponse { accepted: number; rejected: { index: number; reason: string }[]; }
```

```ts
// packages/server/src/app.ts
export interface ServerAppOptions {
  db: Database;              // @tadori/store Database, already migrated
  repoRoot: string;          // absolute path, already resolved
  refresh: ConcurrentRefreshController; // caller-owned lifecycle (07-02 owns start/stop)
}
export function createServerApp(options: ServerAppOptions): Promise<FastifyInstance>;
```

Route table (verbatim from ARCHITECTURE.md Section 3, reproduced here as the
build contract; response bodies use the types above):

| # | Method | Path | Response type | Error codes |
|---|---|---|---|---|
| 1 | GET | `/api/v1/snapshot` | `{context: ApiContext; analyzerVersion: string; counts: {files,nodes,edges}}` | 404 `no_active_snapshot` |
| 2 | GET | `/api/v1/snapshots` | `SnapshotRowDto[]` | — |
| 3 | POST | `/api/v1/snapshots/:id/pin` | `SnapshotRowDto` | 404 `unknown_snapshot`, 409 `invalid_snapshot` |
| 4 | GET | `/api/v1/nodes` | `Page<ToolNode>` | 400 `bad_level` |
| 5 | GET | `/api/v1/edges` | `Page<ToolEdge>` | 400 `bad_query` |
| 6 | GET | `/api/v1/nodes/:entityKey` | `ToolNode & {outEdges: ToolEdge[]; inEdges: ToolEdge[]; fanIn: number}` | 404 `unknown_entity`, 409 `ambiguous` |
| 7 | GET | `/api/v1/nodes/:entityKey/evidence` | `{evidence: Evidence[]; freshness: FreshnessStatus}` | 404 `unknown_entity` |
| 8 | GET | `/api/v1/source` | `{body: string \| null; freshness: FreshnessStatus; staleReason: string}` | 403 `outside_repository`, 404 `not_in_snapshot`, 409 `content_changed` |
| 9 | GET | `/api/v1/search` | `FtsSearchResult` | 400 `empty_query` |
| 10 | GET | `/api/v1/path` | `{nodes: ToolNode[]; edges: ToolEdge[]; found: boolean}` | 404 `unknown_endpoint` |
| 11 | GET | `/api/v1/tests` | `{tests: ToolNode[]; observed: false; note: "not observed inspected"}` | — |
| 12 | GET | `/api/v1/routes` | `{routes: ToolNode[]}` | — |
| 13 | GET | `/api/v1/docs` | `{docs: {node: ToolNode; body: string \| null}[]}` | — |
| 14 | GET | `/api/v1/refresh` | `SerializedRefreshState` (phase/generation/dirtyPaths/snapshotId/lastError) | — |
| 15 | GET | `/api/v1/layout` | `{positions: LayoutPositionDto[]; layoutVersion: number}` | 404 `layout_not_materialized` (until 08-01) |
| 16 | GET | `/api/v1/overview` | `{available: false; reason: "not_yet_implemented"}` (stub until 08B-01) | — |
| 17 | GET | `/api/v1/tour` | `{available: false; reason: "not_yet_implemented"}` (stub until 08B-02) | 404 |
| 18 | GET/PUT | `/api/v1/tour/progress` | `{tourId: string; stepIndex: number; updatedAt: string} \| null` (persists to `.tadori/progress.json` if present) | — |
| 19 | GET | `/api/v1/review/diff` | `{context: ApiContext; base: SnapshotRowDto; head: SnapshotRowDto; nodesAdded: ToolNode[]; nodesRemoved: ToolNode[]; edges: EdgeDiffRow[]; presentation: "raw"}` | 400 `bad_snapshot_ref`, 404 `unknown_snapshot` |
| 20 | POST | `/api/v1/observations` | `ObservationsResponse` | 400 `bad_schema`, 409 `no_active_task` |

WS envelope (verbatim from ARCHITECTURE.md Section 4, this blueprint owns
every variant except `observation`, which 08-09 activates later but whose
type is reserved here so the union is stable):

```ts
type ServerEvent =
  | { type: "snapshot_replaced"; snapshotId: number; snapshotKind: string; generation: number; workspaceHash: string }
  | { type: "refresh_pending";  phase: "dirty" | "refreshing"; dirtyPaths: string[]; generation: number }
  | { type: "refresh_settled";  phase: "idle" | "failed"; snapshotId: number | null; lastError: string | null; generation: number }
  | { type: "watcher_error";    message: string }
  | { type: "observation";      event: ObservationEvent }; // reserved; not emitted until 08-09
interface ClientEvent { type: "subscribe"; channels: ("refresh" | "observation")[]; }
```

## 11. Ordered implementation procedure

1. `packages/server/package.json` + workspace/tsconfig wiring (§9). Run
   `pnpm install`. Expected: `pnpm -w list --depth -1` shows `@tadori/server`.
2. `packages/server/test/fixtures/buildTestDb.ts` — build the temp-file DB
   helper. Test added: a trivial smoke test asserting the helper returns a
   DB with one active snapshot. Expected: green.
3. `packages/server/src/types.ts` — all DTOs. `pnpm typecheck` clean (no
   route logic yet, just types).
4. `packages/server/src/errors.ts` + `packages/server/src/graphState.ts` —
   `GraphState` wrapping `GraphService.open` + `ConcurrentRefreshController` +
   `EventLog`, per §8 decisions. Test added
   (`packages/server/test/graphState.test.ts` if the builder judges it
   needed, or folded into `snapshots.test.ts`): asserts `.current().snapshot`
   matches the fixture DB's active snapshot; asserts `.close()` stops the
   refresh worker (no open handle leak — assert via `db.close()` not
   throwing afterward).
5. `packages/server/src/app.ts` skeleton (Fastify instance, no routes yet,
   `127.0.0.1`-only listen option threaded through options but not called).
   Test added: `localhost-bind.test.ts` — asserts `fastify.listen({host:
   "0.0.0.0", ...})` is never called anywhere in source (grep-based static
   assertion is acceptable here since binding is a config value, not
   runtime-observable without an actual listen) **and** an integration
   check: `app.listen({port: 0})` succeeds, `app.server.address().address`
   is `"127.0.0.1"`.
6. Routes #1-#3 (`snapshots.ts`). Tests in `snapshots.test.ts`: `/snapshot`
   returns the fixture DB's active snapshot context; `/snapshots` lists it;
   `/snapshots/:id/pin` toggles `pinned` and returns the updated row; pinning
   an unknown id returns 404 `unknown_snapshot`.
7. Routes #4-#7 (`graph.ts`). Tests in `graph.test.ts`: `/nodes?level=package`
   returns only package-kind nodes from the fixture graph with correct
   pagination (`limit=1` returns exactly 1 item + non-null `nextCursor`);
   `/edges?relation=imports` filters correctly; `/nodes/:entityKey` for a
   known fixture entity key returns its out/in edges and `fanIn` matching
   `GraphService.fanIn`; unknown key returns 404 `unknown_entity`;
   `/nodes/:entityKey/evidence` returns the node's `evidence` array.
8. Route #8 (`source.ts`). Tests in `source.test.ts`: reading a fixture file
   inside the repo root returns its body; `file=../outside.ts` (path-escape
   attempt) returns 403 `outside_repository`; a file not in the snapshot's
   file set returns 404 `not_in_snapshot`.
9. Route #9 (`search.ts`). Tests in `search.test.ts`: a known fixture symbol
   name returns a match with `total >= 1`; empty `q` returns 400
   `empty_query`.
10. Route #10 (`path.ts`). Test: a known two-hop fixture path returns
    `found: true` with intermediate nodes; an unreachable pair returns
    `found: false`.
11. Routes #11-#13, #16-#18 (`derived.ts`). Tests: each stub route returns
    its documented honest "not yet available"/"not observed inspected" body
    with a 200 (not 500) — these are placeholders, not failures.
12. Route #14 (`refresh.ts`). Tests in `refresh.test.ts`: reflects
    `ConcurrentRefreshController.state()` verbatim (start a real controller
    against the file-backed fixture DB — this is the one route test that
    needs the actual worker thread, per §4 gotcha).
13. Route #15 (`layout.ts`). Test: no `layout_positions` row for the fixture
    repo → 404 `layout_not_materialized`.
14. Route #19 (`review.ts`). Test in a new or existing file: diff between
    the fixture DB's single snapshot and itself returns empty `nodesAdded`/
    `nodesRemoved`/`edges` with `presentation: "raw"`.
15. Route #20 (`observations.ts`). Tests in `observations.test.ts`: a
    well-formed `plan_mentioned` event with no targets is accepted
    (`accepted: 1`); an event referencing an unknown node `ref` is rejected
    with a per-item reason and `accepted: 0` for that item (batch partial
    acceptance, not all-or-nothing — see §17); a malformed body (missing
    `type`) returns 400 `bad_schema` for the whole request.
16. `ws.ts` + wiring into `app.ts`. Tests in `ws.test.ts`: connect, subscribe
    to `["refresh"]`, trigger a refresh-state change on the underlying
    controller (or a test double), assert a `refresh_pending`/
    `refresh_settled` frame arrives; assert no frame arrives for an
    unsubscribed channel.
17. `performance.test.ts` — build (or reuse a cached) larger fixture DB
    approximating the 250k-LOC benchmark corpus (reuse
    `scripts/benchmark-incremental.mts`'s corpus generator if practical, or
    document why a smaller proxy corpus with a scaled budget is used
    instead — see §16). Assert `/nodes?level=package` p95 < 200 ms over N
    repeated `fastify.inject()` calls.
18. Full validation pass (§15). Commit.

## 12. Data and lifecycle flows

**Startup** (invoked by 07-02, or directly by this blueprint's tests):
`openDatabase` + `runMigrations` (caller-provided, already done before
`createServerApp` is called) → `ConcurrentRefreshController.start(db,
repoRoot)` (caller-provided instance, per §9 `ServerAppOptions.refresh`) →
`GraphState` constructed: `GraphService.open(db, repoRoot, refresh,
"working_tree")` → `new EventLog(db, service, "tadori-serve", "tadori serve
HTTP session")` → routes registered → WS subscribed to `GraphState.onChange`.

**Steady-state read**: HTTP request → route handler reads
`graphState.current()` → filters/paginates the in-memory `graph.nodes`/
`graph.edges` arrays → response includes `ApiContext` with
`refreshPending: refresh.isSnapshotStale(current.snapshot.id)`.

**Snapshot rotation** (driven externally — 07-02's `IncrementalRepositoryIndexer`
or `--reindex`, not by this blueprint's own code): the refresh worker
publishes a new activation → `ConcurrentRefreshController`'s `state.snapshotId`
changes → `GraphState`'s change-detection loop notices → ends the old
`EventLog` task (`.endTask("completed")`) → `GraphService.open`s the new
snapshot → constructs a new `EventLog` → broadcasts `snapshot_replaced` over
WS with the new `generation`/`snapshotId`.

**Observation ingest**: `POST /observations` → schema validation (zod, mirrors
`ObservationEvent`) → for each event, resolve `targets[].ref` via
`graphState.current().nodeEntityId`/file-lookup → call
`eventLog.recordAgentEvent(type, "claude_hook", {detail}, resolvedTargets)` →
per-item accept/reject in the response; a single malformed item never fails
sibling well-formed items in the same batch (§17 rationale).

**Shutdown**: `GraphState.close()` → `eventLog.endTask("aborted")` (idempotent
— safe if already ended) → **does not** call `refresh.stop()` or `db.close()`
— those remain owned by the caller (07-02's teardown order, AD-003) since
this blueprint's tests construct their own `refresh`/`db` and must be free to
tear them down independently of `GraphState`.

## 13. Test plan

- Unit/integration (fastify.inject, no real network socket needed except
  `localhost-bind.test.ts`): `snapshots.test.ts`, `graph.test.ts`,
  `source.test.ts`, `search.test.ts`, `observations.test.ts`,
  `refresh.test.ts` — see §11 for exact assertions per file.
- `localhost-bind.test.ts`: real `.listen({port: 0})` + real TCP connect
  assertion (`app.server.address().address === "127.0.0.1"`); assert
  connecting via the loopback address succeeds while asserting no code path
  passes `"0.0.0.0"` as `host` (static grep check acceptable per §11 step 5).
- `ws.test.ts`: real WS client (Node's built-in `node:http` upgrade + a
  minimal raw WebSocket handshake, or `@fastify/websocket`'s own client
  helper if it ships one; no new test-only dependency beyond what
  `@fastify/websocket` already pulls in).
- `performance.test.ts`: performance/benchmark-style, see §16.
- Adversarial (folded into the relevant per-route file, not a separate
  file): path-escape attempt on `/source` (403); unknown entity key on
  `/nodes/:entityKey` (404); malformed observation batch (400); pin an
  already-pinned/unknown snapshot id (404/409); WS subscribe to an unknown
  channel string (server ignores unknown channel names rather than
  crashing — assert no 500).
- Regression: the full existing 170+ test suite (`pnpm test`) must stay
  green — this blueprint adds a new package, touches no existing package
  source.

## 14. Acceptance criteria

- [ ] `packages/server` builds: `pnpm typecheck` exits 0 including the new
      package.
- [ ] `pnpm -w list --depth -1` includes `@tadori/server`.
- [ ] All 20 routes in §10's table exist and return the documented shape for
      at least one passing case each (verified by the named tests in §11).
- [ ] `fastify.listen({host: "127.0.0.1", port: 0})` succeeds and
      `app.server.address().address === "127.0.0.1"`; no source line passes
      `"0.0.0.0"` as a listen host (`grep -r "0.0.0.0" packages/server/src`
      returns zero matches).
- [ ] `/nodes` and `/edges` pagination: requesting `limit=1` against a
      fixture with ≥ 2 matching rows returns exactly 1 item and a non-null
      `nextCursor`; following the cursor returns the next item.
- [ ] `POST /observations` with one well-formed and one malformed event in
      the same batch returns `accepted: 1` and one entry in `rejected`
      (partial-batch acceptance, not all-or-nothing failure).
- [ ] `POST /api/v1/snapshots/:id/pin` on a nonexistent id returns HTTP 404
      with `code: "unknown_snapshot"`.
- [ ] `/source?file=../outside.ts` (or equivalent escape attempt) returns
      HTTP 403 with `code: "outside_repository"`.
- [ ] WS: subscribing to `["refresh"]` and triggering a refresh-state change
      on the bound controller produces exactly one `refresh_pending` or
      `refresh_settled` frame; no frame for unsubscribed channels.
- [ ] `/nodes?level=package` p95 latency < 200 ms across ≥ 20 repeated
      `fastify.inject()` calls against a DB built from the 250k-LOC benchmark
      corpus (or the documented scaled proxy — see §16).
- [ ] No import of `@modelcontextprotocol/sdk`, `StdioServerTransport`,
      `createTadoriMcpServer`, or `TadoriTools` anywhere under
      `packages/server/src` (`grep -r "modelcontextprotocol\|StdioServerTransport\|createTadoriMcpServer\|TadoriTools" packages/server/src` returns zero matches).
- [ ] Full existing suite stays green: `pnpm test` reports the pre-existing
      count plus this blueprint's new tests, zero failures.
- [ ] 5/5 golden fixtures still PASS (`pnpm fixtures:validate`,
      `pnpm fixtures:index`) — this blueprint touches no fixture/indexer
      code, so this is a regression guard, not new coverage.
- [ ] An observation POSTed during the narrow post-rotation window (snapshot
      replaced, replacement EventLog not yet constructed — simulated via test
      double) returns 409 no_active_task and is not recorded.

## 15. Validation commands

pnpm install; pnpm skills:check; pnpm typecheck; pnpm lint; pnpm test;
python validate_fixtures.py; pnpm fixtures:validate; pnpm fixtures:index;
pnpm fixtures:typecheck; pnpm benchmark:incremental; git diff --check;
git status --short

(No new top-level script is added by this blueprint; `pnpm --filter
@tadori/server test` is a convenience subset of `pnpm test` the builder may
use during development but the gate list above is what must pass at the
end.)

## 16. Performance budgets

- `/nodes?level=package` (and `/edges` with an equivalent filter) median and
  p95 < 200 ms against a DB indexed from the 250k-LOC benchmark corpus
  (`scripts/benchmark-incremental.mts`'s generator). **If reusing that exact
  corpus generator inside a vitest file is impractical within one session**
  (it currently writes to `mkdtempSync` and is wired as a standalone script,
  not an importable test helper), the builder may build a smaller synthetic
  fixture (documented row/node/edge counts) and scale the budget
  proportionally, but the synthetic fixture must be no smaller than 20k LOC
  and no less than 1/10 of the benchmark corpus, and must record the actual
  corpus size used and the scaling justification — stating the measured
  ratio — in §21; never silently test against a trivially small graph and
  claim the 250k-LOC budget was met.
- WS broadcast fan-out: not benchmarked in this blueprint (single-client
  tests only); 08-10 owns large-repo/many-client performance validation.
- Server startup (`GraphService.open` + `ConcurrentRefreshController.start`)
  latency is not separately budgeted here — 07-02 §16 owns end-to-end CLI
  startup budget, which includes this cost.

## 17. Failure and recovery behavior

- Malformed request query params (bad `level`, non-numeric `limit`) → 400
  with a specific `code`, never a 500.
- Unknown entity key / snapshot id → 404, never a silent empty success body.
- `/source` path escaping the repo root → 403 `outside_repository` (reuses
  `GraphService`'s own `resolveSnapshotPath` root-confinement logic via the
  `readBody`/freshness helpers — no new path-resolution code is written in
  `packages/server`).
- Stale/refresh-pending snapshot content → responses still return data (the
  last valid snapshot) with `context.stale: true` and the specific
  `staleReason` — the server **never blocks a read waiting for a refresh to
  finish** (matches CLI_CONTRACT.md "the last valid snapshot remains served
  instead").
- `POST /observations` batch: **partial acceptance, not all-or-nothing.**
  Each event is validated and applied independently; one bad `ref` does not
  reject the whole batch. Rationale: hooks (08-08) fire many small events
  and a single unresolved reference (e.g., a file renamed between the hook
  firing and the POST arriving) should not discard an otherwise-good batch.
- If the bound snapshot is no longer active when an observation arrives
  (race with a `snapshot_replaced` rotation) → that item is rejected with
  reason `"snapshot_rotated"`, not a 500; the client should retry against
  the new snapshot (surfaced via the `409 no_active_task` whole-request code
  only if the *entire* task/EventLog itself has become invalid, e.g., mid-
  rotation before the new `EventLog` is constructed — an narrow race window
  documented, not silently swallowed).
- WS disconnect: server drops the client's subscription state; no
  reconnection logic lives server-side (client reconnects and re-subscribes
  per AD-010 — this is a client-side concern, out of scope here).
- Watcher/refresh worker fatal error (`ConcurrentRefreshController`'s
  `onError` callback) → server broadcasts `watcher_error` over WS and keeps
  serving the last valid snapshot's reads; it does not crash the HTTP
  server. (07-03 owns deeper adversarial worker-crash supervision; this
  blueprint's obligation is only that the HTTP layer stays up and reports
  the error honestly.)

## 18. Security and privacy

- `127.0.0.1` bind only, enforced by the static grep check in §14 plus a
  runtime assertion in `localhost-bind.test.ts`.
- No CORS allowlist beyond same-origin; no `Access-Control-Allow-Origin: *`
  anywhere in the route handlers.
- `/source` and any file-path-accepting route resolve through
  `GraphService`'s existing `resolveSnapshotPath` confinement (real-path
  comparison against the repo root, `service.ts:168-192`) — never a naive
  string-prefix check.
- `ApiError.detail` never includes an absolute filesystem path; error
  messages reference repo-relative paths or fixed code strings only.
- `POST /observations` is the sole write path (AD-001); it validates every
  event against the zod schema before touching the DB and resolves
  `targets[].ref` against the currently-served snapshot's own entity/file
  sets (never trusts a client-supplied numeric DB id).
- No new outbound network calls; no telemetry; no cloud dependency
  introduced by this blueprint.

## 19. Accessibility

Not applicable — this blueprint has no human-facing UI surface (pure HTTP+WS
API). Accessibility requirements apply starting at 08-02 (`apps/viz`).

## 20. Documentation updates

None outside `blueprints/`. This blueprint's own file is the specification;
no README/CLI_CONTRACT/ARCHITECTURE edits are made by the builder (any
correction to ARCHITECTURE.md's `ObservationEvent`/`AgentEventType` mismatch
noted in §4/§8 is a planning-doc decision for the planning model, not this
builder session, per the task's "do not edit ARCHITECTURE.md" instruction
carried forward from this blueprint-drafting task itself).

## 21. Builder final report

Require: summary; files changed (full list per §9); resolved `fastify`/
`@fastify/websocket` exact versions; contracts implemented (route table with
pass/fail per row); tests added (file names + count); validation command
output summary (§15, each command's exit status); performance benchmark
evidence (actual corpus size used, p95 numbers, scaling justification if a
proxy corpus was used per §16); commit SHA; `ASSUMPTION:` lines; explicit
statement of whether the split recommendation in §1 was needed.

## 22. Independent review result

- Status: review. §22 content: **Pending Wave 1 adversarial review.**
- Known contradiction to resolve in that review (see §4/§8): ARCHITECTURE.md
  Section 7's `ObservationEventType`/`ObservationEvent.targets` do not match
  the live `EventLog.recordAgentEvent`/`AgentEventType` signatures in
  `packages/mcp/src/events.ts`. This blueprint's §10 contract follows the
  real code; the reviewer should confirm whether ARCHITECTURE.md itself
  needs a follow-up correction pass (out of scope for this blueprint's
  builder to make unilaterally).
- 2026-07-17 Blueprint Review Agent (implementation-phase): PASS after
  corrections. Confirmed this blueprint's task_start resolution against live
  events.ts/migration 003; the same review found blueprint 08-08's DECISION
  08-08-B and §9-§11/§14 still specified the abandoned client-triggered
  task_start path — corrected in 08-08 and ARCHITECTURE AD-011 in the same
  pass so 08-08's builder inherits the server-lifetime task model.

## IF SOMETHING IS UNCLEAR

Smallest safe assumption + `ASSUMPTION:` line. If an uncertainty could mean
serving an invalid snapshot, adding a seventh MCP-tool-shaped surface, or
binding beyond `127.0.0.1`, stop and report blocked instead of guessing.

## TADORI NON-NEGOTIABLES

Frozen v2.1; TS/JS only; exactly six MCP tools (this server is not a
seventh); stable 2D default is out of scope here (08-02 owns it); no
generic admin dashboard; every visible node/edge keeps evidence/origin/
confidence/resolution; unresolved stays visibly unresolved; agent
observation honesty ("not observed inspected"); invalid snapshots never
served; localhost default; no cloud dependency; Graphify is ignored
reference only; no seventh tool; no runtime tracing.
