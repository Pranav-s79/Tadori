---
graph_blueprint_version: 1
node_id: 08-01
state: built
phase: 8
risk: high
complexity: M
predecessors: [07-01, 07-02, 07-03]
successors: [08-02]
execution_card: blueprints/execution/08-01.md
dossier: blueprints/08-01-layout-engine-persistence.md
read_policy: execution-card-first
local_full_gate_budget: 1
independent_validation_budget: 1
architecture_review: required-on-contract-delta
---

> **GRAPH EXECUTION MODE:** Read the execution card first. This long file is an evidence dossier, not mandatory context. Open only the sections linked by the card. Planning-time existence claims and line numbers are historical hints; live repository semantics win. Use one full local gate and one independent validation pass.

# BLUEPRINT 08-01: Layout engine + persistence

## 1. Header

- ID / Title / Phase: 08-01 — Layout engine + persistence — Phase 8
- Status: review/corrected pending implementation
- Primary builder: OpenAI `gpt-5.6-sol` (high reasoning) — deterministic
  graph algorithm, store transaction boundary, and one server route.
- Reviewer roles: Spec Guardian (frozen migration and snapshot boundary),
  Test Adversary (determinism, replacement, concurrency, and empty-state
  matrix), Implementation Reviewer (store/server seam).
- Complexity: M/L. The engine is bounded, but correctness crosses graph
  aggregation, stable persistence, and a request-time materialization seam.
- Depends on: 07-01 (server graph API and the existing `/api/v1/layout` 404
  stub), 07-02/07-03 (serve lifecycle and coherent `GraphService` snapshot).
- Unlocks: 08-02 (package map), 08-03/08-04 (file and symbol semantic zoom),
  08-10 (layout performance gates).
- Related frozen sources: `docs/Specs/Tadori-v2.1-Corrections.md` §6 and
  migration 004; `docs/Specs/GOLDEN_FIXTURE_SPEC.md`; `blueprints/ARCHITECTURE.md`
  AD-005/AD-006; `blueprints/ASSUMPTIONS.md` A-102.

## 2. Objective

Implement one deterministic, server-side layout path for the current
extracted snapshot:

1. construct the package/file/symbol topology from stored graph membership;
2. read reusable positions from frozen migration-004 `layout_positions`;
3. compute and transactionally persist a complete first/version-replacement
   layout, or append only new nodes while all existing coordinates are fixed;
4. return positions in stable entity-key order from `GET /api/v1/layout`.

`apps/viz` only consumes coordinates. It never imports graphology, the store,
or a second layout implementation.

## 3. Why this matters

- Stable coordinates preserve spatial memory across reloads and ordinary
  reindexing.
- A single exported orchestration function prevents the server route and
  future callers from independently reimplementing version and membership
  rules.
- Snapshot-aware reads prevent positions for stable entities that are absent
  from the selected snapshot from leaking into its response.
- Explicit full replacement and append-missing transactions make failure and
  concurrency behavior reviewable.

## 4. Verified repository evidence (2026-07-18)

- Frozen migration 004 already defines `layout_positions(repo_id,
  abstraction_level, view_key, node_id, x, y, z, pinned, anchor_group,
  layout_version, last_snapshot_id, updated_at)`. Its primary key is
  `(repo_id, abstraction_level, view_key, node_id)`; `layout_version` is not
  part of the key. No migration is required or permitted.
- `node_entities` are stable per repository, while `snapshot_nodes` carries
  current membership. Layout reads therefore must join both tables.
- `last_snapshot_id` is provenance and is `ON DELETE SET NULL`; it is not the
  reuse key. Writes must nevertheless verify that the supplied snapshot is
  active and belongs to the supplied repository.
- `GraphService.graph` is a `StoredSnapshotGraph` with `snapshot`, `files`,
  `nodes`, and `edges`. `GraphFile.packageName` is stored snapshot data.
- `GraphNode` has no `packageName`. Ownership must be obtained by mapping
  `GraphNode.file` to the matching stored `GraphFile.normalizedPath`, then
  mapping `GraphFile.packageName` to the unique package node whose
  `qualifiedName` matches it. Do not infer ownership from path prefixes.
