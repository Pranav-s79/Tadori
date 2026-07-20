---
graph_blueprint_version: 1
node_id: 08-04
state: ready
phase: 8
risk: medium
complexity: M
predecessors: [08-03]
successors: [08-07, 08-10]
execution_card: blueprints/execution/08-04.md
dossier: blueprints/08-04-task-region-symbol-expansion.md
read_policy: execution-card-first
local_full_gate_budget: 1
independent_validation_budget: 1
architecture_review: on-demand-only
---

> **GRAPH EXECUTION MODE:** Read the execution card first. This long file is an evidence dossier, not mandatory context. Open only the sections linked by the card. Planning-time existence claims and line numbers are historical hints; live repository semantics win. Use one full local gate and one independent validation pass.

# BLUEPRINT 08-04: Task-region symbol expansion

## 1. Header

- ID / Title / Phase: 08-04 — Task-region symbol expansion — Phase 8 (Guided
  2D visualization)
- Status: ready
- Primary builder: Claude Sonnet — this is the third and final zoom level and
  is a near-exact reuse of 08-03's expand/collapse state machine, one level
  deeper (file → its exported symbols). No new backend semantics; the
  `level=symbol` node/layout endpoints already exist and are contract-frozen.
- Reviewer roles: Spec Guardian (three-and-only-three zoom levels; no fourth
  level invented; exported-only symbol scope), Test Adversary (byte-stability
  of unexpanded nodes across the file→symbol boundary, collapse-restore
  exactness, nested expand/collapse ordering), Implementation Reviewer (reuse
  of 08-03 machinery vs. divergent copy; symbol-node namespacing under an
  already-expanded file under an already-expanded package).
- Complexity: M (one focused builder session)
- Depends on: 08-03 (semantic zoom file expansion — supplies `expansion.ts`
  (`applyExpansion`/`applyCollapse`/`diffExpandedNodes`/`fileNodeId`/
  `truncate`/`computeAggregatedEdges`) and `usePackageExpansion` (the
  ref-cached fetch + expand/collapse hook) that this blueprint parameterizes
  for the file→symbol level; this blueprint EXTENDS that machinery, it does
  not fork a second copy). Transitively 08-02 (scaffold, canvas) and 08-01
  (persisted `abstraction_level='symbol'` layout rows).
- Unlocks: 08-07 (route/test/doc displays reference symbol-level nodes
  surfaced here — e.g. a `route` node or a likely `test` node is a symbol),
  08-10 (symbol-level level-of-detail budget is the deepest and largest;
  the large-repo performance gate measures cold→interactive with symbol
  expansion in play).
- Estimated sessions: 1
- Related frozen-spec sections: ARCHITECTURE.md §10 "Viz data-loading
  contract" (three frozen zoom levels, level 3 = symbol expansion on a file,
  "no global movement"); §6 (layout persistence, `abstraction_level='symbol'`
  rows); BACKLOG.md row 08-04 ("File → exported symbols level (third and
  final zoom level)"); frozen non-negotiable "progressive disclosure package
  → file → task-region symbols."

## 2. Objective

Clicking (or keyboard-activating) an expanded file node reveals that file's
symbol-level nodes (functions, methods, classes, interfaces, types, and the
symbol-kinded nodes `route`/`test`/`adr`/`doc_section`/`external_dep`/
`unresolved` that belong to the file) at deterministic positions read from
`layout_positions` (`abstraction_level='symbol'`), added in place with no
movement of any package, file, or already-expanded-symbol node; collapsing a
file removes exactly its symbol nodes and restores the exact prior view; the
existing per-relation edge aggregation from 08-03 continues to describe
cross-region edges, now with symbols as additional attributable endpoints.

## 3. Why this matters

- User value: this is the third and last of exactly three zoom levels the
  frozen spec promises. It is where a task actually lands — a symbol (a
  function/method) is the unit an agent reads, calls, and modifies. Without
  it the map stops at "which file," which is not fine-grained enough to be
  the task-region the product name refers to.
- System value: proves the 08-03 expand/collapse + aggregation machinery
  generalizes to a second nesting level without a rewrite. If 08-04 needs its
  own divergent copy of that logic, that is a signal 08-03's abstraction was
  wrong and should be fixed there, not duplicated here.
- Downstream: 08-07's route/test/doc surfaces are symbol-node consumers;
  08-10's performance gate exercises the deepest expansion; 08-11's keyboard
  audit adds file→symbol activation to the reachable-action set.

## 4. Current repository evidence

