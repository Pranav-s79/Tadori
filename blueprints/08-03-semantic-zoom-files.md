# BLUEPRINT 08-03: Semantic zoom — file expansion

## 1. Header

- ID / Title / Phase: 08-03 — Semantic zoom: file expansion — Phase 8
- Status: review
- Primary builder: Claude Sonnet — single-interaction extension of an
  existing scaffold; contract fully closed by ARCHITECTURE.md §10 and
  08-01's persistence model.
- Reviewer roles: Spec Guardian (anti-hairball / progressive-disclosure
  compliance), Test Adversary (byte-stability of unexpanded nodes,
  collapse-restore exactness), Implementation Reviewer (edge-aggregation
  correctness).
- Complexity: M (one focused builder session)
- Depends on: 08-02 (`apps/viz` scaffold, package map canvas, HTTP/WS
  client, state model, legend — this blueprint extends that canvas, it does
  not build a new one), 08-01 (this blueprint's expansion reads
  `abstraction_level='file'` rows; if absent for the requested package,
  07-01's `/api/v1/layout?level=file` triggers 08-01's engine to
  materialize them on first request, per AD-005 — this blueprint is a
  consumer of that contract, not an implementer of it).
- Unlocks: 08-04 (symbol-level zoom is the next expansion step on a file,
  reusing this blueprint's expand/collapse state machine), 08-07 (route/test
  displays reference file-level nodes surfaced here), 08-10 (file-level
  budgets feed the large-repo performance gate).
- Estimated sessions: 1
- Related frozen-spec sections: ARCHITECTURE.md §10 "Viz data-loading
  contract" (three frozen zoom levels, level 2 = file expansion, "no global
  movement"), §6 (layout persistence, `abstraction_level='file'` rows);
  BACKLOG.md row 08-03; frozen non-negotiable "progressive disclosure
  package → file → task-region symbols."

## 2. Objective

Clicking (or keyboard-activating) a package hull in the base map expands it
in place to show that package's file-level nodes at deterministic positions
read from `layout_positions` (`abstraction_level='file'`), with edges
between the expanded package and every other (still-collapsed) package
aggregated into a single summary edge per relation carrying a provenance
breakdown; collapsing restores the exact prior view; no other package's
node ever moves during this operation.

## 3. Why this matters

- User value: this is the second of exactly three zoom levels the frozen
  spec promises — the mechanism that turns "one flat overwhelming view"
  (the Graphify failure mode, R-01 §2) into a navigable, memorizable space.
- System value: establishes the expand/collapse state machine and the
  edge-aggregation rule that 08-04 reuses verbatim for the symbol level,
  and that 08-07/08-09 render on top of without re-deriving aggregation
  logic themselves.
- Downstream: 08-10's "positions byte-identical across reloads" gate
  explicitly includes this blueprint's expanded state; 08-11's keyboard
  accessibility audit targets this blueprint's expand/collapse interaction
  as a named keyboard-reachable action.

## 4. Current repository evidence

**Verified current (2026-07-17):**

