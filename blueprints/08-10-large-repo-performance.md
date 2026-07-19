---
graph_blueprint_version: 1
node_id: 08-10
state: review
phase: 8
risk: medium
complexity: M
predecessors: [08-04]
successors: [10-01]
execution_card: blueprints/execution/08-10.md
dossier: blueprints/08-10-large-repo-performance.md
read_policy: execution-card-first
local_full_gate_budget: 1
independent_validation_budget: 1
architecture_review: on-demand-only
---

> **GRAPH EXECUTION MODE:** Read the execution card first. This long file is an evidence dossier, not mandatory context. Open only the sections linked by the card. Planning-time existence claims and line numbers are historical hints; live repository semantics win. Use one full local gate and one independent validation pass.

# BLUEPRINT 08-10: Large-repo performance

## 1. Header

- ID / Title / Phase: 08-10 — Large-repo performance — Phase 8
- Status: review
- Primary builder: Claude Opus — perf-sensitivity: cold-start latency,
  layout determinism, LOD budget enforcement, and memory-ceiling measurement
  each require careful cross-layer reasoning (server materialization timing,
  client fetch sequencing, browser heap behavior) where a wrong call is
  expensive to detect after the fact; this is not a mechanical wiring task.
- Reviewer roles: Performance Reviewer (benchmark methodology,
  machine-variance handling), Spec Guardian (LOD budget fidelity to
  ARCHITECTURE.md §10), Test Adversary (byte-identical-reload assertion
  rigor)
- Complexity: M
- Depends on / Unlocks: Depends on 08-04 (task-region symbol expansion — the
  full three-level LOD chain must exist to budget-test all of it). Unlocks
  10-01 (2.5D fixed-tilt mode reuses the same data paths and budgets).