**Verified current (2026-07-20):**

- `packages/server/src/routes/graph.ts:29` — `const LEVELS = ["package",
  "file", "symbol"]`. The `symbol` level is already served.
- `packages/server/src/routes/graph.ts:115-125` `levelKinds(level)`: for
  `symbol` returns `NODE_KINDS` minus `package` and `file` — i.e. every
  other node kind is a "symbol-level" node. The blueprint's exported-symbol
  emphasis is applied via the `exported=true` query param (line 189:
  `node.exported !== (exported === "true")`), NOT by a server-side kind
  restriction. **Exported-only is the client's request choice, not a server
  default** — see §8.
- `packages/server/src/routes/graph.ts:170-193` — `/nodes` filters by
  `file` (exact `node.file === file`, normalized path) and by `packageName`
  (resolves each node's owning package via its file's `packageName`). So the
  scoped fetch for one file's symbols is
  `GET /api/v1/nodes?level=symbol&file=<normalizedPath>&exported=true`.
  `packageName` MAY additionally be sent for defense in depth but `file` is
  the operative scope (a normalized path is unique across packages).
- `packages/server/src/routes/layout.ts:10,16-36` — `/layout` accepts
  `level=symbol`; returns persisted `LayoutPositionDto[]`
  (`{entityKey,x,y,z,pinned}`) for that level. No recompute is triggered by
  the client; 08-01's engine materializes symbol rows server-side on first
  request per AD-005.
- `packages/server/src/routes/graph.ts:203-249` — `/edges` takes
  `relation?`, `origin?`, `confidence?`, `resolution?`, `srcKey?`, `dstKey?`;
  it does NOT itself take `level` or `file`. As in 08-03, the client fetches
  the file's symbol edges and keeps those whose endpoints resolve inside the
  expanded file (the same client-side scoping 08-03 applies for file edges,
  carrying 08-03's `ponytail:` note forward — a server-side symbol edge
  filter is only warranted if per-file symbol edge volume ever bites).
- `apps/viz/src/graph/expansion.ts` (from 08-03) — `applyExpansion(graph,
  key, {nodes,edges,positions})`, `applyCollapse(...)`,
  `diffExpandedNodes(prev,next)`, `fileNodeId(packageKey, entityKey)`,
  `truncate(text,maxLen)`, `computeAggregatedEdges(edges, entityToPackage,
  expandedPackages)`. These are the reused primitives. `fileNodeId`
  namespaces a child node under its expanded parent (`${parentKey}::${key}`);
  the same helper namespaces symbols under their file (the parent key becomes
  the already-namespaced file node id), so a symbol node id is
  `${packageKey}::${fileKey}::${symbolKey}` — collision-free across files
  that share a symbol name.
- `apps/viz/src/hooks/usePackageExpansion.ts` (from 08-03) — ref-cached
  fetch-once-per-parent expand/collapse hook. This blueprint adds a sibling
  (or generalizes it — see §8) `useFileExpansion` with the identical
  ref-cache + generation shape, fetching symbol-level data per file.
- `apps/viz/src/api/client.ts` (from 08-03) — `fetchFileNodes`/
  `fetchFileEdges`/`fetchFileLayout(packageName)`. This blueprint adds
  `fetchSymbolNodes(file)`, `fetchSymbolEdges(file)`, `fetchSymbolLayout(file)`
  in the identical style (built on the private `getJson`+`unwrapList`).
- `packages/core` frozen `RELATIONS` (11) and `NODE_KINDS` (13) unchanged —
  aggregation groups per-relation exactly as 08-03; no new kind or relation.

**PROPOSED (this blueprint):** every file in §9; no server-side or store-side
files (all data served by already-contracted endpoints).

Files to read first: `blueprints/08-03-semantic-zoom-files.md` §8-§10 (the
state machine and aggregation contract this reuses), `apps/viz/src/graph/
expansion.ts`, `apps/viz/src/hooks/usePackageExpansion.ts`,
`apps/viz/src/graph/PackageMapCanvas.tsx` (how 08-03 wired click/keyboard
activation and applied the diff), ARCHITECTURE.md §10.

Gotchas:
- A symbol can only be revealed under an already-expanded file, which is
  itself under an already-expanded package. Collapsing the *package* must
  also drop any symbol nodes revealed under its files (they are descendants).
  Reuse must handle two nesting levels, not assume a flat parent set.