- `packages/server/src/routes/layout.ts` is the existing route seam. Before
  08-01 it only reads rows/returns `404 layout_not_materialized`; 08-01 owns
  replacing that stub with materialization and route tests.
- The frozen table cannot persist a marker saying “this level was
  materialized and has zero nodes.” Consequently, a zero-row `readLayout`
  remains `null`; `ensureLayout` recognizes an empty current topology and
  returns an in-memory empty result, and the HTTP route returns 200.

Files the builder reads first:

- `packages/store/src/migrations.ts` migration 004;
- `packages/store/src/snapshots.ts` (`StoredSnapshotGraph`, snapshot reads,
  membership validation, transaction conventions);
- `packages/store/src/database.ts`;
- `packages/core/src/graph.ts` and `packages/core/src/enums.ts`;
- `packages/server/src/routes/layout.ts`, `packages/server/src/graphState.ts`,
  and `packages/server/test/layout.test.ts`.

## 5. Scope and ownership

08-01 owns all of the following as one terminal changeset:

1. the pure seeded engine in `packages/store/src/layout.ts`;
2. snapshot-aware `readLayout` and explicit-mode `writeLayout`;
3. topology construction and exported `ensureLayout` orchestration;
4. the existing `packages/server` layout route's compute-on-first-read
   trigger and its tests;
5. a repeatable layout benchmark and its root/CI command;
6. dependency lock and implementation-status bookkeeping.

This ownership corrects the earlier circular plan in which 07-01 was said to
own trigger wiring even though 07-01 intentionally shipped only a 404 stub.

## 6. Non-goals and hard boundaries

- No migration additions or edits. Frozen migrations and schemas are
  untouched.
- No `GraphState` or `GraphService` modifications. The route captures one
  `app.graphState.current()` value and passes its coherent graph to
  `ensureLayout`.
- No indexer, fixture, MCP-tool, or golden-graph change.
- No UI, Sigma, React, browser-side layout, 2.5D, or 3D. Persisted `z` is 0.
- No package ownership heuristic based on paths and no invented relation.
- No human pinning endpoint. Existing `pinned` values are preserved and
  honored; interaction arrives later.
- Only `viewKey=base` is served in this milestone. Other values return the
  existing API error shape with `400 bad_view_key`.
- Exactly six MCP tools remain unchanged.

## 7. Pinned dependencies

Add exactly these store runtime dependencies with exact versions:

```json
"graphology": "0.26.0",
"graphology-layout-forceatlas2": "0.10.1"
```

Update `pnpm-lock.yaml`. Do not use caret/tilde ranges. These exact versions
are part of the determinism surface and must only change with a reviewed
`CURRENT_LAYOUT_VERSION` decision and new determinism evidence.

The engine uses Graphology's `MultiUndirectedGraph` because multiple semantic
edges can constrain the same representative pair. Direction is irrelevant to
force calculation, but each accepted constraint keeps the source edge's
stable `entityKey` and `relation`. Self constraints created by aggregation or
real self-relations are ignored. No semantic edge is relabeled or exposed as
an undirected compiler fact; this is an internal geometric projection only.

## 8. Exact exported contracts