- Estimated sessions: 1
- Related frozen-spec sections: ARCHITECTURE.md §10 (viz data-loading
  contract, LOD levels/budgets, offline-bundle rule, byte-identical reload);
  §6 (layout persistence, AD-005 "server materializes layout once... persist
  for byte-identical reload"); BACKLOG.md 08-10 row; EVIDENCE-BASELINE.md §7
  (benchmark corpus + gates); 00-02's non-goal on `benchmark:incremental`
  being machine-variance-bound and CI-excluded (same treatment applies here).

## 2. Objective

Running `tadori serve .` cold against a 150,000-LOC synthetic TypeScript
corpus reaches an interactive package-level map in under 5 seconds; the
positions rendered are byte-identical across two independent serve cycles
against the same snapshot; every zoom level enforces its fixed node/edge/label
caps; and the viz tab's browser heap stays under 500 MB at package level on
the same corpus — each budget backed by a named, runnable, CI-excluded
benchmark script plus an automated positions-identity assertion.

## 3. Why this matters

- User value: Tadori's core pitch is exploring a real, large codebase visually
  without the tool becoming the bottleneck; an unbounded or non-deterministic
  map defeats both the "fast enough to use" and "trustworthy" halves of that
  pitch.
- System value: this blueprint is the only place the three-level LOD chain
  (08-02/08-03/08-04), the layout persistence contract (08-01/AD-005), and
  the server API (07-01) are jointly load-tested — regressions in any of
  those three could otherwise ship invisibly until a real large repo is
  opened.
- Downstream: 10-01 (2.5D) and 10-02 (3D experimental) both inherit these
  budgets rather than re-deriving them; 12-05 (pilot/RC) needs this
  blueprint's gates green before a release candidate is credible on
  real-world repos larger than the fixture corpus.

## 4. Current repository evidence

**Verified current:**

- `scripts/benchmark-incremental.mts` (192 lines) already generates a
  synthetic corpus: `FILE_COUNT = 250` leaf files, `LINES_PER_FILE = 1_000`,
  `CHAIN_COUNT = 40` import-chain files, `ITERATIONS = 12`
  (`benchmark-incremental.mts:15-18`), written into a fresh `mkdtempSync`
  directory (`benchmark-incremental.mts:55-60`) with its own
  `package.json`/`tsconfig.json`. This corpus is the documented
  "250,330 LOC in 291 files" figure (`IMPLEMENTATION_STATUS.md`, cited in
  EVIDENCE-BASELINE.md §7) — **291 files** = 250 leaf + 40 chain + 1
  supporting file (package.json/tsconfig.json counted once each per the
  script's own file writes, consistent with the corpus generator, not a
  separate count this blueprint invents).
- Existing benchmark gates, thrown as errors
  (`benchmark-incremental.mts:174-186`, cited in EVIDENCE-BASELINE.md §7):
  single-file p95 `< 2000 ms`; package-invalidation duration `< 10000 ms`;
  heap growth ceiling `512 MiB`; DB growth ceiling `2 MiB`/snapshot. **This
  blueprint's 150k-LOC corpus is a separate, larger generation** — the task
  instructions specify 150k LOC for the serve/interactive/memory budgets
  here, distinct from the existing 250k-LOC incremental-refresh corpus; both
  corpora reuse the same generator shape (leaf files + import chains) so this
  blueprint **extends** `benchmark-incremental.mts`'s corpus-generation
  approach with a parameterized size rather than duplicating a second
  from-scratch generator (ladder rung 2 — reuse what exists).
- `README.md`/`IMPLEMENTATION_STATUS.md` cite "single-file refresh p95
  1257.685 ms (< 2000 ms gate) on a 250,330-LOC corpus" as current ground
  truth (EVIDENCE-BASELINE.md §9) — this blueprint's budgets are new,
  additive gates for the serve/viz path, not a revision of the existing
  incremental-indexing gates.
- ARCHITECTURE.md §10 LOD request pattern (verbatim): package level (initial)
  = `GET /api/v1/nodes?level=package` + `GET /api/v1/edges?relation=imports` +
  `GET /api/v1/layout?level=package`; file level (on expand) =
  `GET /api/v1/nodes?level=file&packageName=X` + `GET /api/v1/layout?level=file`
  with "no global movement"; symbol level = `GET /api/v1/nodes?level=symbol&file=Y`
  + `GET /api/v1/layout?level=symbol`. Budgets already stated: "`limit`
  capped per level (package<=500, file<=500, symbol<=1000); `cursor`
  paginates; 08-10 enforces cold 150k LOC -> interactive < 5s by loading
  package level first and lazily fetching deeper levels." **These three
  node caps (500/500/1000) are the frozen numbers this blueprint enforces —
  not re-derived, cited verbatim from ARCHITECTURE.md §10.**
- ARCHITECTURE.md §3 endpoint table row 15: `GET /api/v1/layout` response
  `{ positions: {entityKey, x, y, z, pinned}[]; layoutVersion: number }`,
  error `404 layout_not_materialized`; row 4/5: `nodes`/`edges` pagination is
  "opaque decimal cursor (offset)... `total` may be `null` when counting is
  not free."
- AD-005 (§6, ARCHITECTURE.md): "the server materializes seeded layout once,
  on first serve of a snapshot; the layout engine is a pure function... viz
  never computes layout... byte-identical reload guaranteed by reading
  persisted `x/y/z`, never recomputing." This is the exact mechanism this
  blueprint's positions-identity assertion (§10/§13) tests.
- migration 004's `layout_positions` table
  (`packages/store/src/migrations.ts:442-458`) is the frozen persistence
  target — `PRIMARY KEY (repo_id, abstraction_level, view_key, node_id)`
  means a re-read for the same key always returns the same stored row unless
  explicitly rewritten; this blueprint's cross-cycle assertion reads this
  table (via the 08-01 read function, or directly for test purposes) after
  two independent `tadori serve .` cold starts against the same snapshot and
  diffs the rows.
- `packages/mcp/src/contracts.ts` `toolNodeSchema`/`toolEdgeSchema` are the
  frozen wire shapes viz consumes (ARCHITECTURE.md AD-008) — this blueprint's
  LOD/memory tests assert against these shapes' actual payload sizes, not an
  invented shape.
- 00-02's blueprint (`blueprints/00-02-ci-pipeline.md:90-96`) already
  establishes the precedent this blueprint must match: "No benchmark job
  (`benchmark:incremental` is machine-variance-bound; a scheduled
  non-blocking benchmark job is future work — record in RISKS R-008, do not
  build now)." This blueprint's new scripts follow the identical
  CI-exclusion treatment — named, runnable locally, not wired into the
  blocking CI gate, any future scheduling is out of scope here too.
- `apps/viz`, `packages/server`, `packages/cli` do not exist yet (`ls
  packages/` confirms). This blueprint's scripts and assertions are specified
  against the contracts 07-01/07-02/08-01/08-02/08-03/08-04 establish
  (ARCHITECTURE.md's proposed shapes), consistent with those blueprints'
  own "pending" status — this blueprint's acceptance criteria are stated so
  they are checkable once those dependencies land, per §7.

**PROPOSED / to be resolved by this blueprint:**

- The 150k-LOC corpus generator parameters (§8, §11) — extending
  `benchmark-incremental.mts`'s approach, not a new shape.
- The exact benchmark script names and their CI-exclusion marking (§9, §15).
- The browser-heap measurement method (§8 — via a browser test runner, since
  no such measurement exists in the repo today).

Files to read first: `scripts/benchmark-incremental.mts` (full file, the
pattern this blueprint extends), ARCHITECTURE.md §10 (LOD contract, budgets,
byte-identical reload), §6 (AD-005), §3 (endpoint table rows 4/5/15),
`packages/store/src/migrations.ts:435-458` (`layout_positions`),
`blueprints/00-02-ci-pipeline.md` §6 (non-goal precedent for machine-variance
exclusion), `docs/CLI_CONTRACT.md` (serve startup sequence this blueprint's
cold-start timer wraps).

## 5. Scope

1. A parameterized 150k-LOC synthetic corpus generator (extends
   `benchmark-incremental.mts`'s generation functions, not a duplicate).
2. A cold-start timing script: launches `tadori serve .` against the 150k-LOC
   corpus from a clean `.tadori/` state, measures wall time from process
   start to "package-level map interactive" (defined precisely in §8), fails
   if `>= 5000 ms`.
3. A positions-identity script: runs two full serve cycles (fresh process
   each time) against the same committed snapshot, reads back
   `layout_positions` rows (or the equivalent `GET /api/v1/layout` response)
   for all three levels after each cycle, asserts byte-identical `x`/`y`/`z`
   values (exact float equality, not approximate).
4. LOD budget enforcement: automated assertions that package/file/symbol node
   responses never exceed 500/500/1000 respectively (ARCHITECTURE.md §10
   verbatim), that edge responses respect their own pagination limit
   (`<=1000` per ARCHITECTURE.md §3 row 5), and that label rendering is culled
   below a stated zoom threshold (§8 culling rule, since ARCHITECTURE.md does
   not fix a label cap explicitly — this blueprint fixes one, per task
   instruction "pull numbers from ARCHITECTURE.md viz contract or fix them
   here").
5. Server-side page latency budgets for the LOD endpoints under the 150k-LOC
   benchmark DB (not wall-clock cold-start, but per-request budgets for
   `/api/v1/nodes`, `/api/v1/edges`, `/api/v1/layout` at each level).
6. A browser-driven memory-ceiling test: viz tab heap stays `< 500 MB` at
   package level on the 150k-LOC corpus, measured via a browser test runner
   (heap snapshot or `performance.memory`-equivalent API).
7. A documented regression procedure for when any budget fails: bisect by
   LOD level first, never raise the budget silently.

## 6. Non-goals

- No new corpus-generation approach — this extends
  `benchmark-incremental.mts`'s existing leaf-file/import-chain generator
  functions with a larger parameter set, never a rewritten generator.
- Not wired into the blocking CI gate (`00-02`) — these scripts are
  machine-variance-bound exactly as `benchmark:incremental` already is;
  marked CI-excluded consistent with 00-02's stated non-goal, run manually/
  pre-release instead.
- No automatic budget-raising mechanism — a failing budget is a stop
  condition requiring investigation (§17), never an automatically adjusted
  threshold.
- No production real-world-repo benchmark corpus (that is 11-02's "seeded-
  trap repos" scope, a different phase with different goals — task
  correctness, not raw performance).
- No client-side layout computation of any kind (already excluded by AD-005;
  restated here because a naive "make it faster" instinct could tempt
  precomputing layout in the browser — explicitly rejected).
- No change to the existing `benchmark-incremental.mts` gates (single-file
  p95, package-invalidation, heap/DB growth ceilings) — those stay exactly as
  they are; this blueprint adds new, separate gates for the serve/viz path.
- No 2.5D/3D-mode-specific budgets — those are 10-01/10-02's scope, inheriting
  this blueprint's 2D budgets as a floor, not re-derived here.

## 7. Dependencies and prerequisites

- 08-04 must have delivered the full three-level LOD chain (package → file →
  symbol) so all three levels can be budget-tested together. If 08-01/08-02/
  08-03/08-04/07-01 have not all landed when this blueprint's builder session
  starts, the corpus-generation and script-scaffolding work (§9 items 1-2)
  proceeds independently and unit-tests against a mocked server; the
  cold-start/positions-identity/memory scripts that require a live
  `tadori serve .` process are written but marked pending those dependencies
  (same `describe.skip`-with-cited-dependency pattern used in 08-08/08-09),
  and are not required for this blueprint's own acceptance criteria until
  those dependencies are `built` — see §14.

## 8. Architectural decisions

- **DECISION 08-10-A — extend, don't duplicate, the existing benchmark
  generator.** `scripts/benchmark-incremental.mts`'s `writeLeaf`/`writeChain`
  functions (lines 34-53) already produce exactly the file shapes needed;
  this blueprint's corpus script imports and parameterizes them (or, if they
  are not exported, promotes them to a small shared module
  `scripts/lib/syntheticCorpus.mts` used by both scripts) rather than
  reimplementing file generation. Rationale: two independent generators for
  "a pile of TS files with import chains" is duplicate machinery for zero
  behavioral gain. Rejected: a second from-scratch generator (violates
  "extend, don't duplicate" instruction directly).
- **DECISION 08-10-B — "interactive" is defined as: package-level nodes,
  edges, and layout have all resolved client-side and the first paint with
  real data (not a loading skeleton) has occurred.** This is measured by
  instrumenting the viz app's data-loading sequence (ARCHITECTURE.md §10 step
  1: `GET /api/v1/nodes?level=package` + `GET /api/v1/edges?relation=imports`
  + `GET /api/v1/layout?level=package`) with a timestamp captured at browser
  paint via `performance.mark`/`performance.measure`, from a `serve-start`
  mark (process launch) to an `interactive` mark (all three package-level
  fetches resolved and Sigma.js has rendered at least one frame with the
  fetched data). Rejected: measuring only server-side "ready to accept
  requests" (misses client fetch+render time, the part users actually
  experience); rejected: measuring only "first byte" of the HTTP response
  (misses the reindex-if-stale step that `tadori serve .` may need to run
  first, per `docs/CLI_CONTRACT.md` step 3).
- **DECISION 08-10-C — byte-identical reload assertion compares raw stored
  floats, not rendered pixel positions.** The assertion reads
  `layout_positions.x/y/z` (via `GET /api/v1/layout` or a direct
  read-only DB query in the test harness) after each of two independent
  serve cycles and asserts strict equality (`===`, IEEE-754 exact, since
  AD-005 states the store "REAL round-trips the doubles exactly") — not a
  visual/pixel diff, which would be sensitive to unrelated rendering
  changes (canvas size, DPI) and would not actually test the persistence
  guarantee AD-005 makes. Rejected: screenshot-diffing for "identical
  layout" (tests the wrong layer — rendering, not persistence — and is
  flakier).