- `exported=true` is deliberate: a 150k-LOC file's private helpers would
  re-create the hairball at the leaf. Non-exported symbols are reachable via
  inspection/search (08-05/08-06), not the default expansion. Record this as
  a frozen-scope decision (§8), and DO surface an honest count when symbols
  are omitted by the exported filter ("N private symbols not shown") — never
  silently imply a file has only its exported symbols.

## 5. Scope

- Expand a file node (already visible because its package is expanded) in
  place to its **exported** symbol nodes at persisted `symbol`-level
  positions; collapse to restore exactly.
- Additive graph mutation ONLY (`addNode`/`addEdge`), never a rebuild — every
  package, file, and other file's symbols stay `Object.is`-position-identical;
  the expanded file's own node does not move.
- Intra-file symbol edges render individually inside the expanded file
  region; cross-region edges continue to aggregate per 08-03's
  `computeAggregatedEdges` (now with symbols as attributable endpoints via an
  extended `entityToPackage`-style resolver).
- Ref-cached fetch: collapse→re-expand of the same file in one session issues
  zero additional network requests.
- Keyboard-first: a file node is activatable by `Enter`/`Space` exactly as a
  package hull is in 08-03; documented focus order and ARIA state
  (expanded/collapsed) on file nodes.
- Honest omission: when the exported filter hides private symbols, the file
  region shows an explicit "+N not shown (non-exported)" affordance.
- Symbol label truncation reuses the shared `truncate` helper (symbols at the
  same or a tighter max than file labels — one helper, no duplicated logic).

## 6. Non-goals

- No fourth zoom level, no sub-symbol expansion (statements/blocks), no call
  graph beyond the already-existing `calls` relation edges.
- No non-exported-symbol expansion by default (reachable via search/inspect;
  not a new default view).
- No new server endpoint, no new layout level, no new migration — `symbol`
  level and its persistence already exist and are frozen.
- No inspection-panel internals (08-06 owns that) — activating a symbol for
  inspection opens 08-06's panel via the same injected seam 08-03 uses for
  selection; this blueprint only surfaces the symbol nodes and their
  expand/collapse.
- No route/test/doc-specific tables (08-07) even though route/test nodes are
  symbol-kinded — they render as ordinary symbol nodes here.

## 7. Dependencies and prerequisites

- 08-03 delivered `expansion.ts` and `usePackageExpansion.ts` (the machinery
  this parameterizes) and the click/keyboard activation + diff-application
  path in `PackageMapCanvas.tsx`. This blueprint calls/extends those; it does
  not redefine them.
- 07-01/08-01 serve `GET /api/v1/nodes?level=symbol&file=&exported=true`,
  `GET /api/v1/edges` (symbol edges kept by client scoping), and
  `GET /api/v1/layout?level=symbol` with persisted deterministic positions.

## 8. Architectural decisions

- **Reuse, do not fork, the 08-03 expand/collapse machine.** The file→symbol
  operation is the same additive `addNode`/`addEdge`, byte-stable, ref-cached
  operation as package→file, one level deeper. The builder parameterizes
  `applyExpansion`/`applyCollapse`/`diffExpandedNodes` (or generalizes
  `usePackageExpansion` into a level-agnostic `useNodeExpansion`) rather than
  writing a second copy. Rejected: a bespoke symbol-expansion module —
  duplicated logic drifts and the byte-stability invariant would then be
  enforced in two places. If parameterizing reveals a real seam 08-03 hard-
  coded to "package," fix it in 08-03's file with a widening change and note
  it, rather than shadowing it here.
- **Exported symbols only, by default.** Rationale: the frozen anti-hairball
  goal (R-01 §2) applies hardest at the leaf level; a file's private helpers
  multiply node count without adding navigational value. The client sends
  `exported=true`. Rejected: showing all symbols — recreates the overwhelming
  flat view the three-level disclosure exists to prevent. The omitted private
  count is surfaced honestly (never implying the file has only exported
  symbols) — this satisfies the honesty non-negotiable without abandoning the
  scope decision.
- **Two-level nesting is explicit in the expanded-set model.** React view
  state tracks expanded packages AND expanded files (files only expandable
  when their package is). Collapsing a package cascades: its files' symbol
  nodes are dropped first, then its file nodes (reuse `applyCollapse` per
  descendant, deepest first). Rejected: a flat "expanded ids" set with no
  parent relation — it cannot express the cascade correctly and would leak
  orphaned symbol nodes when a package collapses.