```ts
// packages/store/src/layout.ts

export type LayoutLevel = "package" | "file" | "symbol";
export type LayoutWriteMode = "replace" | "append_missing";

export class LayoutIntegrityError extends Error {}

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface LayoutPosition {
  entityKey: string;
  x: number;
  y: number;
  z: number; // exactly 0 in 08-01
  pinned: boolean;
  anchorGroup: string | null;
}

export interface LayoutReadResult {
  positions: LayoutPosition[]; // sorted by entityKey
  layoutVersion: number;
}

export interface LayoutEngineNode {
  entityKey: string;
  /** Optional deterministic starting coordinate for a movable node. */
  initialPosition: LayoutPoint | null;
  /** Optional immovable coordinate. Mutually exclusive with initialPosition. */
  fixedPosition: LayoutPoint | null;
}

export interface LayoutEngineEdge {
  entityKey: string; // stable GraphEdge key; unique in this engine input
  relation: Relation;
  srcEntityKey: string;
  dstEntityKey: string;
}

export interface ComputeLayoutOptions {
  repoId: number;
  level: LayoutLevel;
  viewKey: string;
  layoutVersion: number;
  iterations: number;
}

export const CURRENT_LAYOUT_VERSION = 1;

export function computeLayout(
  nodes: readonly LayoutEngineNode[],
  edges: readonly LayoutEngineEdge[],
  options: ComputeLayoutOptions
): Map<string, LayoutPoint>; // movable nodes only, entityKey insertion order

export function readLayout(
  db: Database,
  repoId: number,
  snapshotId: number,
  level: LayoutLevel,
  viewKey: string
): LayoutReadResult | null;

export function writeLayout(
  db: Database,
  repoId: number,
  snapshotId: number,
  level: LayoutLevel,
  viewKey: string,
  layoutVersion: number,
  positions: readonly LayoutPosition[],
  mode: LayoutWriteMode
): void;

export function ensureLayout(
  db: Database,
  graph: StoredSnapshotGraph,
  level: LayoutLevel,
  viewKey?: string
): LayoutReadResult;
```

`deriveLayoutSeed` may be exported for direct determinism testing. No other
orchestration helper is public.

Runtime validation is mandatory even where TypeScript has a union:

- `repoId`, `snapshotId`, `layoutVersion`, and iteration counts are safe
  integers in their documented ranges;
- `level` is exactly package/file/symbol;
- `viewKey` is non-empty (and the HTTP route additionally restricts it to
  `base`);
- entity and edge keys are unique lowercase hex64 values;
- all coordinates are finite and `z` is 0;
- a node cannot have both `initialPosition` and `fixedPosition`;
- every engine edge endpoint exists in the engine node set.

Persisted mixed versions, corrupt coordinates/pin state, ambiguous topology
lookups, ignored inserts, and incomplete post-write slices throw the exported
`LayoutIntegrityError` rather than being returned as a partial layout.

## 9. Topology construction contract

`ensureLayout` receives the exact captured `StoredSnapshotGraph` and first
verifies that its snapshot is active, belongs to `snapshot.repo_id`, has zero
foreign-key violations and zero dangling endpoint memberships, and its sorted
node/edge keys equal the corresponding stored memberships. It never combines
a graph from one snapshot with metadata from another or materializes an
invalid snapshot.

Construct deterministic lookup tables, rejecting duplicate/ambiguous keys:

- package name -> package node (`kind=package`, key by `qualifiedName`);
- normalized path -> stored `GraphFile`;
- normalized path -> file node (`kind=file`, key by `node.file`);
- graph node key -> owning package key via
  `node.file -> GraphFile.packageName -> package node`.

Representatives by level are exact:

| Level | Returned position nodes | Endpoint representative for topology edges |
|---|---|---|
| package | package nodes | owning package node; endpoints without stored package ownership are omitted |
| file | file nodes | owning file node from `GraphNode.file`; endpoints without a file are omitted |
| symbol | nodes whose kind is neither package nor file | the node itself; package/file endpoints are omitted |

Selected nodes are sorted by `entityKey`. Graph edges are sorted by their
stable `entityKey` before projection. Each projected non-self edge becomes a
`LayoutEngineEdge` with the original stable key and relation. Parallel edges
remain parallel in `MultiUndirectedGraph`; projected self constraints are
ignored. Output positions and SQL reads are always sorted by `entityKey`.

Package-centroid placement uses the ownership table above. If a new node has
no mapped package or no persisted peers in that package, use the whole
level's persisted centroid. If the level has no persisted position, use its
deterministic seeded initial point. Do not infer package ownership from path
prefixes or `contains` edges.

## 10. Engine contract

- Seed: SHA-256 of `repoId:level:viewKey:layoutVersion`, first 32 bits, used
  only for deterministic initial placement. Never use `Date.now`, wall
  clock, unseeded `Math.random`, snapshot id, iteration timing, or object
  insertion order.
- Append-missing uses one PRNG from that same seed while iterating the sorted
  missing-node list; it does not derive synthetic per-entity view keys.