- **DECISION 08-10-D — LOD budgets are enforced at the server response layer,
  not just documented as a client expectation.** The server's
  `/api/v1/nodes` handler (07-01) is expected to cap `limit` at 500/500/1000
  per level per ARCHITECTURE.md §10; this blueprint's test asserts the actual
  HTTP response never exceeds those counts even if a client requested a
  larger `limit` (defense in depth — a client bug must not be able to pull an
  unbounded response). If 07-01's implementation does not yet enforce the
  cap server-side, that is a **finding** for 07-01, not something this
  blueprint patches around by only checking the client's requested `limit`.
- **DECISION 08-10-E — label culling threshold fixed here since
  ARCHITECTURE.md does not set one.** Per task instruction, this blueprint
  fixes a concrete rule since none is frozen elsewhere: labels render only
  for nodes occupying more than a minimum on-screen footprint at the current
  zoom (proposed: label visible when the node's rendered radius is `>= 6px`
  at the current camera zoom, a standard Sigma.js label-threshold pattern),
  and never more than 200 labels simultaneously on screen regardless of zoom
  (a hard cap independent of the node-count cap, since 500 visible nodes with
  500 simultaneous labels is a readability failure, not just a performance
  one). This is a **new, fixed number** owned by this blueprint, recorded
  here so 08-02/08-03/08-04 treat it as settled rather than re-deciding it.
  Rejected: no cap (label overlap at package level with near-500 nodes is
  illegible — violates the "no default hairball" non-negotiable in spirit).