- **Symbol node ids are doubly namespaced.** `fileNodeId(fileNodeId(pkg,
  file), symbol)` yields `${pkg}::${file}::${symbol}` — reusing the existing
  helper, collision-free across files sharing a symbol name. Rejected: a flat
  symbol id — two files with a `render` function would collide.
- **Cross-region aggregation unchanged.** `computeAggregatedEdges` already
  groups per `(srcGroup,dstGroup,relation)`; the only change is that the
  endpoint→group resolver now maps an expanded file's symbols to that file
  (when the file is the relevant region) or to its package (when the package
  is collapsed) — no new aggregation rule, no merging of relations.

## 9. Exact file plan

All paths under the existing `apps/viz` (from 08-02/08-03). Prefer extending
existing files over new ones where the logic is shared.

- `apps/viz/src/graph/expansion.ts` — EXTEND. If `applyExpansion`/
  `applyCollapse`/`diffExpandedNodes` are already level-agnostic (they take a
  parent key + `{nodes,edges,positions}`), reuse as-is and add only a
  symbol-region edge resolver if needed. If they hard-code package-specific
  color/size, add a small level parameter (e.g. a `NodeVisual` argument)
  rather than branching internally. Symbol nodes get their own visual (size
  ~3, a distinct-but-in-palette color) — keep it data-driven, no magic
  scattered across call sites.
- `apps/viz/src/hooks/useFileExpansion.ts` — CREATE (or generalize
  `usePackageExpansion.ts` into `useNodeExpansion.ts` consumed by both; the
  builder picks whichever yields less duplicated code — document the choice).
  Ref-cached fetch of symbol-level `{nodes,edges,positions}` per file;
  `expand(fileKey)`/`collapse(fileKey)`; exposes the expanded-file set.
- `apps/viz/src/api/client.ts` — EXTEND. Add `fetchSymbolNodes(file)`,
  `fetchSymbolEdges(file)`, `fetchSymbolLayout(file)` mirroring the 08-03
  file-level fetchers; `fetchSymbolNodes` sends `level=symbol&file=&
  exported=true` and returns both the exported nodes and the omitted-private
  count if the server exposes `total` vs returned length (it paginates with
  `total`) — use `total - items.length` under the exported filter to derive
  the honest omitted count, or a second `exported`-less count query if
  clearer (prefer the single query + total).
- `apps/viz/src/graph/PackageMapCanvas.tsx` — EXTEND. Add file-node
  activation (click/keyboard) that toggles symbol expansion, applying the
  same diff mechanism 08-03 uses for package activation. Add ARIA
  expanded/collapsed state to file nodes. Render the "+N non-exported not
  shown" affordance on an expanded file region.