- Inputs are defensively sorted: nodes by `entityKey`, edges by
  `(entityKey, relation, srcEntityKey, dstEntityKey)`.
- Nodes without either supplied position receive deterministic seeded circle
  positions in sorted order.
- Use fixed, code-owned ForceAtlas2 settings and fixed iteration counts: 200
  for full layout and 50 for append-missing relaxation. Any setting or count
  change requires a layout-version bump.
- `fixedPosition` is implemented with Graphology's `fixed` node attribute.
  Under pinned `graphology-layout-forceatlas2@0.10.1`, fixed nodes remain in
  the node/edge matrices and contribute mass, repulsion, and attraction, but
  the apply-forces step does not update their coordinates. This is a
  version-specific implementation reliance and must be locked by a test; it
  is not accepted merely because the dependency documentation says “fixed.”
- Fixed nodes do not appear in the returned map. Movable nodes appear in
  sorted entity-key insertion order.
- Fixed anchors still participate in force calculations. Do not remove them
  from the graph before the 50-iteration local pass.
- Engine input is not mutated. Zero nodes returns an empty map. Self edges
  are ignored. A non-self dangling edge is an error.
- Force output is clamped to `APPEND_RELAXATION_RADIUS = 25` layout units
  around each new node's chosen centroid during append-missing. This constant
  is owned by layout version 1; changing it requires a
  `CURRENT_LAYOUT_VERSION` bump.

## 11. Read and write semantics

### `readLayout`

1. Validate the repository/snapshot pair and require snapshot status
   `active`.
2. Join `layout_positions -> node_entities -> snapshot_nodes` for the exact
   `snapshotId`; do not return stable entities absent from that snapshot.
3. Restrict returned rows to the representative node kinds for the requested
   level and order by `node_entities.entity_key`.
4. Return `null` when the query returns zero rows. This includes a genuinely
   empty level; the schema has no durable empty-materialization marker.
5. If returned rows contain multiple `layout_version` values, throw a typed
   integrity error. `ensureLayout` inspects the raw slice before public read
   and repairs this state through a full `replace`.

### `writeLayout`

Both modes use `db.transaction(...).immediate()` and validate all entity keys
against `(repoId, snapshotId)` membership before deleting or inserting. An
error rolls back the whole operation.

- `replace`: delete rows for the exact current snapshot membership within
  `(repoId, level, viewKey)`, then insert the complete current representative
  set with one layout version. Rows for stable entities absent from the
  current snapshot remain untouched so their positions and pins survive a
  temporary disappearance.
  This is used for first materialization, mixed/stale versions, unexpected
  extra rows, and any incomplete state that is unsafe to append.
- `append_missing`: insert only currently absent member keys with a plain
  `INSERT`; a conflict throws and rolls back instead of silently accepting a
  race. It never updates coordinates, pins, anchor
  groups, versions, or provenance of existing rows. It is used only after
  `ensureLayout` proves all existing current rows have
  `CURRENT_LAYOUT_VERSION` and the row keys are a strict subset of the
  expected topology.

`last_snapshot_id` is set on inserted/replaced rows. Existing append-mode
rows keep their prior provenance because they are intentionally untouched.
After either write, `ensureLayout` rereads and verifies exact key coverage,
one current version, stable order, and finite values. A concurrent append
conflict fails explicitly; there is no hidden overwrite or retry loop.

## 12. Orchestration and lifecycle flows

### Empty topology

If the selected current topology has zero representatives, `ensureLayout`
does not write or delete rows and returns
`{ positions: [], layoutVersion: CURRENT_LAYOUT_VERSION }` directly in
memory. The route returns HTTP 200. A later direct `readLayout` still returns
`null`; no impossible persistent empty/non-materialized distinction is
claimed.

### First materialization or unsafe slice

If no reusable rows exist, versions are mixed/stale, or keys contain an
unexpected/invalid subset, compute the full sorted topology. Persist the full
result with `replace`. Existing persisted `pinned=true` members, when
available, are passed as fixed anchors and written back unchanged under the
current version; all other nodes are recomputed.

### Byte-identical reload