- ARCHITECTURE.md §10, level 2: "File level (on package expand): `GET
  /api/v1/nodes?level=file&packageName=X` + `GET /api/v1/layout?level=file`
  — **no global movement** (positions are read from store, Section 6)." This
  is the exact endpoint pair this blueprint calls; both are owned/served by
  07-01, not built here.
- ARCHITECTURE.md §3 row 4: `GET /api/v1/nodes` params include
  `level=package|file|symbol`, `packageName?`, `cursor?`, `limit<=500` for
  file level (same cap family as package level). Row 5: `GET /api/v1/edges`
  params `relation?`, `origin?`, `confidence?`, `resolution?`, `srcKey?`,
  `dstKey?`, `limit<=1000`.
- ARCHITECTURE.md §6 (restated from 08-01): `layout_positions` rows for
  `abstraction_level='file'` are materialized by 08-01's engine on first
  request for a given package's files (server-triggered, not client-
  triggered — this blueprint's client only ever issues a `GET`, it never
  computes or requests computation of a layout directly).
- 08-01 (this planning batch, sibling blueprint) establishes: existing
  frozen node positions never move on new-node arrival (package-centroid +
  bounded local relaxation, scoped to the *new* node only). This blueprint
  depends on that exact guarantee holding across the package→file boundary:
  expanding package X must materialize file positions *for X's files only*
  and must not touch `abstraction_level='package'` rows for any package
  (including X itself — the package hull's own anchor position does not
  move when its contents are revealed).
- 08-02 (sibling blueprint) establishes the state model: "React owns view
  state (current level, selection, open panels...)." This blueprint adds
  exactly one more piece of React-owned view state: the set of currently
  expanded package ids. It does not touch server-owned data/layout state
  ownership.
- `packages/core/src/enums.ts:20-26` — frozen `RELATIONS` (11 total:
  `contains, imports, exports, references, calls, implements, extends,
  tests, routes_to, documents, changed_with`) is the enum edge aggregation
  groups by (§8 below: aggregation is per-relation, never merging two
  different relations into one summary edge).
- No file under `apps/viz` yet performs any expand/collapse logic (08-02 is
  package-level-only by its own non-goals) — this is genuinely new surface,
  not a refactor of existing code.

**PROPOSED (this blueprint):** every file in §9; no server-side or store-
side files (all data is served by already-contracted 07-01/08-01 endpoints).

Files to read first: `blueprints/08-02-viz-package-map.md` §8-§10 (state
model, hand-ported types, `PackageMapCanvas.tsx`'s shape as this blueprint
extends it), `blueprints/08-01-layout-engine-persistence.md` §8 (new-node
placement guarantee this blueprint relies on), ARCHITECTURE.md §10.

Gotchas: "no global movement" must be enforced as a **tested invariant**,
not just an intent — a naive re-layout-on-expand implementation (e.g.
recomputing the whole graph's force layout including the newly-visible file
nodes) would silently violate it. This blueprint's canvas code must add
file-level nodes/edges to the existing graphology graph **without**
touching any existing node's position attribute.

## 5. Scope

1. Expand interaction: activating a package hull (click or keyboard) fetches
   that package's file-level nodes + `abstraction_level='file'` layout
   positions and adds them to the canvas inside the package's existing hull
   region, without altering any other node's position.
2. Collapse interaction: re-activating an expanded package removes its
   file-level nodes/edges from the canvas and restores the exact prior
   view (the package hull alone, at its unchanged position).
3. Edge aggregation rule: edges between an expanded package's files and
   nodes in a still-collapsed package are drawn as one aggregated summary
   edge per `(srcPackage, dstPackage, relation)` triple, annotated with a
   count and a provenance breakdown (counts per `origin`/`confidence`/
   `resolution` combination present in the aggregated set).
4. Edges wholly *within* an expanded package (file-to-file) render as
   individual edges (no aggregation needed — the point of aggregation is
   avoiding a hairball at the boundary between expanded detail and
   collapsed summary, not hiding detail the user just asked to see).
5. Label budget for file-level nodes (this blueprint sets the number,
   since 08-02 only set it for package labels).
6. Multiple simultaneously expanded packages (the interaction is
   per-package, not exclusive — expanding package B does not collapse
   package A).
7. Byte-stability assertion: expanding/collapsing must never change the
   `x`/`y` of any node not belonging to the expanded package, verified by
   test.

## 6. Non-goals

- No symbol-level rendering (08-04 — that is the *third* zoom level, only
  reachable by expanding *within* an already-expanded file, not from this
  blueprint's package-level expand action).
- No search integration (08-05).
- No inspection panels on file nodes (08-06) — this blueprint renders file
  nodes on the canvas; clicking one for detailed inspection is 08-06's
  surface, though this blueprint must at minimum track "which node is
  selected" as already-scoped React view state from 08-02 (no new state
  shape invented here beyond the expanded-set).
- No re-running of the force layout algorithm at expand time — file
  positions are **read**, never (re)computed by this blueprint (08-01 owns
  computation, triggered server-side on first request only).
- No animation/transition requirement beyond "not jarring" — this blueprint
  does not mandate a specific easing curve or duration; a reasonable
  transition (or none) is an implementation detail left to the builder, not
  a frozen contract.
- No change to the package-level hull shape/label logic from 08-02 beyond
  what is strictly needed to host expanded content inside it.

## 7. Dependencies and prerequisites

- **08-02**: `PackageMapCanvas.tsx`, `buildGraphologyGraph.ts`,
  `apps/viz/src/api/client.ts`, `apps/viz/src/api/types.ts`,
  `apps/viz/src/legend.ts` must exist with the exact shapes documented in
  that blueprint's §9/§10 — this blueprint imports and extends them, it
  does not duplicate them.
- **08-01**: `layout_positions` `abstraction_level='file'` rows must be
  producible by the engine described there (this blueprint never calls
  08-01's code directly — AD-009 forbids it — it only relies on 07-01's
  `/api/v1/layout?level=file` contract being backed by that engine).

## 8. Architectural decisions

- **Expansion is additive to the existing graphology graph instance, never
  a graph rebuild.** On expand, file nodes/edges are added via `addNode`/
  `addEdge` to the *same* `graphology.Graph` object `PackageMapCanvas`
  already holds; package-level nodes already in the graph are never
  removed or re-added (removal-then-re-add is a common source of
  accidental position loss — Sigma/graphology attribute state lives on the
  node key, and re-adding a node with the same key but omitting its `x`/`y`
  attributes would silently reset its position to a default). Rejected:
  rebuilding the whole graph from a merged node/edge list on every
  expand/collapse — rejected specifically because it is the failure mode
  most likely to violate "no global movement" by accident (any bug in the
  merge logic touches every node, not just the newly-expanded ones).
- **Expanded-package state: `Set<string>` of package entity keys, held in
  React state, added to (not replacing) 08-02's existing view-state shape.**
  `expandedPackages: Set<string>`. A package's file nodes are fetched and
  added to the graph when its key enters the set; removed from the graph
  when its key leaves the set. This mirrors 08-02's existing state-ownership
  split exactly: the *set membership* is view state (React), the *positions*
  of whatever is currently shown are always a direct read from the
  server's layout endpoint (never cached/recomputed client-side).
- **Fetch-once-per-expand-session, not fetch-on-every-render.** A package's
  file nodes/edges/layout are fetched when it is first expanded in a given
  page load and cached (in a plain `Map` outside React state, or a
  `useRef`-held cache — not `useState`, since this is a data cache, not
  view state) so re-expanding after a collapse in the same session does not
  re-fetch. A full page reload always re-fetches (matches 08-02's "reload
  re-fetches identical data" principle) rather than persisting expand state
  across reloads (expand/collapse is ephemeral view state, not durable
  layout state — durable state is exactly and only what `layout_positions`
  stores).
- **Collapse removes exactly the added nodes/edges, restoring the prior
  view by construction, not by snapshotting-and-restoring a serialized
  state.** Because expand is purely additive (previous bullet) and nothing
  else is touched, collapse's implementation is the literal inverse:
  `removeNode`/`removeEdge` for every entity added during that package's
  expand. This is why "collapse restores identical state" is true by
  construction rather than needing a separate restore mechanism — there is
  no snapshot to diverge from the live graph.
- **Edge aggregation: computed client-side from already-fetched raw edges,
  not a new server endpoint.** When package X is expanded and package Y is
  not, any edge in the fetched edge set whose src is a file in X and whose
  dst is a node in Y (or vice versa) is grouped by `(srcPackageKey,
  dstPackageKey, relation)` into one aggregate edge with `count` and a
  `provenanceBreakdown: {origin, confidence, resolution, count}[]`
  (deduplicated combination counts). Rationale: 07-01's endpoints already
  return raw edges with full provenance fields (AD-008, reused
  `toolEdgeSchema` shape) — aggregation is a pure client-side reduction
  over data already on hand, not a reason to add a new API shape 07-01
  must additionally implement and version. Rejected: a server-side
  `/api/v1/edges/aggregated` endpoint — rejected as premature: the
  aggregation is O(edges-at-the-boundary), not O(whole-graph), well within
  client-side budget at the file-level node/edge caps already in place
  (500 nodes / 1000 edges per level, ARCHITECTURE.md §3), and a second
  endpoint shape is exactly the kind of API surface growth the six-tool /
  minimal-server-surface discipline (AD-002) argues against adding without
  a proven need.
- **Aggregation never merges relations.** A `(srcPackage, dstPackage)` pair
  with both `imports` and `calls` edges crossing the boundary renders as
  **two** aggregate edges (one per relation), each with its own count and
  provenance breakdown — never a single merged "N edges" summary that hides
  which relations are present. Rationale: relation identity is itself part
  of the frozen provenance/evidence discipline ("every visible relation
  keeps evidence, origin, confidence, resolution") — collapsing relation
  identity in aggregation would be a silent information loss the
  non-negotiables forbid.
- **Intra-package edges (file-to-file, both ends inside the same expanded
  package) are never aggregated** — they render individually, same as any
  fully-collapsed-level edge would. Aggregation exists only to prevent a
  hairball at the collapsed/expanded seam; it does not apply where the
  user has already asked to see full detail.
- **Label budget for file nodes: file basename only (not full path),
  truncated to 20 characters with ellipsis** (shorter than 08-02's 24-char
  package-label budget, since file nodes are denser on screen inside a
  hull than package hulls are on the base map — a smaller per-node label
  budget keeps the expanded region legible). Full path is always available
  via the (08-06-owned) inspection panel and the node's title/tooltip
  attribute set here.
- **Node/edge count budget per single package expansion: reuses the
  documented per-level cap verbatim (`limit<=500` nodes, `limit<=1000`
  edges, ARCHITECTURE.md §3).** If a package's file count exceeds the
  page size, this blueprint's fetch follows `nextCursor` pagination (same
  opaque-cursor mechanism 08-02 already implements for package level) up to
  a **client-side hard stop at 500 files displayed**, past which an honest
  omission indicator is shown ("N files not shown" — plain count, no
  attempt to summarize which N) rather than silently paginating forever or
  silently truncating without saying so. This mirrors 08-02's §8 "beyond-
  budget" honest-indicator pattern, applied at file level.

## 9. Exact file plan

- `apps/viz/src/graph/expansion.ts` — create. Pure functions:
  `computeAggregatedEdges(rawEdges, expandedPackageKeys, allNodePackageOf)`
  (the aggregation reducer from §8), `diffExpandedNodes(prevExpanded,
  nextExpanded)` (which package keys were added/removed, drives which
  fetch/add or remove calls happen).
- `apps/viz/src/hooks/usePackageExpansion.ts` — create. Owns
  `expandedPackages: Set<string>`, the per-session fetch cache
  (`useRef<Map<string, {nodes, edges, positions}>>`), `expand(packageKey)`,
  `collapse(packageKey)`, `isExpanded(packageKey)`.
- `apps/viz/src/graph/PackageMapCanvas.tsx` — modify. Wires
  `usePackageExpansion` into the existing render loop: on `expand`, calls
  `addNode`/`addEdge` for the newly fetched file entities (positioned from
  the fetched layout) plus the computed aggregate edges, and removes any
  now-superseded raw collapsed-level edges that the aggregate replaces; on
  `collapse`, calls the inverse `removeNode`/`removeEdge`. Adds
  click/keyboard (`Enter`/`Space` when a hull has focus) handlers invoking
  `expand`/`collapse`.
- `apps/viz/src/api/client.ts` — modify (additive): add
  `fetchFileNodes(packageName, cursor?)`, `fetchFileEdges(packageName)`,
  `fetchLayout("file")` variant call (the existing `fetchLayout(level)`
  from 08-02 already takes a level parameter — this blueprint is the first
  caller to pass `"file"`, no signature change needed).
- `apps/viz/src/api/types.ts` — modify (additive): `AggregatedEdge`
  interface (§10).
- `apps/viz/test/expansion.test.ts` — create. Aggregation reducer unit
  tests.
- `apps/viz/test/usePackageExpansion.test.ts` — create. Expand/collapse
  state machine tests, including the byte-stability assertion.
- `apps/viz/test/expand-collapse-canvas.test.tsx` — create. Integration
  test against `PackageMapCanvas` with mock data: expand -> assert other
  packages' node positions unchanged; collapse -> assert graph node/edge
  count returns to pre-expand count exactly.

## 10. Exact contracts

```ts
// apps/viz/src/api/types.ts (additive)
export interface AggregatedEdge {
  srcPackageKey: string;
  dstPackageKey: string;
  relation: string;              // one of the 11 frozen RELATIONS values
  count: number;
  provenanceBreakdown: {
    origin: Origin;
    confidence: Confidence;
    resolution: Resolution;
    count: number;
  }[];
}