- Tests (co-located with 08-03's tests under `apps/viz/test/`):
  - `apps/viz/test/symbol-expansion.test.ts` — CREATE. Pure: symbol id double-
    namespacing, diff of expanded-file set, omitted-count derivation,
    aggregation with symbol endpoints.
  - `apps/viz/test/useFileExpansion.test.ts` — CREATE. Ref-cache (zero
    refetch on collapse→re-expand), generation guard, package-collapse
    cascade drops descendant symbols.
  - `apps/viz/test/expand-collapse-symbol-canvas.test.tsx` — CREATE. Canvas:
    file activation expands symbols; byte-stability of all other nodes
    (`Object.is` on x/y); collapse restores exact node count/positions;
    keyboard `Enter`/`Space` on a file node; package collapse cascades.
  - EXTEND `mockServer.ts` with `level=symbol` node/edge/layout handlers and
    an exported-filter honoring `total`.

## 10. Exact contracts

```ts
// client.ts additions
export function fetchSymbolNodes(file: string): Promise<{ nodes: ApiNode[]; omittedNonExported: number }>;
// GET /api/v1/nodes?level=symbol&file=<file>&exported=true  → keeps items; omittedNonExported = total - items.length
export function fetchSymbolEdges(file: string): Promise<ApiEdge[]>;
export function fetchSymbolLayout(file: string): Promise<LayoutPositionDto[]>;

// useFileExpansion.ts (or the generalized useNodeExpansion)
export interface FileExpansionState {
  expandedFiles: ReadonlySet<string>;      // file node ids currently expanded
  expand(fileKey: string): void;           // fetch (or reuse cached) + apply
  collapse(fileKey: string): void;
  cascadeCollapseForPackage(packageKey: string): void; // drop all symbol nodes under a collapsing package's files
}

// expansion.ts (reused, possibly widened)
export function fileNodeId(parentKey: string, entityKey: string): string; // already exists; used twice for symbols
// applyExpansion/applyCollapse/diffExpandedNodes/computeAggregatedEdges reused unchanged in signature,
// with a NodeVisual param added ONLY if 08-03 hard-coded package visuals.
```

Symbol-region visual state derivation (deterministic):
- A file is `expandable` iff its package is expanded and it has ≥1 exported
  symbol (else it is a leaf; activating it opens inspection, does not expand
  to an empty region).
- `omittedNonExported > 0` → render the "+N not shown (non-exported)" label
  inside the region.

## 11. Ordered implementation procedure

1. `expansion.ts`: confirm the 08-03 primitives are level-agnostic; add a
   `NodeVisual` parameter only if needed for symbol styling. Extend/verify
   `computeAggregatedEdges`'s endpoint→group resolver handles symbol
   endpoints. Unit test (`symbol-expansion.test.ts`) — green.
2. `client.ts`: add the three symbol fetchers with the `exported=true` +
   `total`-derived omitted count. Unit test the omitted-count math.
3. `useFileExpansion.ts` (or generalized hook): ref-cache + generation guard +
   package-collapse cascade. Test the cascade and the zero-refetch invariant.
4. `PackageMapCanvas.tsx`: wire file-node activation (click + `Enter`/`Space`),
   apply the additive diff, add ARIA expanded state, render the omitted-count
   affordance. Component test: byte-stability + keyboard + cascade.
5. Full gate (§15); update `IMPLEMENTATION_STATUS.md` and this blueprint's
   status per the template.

## 12. Data and lifecycle flows

**Expand file:** file-node activation → `useFileExpansion.expand(fileKey)` →
cached symbol `{nodes,edges,positions}` or one fetch trio → `diffExpandedNodes`
computes the added file → `applyExpansion` adds symbol nodes/intra-file edges
additively → `computeAggregatedEdges` recomputed for the new region set →
Sigma re-renders; no existing node moves.

**Collapse file:** activation on an expanded file → `applyCollapse` drops
exactly that file's symbol nodes/edges → prior view restored exactly.

**Collapse package (cascade):** package activation → for each expanded file
under it, `applyCollapse` its symbols (deepest first) → then 08-03's package
collapse drops the file nodes → no orphaned symbol node remains.

**Re-expand:** cached data reused; fetch call count unchanged (asserted).

**Failure:** a symbol fetch failing leaves the file collapsed with an inline
error affordance; the rest of the graph is untouched (a leaf failure never
blurs/moves the map).

## 13. Test plan

Unit (Vitest): symbol id double-namespacing; expanded-file diff; omitted-count
derivation (`total - items.length`); aggregation correctness with symbol
endpoints; no-mutation invariant on `applyExpansion`/`applyCollapse` inputs.

Hook: zero-refetch on collapse→re-expand (fetch-mock call count); generation
guard discards stale symbol responses; package-collapse cascade removes all
descendant symbol nodes (assert node count returns to the pre-symbol-expansion
count exactly).

Component (RTL): file activation renders symbol nodes; every other node's
`(x,y)` is `Object.is`-unchanged before/after (byte-stability); collapse
restores exact node count and positions; `Enter`/`Space` on a focused file
node toggles expansion; ARIA `aria-expanded` reflects state; the
"+N non-exported not shown" affordance renders when `omittedNonExported > 0`
and is absent when 0.

Regression: none pre-existing beyond 08-03's suite (which must stay green —
the reuse must not regress package→file behavior); no fixture files touched.

## 14. Acceptance criteria

- [ ] Activating an expanded file reveals its exported symbol nodes at
      persisted `symbol`-level positions; no package/file/other-symbol node
      moves (`Object.is` on x/y verified).
- [ ] Collapsing a file removes exactly its symbol nodes/edges and restores
      the exact prior node count and positions.
- [ ] Collapsing a package cascades: no symbol node orphaned; node count
      returns exactly to the package-collapsed baseline.
- [ ] Collapse→re-expand of a file issues zero additional fetches (call-count
      asserted).
- [ ] Non-exported symbols are omitted by default and their count is shown
      honestly ("+N not shown"), never silently implying the file has only its
      exported symbols.
- [ ] File-node expansion is reachable and operable by keyboard alone
      (`Enter`/`Space`), with `aria-expanded` state.
- [ ] 08-03's package→file suite remains green (reuse did not regress it).
- [ ] No second copy of the expand/collapse/aggregation logic exists — 08-04
      reuses 08-03's `expansion.ts` primitives (reviewer-verified).
