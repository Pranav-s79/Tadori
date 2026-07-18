# BLUEPRINT 08B-03: Walkthrough tours

## 1. Header

- ID / Title / Phase: 08B-03 — Walkthrough tours — Phase 8B (Guided Explore
  mode)
- Status: review
- Primary builder: Claude Sonnet — four deterministic tour builders over an
  existing engine and derivation layer; no new state machine, no new
  persistence format, no architectural latitude beyond the ordering/
  emptiness rules fixed here.
- Reviewer roles: Spec Guardian (evidence honesty per tour type, linkage-
  kind wording), Test Adversary (per-fixture expected step counts, empty-
  state coverage), Implementation Reviewer (anti-hairball LOD budget
  conformance).
- Complexity: M (one focused builder session)
- Depends on: 08B-02 (tour engine + progress state — supplies the state
  machine, camera-target function, and persistence this blueprint's four
  tour builders plug into)
- Unlocks: none downstream in the current BACKLOG (Phase 8B is the last
  item before Phase 9 review mode, which does not depend on tours)
- Estimated sessions: 1
- Related frozen-spec sections: ARCHITECTURE.md §8 (tour data model); §3
  row 16 (`GET /api/v1/overview`, consumed as an input); ASSUMPTIONS.md
  A-105 (deterministic, offline, evidence-backed); BACKLOG.md Phase 8
  anti-hairball / LOD budget rows (08-10); R-01 (guided-explore framing,
  anti-hairball motivation).

## 2. Objective

Four concrete, deterministic tour types — entry-point tour, route/request
tour, dependency tour, test walkthrough — each built as a `Tour` object
(ARCHITECTURE §8 shape) consumable by 08B-02's engine. A deterministic
ranking function orders the available tours into a recommended exploration
sequence. Every tour step renders a bounded neighborhood (never the whole
graph). A tour type with no qualifying graph data is **absent**, not
empty-with-an-error, and its absence is explained.

## 3. Why this matters

- User value: four purpose-built entry angles into an unfamiliar repository
  (rather than one flat exploration mode), each grounded in real graph
  structure — directly answers R-01's "guided-explore framing" validation
  (§5 translation table: "confirms, does not originate, that scope").
- System value: this is where 08B-01's derived subsystems/entry-points and
  08B-02's generic engine meet concrete content — the four tour types are
  the full initial Guided Explore product surface.
- Downstream: none further in Phase 8B; this closes out the phase.

## 4. Current repository evidence

**Verified current — fixture ground truth (read directly from
`packages/fixtures/0{1,2,3}-*/expected/graph.json` for this blueprint):**

| Fixture | package nodes | route nodes | `routes_to` edges | test nodes | `tests` edges | function/method/class nodes (fan-in candidates) |
|---|---:|---:|---:|---:|---:|---:|
| 01-core-symbols | 1 | 0 | 0 | 3 | 2 | 6 function + 4 method + 3 class = 13 |
| 02-express-routes | 1 | 2 | 2 | 2 | 1 | 4 method + 4 function + 4 class = 12 |
| 03-next-routes | 1 | 5 | 5 | 2 | 1 | 10 function |

(Node/edge kind counts verified by direct JSON inspection of each
`expected/graph.json`'s `nodes`/`edges` arrays, tallied by `kind`/
`relation` field — see also EVIDENCE-BASELINE.md §6 for the top-level
node/edge totals per fixture, which match: fixture 01 = 32 nodes/72 edges,
fixture 02 = 33 nodes/79 edges, fixture 03 = 30 nodes/68 edges.)

- Fixture 02's two `routes_to` edges have **different provenance**: one
  `origin: "compiler", confidence: "certain", resolution: "resolved"`
  (`route:GET /users/:id` -> `method:controller.UserController.getUser`,
  evidence at `src/routes/users.ts:7`), one `origin: "heuristic",
  confidence: "likely", resolution: "partial"` (`route:POST
  <computed:adminPath>` -> `method:controller.AdminController.createAdmin`,
  evidence at `src/routes/admin.ts:8`, the route's own `qualifiedName`
  literally contains `<computed:adminPath>` because the path is not a
  string literal). The route/request tour (§8) must carry this
  distinction into its narration, never flattening both to the same
  confidence.