// apps/viz/src/graph/expansion.ts
export function computeAggregatedEdges(
  rawEdges: ApiEdge[],
  expandedPackageKeys: ReadonlySet<string>,
  packageOfNode: (entityKey: string) => string | null
): AggregatedEdge[];
// Rule: an edge is aggregated iff at least one endpoint's package is NOT
// in expandedPackageKeys (i.e. it crosses an expanded/collapsed boundary,
// or both ends are in different collapsed packages — already-collapsed
// package-to-package edges from 08-02 are themselves a degenerate case of
// this same function with expandedPackageKeys empty). Edges with both
// endpoints' packages in expandedPackageKeys AND those endpoints being the
// SAME expanded package are excluded (rendered individually, not
// aggregated, per §8).

export function diffExpandedNodes(
  prev: ReadonlySet<string>,
  next: ReadonlySet<string>
): { added: string[]; removed: string[] };

// apps/viz/src/hooks/usePackageExpansion.ts
export interface PackageExpansionState {
  expandedPackages: ReadonlySet<string>;
  isExpanded(packageKey: string): boolean;
  expand(packageKey: string): Promise<void>;
  collapse(packageKey: string): void;
}
export function usePackageExpansion(): PackageExpansionState;
```

## 11. Ordered implementation procedure

1. `apps/viz/src/api/types.ts`: add `AggregatedEdge`. Typecheck passes
   (additive only).
2. `apps/viz/test/expansion.test.ts`: write failing tests for
   `computeAggregatedEdges` covering (a) a boundary edge between an
   expanded and a collapsed package aggregates by relation with correct
   count/provenance breakdown, (b) two different relations crossing the
   same package pair produce two separate aggregate edges, (c) an
   intra-expanded-package edge is excluded from aggregation output
   entirely (it is expected to render individually elsewhere), (d) an
   edge between two different collapsed packages aggregates (baseline
   08-02 behavior, now expressed through this shared function). Expected:
   fails (function doesn't exist).
3. `apps/viz/src/graph/expansion.ts`: implement `computeAggregatedEdges`
   and `diffExpandedNodes`. Expected: step-2 tests pass.
4. `apps/viz/src/api/client.ts`: add `fetchFileNodes`/`fetchFileEdges`
   against the mock server contract (extend `apps/viz/test/mockServer.ts`
   from 08-02 with file-level fixture data for at least two packages).
   Expected: fetch functions return typed data against the mock.
5. `apps/viz/test/usePackageExpansion.test.ts`: write failing tests: (a)
   `expand(pkg)` populates `expandedPackages` and returns file data from
   the mock fetch, (b) `collapse(pkg)` removes it from the set, (c)
   re-`expand`ing a previously-expanded-then-collapsed package in the same
   session does not issue a second fetch call (assert mock fetch call
   count), (d) expanding two different packages leaves both in the set
   simultaneously. Expected: fails.
6. `apps/viz/src/hooks/usePackageExpansion.ts`: implement per §8 (cache in
   a ref, not state). Expected: step-5 tests pass.
7. `apps/viz/src/graph/PackageMapCanvas.tsx`: wire in `usePackageExpansion`;
   implement additive `addNode`/`addEdge` on expand and inverse `removeNode`/
   `removeEdge` on collapse; add click + keyboard (`Enter`/`Space`)
   activation on package hulls. Expected: manual smoke render works against
   mock data (folded into the integration test next).
8. `apps/viz/test/expand-collapse-canvas.test.tsx`: write and pass the
   byte-stability + collapse-restores-exact-state tests: render canvas with
   3 mock packages -> record all node `x`/`y` -> expand package A -> assert
   packages B/C's node positions are `Object.is`-unchanged and package A's
   own hull-anchor position is unchanged -> collapse package A -> assert
   graph's total node count and every remaining node's position exactly
   match the pre-expand snapshot. Expected: passes once step-7 is correct;
   this test is the one most likely to catch an accidental full-graph
   rebuild regression.
9. Label truncation (20 chars) applied in the file-node rendering path
   inside `PackageMapCanvas.tsx`; add a focused unit test for the
   truncation function (reuses or parallels 08-02's label-truncation
   helper — if 08-02 exported a generic `truncateLabel(text, maxLen)`
   helper, this blueprint reuses it with a different `maxLen` argument
   rather than duplicating the logic; if 08-02 did not export one as a
   standalone function, this blueprint extracts it as a small additive
   change to `apps/viz/src/graph/PackageMapCanvas.tsx` shared by both
   label call sites).
10. Full `apps/viz` test suite + validation gate (§15).
    `IMPLEMENTATION_STATUS.md`: dated entry. Commit:
    `feat(viz): package-to-file semantic zoom with edge aggregation`.

## 12. Data and lifecycle flows

**Expand (first time this session):** hull activated -> `expand(pkgKey)`
called -> cache miss -> parallel fetch `fetchFileNodes(pkgName)`,
`fetchFileEdges(pkgName)`, `fetchLayout("file")` -> on success, results
cached in the ref -> `PackageMapCanvas` effect notices the new cache entry
-> `addNode` for each file (position from fetched layout), `addEdge` for
intra-package edges, `computeAggregatedEdges` recomputed over the full
current raw-edge set (package-level + this package's file-level) and the
now-updated `expandedPackages` set -> aggregate edges replace any
now-stale collapsed-level summary edges touching this package.

**Expand (already cached from an earlier expand+collapse in this
session):** `expand(pkgKey)` called -> cache hit -> no fetch -> same
add-to-graph step as above using cached data.

**Collapse:** hull re-activated while expanded -> `collapse(pkgKey)` ->
`expandedPackages` loses the key -> `PackageMapCanvas` effect
`removeNode`/`removeEdge` for every entity that was added for this package
-> `computeAggregatedEdges` recomputed -> the package-level aggregate edge
that existed before this package was ever expanded reappears (same
function, now called with the package back out of the expanded set).

**Snapshot replaced mid-session (WS `snapshot_replaced`):** per 08-02's
existing contract, `useSnapshot`/`usePackageGraph` refetch; this
blueprint's per-session expansion cache is invalidated entirely (cleared)
on `snapshot_replaced`, since cached file data may now be stale relative to
the new snapshot — the next `expand` call for any package re-fetches fresh
data. `expandedPackages` (the *set of which packages were open*) is
preserved across the refetch so the user's current view depth is restored
against the new data, rather than silently collapsing everything on every
background refresh.

## 13. Test plan

- `apps/viz/test/expansion.test.ts` — aggregation reducer: boundary-edge
  aggregation with count/provenance correctness; multi-relation
  non-merging; intra-expanded-package exclusion; degenerate
  all-collapsed case matches 08-02's existing package-level edge behavior.
- `apps/viz/test/usePackageExpansion.test.ts` — expand/collapse state
  machine; fetch-once-per-session caching (mock fetch call-count
  assertion); multiple simultaneous expansions.
- `apps/viz/test/expand-collapse-canvas.test.tsx` — the byte-stability
  assertion (unexpanded/other-package node positions `Object.is`-unchanged
  across expand); collapse-restores-exact-node/edge-count assertion;
  keyboard activation (`Enter`/`Space` on a focused hull element triggers
  the same `expand`/`collapse` as a click, asserted via React Testing
  Library `fireEvent.keyDown`).
- Label truncation: file-basename-only, 20-char cap, unit-tested with a
  synthetic long filename.
- Pagination/omission: a mock package with > 500 files (synthetic fixture)
  triggers the honest "N files not shown" indicator rather than an
  unbounded fetch loop or silent truncation — asserted by a dedicated test.
- Regression: existing `apps/viz` suite from 08-02 (legend, convex hull, WS
  reconnect, states, package-map mount/unmount) stays green — this
  blueprint only adds to `PackageMapCanvas`, it must not alter package-level
  behavior when nothing is expanded.

## 14. Acceptance criteria

- [ ] Expanding a package hull renders its file nodes at positions read
      from `/api/v1/layout?level=file` (verified against the mock server
      contract in tests; real-server integration verified manually once
      07-01/08-01 are live).
- [ ] Expanding package X leaves every node's `x`/`y` in every *other*
      package, and package X's own hull-anchor node, `Object.is`-unchanged
      (test-asserted, not just intended).
- [ ] Collapsing a previously-expanded package restores the exact prior
      node/edge count and every remaining node's exact position.
- [ ] Cross-boundary edges render as one aggregate per
      `(srcPackage, dstPackage, relation)` triple with a correct count and
      provenance breakdown; two different relations across the same pair
      never merge into one aggregate.
- [ ] Intra-expanded-package edges render individually, never aggregated.
- [ ] Keyboard activation (`Enter`/`Space`) triggers expand/collapse
      identically to a mouse click.
- [ ] File labels truncate at exactly 20 characters with ellipsis.
- [ ] Re-expanding a package already cached in the current session issues
      zero additional network/mock-fetch calls.
- [ ] `pnpm --filter apps/viz test` full suite (08-02's tests plus this
      blueprint's additions) passes; `pnpm --filter apps/viz exec eslint .`
      and `tsc --noEmit` exit 0.

## 15. Validation commands

pnpm install; pnpm typecheck; pnpm lint; pnpm test; pnpm --filter apps/viz
exec tsc --noEmit; pnpm --filter apps/viz exec eslint .; pnpm --filter
apps/viz test; pnpm --filter apps/viz exec vite build; python
validate_fixtures.py; pnpm fixtures:validate; git diff --check; git status
--short

## 16. Performance budgets

- Expansion interaction (click/keyboard-activate to file nodes fully added
  to the canvas and rendered) must complete in **< 200 ms** for a package
  at the 500-file cap, measured against the cached-data path (fetch
  latency itself is excluded from this budget — that is a server/network
  concern, not this blueprint's client-side add-to-graph cost) — named
  benchmark script `apps/viz/bench/expand-latency.bench.ts` (proposed):
  synthetic 500-file package data pre-cached, times
  `addNode`/`addEdge`/`computeAggregatedEdges` cost only, throws if
  `>= 200`.
- Collapse interaction must complete in **< 100 ms** at the same 500-file
  scale (removal is cheaper than addition — no aggregation recompute
  needed beyond re-running `computeAggregatedEdges` once over the reduced
  expanded set, same function, smaller input).
- Aggregation reducer (`computeAggregatedEdges`) alone, at the 1000-edge
  per-level cap (ARCHITECTURE.md §3 row 5), must complete in **< 20 ms** —
  isolated in the same benchmark script as a sub-measurement, since it is
  the one function called on every expand *and* every collapse.

## 17. Failure and recovery behavior

- Fetch failure on expand (network error, malformed response): the
  package-level hull stays collapsed (expand is not optimistically
  applied before the fetch resolves); an error affordance is shown on that
  hull specifically (not a whole-app error state) — a failed expansion of
  one package must not disturb any other package's already-expanded or
  collapsed state.
- Partial pagination failure (first page of files loads, `nextCursor` fetch
  fails): already-loaded files remain visible; the omission indicator
  shows an honest "at least N more, could not load full count" variant
  rather than silently reporting a wrong total.
- Snapshot replaced while a fetch is in flight: the in-flight fetch's
  result, if it later resolves, is discarded if `expandedPackages` no
  longer contains that package's key by the time it resolves (avoids a
  stale response reviving a since-collapsed package) — implemented via a
  request-generation token compared at resolution time, the same pattern
  already implicit in 08-02's snapshot-replacement refetch handling.
- Collapse called on a package that was never expanded: no-op (idempotent),
  not an error.

## 18. Security and privacy

No new I/O surface beyond the already-contracted `/api/v1/nodes`,
`/api/v1/edges`, `/api/v1/layout` endpoints (07-01's trust boundary, not
this blueprint's). No new sensitive data introduced — file-level node
metadata (paths, qualified names) is the same class of repository-source
information the package level already exposes (08-02 §18), not a new
sensitivity tier.

## 19. Accessibility

- Expand/collapse must be keyboard-reachable: a package hull is a
  focusable element (`tabIndex={0}` or a native `<button>` wrapper) and
  responds to `Enter`/`Space` identically to a click — tested directly
  (§13), not deferred.
- Focus is retained on the activated hull after expand/collapse (no focus
  loss to `document.body`) — minimum viable focus-management contract for
  this blueprint; the full focus-order audit across the whole app is
  08-11's scope.
- The full accessible list/table alternative for file-level graph content
  is owned by 08-11; this blueprint's contribution is that `ApiNode`
  (already defined in 08-02, reused unmodified here) remains the one typed
  shape 08-11 will render as a table row — no parallel/divergent data
  shape is introduced for file-level nodes.

## 20. Documentation updates

`IMPLEMENTATION_STATUS.md` — dated entry recording the file-level semantic
zoom feature and the edge-aggregation rule. No other existing
documentation file is modified.

## 21. Builder final report

Require: summary; files changed; contracts implemented
(`computeAggregatedEdges`, `usePackageExpansion`); tests added (names +
count per §13 category, explicitly calling out the byte-stability test
result); validation command output summary; benchmark results (expand
latency, collapse latency, aggregation-reducer latency at cap) against
§16; commit SHA; known limitations; `ASSUMPTION:` lines (e.g. the 20-char
file-label budget, the client-side-only aggregation decision).

## 22. Independent review result

Pending Wave 2 adversarial review.

## IF SOMETHING IS UNCLEAR

Make the smallest safe assumption, record `ASSUMPTION: ...` in the report,
continue without expanding scope. If enforcing byte-stability requires a
choice between two graphology API calls with subtly different semantics
(e.g. `mergeNodeAttributes` vs. `setNodeAttribute`), prefer the one that
touches the fewest existing nodes' attribute objects and record the choice.
If aggregation logic would need a new relation or schema field to express
correctly, stop — that is a frozen-enum violation, not an implementation
detail.

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