- [ ] Full existing repository gate remains green (§15).

## 15. Validation commands

Existing repository gate (preserved verbatim): `pnpm skills:check`;
`pnpm typecheck`; `pnpm lint`; `pnpm test`; `python validate_fixtures.py`;
`pnpm fixtures:validate`; `pnpm fixtures:index`; `pnpm fixtures:typecheck`;
`pnpm benchmark:incremental`; `git diff --check`; `git status --short`.
Plus the viz-scoped gate: `pnpm --filter @tadori/viz test`, and inside
`apps/viz`: `npx tsc --noEmit`, `pnpm lint`, `pnpm build` (offline-bundle
assertion must still pass).

## 16. Performance budgets

- Symbol expansion of one file: added nodes ≤ the file's exported-symbol count
  (typically ≤ a few dozen); apply+render < 50 ms for a file region.
- `/api/v1/nodes?level=symbol` returns within 07-01's node-endpoint budget;
  the client issues one fetch trio per file first-expand, cached thereafter.
- Deepest state (a package expanded, several files expanded to symbols) stays
  within 08-10's level-of-detail budget — 08-10 owns the whole-repo gate; this
  blueprint keeps per-file symbol count bounded by the exported filter so the
  leaf level does not blow that budget.

## 17. Failure and recovery behavior

- Symbol fetch network/HTTP failure: the file stays collapsed with an inline,
  dismissible error affordance; the rest of the graph is unaffected.
- A file with zero exported symbols: not expandable (activating it opens
  inspection via 08-06's seam, does not create an empty region).
- Stale snapshot mid-expansion: symbol nodes render with their own freshness
  honestly (same per-node honesty as 08-03); a global refresh (08-09) may
  re-fetch, but this blueprint does not suppress symbols merely because a
  refresh is pending.

## 18. Security and privacy

- All requests target `127.0.0.1` only (inherited from the server binding);
  no new origin. Only repo-relative `file` params are sent (no absolute
  paths). No PII beyond what the repository source already contains.

## 19. Accessibility

- **Focus order:** file nodes are keyboard-focusable when their package is
  expanded (extending 08-03's package-node focus model to the file layer);
  symbol nodes are focusable when their file is expanded.
- **Keyboard:** `Enter`/`Space` on a focused file node toggles symbol
  expansion (identical affordance to package activation in 08-03); `Escape`
  behavior inherits 08-03's.
- **ARIA:** file nodes carry `aria-expanded` reflecting symbol-expansion
  state; the omitted-count affordance is announced (`aria-live="polite"`
  region reused from 08-03 if present, else a small labelled element).
- **Reduced motion:** any expand/collapse visual transition respects
  `prefers-reduced-motion` (inherits 08-03's approach; no second animation
  path introduced).
- **Non-canvas fallback:** symbol nodes are part of the accessible
  list/table alternative 08-11 defines; this blueprint's expansion feeds
  that surface with the third level's nodes.

## 20. Documentation updates

`IMPLEMENTATION_STATUS.md` — add a dated entry once built (feature, test count
added, validation evidence). Update this blueprint's status and INDEX.md row
08-04. No other doc requires edits for this scope.

## 21. Builder final report

Require: summary; files changed (noting which 08-03 files were extended vs.
new); confirmation the 08-03 machinery was reused (not forked) with the exact
seam widened if any; contracts implemented (match §10); tests added (names +
count); validation output summary; commit SHA; every `ASSUMPTION:` (expected:
the 08-06 inspection seam name if built out of order, and the symbol NodeVisual
choice); known limitations; follow-on risks.

## 22. Independent review result

Pending Wave 2 adversarial review.

## IF SOMETHING IS UNCLEAR

Smallest safe assumption + `ASSUMPTION:` line. If an assumption would (a)
introduce a fourth zoom level, (b) show non-exported symbols by default
without an honest omitted count, (c) move any existing node during expansion,
or (d) duplicate 08-03's expand/collapse logic instead of reusing it — stop
and report blocked; those are frozen-scope / invariant violations, not
implementation details.

## TADORI NON-NEGOTIABLES

Frozen v2.1; TS/JS only; ATLAS separate; exactly six MCP tools (this blueprint
consumes HTTP only, never MCP); stable 2D default; exactly three zoom levels —
no fourth; every visible relation keeps evidence/origin/confidence/resolution;
unresolved stays visibly unresolved; deterministic positions byte-identical
across reloads; no permanent dual sidebars; localhost only; Graphify ignored
reference only; never weaken golden fixtures.