- **DECISION 08-10-F — memory measurement via the browser test runner's heap
  snapshot API, not a manual DevTools check.** The existing repo has no
  browser-driven test infrastructure yet (08-11 owns general browser/a11y
  validation); this blueprint's memory test is written against whatever
  browser test runner 08-11/08-02 establishes (Playwright is the ecosystem-
  standard choice for Sigma.js/Vite React apps and is consistent with the
  "minimal tooling" dependency allowlist's spirit, though not itself in the
  explicit runtime-deps allowlist since it is a devDependency/test tool, not
  a shipped runtime dependency) capturing a heap snapshot
  (`page.metrics()` / CDP `Performance.getMetrics` `JSHeapUsedSize`) at
  package level after the interactive mark, asserting `< 500 MB`. Rejected:
  a manual, non-automated DevTools screenshot (not "command-verifiable" per
  the template's binary-acceptance-criteria requirement).
- **DECISION 08-10-G — regression procedure: bisect by LOD level, never raise
  a budget silently.** If a budget fails, the procedure (documented in §17)
  is: (1) identify which LOD level's fetch/render/memory contributed the
  regression by re-running the timing/memory script with only that level's
  fetch enabled; (2) `git bisect` across the commit range if the regression
  is new; (3) file a defect record (matching the existing `IMPLEMENTATION_STATUS.md`
  "Discovered defects" convention); (4) fix the root cause. Raising the
  budget number itself is never step (1)-(4) — it requires an explicit,
  separately-reviewed decision to change the frozen number in this blueprint,
  analogous to how migration numbers are frozen and only change via a
  reviewed correction (C-1/C-2 precedent in ARCHITECTURE.md).

## 9. Exact file plan

- `scripts/lib/syntheticCorpus.mts` — create (or refactor from
  `benchmark-incremental.mts` if its generation functions are not already
  exported — promote `writeLeaf`/`writeChain`-equivalent logic here,
  parameterized by `fileCount`/`linesPerFile`/`chainCount`). Both the existing
  `benchmark-incremental.mts` and this blueprint's new scripts import from
  here — existing script's behavior/output is unchanged (regression-tested
  by re-running its own existing gate after the refactor).