If stored keys exactly equal expected representative keys and every row has
`CURRENT_LAYOUT_VERSION`, return the ordered stored values without invoking
the engine or any write path. SQLite `REAL` values are not serialized through
text.

### Snapshot replacement with new nodes

Reuse rows whose stable entities are current members. New representatives
start at their stored package centroid (or documented fallback). Every
existing position is supplied as `fixedPosition`, so it still exerts force
but never moves. Run 50 iterations, bound the new-node displacement, and
write only new positions with `append_missing`.

### Layout-version change or mixed versions

The primary key cannot retain parallel versions. Any version other than one
uniform `CURRENT_LAYOUT_VERSION` requires one full `replace` of the current
topology. A version bump is a reviewed source constant change tied to engine
settings/algorithm behavior, never a snapshot/content counter.

## 13. Server route contract

Modify the existing `GET /api/v1/layout` route only:

1. default `level=package`, `viewKey=base`;
2. reject unknown levels with `400 bad_level` before touching the engine;
3. reject non-base/empty view keys with `400 bad_view_key`;
4. capture `const service = app.graphState.current()` once;
5. call `ensureLayout(app.graphState.currentDb(), service.graph, level,
   viewKey)`; do not reopen or rotate `GraphService`;
6. return the frozen DTO `{ positions: {entityKey,x,y,z,pinned}[],
   layoutVersion }` in stable entity-key order;
7. return 200 with an empty array for a vacuously empty level;
8. map validation/engine/store failures to `500 layout_engine_error` without
   source, SQL, path, or stack disclosure.

After 08-01, `404 layout_not_materialized` is no longer a normal route
outcome because the route owns materialization. It remains historical 07-01
behavior, not this milestone's acceptance state.

## 14. Exact file plan

- `packages/store/src/layout.ts` — create engine, reader, writer, topology,
  and exported orchestration.
- `packages/store/src/index.ts` — additive layout barrel export.
- `packages/store/package.json` — exact dependency pins.
- `packages/store/test/layout.test.ts` — create unit/store/orchestration
  matrix.
- `packages/server/src/routes/layout.ts` — replace 404 stub with validated
  `ensureLayout` trigger.
- `packages/server/test/layout.test.ts` — expand route integration coverage.
- `scripts/benchmark-layout.mts` — create deterministic full, append, read,
  and 500-row write benchmark.
- `package.json` — add `benchmark:layout`.
- `pnpm-lock.yaml` — lock exact graphology packages/transitives.
- `.github/workflows/ci.yml` — run `pnpm benchmark:layout` as a named gate on
  both supported CI operating systems.
- `IMPLEMENTATION_STATUS.md`, `BACKLOG.md`, `blueprints/INDEX.md`, and
  `blueprints/AUTONOMOUS_RUN_CHECKPOINT.md` — update only after implementation
  and validation evidence exists.

Explicitly unchanged: `packages/server/src/graphState.ts`,
`packages/mcp/src/service.ts`, every migration, every schema, and every
golden fixture.

## 15. Ordered implementation procedure

1. Add exact dependency pins, install, and inspect the installed 0.10.1 fixed
   node path used by the test.
2. Write failing engine tests for input validation, sorting, deterministic
   output, parallel edges, ignored self constraints, and fixed-anchor force
   participation.
3. Implement the pure engine and pass those tests.
4. Write failing store tests for snapshot-aware ordered reads, both immediate
   write modes, rollback, stale membership, and mixed versions.
5. Implement reader/writer without altering migrations.
6. Write failing topology/orchestration tests for all three levels, stored
   package ownership, empty topology, first/full/append flows, pins, and
   concurrency recovery.
7. Implement `ensureLayout`, keeping topology helpers private.
8. Replace the route stub and expand route integration tests.
9. Add and run the named benchmark; record actual values and environment.
10. Run the full Tadori validation skill, inspect the complete diff, then
    update status documents. Status remains review/corrected pending
    implementation until every required check is green.

## 16. Adversarial test matrix

### Engine

- identical input twice produces `Object.is`-equal coordinates and identical
  map order;
