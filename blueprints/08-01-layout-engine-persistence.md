# BLUEPRINT 08-01: Layout engine + persistence

## 1. Header

- ID / Title / Phase: 08-01 — Layout engine + persistence — Phase 8
- Status: review
- Primary builder: Claude Sonnet — deterministic algorithm + store-layer
  writer over an already-frozen table; no UI, no architectural latitude left
  open (AD-005/AD-006 resolve every open question).
- Reviewer roles: Spec Guardian (frozen-migration boundary), Test Adversary
  (determinism/byte-identity matrix), Implementation Reviewer (store seam).
- Complexity: M (one focused builder session)
- Depends on: 07-01 (`packages/server` — provides `GraphService`-backed read
  view this blueprint's engine consumes as pure input; server-side trigger
  wiring at `/api/v1/layout` is owned by 07-01, calling this blueprint's
  engine).
- Unlocks: 08-02 (viz cannot render a stable base map without persisted
  positions), 08-03/08-04 (semantic zoom reads `abstraction_level='file'`
  and `='symbol'` rows this blueprint's writer produces).
- Estimated sessions: 1
- Related frozen-spec sections: ARCHITECTURE.md §6 "Layout persistence"
  (AD-005, AD-006/C-1); ASSUMPTIONS.md A-102 (REFUTED-as-written, corrected);
  docs/CLI_CONTRACT.md non-negotiables (deterministic, evidence-visible —
  layout itself carries no evidence but must not contradict it); BACKLOG.md
  row 08-01.

## 2. Objective

Given a snapshot's graph, a deterministic seeded layout is computed exactly
once per `(repo_id, abstraction_level, view_key, layout_version)` and
persisted into the existing frozen migration-004 `layout_positions` table via
a new additive `@tadori/store` writer; every subsequent read returns the
byte-identical stored `x/y/z`, never a recomputed value.

## 3. Why this matters

- User value: a graph that reshuffles on every reload is unusable for
  spatial memory ("where was that package last time") — the single most-cited
  Graphify failure mode this phase must avoid (R-01 §2 "no deterministic/
  seeded layout guarantee").
- System value: 08-02/08-03/08-04 all assume layout is a read, not a
  computation, inside the browser bundle (AD-005 — viz must not import
  graphology-on-node or the store).
- Downstream: 08-10 (byte-identical-reload is itself a named performance/
  correctness gate), 08-09 (observation overlays render atop frozen
  coordinates — they must never move a node).

## 4. Current repository evidence

**Verified current (2026-07-17):**

- `packages/store/src/migrations.ts:435-474` (migration004, frozen, name
  "layouts and quarantined summaries") already creates:
  ```sql
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
  ```
  Grep across `packages/store`, `packages/mcp` confirms **no production
  reader or writer** of this table exists today — only the migration itself
  and its own migration test touch it.
- `node_id` is a foreign key to `node_entities(id)` (migration001,
  `migrations.ts:80-94`) — an **internal per-repo integer id**, unique per
  `(repo_id, entity_key)`. `node_entities` rows are **stable across
  snapshots**: `ensureNodeEntity` (`packages/store/src/snapshots.ts:137-196`,
  referenced in EVIDENCE-BASELINE.md §3) reuses the existing row for a given
  `(repo_id, entity_key)` rather than inserting a new one per snapshot. This
  is the exact mechanism that makes `node_id`-keyed positions survive
  snapshot replacement without any special-case logic — it is the same
  entity table every snapshot's `snapshot_nodes` membership row points at.
- `last_snapshot_id` (`ON DELETE SET NULL`) records which snapshot the stored
  `x/y/z` were computed against; it does not gate whether the row is valid
  for a *different current* snapshot (node identity, not snapshot identity,
  is what layout is keyed to — ARCHITECTURE.md §6).
- `packages/store/src/index.ts` barrel: `export * from "./database.js"`,
  `./migrations.js`, `./snapshots.js`, `./diff.js`, `./gc.js`, `./search.js`.
  No `layout.ts` file exists yet.
- `packages/core/src/enums.ts:4-17` — `NODE_KINDS` includes `"package"` as a
  frozen node kind (migration001 CHECK constraint); package-level nodes
  already exist in every snapshot graph, giving this blueprint's centroid
  placement a concrete anchor kind to query.
- `packages/mcp/src/service.ts:66-118` — `GraphService` (already reused
  in-place by 07-01 per AD-002) exposes `nodesByKey: Map<string, GraphNode>`,
  `repoId: number`, `snapshot: SnapshotRow`; `GraphNode` (from
  `@tadori/core` `graph.ts`) carries `entityKey`, `kind`, `qualifiedName`. No
  `packageName` field is on `GraphNode` directly — package assignment must be
  derived the same way `repo_overview`/07-01's `/api/v1/nodes?level=package`
  does: package nodes are `kind==='package'`; file/symbol nodes' package
  membership is derived via `contains` edges or the file's normalized path
  prefix (see `detectPackageName` precedent,
  `packages/indexer/src/scan.ts:162-186`, which is the indexer-time
  equivalent — 08-01 does not re-derive package assignment from paths; it
  reads it from the graph's own `contains` edges, since that is the frozen
  relation already recorded at index time, avoiding a second, possibly
  divergent, path-based heuristic).
- No `graphology` dependency exists anywhere in `package.json` today (grep
  confirmed) — this blueprint is the first to add it. Allowed per
  ASSUMPTIONS.md A-003 / BACKLOG.md locked decision (deps allowlist: react,
  sigma, graphology, fastify, simple-git, Vite).
- `better-sqlite3` `REAL` columns round-trip IEEE-754 doubles exactly
  (SQLite storage class `REAL` is an 8-byte IEEE float, and `better-sqlite3`
  reads/writes JS `number` without an intermediate string/text conversion) —
  this is the mechanism the byte-identical-reload guarantee below relies on;
  no serialization-format risk (contrast with e.g. writing decimal strings).

**PROPOSED (this blueprint):** the `packages/store/src/layout.ts` module,
its two exported functions, and the `packages/indexer`-adjacent
`@tadori/layout-engine`-shaped pure function described in §8/§9. Package
placement of the *engine* (vs. the *store writer*) is a decision made below,
not left open.

Files to read first: `packages/store/src/migrations.ts:435-474`,
`packages/store/src/snapshots.ts:137-219` (`ensureNodeEntity`,
`findDanglingEndpoints`), `packages/store/src/database.ts` (transaction
helper pattern), `packages/mcp/src/service.ts:66-155` (`GraphService`
shape), `packages/core/src/graph.ts` (`GraphNode`/`GraphEdge` field shapes).

Gotchas: `layout_positions` has **no `entity_key` column** — only
`node_id` (an internal integer). The writer must resolve `entity_key ->
node_id` per repo via `node_entities`, mirroring the exact lookup pattern
`GraphService.nodeEntityId` already uses (`service.ts:307-317`) rather than
inventing a second resolution path.

## 5. Scope

1. A pure, dependency-injected layout **engine** function: given a node/edge
   list for one `(repo, abstraction_level, view_key)` slice plus a
   deterministic seed, returns `x/y` (and `z=0` for the 2D default) for every
   node, using `graphology` + a seeded force-directed algorithm, run for a
   fixed iteration count, no wall-clock or PRNG entropy.
2. A store-layer **writer/reader pair** (`readLayout`, `writeLayout`) in a
   new `packages/store/src/layout.ts`, additive to the barrel.
3. **Run-once semantics**: a `(repo_id, abstraction_level, view_key,
   layout_version)` combination with an existing full row set is never
   recomputed; only missing rows (new nodes) or an explicit `layout_version`
   bump triggers computation for the affected rows.
4. **New-node placement**: nodes present in a snapshot but absent from
   `layout_positions` are placed at their package centroid with bounded local
   relaxation, computed and persisted without moving any existing row.
5. **Byte-identical reload test**: two consecutive `readLayout` calls with no
   intervening `writeLayout` return identical `x/y/z` values (exact float
   equality, not epsilon-approximate).
6. `layout_version` bump rule and its all-rows-stale consequence.

## 6. Non-goals

- No UI, no rendering, no Sigma.js/React (owned by 08-02).
- No HTTP endpoint (the `GET /api/v1/layout` route and its
  compute-on-first-request trigger are owned by 07-01, per ARCHITECTURE.md
  §3 row 15 and §6 "Owner: 08-01 (engine + store writer), 07-01 (serve-time
  trigger)" — this blueprint delivers the engine and writer as a library
  seam 07-01 calls, not the route itself).
- No new migration — frozen migrations 001-006 are untouched (AD-006/C-1;
  A-102 corrected). Any implementation that adds a migration file is a scope
  violation, stop and report blocked.
- No pinning UI/interaction (the `pinned` column exists in the frozen
  schema; this blueprint's writer accepts and preserves a `pinned` flag
  passed to it but does not add a mechanism for a human to set it — that is
  a later 08-06/08-09-adjacent concern).
- No 2.5D/3D layout variant (`z` is always `0` here; Phase 10 owns non-zero
  `z`).
- No cross-repo layout sharing; `repo_id`-scoped only, matching the schema.

## 7. Dependencies and prerequisites

- **07-01** must exist to call this blueprint's `writeLayout`/`readLayout`
  from an HTTP handler, but 08-01 itself has no runtime dependency on
  `packages/server` — it only requires a `better-sqlite3` `Database` handle
  and a node/edge list, which 08-01's own tests construct directly against
  `@tadori/store` (`openDatabase` + `runMigrations`), the same pattern every
  existing store test file already uses.
- Consumes (read-only, no modification): `@tadori/core` (`GraphNode`,
  `GraphEdge`, `NODE_KINDS`), `@tadori/store` (`Database` type,
  `openDatabase`, `runMigrations`, existing snapshot/node-entity tables).

## 8. Architectural decisions

- **Engine lives inside `@tadori/store` as `packages/store/src/layout.ts`,
  not a new package.** Rationale: the engine's sole consumer today is the
  store-layer writer itself (compute-then-persist is one operation from
  07-01's point of view); a `graphology`-only pure function has no reason to
  be a separate workspace member, and adding one would be an unrequested
  package for a single internal consumer. `graphology` becomes a
  `@tadori/store` dependency (still Node-only, never bundled into `apps/viz`
  — AD-009 forbids viz importing `@tadori/*`, and `@tadori/store` never
  ships to the browser). Rejected: a new `packages/layout` package —
  rejected as an unrequested abstraction for one internal caller; revisit
  only if a second consumer (e.g. a future CLI layout-recompute command)
  needs the engine without pulling in all of `@tadori/store`.
- **Algorithm: graphology's `forceAtlas2` (via `graphology-layout-forceatlas2`
  — the standard companion package), run for a fixed 200 iterations, with
  nodes pre-seeded on a deterministic circle/grid before the first
  iteration.** Rationale: `forceAtlas2` is graphology's canonical
  force-directed layout (part of the same dependency family already on the
  allowlist), gives stable convergence for a few hundred to low-thousands of
  nodes (package/file counts stay in that range per ARCHITECTURE.md §10
  budgets), and — critically — **it has no internal randomness**; all
  stochastic behavior in force-directed layouts comes from *initial
  position* choice, which this blueprint controls explicitly (below), not
  from the algorithm's iteration step. Rejected: `graphology-layout` random
  or `circular` alone (no relaxation, clusters overlap); a from-scratch
  spring-embedder (reinvents a maintained, allowlisted library).
- **Seed derivation: deterministic from `repo_id` + `layout_version` +
  `abstraction_level`, never `Date.now()`/`Math.random()`.** Concretely:
  `seed = sha256Hex(\`${repoId}:${abstractionLevel}:${viewKey}:${layoutVersion}\`)`
  (reusing `@tadori/core`'s existing `sha256Hex`, no new hashing dependency),
  reduced to a 32-bit unsigned integer via `parseInt(seed.slice(0, 8), 16)`,
  fed into a seeded PRNG (`mulberry32`-style, ~10 lines, no new dependency —
  a named, tested pure function in `layout.ts`) that drives **initial node
  placement only** (a deterministic circular layout ordered by sorted
  `entity_key`, matching AD-005's "fixed RNG seed + fixed iteration count +
  sorted node input => identical output"). Rejected: seeding from
  `snapshot_id` — snapshot ids change on every reindex even when the node
  set is unchanged, which would spuriously invalidate stable positions on
  every refresh; rejected: seeding from repo path string directly — less
  robust to path casing/trailing-slash differences already normalized
  elsewhere via `normalizePath`, and `repo_id` is the canonical row identity
  once a repository is registered.
- **Sorted node input.** Nodes are sorted by `entity_key` (already a stable
  64-char hex string, frozen identity primitive) before being fed to the
  initial-placement PRNG and to `forceAtlas2`. This guarantees iteration
  order — and therefore floating-point accumulation order inside the
  layout algorithm — is identical across runs on the same node set,
  independent of Map/Set iteration order from upstream JS objects (which is
  insertion-order-dependent and must not be trusted as a determinism
  source).
- **Persistence granularity: one row per node per `(repo_id,
  abstraction_level, view_key)`.** `writeLayout` is a single SQLite
  transaction (`db.transaction(...)`, the same pattern
  `insertSnapshotGraph` already uses per EVIDENCE-BASELINE.md §3) that
  upserts (`INSERT ... ON CONFLICT (repo_id, abstraction_level, view_key,
  node_id) DO UPDATE`) every position in the batch atomically — a crash
  mid-write must never leave a fraction of one abstraction level persisted
  while the rest recomputes on next read (which would silently violate
  byte-identical reload for the fraction that did land).
- **Byte-identical reload via store-REAL round-trip, not recomputation.**
  `readLayout` never invokes the engine; it is a pure `SELECT`. The
  guarantee is structural (AD-005): once written, a value is read back
  verbatim. The test plan (§13) asserts this by comparing the exact
  `number` values returned by two `readLayout` calls, not by re-running the
  engine and comparing to a tolerance — recomputing-and-comparing would
  only prove the algorithm is *stable*, not that storage is
  *byte-identical*, which is the actual frozen requirement.
- **New-node placement: package centroid + bounded local relaxation, existing
  rows never move.** For a node absent from `layout_positions` at read/write
  time: (a) resolve its package via the node's `contains`-edge parent chain
  (file `kind==='file'`/symbol nodes trace up to their owning `kind==='package'`
  node via existing `contains` edges — no path-string heuristic); (b)
  compute the centroid as the arithmetic mean of `(x, y)` over all **existing
  persisted** sibling positions in the same package at the same
  `abstraction_level`; (c) if the package itself has no persisted rows yet
  (a brand-new package), fall back to the centroid of the whole level's
  existing positions, or the deterministic circle-seed point if the level is
  empty; (d) apply up to 50 `forceAtlas2` iterations **restricted to the new
  node(s) only** (existing nodes' positions passed in as frozen/pinned inputs
  to the relaxation pass so they act as immovable anchors, then discarded
  from the write set) so the new node settles near its neighbors without
  overlapping them, then persist only the new node's row. Rationale:
  matches ARCHITECTURE.md §6 verbatim ("placed at its package centroid... with
  bounded local relaxation... existing nodes never move") and gives a
  concrete, testable algorithm rather than leaving "bounded" undefined.
  Rejected: re-running full-graph `forceAtlas2` including existing nodes as
  movable — directly violates "existing nodes never move."
- **`layout_version` bump rule.** `layout_version` increments only when the
  *algorithm* changes (different iteration count, different force
  parameters, different seed-derivation formula) — never for ordinary
  snapshot/content changes, which are handled by the new-node-placement path
  instead. A version bump is a deliberate, reviewed constant change in
  `layout.ts` (e.g. `CURRENT_LAYOUT_VERSION = 2`), not automatic or
  content-derived. When bumped, all existing rows for the affected `(repo_id,
  abstraction_level, view_key)` at the *old* version are treated as stale
  (queried and ignored by `readLayout` when the caller requests the current
  version) and the full node set is recomputed once under the new version
  and written — old-version rows are left in place (not deleted; harmless
  orphans scoped by the primary key's `layout_version`-independent columns
  is not an issue since `layout_version` is a plain data column, not part of
  the primary key, so a version bump is actually an **overwrite** of the
  same primary-key rows via upsert, not a parallel row set — clarified:
  `layout_version` is stored per-row as metadata recording which algorithm
  produced that row's coordinates; `readLayout` returns rows plus the
  `layout_version` value found, and the caller (07-01) compares it against
  `CURRENT_LAYOUT_VERSION` to decide whether a full recompute is needed).
  Rejected: a separate version-keyed row per algorithm generation — the
  primary key has no `layout_version` column in it (frozen schema), so this
  is not a mechanism the frozen table supports without a migration, and a
  migration is out of scope (AD-006).
- **`last_snapshot_id` semantics.** Set to the snapshot id active at the
  moment `writeLayout` ran for that node (informational provenance — "these
  coordinates were computed while snapshot N was active" — not a validity
  gate). `readLayout` does not filter on it; node-entity identity, not
  snapshot identity, governs whether a row is reused (matches
  ARCHITECTURE.md §6: "positions keyed by node_id (stable entity) survive").
  On `ON DELETE SET NULL` (the snapshot later pruned), the row remains valid
  and readable; a `NULL` `last_snapshot_id` is not an error state.
- **Failure semantics.** `writeLayout` runs inside one transaction; any
  exception rolls back the whole batch (no partial commits). `readLayout`
  returns `null` when no rows exist for the requested
  `(repo_id, abstraction_level, view_key)` (distinguishing "not yet
  materialized" from "materialized with zero nodes," which returns an empty
  `positions` array with a valid `layoutVersion`).
- **Concurrency.** `writeLayout` opens `BEGIN IMMEDIATE` (matching the
  existing convention in `migrations.ts`/`snapshots.ts` for writer
  transactions) so a concurrent reader never observes a half-written batch;
  SQLite's WAL mode (already configured by `openDatabase`,
  `database.ts:18-27`) keeps readers non-blocking during the write.

## 9. Exact file plan

- `packages/store/src/layout.ts` — **create**. Exports: `LayoutPosition`
  interface, `LayoutLevel` type alias (`"package" | "file" | "symbol"`,
  reusing the same three strings as the migration's CHECK constraint, no new
  enum needed since `abstraction_level` is not a `@tadori/core` frozen enum
  today — it is a table-local CHECK; this blueprint does not add it to
  `@tadori/core` because nothing outside layout consumes it as a typed
  value yet), `readLayout`, `writeLayout`, `computeLayout` (the pure
  engine), `CURRENT_LAYOUT_VERSION` constant, `deriveLayoutSeed` (exported
  for the test file, not for external consumers).
- `packages/store/src/index.ts` — **modify** (additive):
  `export * from "./layout.js";` appended to the existing six re-exports.
- `packages/store/package.json` — **modify**: add `graphology` and
  `graphology-layout-forceatlas2` as dependencies (justification: §8 above;
  both are on the frozen allowlist's `graphology` family, `forceatlas2` is
  graphology's own companion package for exactly this algorithm, not a
  third-party alternative).
- `packages/store/test/layout.test.ts` — **create**. Full test matrix, §13.
- `pnpm-workspace.yaml`, root `tsconfig.json` — **no change** (this
  blueprint adds files inside the existing `packages/store` member, not a
  new workspace package).
- `IMPLEMENTATION_STATUS.md` — **modify**: add a dated entry recording the
  new additive store export (mirrors how 00-01A's plan records its own
  additive export).

## 10. Exact contracts

```ts
// packages/store/src/layout.ts

/** The three frozen semantic-zoom levels (migration004 CHECK constraint values). */
export type LayoutLevel = "package" | "file" | "symbol";

export interface LayoutPosition {
  entityKey: string;   // hex64, resolved from node_entities.entity_key
  x: number;
  y: number;
  z: number;            // always 0 for the 2D default in this blueprint
  pinned: boolean;
  anchorGroup: string | null;
}

export interface LayoutReadResult {
  positions: LayoutPosition[];
  layoutVersion: number;
}

/** Current algorithm version. Bump only per the §8 rule; never automatic. */
export const CURRENT_LAYOUT_VERSION = 1;

/**
 * Read-only. Returns null if no rows exist yet for this (repo, level, view).
 * Never recomputes; never blocks on the engine.
 */
export function readLayout(
  db: Database,
  repoId: number,
  level: LayoutLevel,
  viewKey: string
): LayoutReadResult | null;

/**
 * Upserts the given positions transactionally. `snapshotId` is stored as
 * informational provenance (last_snapshot_id), not a validity gate.
 * Throws on any row failure; no partial commit.
 */
export function writeLayout(
  db: Database,
  repoId: number,
  level: LayoutLevel,
  viewKey: string,
  snapshotId: number,
  layoutVersion: number,
  positions: LayoutPosition[]
): void;

/** Input to the pure layout engine — no DB, no side effects. */
export interface LayoutEngineNode {
  entityKey: string;
  /** Existing frozen position, if this node already has one; anchors it as immovable during relaxation. */
  frozen: { x: number; y: number } | null;
}
export interface LayoutEngineEdge {
  srcEntityKey: string;
  dstEntityKey: string;
}
export interface ComputeLayoutOptions {
  repoId: number;
  level: LayoutLevel;
  viewKey: string;
  layoutVersion: number;
  iterations: number; // 200 for full-graph, 50 for new-node relaxation
}

/**
 * Pure function: sorted-input, seeded, deterministic. No randomness source
 * other than the seed derived from (repoId, level, viewKey, layoutVersion).
 * Nodes with `frozen` set are used as fixed anchors and are NOT present in
 * the returned map (callers must not re-persist them).
 */
export function computeLayout(
  nodes: LayoutEngineNode[],
  edges: LayoutEngineEdge[],
  options: ComputeLayoutOptions
): Map<string, { x: number; y: number }>;

/** Exported for the test file only; not part of the stable public contract. */
export function deriveLayoutSeed(
  repoId: number,
  level: LayoutLevel,
  viewKey: string,
  layoutVersion: number
): number;
```

Error/edge behavior: `writeLayout` with an `entityKey` that has no matching
`node_entities` row for `repoId` throws `Error("unknown entity key: <key>")`
— this is a caller bug (07-01 must resolve entity keys from the same
`GraphService` that produced the node list), not a recoverable runtime
state. `readLayout` for an unknown `repoId` (no repository row) returns
`null` (same "not yet materialized" contract, not an error — the repository
may simply never have been laid out).

## 11. Ordered implementation procedure

1. `packages/store/package.json`: add `graphology`,
   `graphology-layout-forceatlas2` dependencies; `pnpm install`. Reason:
   engine implementation needs the library present before any code compiles.
   Expected: `pnpm install` succeeds, lockfile updates.
2. `packages/store/test/layout.test.ts`: write failing tests for
   `deriveLayoutSeed` determinism (same inputs -> same output across two
   calls; different `layoutVersion` -> different output) and
   `computeLayout` determinism (same node/edge list, same options, called
   twice -> byte-identical `Map` values). Reason: lock down the seed/engine
   contract before the write path exists. Expected: fails (module doesn't
   exist yet).
3. `packages/store/src/layout.ts`: implement `deriveLayoutSeed` (sha256 of
   the composite key, reduced to uint32) and the `mulberry32`-style seeded
   PRNG helper (private, not exported). Expected: seed tests from step 2
   pass.
4. Implement `computeLayout`: sort input nodes by `entityKey`; place
   `frozen`-less nodes on a deterministic seeded circle as
   `forceAtlas2` initial positions (frozen nodes contribute their existing
   `x/y` as fixed graphology node attributes); run `forceAtlas2` for
   `options.iterations` with graphology's `settings: { adjustSizes: false,
   barnesHutOptimize: nodes.length > 200 }` (documented, fixed settings, not
   tunable per-call — determinism requires fixed parameters); return only
   the non-frozen nodes' final positions. Expected: determinism tests from
   step 2 (`computeLayout` half) pass.
5. `packages/store/test/layout.test.ts`: add failing tests for
   `writeLayout`/`readLayout` round-trip (write positions, read back,
   assert exact `x/y/z/pinned/anchorGroup` equality — including a
   non-integer float value to catch any accidental string coercion),
   `readLayout` returning `null` for an unmaterialized level, unknown-entity
   `writeLayout` throwing, and a byte-identical-reload test that calls
   `readLayout` twice after one `writeLayout` and asserts `Object.is`-level
   equality on every `x`/`y` value (not `toBeCloseTo`). Expected: fails
   (functions don't exist).
6. `packages/store/src/layout.ts`: implement `readLayout`/`writeLayout`
   against `layout_positions`, resolving `entity_key <-> node_id` via
   `node_entities` (same join pattern as `GraphService.nodeEntityId`,
   `service.ts:307-317`); `writeLayout` wraps the upsert loop in
   `db.transaction(...)`. Expected: round-trip and byte-identical tests from
   step 5 pass.
7. Add the new-node package-centroid placement test (§13 item) and
   implement it as a helper (`placeNewNode`) inside `layout.ts`, called by
   `writeLayout`'s caller contract documented in §10 (07-01 calls
   `readLayout`, diffs against the current node set, calls `computeLayout`
   only for the delta with `frozen` populated for all existing nodes, then
   `writeLayout` for the delta only — this blueprint provides and tests that
   exact call sequence as an integration test against a real `better-sqlite3`
   DB, since 07-01 is not yet built to call it end-to-end itself).
   Expected: existing-node positions in the test DB are bit-identical before
   and after a simulated "new node arrives" scenario.
8. `packages/store/src/index.ts`: append the barrel export. Typecheck.
9. `IMPLEMENTATION_STATUS.md`: add the dated entry. Run full validation gate
   (§15). Commit:
   `feat(store): add deterministic layout engine + layout_positions writer`.

## 12. Data and lifecycle flows

**First materialization** (triggered by 07-01, tested here as a direct call
sequence): `readLayout` returns `null` -> caller builds the full node/edge
list for the level from the active snapshot -> `computeLayout` with no
`frozen` nodes and `iterations=200` -> `writeLayout` persists every position
with the active `snapshotId` and `CURRENT_LAYOUT_VERSION`.

**Subsequent reload (byte-identical path):** `readLayout` returns the full
row set; no engine call; `x/y/z` are the exact stored `REAL` values.

**Snapshot replacement, same node set:** new snapshot activated -> node
entities unchanged (same `entity_key`s, same `node_entities` rows) ->
`readLayout` still returns the same rows -> byte-identical, no write
triggered.

**Snapshot replacement, new node added:** `readLayout` returns existing rows
for old nodes; caller detects the new node has no row -> resolves its
package via `contains` edges -> `computeLayout` called with existing
neighbors as `frozen` anchors and only the new node as free, `iterations=50`
-> `writeLayout` persists only the new node's row; all prior rows untouched
in the transaction (not included in the write batch at all).

**`layout_version` bump:** operator changes `CURRENT_LAYOUT_VERSION` in code
-> caller's `readLayout` result reports the old `layoutVersion` -> caller
recomputes the **full** node set with `iterations=200` under the new version
-> `writeLayout` overwrites every row for that `(repo, level, view)` via
upsert.

**Failure mid-write:** transaction throws (e.g. unknown entity key) ->
SQLite rolls back the entire batch -> `readLayout` still reflects the last
successfully committed state (no partial corruption).

## 13. Test plan

`packages/store/test/layout.test.ts` (unit + integration against a real
temp `better-sqlite3` DB, matching the existing store test convention):

- Seed determinism: `deriveLayoutSeed` same inputs twice -> identical
  `number`; changing any one of `repoId`/`level`/`viewKey`/`layoutVersion`
  -> different `number` (at least for a spot-checked set of variations).
- Engine determinism: `computeLayout` called twice with identical
  node/edge/options input -> `Map` values `Object.is`-equal per entry (both
  `x` and `y`).
- Engine anchor invariant: a node passed with `frozen` set never appears in
  `computeLayout`'s returned map.
- Round-trip: `writeLayout` then `readLayout` returns the exact
  `x/y/z/pinned/anchorGroup` values passed in, including a value with many
  decimal digits (e.g. `1.23456789012345`) to catch float-precision loss.
- Byte-identical reload: one `writeLayout`, then two separate `readLayout`
  calls -> every `x`/`y` value `Object.is`-equal across the two reads.
- Not-yet-materialized: `readLayout` on a level with zero rows returns
  `null`.
- Materialized-but-empty: `writeLayout([])` then `readLayout` returns
  `{ positions: [], layoutVersion }` (not `null`) — this asserts the
  null/empty distinction from §8.
- Unknown entity key: `writeLayout` with an `entityKey` absent from
  `node_entities` for that `repoId` throws.
- New-node placement: seed a DB with 3 package-level nodes and persisted
  positions; call the centroid-placement helper for a 4th new package node;
  assert (a) the 3 existing rows' `x/y` are `Object.is`-unchanged after the
  operation, (b) the new node's position lies within a bounded distance of
  the centroid of its package siblings (numeric bound, not exact value,
  since relaxation is expected to perturb it slightly).
- `layout_version` bump: write under version 1; bump `CURRENT_LAYOUT_VERSION`
  equivalent in the test (pass an explicit higher version to `writeLayout`
  directly, simulating the bump); assert `readLayout` returns the new
  version's positions and the old version's row is superseded (via upsert on
  the same primary key — the row's `layout_version` column now reads the new
  value; no duplicate row exists per the primary key on `(repo_id,
  abstraction_level, view_key, node_id)`).
- Migration untouched: `packages/store/test/migrations.test.ts` (existing,
  unmodified) must still pass — confirms this blueprint added no migration.
- Full existing suite (170+ tests) stays green; 5/5 fixtures unaffected
  (layout is not part of the fixture contract — fixtures carry no
  `layout_positions` expectations).

## 14. Acceptance criteria

- [ ] `packages/store/src/layout.ts` exists and is exported from
      `packages/store/src/index.ts`.
- [ ] No migration file added or modified; `packages/store/test/
      migrations.test.ts` passes unmodified (`pnpm test -- migrations`).
- [ ] `pnpm test -- layout` passes with every test in §13 present and green.
- [ ] Byte-identical-reload test asserts `Object.is` equality (not
      approximate comparison) on stored `x`/`y` values across two reads.
- [ ] New-node-placement test asserts existing rows are bit-identical before
      and after a new node is added.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` all exit 0 with the full
      existing suite intact (170+ tests, count grows only by this
      blueprint's additions).
- [ ] `python validate_fixtures.py`, `pnpm fixtures:validate`, `pnpm
      fixtures:index`, `pnpm fixtures:typecheck` all still pass (fixtures
      untouched by this blueprint).
- [ ] `packages/store/package.json` lists exactly two new dependencies
      (`graphology`, `graphology-layout-forceatlas2`); no other new runtime
      dependency added anywhere in the repo by this blueprint.
- [ ] `IMPLEMENTATION_STATUS.md` records the new additive export with a
      commit SHA.

## 15. Validation commands

pnpm install; pnpm skills:check; pnpm typecheck; pnpm lint; pnpm test;
python validate_fixtures.py; pnpm fixtures:validate; pnpm fixtures:index;
pnpm fixtures:typecheck; pnpm benchmark:incremental; git diff --check;
git status --short

## 16. Performance budgets

- Full-graph layout compute (`computeLayout`, 200 iterations) on a
  package-level graph of up to 500 nodes (ARCHITECTURE.md §10 per-level
  cap) must complete in **< 2 s** on the existing 250k-LOC benchmark corpus
  machine (same machine class as `pnpm benchmark:incremental`'s documented
  environment). Measured by a named script,
  `scripts/benchmark-layout.mts` (proposed, mirrors
  `scripts/benchmark-incremental.mts`'s structure): generates a synthetic
  package-level node/edge set at the 500-node cap, times `computeLayout`,
  throws if `>= 2000`.
- New-node bounded relaxation (50 iterations, single new node, existing
  neighbors as frozen anchors) must complete in **< 50 ms** — this is the
  operation 07-01 will call synchronously inside a request handler on
  first-serve of a snapshot with new nodes, so it must not itself become a
  latency source; asserted in the same benchmark script as a second gate.
- `writeLayout` transaction for a 500-row batch must complete in **< 100
  ms** (single SQLite transaction, matches the write-latency class already
  demonstrated by `insertSnapshotGraph` in existing benchmarks).

## 17. Failure and recovery behavior

- Malformed/missing `node_entities` row for a requested `entityKey`:
  `writeLayout` throws before any row in the batch is committed (whole
  transaction rolls back); caller (07-01) surfaces this as a 500 with
  `layout_engine_error`, never a partial layout.
- Interrupted write (process crash mid-transaction): SQLite's WAL +
  transaction semantics guarantee the DB reflects either the pre-write or
  fully-post-write state on next open — no separate recovery code needed
  here (relies on `better-sqlite3`/SQLite's existing guarantees, already
  exercised by `insertSnapshotGraph`'s equivalent transactional pattern).
- Corrupt/inconsistent `layout_positions` row (e.g. a `node_id` whose
  `node_entities` row was later deleted): the `ON DELETE CASCADE` on
  `node_id` (migration004) means the position row is deleted automatically
  when its node entity is deleted — this cannot occur as an orphan; no
  additional handling required.
- Engine given zero nodes: `computeLayout([], [], options)` returns an empty
  `Map` (no error) — an empty package/file/symbol level is a valid, if
  unusual, real state (e.g. a package with only external-dependency
  members).

## 18. Security and privacy

No new I/O surface — this blueprint only reads/writes the existing local
SQLite file through the existing `better-sqlite3` handle; no network, no new
file-system paths, no user-supplied strings interpolated into SQL (all
queries use parameterized statements, matching existing store-module
convention). No sensitive content is introduced (coordinates are not
source code or evidence).

## 19. Accessibility

Not applicable — this blueprint has no human-facing surface (owns no UI per
§1 header and BACKLOG.md scope). The eventual UI accessibility contract for
rendered node positions is owned by 08-11.

## 20. Documentation updates

`IMPLEMENTATION_STATUS.md` — add a dated entry for the new additive
`@tadori/store` layout export (mirrors the existing per-milestone entry
style). No other existing documentation file requires modification; this
blueprint does not touch README.md, ARCHITECTURE.md, ASSUMPTIONS.md,
BACKLOG.md, or INDEX.md (status/index bookkeeping for those files is
maintained by the planning process, not this builder blueprint's file plan).

## 21. Builder final report

Require: summary; files changed; new store exports (names + signatures);
tests added (names + count, called out separately: seed/engine determinism,
round-trip, byte-identical reload, new-node placement, version bump);
validation command output summary; benchmark script results (compute time
at 500-node cap, new-node relaxation time, write-transaction time) with
pass/fail against §16; commit SHA; known limitations; `ASSUMPTION:` lines
for any point where §8's algorithm choice needed a concrete default not
otherwise pinned (e.g. exact `forceAtlas2` tuning constants beyond
`adjustSizes`/`barnesHutOptimize`).

## 22. Independent review result

Pending Wave 2 adversarial review.

## IF SOMETHING IS UNCLEAR

Make the smallest safe assumption, record `ASSUMPTION: ...` in the report,
continue without expanding scope. If package assignment for a node cannot be
derived from an existing `contains` edge (e.g. an `external_dep` node with
no package parent), fall back to the whole-level centroid (§8 item (c)) and
record it as an `ASSUMPTION`, do not invent a new relation or schema change.
If any change would require touching `layout_positions`' schema, stop — that
is a frozen-migration violation (AD-006), not an implementation detail.

## TADORI NON-NEGOTIABLES

Frozen v2.1; TS/JS only; ATLAS separate; exactly six MCP tools; stable 2D
default; 2.5D optional; 3D experimental only; no city metaphor; no default
hairball; no generic admin dashboard or permanent dual sidebars; progressive
disclosure package → file → task-region symbols; deterministic positions;
every visible relation keeps evidence, origin, confidence, resolution;
unresolved stays visibly unresolved; static test linkage is not runtime
coverage; agent observation honesty; design rationale only from
ADRs/docs/instructions/explicit human input; hooks remain an evidence
receiver, never an orchestrator/runtime; invalid snapshots never served;
`tadori serve .` is the normal command; localhost default; no cloud
dependency; Graphify is ignored reference only — never import/copy/ship;
never weaken golden fixtures; no seventh tool; no runtime tracing.