- `scripts/benchmark-serve-coldstart.mts` — create. Generates (or reuses a
  cached) 150k-LOC corpus via `syntheticCorpus.mts` parameterized for
  ~150,000 LOC (matching the existing corpus shape's LOC-per-file ratio —
  e.g. 150 leaf files × 1,000 lines ≈ 150,000 LOC, adjusted to match
  whatever exact ratio keeps parity with the existing 250-file/250,330-LOC
  corpus's per-file line count); launches `tadori serve .` as a child
  process; drives a headless browser to the printed URL; captures the
  `serve-start` → `interactive` timing (DECISION 08-10-B); asserts
  `< 5000 ms`; **CI-excluded** (not run in `00-02`'s workflow).
- `scripts/benchmark-serve-positions-identity.mts` — create. Runs two
  complete `tadori serve .` cycles against the same pre-indexed snapshot;
  reads back layout positions for all three levels after each; asserts
  exact float equality; **CI-excluded**.
- `scripts/benchmark-serve-memory.mts` — create (or a Playwright test file
  under `apps/viz/test/perf/memory.spec.ts` if that is where 08-11 establishes
  browser tests — this blueprint's builder resolves the exact location to
  match whatever 08-02/08-11 convention exists at build time, defaulting to
  `apps/viz/test/perf/` if no convention yet exists). Loads the 150k-LOC
  corpus's package-level map; captures heap size; asserts `< 500 MB`;
  **CI-excluded**.
- `apps/viz/src/lod/budgets.ts` — create. `LOD_BUDGETS = { package: {nodes:
  500, edges: 1000}, file: {nodes: 500, edges: 1000}, symbol: {nodes: 1000,
  edges: 1000} }` and `LABEL_BUDGET = { minRadiusPx: 6, maxSimultaneous: 200
  }` — the single source of truth both the client-side request logic and
  this blueprint's tests reference (no magic numbers duplicated across
  files).
- `apps/viz/test/lod-budgets.test.ts` — create. Asserts fetch calls never
  request (client-side guard) or accept (response-validation guard) more
  than the budgeted counts; asserts label-culling function respects
  `LABEL_BUDGET`.
- `packages/server/test/lod-response-caps.test.ts` — create (or the
  equivalent path once 07-01 establishes `packages/server/test/`). Server-
  side assertion (DECISION 08-10-D): a request with `limit` above the level
  cap still returns a response capped at the frozen number.
- `IMPLEMENTATION_STATUS.md` — not modified by this planning blueprint
  (builder updates at build time).

## 10. Exact contracts

```ts
// scripts/lib/syntheticCorpus.mts
export interface SyntheticCorpusOptions {
  fileCount: number;
  linesPerFile: number;
  chainCount: number;
}
export interface SyntheticCorpus { root: string; approxLoc: number; }
export function generateSyntheticCorpus(options: SyntheticCorpusOptions): SyntheticCorpus;
export function cleanupSyntheticCorpus(corpus: SyntheticCorpus): void;

// existing 250k corpus becomes: generateSyntheticCorpus({fileCount:250, linesPerFile:1000, chainCount:40})
// this blueprint's 150k corpus:  generateSyntheticCorpus({fileCount:150, linesPerFile:1000, chainCount:24})
//   (chainCount scaled proportionally to fileCount, preserving the existing corpus's ratio of ~1 chain file per 6.25 leaf files)
```

```ts
// apps/viz/src/lod/budgets.ts
export interface LevelBudget { nodes: number; edges: number; }
export const LOD_BUDGETS: Record<"package" | "file" | "symbol", LevelBudget> = {
  package: { nodes: 500, edges: 1000 },
  file:    { nodes: 500, edges: 1000 },
  symbol:  { nodes: 1000, edges: 1000 }
};
export const LABEL_BUDGET = { minRadiusPx: 6, maxSimultaneous: 200 } as const;
```

```ts
// scripts/benchmark-serve-coldstart.mts (assertion shape)
interface ColdStartResult { serveStartMs: number; interactiveMs: number; elapsedMs: number; }
// throws if elapsedMs >= 5000

// scripts/benchmark-serve-positions-identity.mts (assertion shape)
interface PositionsIdentityResult {
  level: "package" | "file" | "symbol";
  mismatches: { entityKey: string; cycle1: [number,number,number]; cycle2: [number,number,number] }[];
}
// throws if any level's mismatches.length > 0

// scripts/benchmark-serve-memory.mts (assertion shape)
interface MemoryResult { level: "package"; heapBytes: number; }
// throws if heapBytes >= 500 * 1024 * 1024
```

Server-side page-latency budgets (per-request, under the 150k-LOC benchmark
DB, measured server-side with `process.hrtime`):

```
GET /api/v1/nodes?level=package   p95 < 200 ms
GET /api/v1/nodes?level=file      p95 < 200 ms
GET /api/v1/nodes?level=symbol    p95 < 300 ms
GET /api/v1/edges (any level)     p95 < 300 ms
GET /api/v1/layout (any level)    p95 < 150 ms   (materialization is once-only per AD-005; this budget covers the read path after materialization, and a separate one-time-materialization budget of < 3000 ms covers the first call)
```

## 11. Ordered implementation procedure

1. `scripts/lib/syntheticCorpus.mts`: extract/parameterize
   `benchmark-incremental.mts`'s file-generation logic; re-run
   `pnpm benchmark:incremental` unchanged to confirm the refactor is
   behavior-preserving (same gates pass with the same numbers, within normal
   machine variance). Reason: single source of corpus generation (DECISION
   08-10-A). Test: existing `benchmark-incremental.mts` gates still pass.
2. `apps/viz/src/lod/budgets.ts` + `apps/viz/test/lod-budgets.test.ts`:
   define the frozen numbers and their unit tests (client-side request
   capping, label-culling function). Reason: single source of the numeric
   budgets before any script references them. Test: requesting `limit=9999`
   at package level is clamped to 500 before the fetch is issued; label
   function returns `<= 200` labels for a synthetic 500-node input.
3. `packages/server/test/lod-response-caps.test.ts`: write against 07-01's
   endpoint (or a documented-pending stub if 07-01 is not yet built — see
   §7). Reason: server-side enforcement is the authoritative cap (DECISION
   08-10-D), client-side is defense in depth only. Test: oversized `limit`
   request still yields a capped response.
4. `scripts/benchmark-serve-coldstart.mts`: implement the cold-start timing
   script against the 150k-LOC corpus, marked CI-excluded in its own header
   comment (matching 00-02's precedent). Reason: the headline 08-10 budget.
   Test: script runs locally, asserts `< 5000 ms`, throws with a clear
   message on failure (mirrors `benchmark-incremental.mts`'s throw-based gate
   style).
5. `scripts/benchmark-serve-positions-identity.mts`: implement the two-cycle
   positions comparison. Reason: the byte-identical-reload contract (AD-005)
   is otherwise untested end-to-end. Test: two cycles against the same
   snapshot yield zero mismatches across all three levels.
6. `scripts/benchmark-serve-memory.mts` (or the Playwright-spec equivalent):
   implement the heap-snapshot measurement. Reason: the memory ceiling is
   otherwise unverified. Test: package-level load on the 150k corpus reports
   `< 500 MB`.
7. Document the regression procedure (§17) and CI-exclusion marking
   consistent with 00-02 (§15). Run the full existing gate (§15) to confirm
   zero regression to the pre-existing suite.

## 12. Data and lifecycle flows

**Cold start (measured):** `tadori serve .` launched against the 150k-LOC
corpus with no prior `.tadori/tadori.sqlite` → CLI resolves repo → indexes
from scratch (no reuse possible, matching "cold" in the objective) →
validates → starts server → starts viz static serving → browser navigates to
the printed URL → viz fetches package-level nodes/edges/layout → first real
paint. The `serve-start` mark is captured at CLI process launch; the
`interactive` mark at first real-data paint (DECISION 08-10-B). This is
strictly slower than a warm start (existing snapshot reused) — the objective
is explicitly the cold path, the harder bound.

**Positions-identity cycles:** cycle 1 — index the corpus once (shared
starting point for both cycles, so both compare against the identical
snapshot, isolating the layout-persistence variable from indexing
non-determinism, which is out of this blueprint's scope); serve, fetch all
three levels' layout, record; teardown. Cycle 2 — serve again (same
`.tadori/tadori.sqlite`, same active snapshot, fresh process); fetch all
three levels' layout again; record; teardown; diff.

**LOD lazy-loading (operation):** package level loads first and fully; file
level loads only on a specific package's expansion (08-03); symbol level
loads only on a specific file's expansion (08-04) — this blueprint's
cold-start budget only requires package level to be interactive within 5 s;
file/symbol levels are budgeted separately via their own per-request latency
numbers (§10), not folded into the 5 s headline number, since they are
demand-loaded, not part of the initial paint.

**Failure (any budget script):** a budget script that fails throws with a
message naming the exact measured value vs. the budget (mirrors
`benchmark-incremental.mts`'s existing throw style) and a non-zero exit code;
it does not silently pass or auto-adjust.

**Shutdown:** each script tears down its own `tadori serve .` child process
and browser instance in a `finally` block, mirroring
`diffWorkingTree`'s `finally { await indexer.stop() }` convention already
established in the indexer package.

## 13. Test plan

- Performance/benchmark (all explicitly CI-excluded, matching 00-02's
  precedent for `benchmark:incremental`):
  `scripts/benchmark-serve-coldstart.mts`,
  `scripts/benchmark-serve-positions-identity.mts`,
  `scripts/benchmark-serve-memory.mts`.
- Unit: `apps/viz/test/lod-budgets.test.ts` — budget constants, client-side
  request-clamping, label-culling function (runs in the normal `pnpm test`
  gate, not CI-excluded, since it is a fast deterministic unit test, not a
  wall-clock/memory measurement).
- Integration: `packages/server/test/lod-response-caps.test.ts` — server-side
  cap enforcement (normal `pnpm test` gate, deterministic, fast).
- Regression: existing `pnpm benchmark:incremental` gate re-run unchanged
  after the `syntheticCorpus.mts` extraction, confirming behavior-preserving
  refactor.
- Adversarial: a deliberately malformed/interrupted serve cycle (kill the
  server process mid-layout-materialization) followed by a clean restart —
  asserts the positions-identity comparison still holds for whatever
  subset of levels did materialize before the interruption (partial
  materialization must not corrupt already-persisted rows for other levels).

## 14. Acceptance criteria

- [ ] `scripts/benchmark-serve-coldstart.mts` reports package-level
      interactive time `< 5000 ms` on the 150k-LOC corpus (run locally;
      CI-excluded).
- [ ] `scripts/benchmark-serve-positions-identity.mts` reports zero
      mismatches across all three LOD levels between two independent serve
      cycles against the same snapshot.
- [ ] `apps/viz/test/lod-budgets.test.ts` passes: package/file node caps
      `<= 500`, symbol node cap `<= 1000`, edge cap `<= 1000` per level,
      simultaneous label cap `<= 200`.
- [ ] `packages/server/test/lod-response-caps.test.ts` passes: an
      over-limit request never yields an over-budget response.
- [ ] `scripts/benchmark-serve-memory.mts` reports package-level browser heap
      `< 500 MB` on the 150k-LOC corpus.
- [ ] All three new benchmark scripts are excluded from `00-02`'s CI
      workflow file (verified by `git diff` showing no new script name added
      to the CI workflow's run list) and each carries a `machine-variance,
      CI-excluded` header comment.
- [ ] `scripts/lib/syntheticCorpus.mts` extraction leaves
      `pnpm benchmark:incremental`'s existing four gates passing unchanged.
- [ ] Full existing suite (170+ tests) and 5/5 fixtures stay green — this
      blueprint touches no fixture/migration surface.
- [ ] The regression procedure (§17) is documented and named; no budget in
      this file is silently raised as part of this blueprint's own
      acceptance (raising a budget requires a separate, explicit, reviewed
      change).

## 15. Validation commands

pnpm skills:check; pnpm typecheck; pnpm lint; pnpm test;
python validate_fixtures.py; pnpm fixtures:validate; pnpm fixtures:index;
pnpm fixtures:typecheck; pnpm benchmark:incremental;
tsx scripts/benchmark-serve-coldstart.mts (manual/pre-release, CI-excluded);
tsx scripts/benchmark-serve-positions-identity.mts (manual/pre-release,
CI-excluded); tsx scripts/benchmark-serve-memory.mts (manual/pre-release,
CI-excluded); git diff --check

## 16. Performance budgets

(Restated as the definitive list, all frozen by this blueprint unless a
future explicit reviewed change raises them per DECISION 08-10-G):

- Cold `tadori serve .` → package-level interactive: `< 5000 ms` on the
  150k-LOC synthetic corpus.
- Layout positions byte-identical across two independent serve cycles: zero
  mismatches, all three LOD levels.
- Node caps: package `<= 500`, file `<= 500`, symbol `<= 1000` (verbatim from
  ARCHITECTURE.md §10).
- Edge cap: `<= 1000` per level (ARCHITECTURE.md §3 row 5).
- Label cap: `<= 200` simultaneous, `>= 6px` rendered-radius threshold to
  show a label at all (fixed by this blueprint, DECISION 08-10-E).
- Server per-request p95: nodes package/file `< 200 ms`, nodes symbol
  `< 300 ms`, edges `< 300 ms`, layout read `< 150 ms`, layout first
  materialization `< 3000 ms`.
- Browser heap at package level on the 150k-LOC corpus: `< 500 MB`.

## 17. Failure and recovery behavior

- Any budget script failure: throws with the measured value and the budget
  it violated (mirrors `benchmark-incremental.mts`'s existing style); exits
  non-zero; never silently passes.
- **Regression procedure when a budget fails** (DECISION 08-10-G, restated
  as the operational steps): (1) bisect by LOD level — re-run the relevant
  script with only the failing level's fetch/render path active to localize
  whether the regression is in server response time, client fetch/parse, or
  render/paint; (2) if the regression is newly introduced, `git bisect`
  across the commit range using the same script as the bisection oracle;
  (3) record a dated defect entry in `IMPLEMENTATION_STATUS.md`'s
  "Discovered defects" section (existing convention, EVIDENCE-BASELINE.md
  §9); (4) fix the root cause in the offending layer. **Raising the numeric
  budget itself is never an acceptable resolution step** — it requires a
  separate, explicitly reviewed edit to this blueprint file (analogous to
  how ARCHITECTURE.md's C-1/C-2 corrections were explicit, cited, and
  reviewed, not silent).
- Interrupted serve cycle mid-materialization: partially-materialized levels
  (e.g. package level persisted, file level not yet requested) must not
  corrupt or block a subsequent clean cycle's materialization of the
  remaining levels — each level's `layout_positions` rows are independent by
  `abstraction_level` in the primary key, so a partial cycle cannot corrupt
  another level's rows (structural guarantee already provided by migration
  004's schema, verified not reinvented here).
- Corpus generation failure (disk space, permissions): scripts fail fast
  with a clear message before attempting any serve/timing measurement.

## 18. Security and privacy

No new security surface — all scripts operate against locally-generated
synthetic corpora and localhost-bound `tadori serve .` instances, identical
trust boundary to every other local-only Tadori command. No new persistent
data beyond the temp corpus directories (cleaned up via `cleanupSyntheticCorpus`,
mirroring the existing `mkdtempSync`/cleanup pattern in
`benchmark-incremental.mts`).

## 19. Accessibility

Not directly applicable — this blueprint is performance instrumentation, not
human-facing UI. Its memory/timing scripts must not disable or bypass any
accessibility feature 08-11 establishes in the same browser test runner
(e.g. do not run with reduced-motion/ARIA features stripped out just to
simplify measurement — measure the real, fully-accessible build).

## 20. Documentation updates

- This blueprint file itself is the authoritative budget list (§16);
  `IMPLEMENTATION_STATUS.md` updates at build time per standing CLAUDE.md
  rule, not by this planning blueprint.
- `blueprints/00-02-ci-pipeline.md` is not edited by this blueprint (per
  task instruction); this blueprint's CI-exclusion treatment is stated here
  as consistent with 00-02's existing non-goal wording, for 00-02's own
  builder/reviewer to cross-reference, not to modify 00-02's file.

## 21. Builder final report

Require: summary; files changed; corpus-generator extraction diff summary;
the three new benchmark scripts + their measured results on the build
machine (explicitly labeled as machine-variance-bound, not a strict pass/
fail gate for CI); LOD budget unit test results; server-cap test results;
commit SHA; known limitations (e.g. exact hardware the 5s/500MB numbers were
measured on); follow-on risks; `ASSUMPTION:` lines.

## 22. Independent review result

Pending Wave 2 adversarial review.

## IF SOMETHING IS UNCLEAR

Smallest safe assumption + `ASSUMPTION:` line. Where ARCHITECTURE.md leaves a
number unfixed (label culling, §8-E), this blueprint fixes one explicitly
and records it as a new decision, per task instruction, rather than leaving
it to the builder to invent ad hoc at implementation time.

## TADORI NON-NEGOTIABLES

Frozen v2.1; TS/JS only; ATLAS separate; exactly six MCP tools; stable 2D
default; 2.5D optional; 3D experimental only; no city metaphor; no default
hairball; no generic admin dashboard or permanent dual sidebars; progressive
disclosure package → file → task-region symbols; deterministic positions;
every visible relation keeps evidence, origin, confidence, resolution;
unresolved stays visibly unresolved; static test linkage is not runtime
coverage; agent observation honesty ("not observed inspected"; coverage
complete_for_registered_sources | partial | unknown); design rationale only
from ADRs/docs/instructions/explicit human input, otherwise "No documented
design decision found"; hooks remain an evidence receiver, never an
orchestrator/runtime; invalid snapshots never served; `tadori serve .` is the
normal command; localhost default; no cloud dependency; Graphify is ignored
reference only — never import/copy/ship; never weaken golden fixtures; no
seventh tool; no runtime tracing.