- Fixture 01 has **zero** `route` nodes and **zero** `routes_to` edges —
  this is the concrete case that exercises the route tour's absence rule
  (§8, §17).
- All three fixtures have exactly **one `package` node** (single-package
  repos, per 08B-01's evidence) — the dependency tour's "high fan-in
  modules" ranking (§8) operates at the **symbol** level in these fixtures
  (function/method/class fan-in), not the package level, since there is
  only one package to rank; the dependency tour's ranking rule (§8) is
  written to work at whichever granularity has more than one candidate,
  falling back from package-level to symbol-level exactly as stated there.
- `packages/mcp/src/service.ts:155-156` `fanIn(entityKey): number` — already
  computed for every node at `GraphService` construction time (per 08B-01
  §4's citation) — this blueprint's dependency-tour ranking reuses this
  exact method, no new computation.
- `packages/core/src/enums.ts:23-35` `RELATIONS` — `"tests"` is a frozen
  relation; `packages/core/src/enums.ts:4-18` `NODE_KINDS` includes
  `"test"` — the test walkthrough tour (§8) walks `tests` edges from `test`
  nodes to their subject nodes exactly as these enums define, with no
  invented relation.
- ARCHITECTURE §3 row 11 (`GET /api/v1/tests`) already fixes the honesty
  wording this blueprint must match: `{ tests: ToolNode[]; observed:false;
  note:"not observed inspected" }` — the test walkthrough's narration reuses
  this **exact phrase** ("not observed inspected") for static test linkage,
  per this task's linkage-kind-honesty requirement and the TADORI non-
  negotiable "static test linkage is not runtime coverage."
- BACKLOG.md Phase 8 row 08-10 ("Large-repo performance... level-of-detail
  budgets") and ARCHITECTURE §10 (lines 470-472): `limit` caps per level
  are `package<=500, file<=500, symbol<=1000` — this blueprint's "bounded
  neighborhood" anti-hairball guarantee (§8) cites these exact numbers as
  its per-step ceiling, not a new invented budget.

**Files to read first:** `blueprints/08B-01-subsystem-overview-derivation.md`
(`Subsystem`/entry-point contract, this blueprint's entry-point tour input),
`blueprints/08B-02-tour-engine-progress.md` (`Tour`/`TourStep` engine
contract, this blueprint's construction target), `packages/fixtures/0{1,2,3}
-*/expected/graph.json` (ground truth for acceptance test step counts),
`packages/core/src/enums.ts` (frozen relations/kinds), ARCHITECTURE.md §10
(LOD budgets).

**Gotchas:** fixture 01 has zero routes — any acceptance test asserting a
nonzero route-tour step count on fixture 01 is wrong; the correct assertion
is tour absence. Fixture 02's two routes have **different confidence** —
do not write a test asserting both narrations are identical. All three
fixtures are single-package, so "package clustering" language from 08B-01
never produces multiple subsystems here — the dependency tour must not
assume multi-package input is available in the acceptance fixtures.

## 5. Scope

1. Entry-point tour builder: one step per identified entry point (08B-01's
   `Subsystem.entryPoints`), grouped by subsystem, in subsystem-then-fan-in
   order.
2. Route/request tour builder: one step-chain per route
   (route node -> handler -> callees, via compiler-origin edges only for
   the "chain continues" portion; the route->handler edge itself may be any
   origin/confidence, carried honestly into narration).
3. Dependency tour builder: steps over high-fan-in modules, package-level
   if `>1` package exists, symbol-level fallback otherwise.
4. Test walkthrough builder: one step per linked test, honest linkage-kind
   wording, "not observed inspected" for static-only linkage.
5. Recommended exploration sequence: deterministic ranking of the (present)
   tours.
6. Anti-hairball guarantee: every step's `focusEntityKeys` plus its
   rendered neighborhood stays within the cited LOD budgets.
7. Per-tour empty states with explicit UI wording.
8. Acceptance tests per tour type against fixtures 01/02/03 with exact
   expected step counts.

## 6. Non-goals

- No new tour engine mechanics (all four tours are `Tour` objects consumed
  by 08B-02's existing state machine — no new states, no new persistence
  format).
- No new relations, node kinds, or graph facts — every tour is built purely
  from relations/kinds already frozen in `packages/core/src/enums.ts`.
- No runtime tracing or dynamic call-graph data for the route/request tour
  — "callees" means statically-resolved `calls` edges only (frozen
  non-negotiable: no runtime tracing).
- No cross-tour merging or a combined "mega tour" — the four types are
  separate `Tour` objects; the recommended sequence (§8) orders which one
  to *offer first*, it does not concatenate their steps into one.
- No UI rendering of tour panels (viz-layer concern, not numbered yet).

## 7. Dependencies and prerequisites

- 08B-02: exact `Tour`/`TourStep` shape and the engine that consumes it —
  this blueprint's four builder functions return `Tour` objects matching
  that contract precisely, with no deviation.
- 08B-01 (transitively, via 08B-02's dependency chain): the entry-point
  tour directly consumes `RepoOverview.subsystems[].entryPoints` — if
  08B-01 is not yet implemented at build time, this blueprint's entry-point
  tour builder can still be written against the `Subsystem` type contract
  (already fixed, ARCHITECTURE §8) using a synthetic fixture, with the
  live-integration test deferred, same `BLOCKED:`-note pattern as prior
  blueprints.

## 8. Architectural decisions

**AD-08B03-1 — Entry-point tour: one step per entry point, subsystem-major
then fan-in-desc then entityKey-asc order.** Steps are built directly from
`RepoOverview.subsystems` (08B-01 output): for each subsystem in the
overview's already-sorted order (packageName ascending, per 08B-01 AD-
08B01-1's determinism), emit one `TourStep` per `entryPoints[]` entity, in
the order 08B-01 already produced them (rule-1/2/3 priority then fan-in
desc then entityKey asc, per 08B-01 AD-08B01-2). This tour builder adds
**no new ordering logic** of its own — it is a direct, order-preserving
flatten of `subsystems[].entryPoints`, keeping a single source of ordering
truth in 08B-01. `TourStep.narration` reuses the entry point's existing S3
sentence fragment (08B-01's template) rephrased as a per-step sentence:
`"{displayName} is an entry point of {packageName} ({entryPointKindLabel})."`
where `entryPointKindLabel` is `"route handler"` / `"bin entry"` /
`"exported symbol"` matching the AD-08B01-2 tag verbatim (never re-derived,
just displayed).

**AD-08B03-2 — Route/request tour: one step-chain per route, compiler-only
for the "and calls" continuation.** For each `route` node with an outgoing
`routes_to` edge (per 08B-01 AD-08B01-2 rule 1), build a **chain** of
steps:

1. **Step A (the route itself)**: `focusEntityKeys: [routeNode.entityKey]`,
   narration: `"{route.displayName} is a route defined in {file}:{line}."`
2. **Step B (the handler)**: `focusEntityKeys: [routeNode.entityKey,
   handlerNode.entityKey]` (both, so the camera centroid shows the edge),
   narration varies by the `routes_to` edge's own provenance — **never
   flattened**:
   - `origin === "compiler" && confidence === "certain"`: `"{route.displayName} routes to {handler.displayName}."`
   - otherwise (heuristic/likely, or any non-certain case): `"{route.displayName} likely routes to {handler.displayName} (heuristic match, not compiler-verified)."`
3. **Step C+ (callees, compiler-origin `calls` edges only, breadth-first,
   depth capped at 2)**: starting from the handler node, follow outgoing
   `calls` edges **where `origin === "compiler"`** only (heuristic/inferred
   `calls` edges are excluded from this chain-continuation step — the task
   instruction says "via compiler edges only" and this blueprint applies
   that restriction to the callee-chain continuation specifically, not to
   the route->handler edge in step B, which is allowed to be heuristic
   because that edge is what tells the user "here is the (possibly
   uncertain) connection," while the *chain* built on top of it must be on
   solid ground). One step per callee, `focusEntityKeys: [callerKey,
   calleeKey]`, narration: `"{caller.displayName} calls {callee.displayName}."`
   Depth cap of 2 hops from the handler bounds chain length (anti-hairball,
   §16). If the handler has zero outgoing compiler `calls` edges, the chain
   ends at step B — this is not an error, just a short chain.

Routes are ordered by their `routes_to` edge's `entityKey` ascending (stable
tie-break; no other ranking signal exists at the route level, per the
"deterministic ordering" requirement, and route count is expected to be
small enough that fan-in-based ranking would add no signal — every route
node has fan-in 0 or 1 by construction, one inbound edge from the router
registration, so fan-in cannot discriminate between routes).

**AD-08B03-3 — Dependency tour: package-level fan-in if >1 package exists,
symbol-level fallback otherwise.** Ranking rule, applied in this exact
priority:

1. If the snapshot's `RepoOverview.subsystems.length > 1` (multi-package,
   per 08B-01's clustering): rank subsystems by `Subsystem.fanIn`
   descending, tie-break `packageName` ascending; one `TourStep` per
   subsystem, `focusEntityKeys: [thatSubsystem's package node entityKey]`
   (or, for a merged subsystem, all member package-node entityKeys),
   narration: `"{packageName} has {fanIn} incoming references, the
   {ordinal} most depended-on subsystem in this repository."`
2. Else (single-package repo — **the case for all three current golden
   fixtures**): rank **exported** `function`/`method`/`class`/`interface`
   nodes by `GraphService.fanIn(entityKey)` descending, tie-break
   `entityKey` ascending, **top 10** (bounded — anti-hairball, §16); one
   `TourStep` per node, narration: `"{displayName} has {fanIn} incoming
   references within this repository."` If fewer than 10 qualifying nodes
   exist, all are taken (not an error — see fixture 01's 13 candidates,
   fixture 02's 12, fixture 03's 10, all of which exceed or meet 10 except
   none falling short, so this branch is exercised at its cap in all three
   fixtures; a smaller synthetic fixture in the unit tests exercises the
   "fewer than 10" branch explicitly).
3. If **zero** qualifying nodes exist at either granularity (e.g. a
   snapshot with a package node but no exported symbols and only one
   package): the dependency tour is **absent** (§17).

**AD-08B03-4 — Test walkthrough: one step per `test` node via `tests`
edges, honest linkage-kind wording.** For each `test` node with an outgoing
`tests` edge, build one `TourStep`: `focusEntityKeys: [testNode.entityKey,
subjectNode.entityKey]`, narration:

```
"{test.displayName} is linked to {subject.displayName} via static analysis
 ({originLabel}); this reflects declared test linkage, not observed
 inspected test coverage."
```

where `{originLabel}` is the edge's own `origin` field rendered plainly
(`"compiler"` / `"heuristic"` / `"doc"` / etc. — whatever the edge actually
carries, never overridden). The phrase **"not observed inspected"** is
carried verbatim from ARCHITECTURE §3 row 11's existing wording (this
blueprint does not invent new honesty language, it reuses the frozen
phrase). Tests are ordered by `entityKey` ascending (test nodes carry no
inherent ranking signal beyond identity; unlike routes/dependencies there
is no fan-in or confidence axis that would justify a different order).

**AD-08B03-5 — Recommended exploration sequence: deterministic ranking of
present tours by graph properties.** Given the set of tours that are
**present** (passed their own §17 non-empty check), order them:

```
1. entry_point   — always first when present (orientation before depth, matches R-01's "guide" framing)
2. route_request — second when present (concrete, user-facing behavior)
3. dependency    — third when present (structural depth)
4. test          — fourth when present (verification-layer, most niche)
```

This is a **fixed priority order**, not a graph-property-computed ranking —
restated honestly: the task description asks for "deterministic ranking of
tours by graph properties," and this blueprint's answer is that the
*ranking rule itself* is a fixed, principled sequence (orientation ->
behavior -> structure -> verification) applied uniformly, filtered to only
the tours that are present for this particular repository; graph
properties (route count, fan-in, test count) already determine **presence**
(§17), and *within* the dependency and route tours the individual steps are
already ranked by graph properties (fan-in, entityKey) per AD-08B03-2/3.
Rejected: ranking whole tour *types* against each other by a cross-type
metric like total step count — rejected because comparing "12 entry points"
against "2 routes" by raw count would rank tours by incidental graph size
rather than by what helps orientation first, and would produce an
unintuitive, size-dependent recommended order that changes for shallow
reasons (e.g., one extra test file flips test-walkthrough ahead of
dependency-tour). The fixed sequence is simpler, stable, and matches the
"guide" framing's natural progression.

## 9. Exact file plan

- `packages/mcp/src/tours/entryPointTour.ts` — **create**. Exports
  `buildEntryPointTour(overview: RepoOverview): Tour | null` (`null` = §17
  absence case).
- `packages/mcp/src/tours/routeTour.ts` — **create**. Exports
  `buildRouteTour(service: GraphService): Tour | null`.
- `packages/mcp/src/tours/dependencyTour.ts` — **create**. Exports
  `buildDependencyTour(service: GraphService, overview: RepoOverview): Tour | null`.
- `packages/mcp/src/tours/testTour.ts` — **create**. Exports
  `buildTestTour(service: GraphService): Tour | null`.
- `packages/mcp/src/tours/index.ts` — **create**. Exports
  `buildAllTours(service, overview): Tour[]` (filters out `null`s) and
  `recommendedTourOrder(tours: Tour[]): Tour[]` (AD-08B03-5's fixed
  priority filter/sort).
- `packages/mcp/src/index.ts` — **modify**. Barrel-export the `tours/index.js`
  surface (additive).
- `packages/mcp/test/tours/entryPointTour.test.ts`,
  `.../routeTour.test.ts`, `.../dependencyTour.test.ts`,
  `.../testTour.test.ts`, `.../recommendedOrder.test.ts` — **create**.
  Acceptance tests against fixtures 01/02/03 with exact step counts (§13).
- `packages/server/src/routes/tour.ts` — **modify** (from 08B-02; this
  blueprint's addition is the tour **catalog** — the previously-deferred
  "no id param" behavior in 08B-02 §10 is resolved here: `GET /api/v1/tour`
  with no `id` returns the first tour in `recommendedTourOrder`, matching
  ARCHITECTURE §3 row 17's `id?` optionality).

## 10. Exact contracts

No new top-level types beyond ARCHITECTURE §8's `Tour`/`TourStep`
(restated in 08B-02 §10) — this blueprint's contracts are the builder
function signatures:

```ts
function buildEntryPointTour(overview: RepoOverview): Tour | null;
function buildRouteTour(service: GraphService): Tour | null;
function buildDependencyTour(service: GraphService, overview: RepoOverview): Tour | null;
function buildTestTour(service: GraphService): Tour | null;

function buildAllTours(service: GraphService, overview: RepoOverview): Tour[];
function recommendedTourOrder(tours: Tour[]): Tour[];   // AD-08B03-5 fixed sequence, filtered to present tours
```

`Tour.id` values (fixed literals, one per builder, used by `GET /api/v1/
tour?id=`): `"entry_point"`, `"route_request"`, `"dependency"`, `"test"` —
these match `TourKind` exactly (one tour instance per kind in this
blueprint's scope; a future blueprint could allow multiple tours of the
same kind, out of scope here).

`Tour.deterministicSeed` (per ARCHITECTURE §8, already a required field):
set to the tour's `id` string itself for all four builders — sufficient
because these builders have no random component to seed; the field exists
in the type for tours that might need one, and a fixed non-empty string
satisfies the schema without inventing meaningless entropy.

**Server endpoint completion (extends 08B-02 §10):**

```ts
// GET /api/v1/tour            (no id param)
// 200 -> { context: ApiContext; tour: Tour; stepAvailability: StepAvailability[] }
//        tour = recommendedTourOrder(buildAllTours(service, overview))[0]
// 404 -> ApiError { code: "no_tours_available" }   // buildAllTours returns [] (every tour type absent)

// GET /api/v1/tours            (NEW, catalog listing — additive to ARCHITECTURE §3, owner 08B-03)
// 200 -> { context: ApiContext; tours: { id: string; kind: TourKind; title: string; stepCount: number; present: true }[];
//          absentTours: { kind: TourKind; reason: string }[] }   // §17's exact absence reasons
```

## 11. Ordered implementation procedure

1. Write `packages/mcp/test/tours/entryPointTour.test.ts` against a
   synthetic `RepoOverview` fixture (2 subsystems, 3 total entry points) —
   failing assertions for step count/order. Run `pnpm test` — fails (module
   absent).
2. Implement `buildEntryPointTour` (AD-08B03-1: flatten
   `subsystems[].entryPoints` in existing order). Test green. Add the
   fixture-02-derived integration case (needs 08B-01's real
   `deriveRepoOverview` output — if 08B-01 not yet built, use its type
   contract with a hand-built `RepoOverview` literal matching fixture 02's
   expected entry points, and note the deferred live-integration check as
   `ASSUMPTION:` in the eventual builder report).
3. Implement `buildRouteTour` against fixture 02 (2 routes, one
   compiler/certain, one heuristic/likely) and fixture 01 (0 routes ->
   `null`). Test: assert fixture 02 produces exactly 2 route chains, the
   compiler-origin one uses the plain narration template, the heuristic one
   uses the hedged template; assert fixture 01 returns `null`.
4. Implement `buildDependencyTour` against all three fixtures (single-
   package -> symbol-level fallback, top-10-or-fewer). Test: fixture 01 (13
   candidates -> 10 steps), fixture 02 (12 candidates -> 10 steps), fixture
   03 (10 candidates -> exactly 10 steps, the boundary case). Add one
   synthetic multi-package fixture exercising the package-level branch (>1
   subsystem) and one synthetic <10-candidate fixture exercising the
   "fewer than 10, take all" branch.
5. Implement `buildTestTour` against all three fixtures (3, 2, 2 test nodes
   respectively -> 3, 2, 2 steps). Test: assert the "not observed
   inspected" phrase appears verbatim in every step's narration.
6. Implement `buildAllTours`/`recommendedTourOrder` (AD-08B03-5). Test:
   fixture 01 (no routes) -> recommended order is
   `[entry_point, dependency, test]` (route_request filtered out); fixtures
   02/03 (routes present) -> full `[entry_point, route_request, dependency,
   test]` order.
7. Barrel-export; wire `packages/server/src/routes/tour.ts`'s no-id and new
   `/tours` catalog behavior (defer with `BLOCKED:` note if 07-01/08B-02's
   server scaffold pieces are not yet built).
8. Run full validation gate (§15).

## 12. Data and lifecycle flows

**Route tour chain-building flow (per route):** `route` node -> outgoing
`routes_to` edge (any origin) -> handler node (step B) -> outgoing `calls`
edges filtered to `origin === "compiler"` -> breadth-first, depth <= 2 ->
each traversed edge becomes one step (step C, D, ...) -> chain ends when
depth cap reached or no more compiler-origin outgoing `calls` edges exist.

**Tour-catalog request flow:** `GET /api/v1/tours` -> server calls
`deriveRepoOverview(service)` (08B-01) once -> `buildAllTours(service,
overview)` -> `recommendedTourOrder(...)` for display order -> for each
absent tour type, the corresponding builder's `null` return is paired with
its §17 reason string in `absentTours`.

**No refresh-triggered rebuild**: tours are derived fresh per request from
the current `GraphService` (same pattern as 08B-01's overview) — no caching
layer, no staleness beyond what the underlying snapshot's own
freshness/`ApiContext` already communicates.

## 13. Test plan

**Entry-point tour:** synthetic 2-subsystem `RepoOverview` (3 entry
points total) -> exactly 3 steps in subsystem-then-priority-then-fan-in
order; zero-entry-point overview (all subsystems have `entryPoints: []`)
-> `buildEntryPointTour` returns `null`.

**Route tour, exact fixture-derived counts:**
- Fixture 01 (0 routes): `buildRouteTour` returns `null`.
- Fixture 02 (2 routes, 1 compiler/certain + 1 heuristic/likely, handler
  fan-out to callees unknown until read): assert exactly 2 chains; assert
  chain 1 (compiler route) uses the plain "routes to" narration; assert
  chain 2 (heuristic route) uses the hedged "likely routes to... not
  compiler-verified" narration; assert each chain's step count is
  `>= 2` (route step + handler step, plus 0+ callee steps depending on the
  fixture's actual `calls` edges from each handler — assert against the
  fixture's real edge data, not a guessed count, since callee fan-out
  depends on fixture content not independently re-derived here).
- Fixture 03 (5 routes): assert exactly 5 chains, each starting with a
  route step and a handler step at minimum.

**Dependency tour, exact fixture-derived counts:**
- Fixture 01: 13 fan-in candidates (6 function + 4 method + 3 class, all
  exported — verify exported filter against real fixture data in the test,
  do not assume all 13 are exported without checking) -> capped at 10
  steps.
- Fixture 02: 12 candidates -> capped at 10 steps.
- Fixture 03: 10 candidates -> exactly 10 steps (cap boundary, not
  triggered/not exceeded — assert this exact edge case).
- Synthetic <10-candidate fixture: assert all candidates included, no
  padding.
- Synthetic multi-package fixture (reused from 08B-01's synthetic
  clustering test, 2 subsystems): assert package-level branch fires
  (2 steps, one per subsystem, ranked by `Subsystem.fanIn` desc).

**Test walkthrough, exact fixture-derived counts:**
- Fixture 01: 3 test nodes, 2 `tests` edges -> assert step count equals the
  **edge** count (2), not the node count (3) — a `test` node with no
  outgoing `tests` edge produces no step (nothing to link it to); this is
  an intentional distinction verified directly against fixture data in the
  test (do not assume all test nodes have a linking edge).
- Fixture 02: 2 test nodes, 1 `tests` edge -> 1 step.
- Fixture 03: 2 test nodes, 1 `tests` edge -> 1 step.
- Every step's narration contains the exact substring `"not observed
  inspected"`.

**Recommended order:**
- Fixture 01 (route tour absent) -> `["entry_point", "dependency", "test"]`
  (order preserved, route_request missing).
- Fixture 02/03 (route tour present) -> `["entry_point", "route_request",
  "dependency", "test"]`.

**Anti-hairball assertion (all tours, all fixtures):** for every
`TourStep` produced by any of the four builders, assert
`focusEntityKeys.length` stays within a small bounded neighborhood — this
blueprint's own steps use at most 2-3 explicit focus keys per step (route
tour chains touch 2 nodes per step, dependency/test steps touch 1-2), well
under the ARCHITECTURE §10 per-level `limit` ceilings (`package<=500,
file<=500, symbol<=1000`) that bound what the *viz layer* additionally
loads around a focused step — assert no builder ever requests an unbounded
expansion (e.g. no builder emits a step with `focusEntityKeys` derived from
an entire unfiltered node list).

**Regression:** full existing suite stays green; no golden fixture
modified.

## 14. Acceptance criteria

- [ ] Fixture 01 (0 routes): route tour is absent (`null`), entry-point/
      dependency/test tours are present with exact step counts asserted
      above.
- [ ] Fixture 02 (2 routes, mixed confidence): route tour has exactly 2
      chains with narration honestly distinguishing compiler-certain from
      heuristic-likely provenance — verbatim assertion, not a loose
      substring check on the confidence-sensitive portion.
- [ ] Fixture 03 (5 routes): route tour has exactly 5 chains.
- [ ] Dependency tour step count matches the exact fixture-derived
      candidate counts (13->10, 12->10, 10->10) with the top-10 cap
      verified at the exact boundary case (fixture 03).
- [ ] Test walkthrough step count equals `tests`-edge count, not
      `test`-node count, per fixture (2, 1, 1) — and every narration
      contains the verbatim phrase "not observed inspected."
  - [ ] Recommended order omits `route_request` exactly when the route
      tour is absent (fixture 01) and includes it in the fixed position
      otherwise (fixtures 02/03).
- [ ] No `TourStep` in any of the four tour types exceeds a small,
      explicitly-asserted `focusEntityKeys` bound (anti-hairball).
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass with zero new
      failures; no golden fixture modified.

## 15. Validation commands

pnpm skills:check; pnpm typecheck; pnpm lint; pnpm test;
python validate_fixtures.py; pnpm fixtures:validate; pnpm fixtures:index;
pnpm fixtures:typecheck; git diff --check; git status --short

## 16. Performance budgets

Each tour builder runs once per `/api/v1/tours` (or `/tour`) request,
in-memory over already-loaded `GraphService` data — no new DB queries. The
route tour's callee BFS is capped at depth 2, bounding its cost to
`O(routes * avg_fan_out^2)`, trivial at fixture scale and bounded at
real-repo scale by the same 08-10 performance envelope every other
derived-data endpoint operates under. Dependency tour's top-10 selection
is `O(n log n)` over exported symbol count — bounded, not `O(n^2)`. Target:
`< 100ms` for `buildAllTours` at the 08-10 cold-load ceiling (informal
wall-clock assertion in tests, `< 300ms` hard CI ceiling to avoid runner
flakiness, consistent with 08B-01's stated budget pattern).

## 17. Failure and recovery behavior

**Per-tour absence, exact required UI wording (each builder's `null` return
is paired with this reason string wherever the catalog surfaces it):**

- Entry-point tour absent (zero entry points across all subsystems):
  `"No entry points could be identified in this repository."`
- Route/request tour absent (zero route nodes, fixture 01's exact case):
  `"This repository has no HTTP routes, so no route tour is available."`
- Dependency tour absent (zero exported symbols and only one package, no
  package-level candidates either): `"No dependency relationships were
  found to build a dependency tour."`
- Test walkthrough absent (zero `tests` edges, even if `test` nodes exist
  with no linkage): `"No linked tests were found, so no test walkthrough is
  available."`

**All four tours absent simultaneously**: `GET /api/v1/tour` (no id)
returns `404 no_tours_available`; `GET /api/v1/tours` still returns `200`
with `tours: []` and all four reasons populated in `absentTours` — the
catalog endpoint itself never 404s, since "here is why nothing is
available" is itself useful information, matching this task's "empty state
says so explicitly" honesty constraint.

**A step whose focus entity vanishes after snapshot replacement**: handled
entirely by 08B-02's engine (AD-08B02-6); this blueprint's tour builders
are re-run fresh on the new snapshot on the next catalog request, so a
rebuilt tour naturally reflects the current graph — the *engine's*
vanished-anchor handling only matters for a tour object that was already
being displayed at the moment of replacement, before the client re-fetches.

**Malformed/missing route provenance fields**: cannot occur — `origin`/
`confidence`/`resolution` are non-optional on `GraphEdge`
(`packages/core/src/graph.ts:74-76`), so the route tour's provenance-
sensitive narration branch always has a value to branch on.

## 18. Security and privacy

No new I/O beyond what 08B-01/08B-02 already load. No new file reads. No
network calls. Narration text contains only already-loaded `displayName`/
`file`/line data, same confinement as every other derived-text surface in
Phase 8B.

## 19. Accessibility

Every tour step's narration is a complete plain-language sentence (per
08B-02 §19's `aria-live`-ready contract). The route tour's provenance
hedging ("likely routes to... not compiler-verified") is itself an
accessibility-relevant honesty signal — a screen-reader user gets the same
uncertainty information a sighted user would get from a dashed-line legend
(ARCHITECTURE §10's provenance edge legend), stated in words instead of
relying on line style alone.

## 20. Documentation updates

None beyond this blueprint file itself (INDEX.md/BACKLOG.md untouched
during drafting, per this task's instructions). The eventual builder
updates `IMPLEMENTATION_STATUS.md` and flips INDEX.md/BACKLOG.md status at
build time.

## 21. Builder final report

Require: summary; files changed; contracts implemented (confirm all four
builders return `Tour | null` matching ARCHITECTURE §8's `Tour` shape
exactly); tests added (names + count); exact step-count evidence per
fixture (paste the asserted numbers: route 0/2/5, dependency 10/10/10,
test 2/1/1); validation results; commit SHA; known limitations (e.g.
recommended-order is a fixed sequence, not a computed graph-property
ranking — restate the rationale from AD-08B03-5); follow-on risks;
`ASSUMPTION:` lines.

## 22. Independent review result

Pending Wave 3 adversarial review.

## IF SOMETHING IS UNCLEAR

Make the smallest safe assumption, record `ASSUMPTION: ...` in the report,
continue without expanding scope. If the uncertainty could violate a frozen
contract (e.g. any tour narration that would flatten confidence/origin
distinctions, or any step exceeding the anti-hairball bound), stop that
item and report blocked.

## TADORI NON-NEGOTIABLES (every blueprint)

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