- shuffled node and edge inputs produce the same result;
- changing repo/level/view/version seed inputs changes a sampled seed;
- duplicate node/edge keys, non-finite coordinates, mutually supplied
  initial/fixed positions, and dangling endpoints throw;
- two different semantic edges between the same endpoints coexist in
  `MultiUndirectedGraph`; their relation/key metadata is retained internally;
- original and aggregation-created self edges do not crash or affect output;
- fixed coordinates are bit-identical after a run and fixed nodes are absent
  from the returned map;
- a connected fixed anchor changes a free node's computed result compared
  with the same free node without that anchor, proving the anchor remained in
  force calculations;
- zero nodes returns an empty map.

### Store and orchestration

- exact float/pin/anchor round trip and two byte-identical reloads;
- reads are sorted and exclude entities absent from `snapshotId` membership;
- unknown, cross-repository, and pruned snapshots fail before mutation;
- foreign-key or dangling-endpoint violations fail before mutation;
- invalid runtime level fails before SQL construction;
- unknown and wrong-level entity keys roll back the whole transaction;
- `replace` rewrites the exact current membership while preserving rows for
  stable entities absent from the current snapshot;
- `append_missing` adds only absent rows and leaves every existing column
  bit-identical;
- a forced mid-batch error leaves the pre-transaction slice unchanged;
- mixed versions and same-version incomplete/extra slices take the full
  replacement path;
- a current-version strict subset takes append-missing;
- concurrent append conflict fails explicitly and rolls back; never partial
  success or a hidden overwrite;
- package topology uses `GraphFile.packageName`, including an adversarial
  path whose prefix suggests a different package;
- package/file/symbol representative sets and projected edges match the table
  in §9; nodes without a valid representative are honestly omitted;
- new-node relaxation leaves all existing rows `Object.is`-identical, stays
  within its displacement bound, and places package-owned nodes from their
  package centroid;
- pinned rows remain fixed through replacement and are persisted with the
  current version;
- empty topology returns an in-memory empty current-version result while a
  direct zero-row read remains `null`.

### Server

- first valid request materializes and returns 200;
- second request returns byte-identical coordinates without recomputation;
- package/file/symbol responses are ordered and contain only their
  representatives;
- empty current level returns 200/empty, not 404;
- invalid level and view key return 400 without invoking `ensureLayout`;
- captured snapshot id/graph stay coherent during a simulated refresh;
- materialization failure returns sanitized `500 layout_engine_error`;
- a new-node snapshot preserves prior positions and returns the appended node.

No golden fixture expectation is edited to make these tests pass.

## 17. Acceptance criteria

- [ ] All files in §14 exist/change exactly as scoped.
- [ ] No GraphState, GraphService, migration, schema, fixture, or MCP-tool
      change.
- [ ] Exact dependency versions are `graphology@0.26.0` and
      `graphology-layout-forceatlas2@0.10.1`.
- [ ] `ensureLayout` is exported and is the server route's only
      materialization entry point.
- [ ] Reads/writes are snapshot-aware, current-membership-filtered, runtime
      level-validated, and entity-key ordered.
- [ ] Replace and append-missing use explicit immediate transactions with the
      rollback behavior in §11.
- [ ] Mixed/stale versions trigger full replacement; append never overwrites
      an existing row.
- [ ] Empty topology returns 200/empty in memory; zero-row `readLayout`
      remains `null`.
- [ ] All existing positions are fixed yet force-participating during local
      relaxation; the version-specific behavior test passes.
- [ ] The complete adversarial matrix is green on a real migrated temporary
      SQLite database.
- [ ] Full validation and `pnpm benchmark:layout` are green, with actual
      measurements recorded.
- [ ] Frozen specs, schemas, migrations, and fixtures have no diff.
- [ ] Status documents report built/validated only after evidence exists.

## 18. Validation commands

```text
pnpm install --frozen-lockfile
pnpm skills:check
pnpm typecheck
pnpm lint
pnpm test
python validate_fixtures.py
pnpm fixtures:validate
pnpm fixtures:index
pnpm fixtures:typecheck
pnpm benchmark:incremental
pnpm benchmark:layout
git diff --check
git status --short
```

Additionally inspect:

```text
git diff -- docs/Specs schemas packages/fixtures packages/store/src/migrations.ts
```

Expected output for that frozen-surface diff is empty.

## 19. Benchmark contract

`scripts/benchmark-layout.mts` uses deterministic synthetic graphs and a
real migrated temporary SQLite database. It records Node version, OS,
processor description, sample count, warm-up count, graph size, and actual
median/p95 values for:

- 500-node full compute at 200 iterations;
- 1,000-node symbol-level full compute at 200 iterations;
- one-new-node relaxation with the other 499 nodes fixed at 50 iterations;
- 500-row `replace` transaction;
- current-version ordered `readLayout`;
- end-to-end first `ensureLayout` materialization and byte-identical reuse.

Implementation gates (not claims about unmeasured code): 500-node package
full compute <2 s, 1,000-node symbol full compute <5 s,
single-new-node relaxation <250 ms, 500-row replace <100 ms, and the inherited
first-materialization endpoint class <3 s on the documented benchmark
machine. The 250 ms relaxation ceiling replaces the unmeasured 50 ms draft:
the pinned ForceAtlas2 implementation still calculates forces for fixed
anchors, and the first executed 499-fixed/1-free benchmark measured 146.1 ms
p95 on the documented Windows machine. If the measured environment cannot meet a gate, report the numbers
and investigate; do not rewrite the blueprint as though the budget had
already been demonstrated. The builder final report uses “measured” only
next to command output from this script.

## 20. Failure, recovery, security, and privacy

- Every write is atomic. A process interruption yields the pre-write or
  complete post-write state under existing SQLite WAL semantics.
- Unknown/mismatched/pruned snapshots, invalid levels, wrong-level keys,
  dangling engine endpoints, mixed public reads, and non-finite output fail
  explicitly. There are no swallowed exceptions or partial commits.
- `ensureLayout` repairs safe incomplete/version states; it does not serve an
  invalid snapshot or silently substitute another snapshot.
- SQL uses prepared parameters. `viewKey` is never interpolated into SQL.
- The route exposes no stack, SQL, filesystem path, or source content in its
  500 response.
- No network or cloud dependency is added. Coordinates contain no source
  body or evidence excerpt.

## 21. Documentation and builder final report

After validation, update the status documents listed in §14 with:

- summary and exact files changed;
- exported signatures;
- tests added and final test count;
- the fixed-anchor reliance test result;
- actual layout benchmark environment/median/p95 values;
- full validation evidence;
- frozen-surface diff evidence;
- commit SHA, PR, and known limitations.

Until then, this blueprint's status is **review/corrected pending
implementation**. Do not mark it built merely because dependency files or a
partial implementation exist.

## 22. Independent review result

The prior roadmap audit found five implementation blockers: no route-trigger
owner, an impossible durable empty-layout distinction, missing relation-aware
engine edges, no exported orchestration seam, and a benchmark absent from the
file/validation plan. This correction resolves those planning defects.

Implementation review remains pending. The reviewer must execute the §16
matrix and the full validation/benchmark gates; prose inspection alone is
not acceptance.

## IF SOMETHING IS UNCLEAR

Make the smallest safe assumption within this blueprint and record it in the
builder report. Stop instead of changing migration 004, any frozen enum,
golden fixtures, GraphService, or GraphState. Missing stored package ownership
falls back to the whole-level centroid; it never authorizes a path heuristic
or invented relation.

## TADORI NON-NEGOTIABLES

Frozen v2.1; TypeScript/JavaScript only; ATLAS separate; exactly six MCP
tools; stable 2D default; 2.5D optional; 3D experimental only; no city
metaphor; no default hairball; progressive package -> file -> task-region
symbol disclosure; deterministic persisted positions; evidence/origin/
confidence/resolution remain honest; unresolved remains visible; static test
linkage is not runtime coverage; observation claims remain bounded; hooks are
evidence receivers only; invalid snapshots are never served; `tadori serve
.` is normal; localhost default; no cloud dependency; Graphify is ignored
reference only; never weaken golden fixtures; no seventh tool; no runtime
tracing.
