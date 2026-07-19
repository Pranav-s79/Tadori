---
graph_blueprint_version: 1
node_id: 08-05
state: review
phase: 8
risk: medium
complexity: M
predecessors: [08-02]
successors: [08-11]
execution_card: blueprints/execution/08-05.md
dossier: blueprints/08-05-search-and-filters.md
read_policy: execution-card-first
local_full_gate_budget: 1
independent_validation_budget: 1
architecture_review: on-demand-only
---

> **GRAPH EXECUTION MODE:** Read the execution card first. This long file is an evidence dossier, not mandatory context. Open only the sections linked by the card. Planning-time existence claims and line numbers are historical hints; live repository semantics win. Use one full local gate and one independent validation pass.

# BLUEPRINT 08-05: Search & filters

## 1. Header

- ID / Title / Phase: 08-05 — Search & filters — Phase 8 (Guided 2D visualization)
- Status: review
- Primary builder: Claude Sonnet — client-side UI over an already-frozen
  server search contract; no new backend semantics to invent, just correct
  wiring, state modeling, and keyboard-first UI construction.
- Reviewer roles: Spec Guardian (frozen-contract adherence: FTS ordering,
  evidence honesty), Accessibility Reviewer (keyboard/ARIA), Implementation
  Reviewer (state model, network usage).
- Complexity: M (one focused builder session)
- Depends on: 08-02 (`apps/viz` scaffold + package map — provides the Sigma
  stage, camera, and selection state this blueprint reads/writes)
- Unlocks: 08-11 (browser/a11y validation exercises this surface's keyboard
  flows and list-alternative contract)
- Estimated sessions: 1
- Related frozen-spec sections: FTS5 search endpoint (ARCHITECTURE.md
  §3 row 9); evidence/origin/confidence/resolution visibility (non-negotiable
  list); a11y locked decisions (BACKLOG.md "Decisions locked 2026-07-15":
  keyboard access for search/filters; WCAG AA non-canvas UI).

## 2. Objective

A user can type a query into a single search box, see snapshot-scoped FTS5
results ordered exact-match-first then by rank, filter the graph by
relation/kind/provenance without the filters ever inventing or hiding the
existence of data, and reach any result via keyboard alone — landing on a
deterministic focus/zoom of the graph or an explicit empty/ambiguous state.

## 3. Why this matters

- User value: a 150k-LOC repository is not human-searchable by eye; search is
  the primary alternate entry point into the graph besides the package map.
- System value: reuses the store's frozen FTS5 contract
  (`packages/store/src/search.ts`) verbatim through one HTTP endpoint —
  no second search implementation to keep in sync.
- Downstream: 08-06 (inspection panel is the landing surface for a selected
  result), 08-07 (path/route/test/doc displays reuse the same filter-state
  pattern), 08-11 (this is one of the required full-flow browser tests).

## 4. Current repository evidence

Verified current (2026-07-17):

- `packages/store/src/search.ts` — `searchNodeFts(db, snapshotId, query,
  limit, kind?, offset)` (lines 83-142): FTS5 `MATCH` over `node_fts`
  (`display_name`, `qualified_name`, `signature`, `path`), `limit` clamped to
  `[1,100]` (throws `RangeError` outside range), `offset` clamped to
  `[0,1000000]`. Ordering is **exact-match boost first** —
  `ORDER BY exact_match DESC, f.rank, ne.entity_key` (line 127) — where
  `exact_match` is a case-insensitive equality check against
  `display_name`/`qualified_name`/`signature`/`normalized_path` (lines
  114-120). `total` is a separate `COUNT(*)` query (lines 131-141), so result
  count and page are independently correct even under pagination.
  `toFtsQuery` (lines 28-34) tokenizes on non-word/`$` boundaries, quotes each
  token (`"<token>"*`), preventing FTS-syntax injection; empty/no-token input
  returns `null` and the caller must render this as "no query", not an error.
- `packages/mcp/src/service.ts` `GraphService.searchNodes` (lines 159-166)
  is a thin delegate to `searchNodeFts` bound to the served snapshot — this
  is the function the server endpoint (07-01) calls; no reimplementation.
- ARCHITECTURE.md §3 row 9: `GET /api/v1/search` — params `q`, `kind?`,
  `limit<=100`, `offset<=1000000` → `FtsSearchResult` (rows + total); error
  `400 empty_query`. Owner 07-01/08-05 (this blueprint owns the UI half).
- `packages/mcp/src/contracts.ts` `toolNodeSchema` (lines 49-69) — the wire
  shape every result row must be renderable as: `entityKey`, `kind`,
  `qualifiedName`, `displayName`, `file`, `lineStart`/`lineEnd`, `signature`,
  `exported`, `fanIn`, `representation`, `body`, `evidence[]`,
  `evidenceOmittedCount`, `freshness`, `stale`, `staleReason`.
  `packages/core/src/enums.ts` — `NODE_KINDS` (13 values), `RELATIONS` (11
  values), `ORIGINS` (6: compiler/heuristic/git/doc/human/llm), `CONFIDENCES`
  (3: certain/likely/inferred), `RESOLUTIONS` (3:
  resolved/partial/unresolved) — the exact filter vocabularies.
- ARCHITECTURE.md §10 (viz data-loading contract): `apps/viz` is HTTP/WS-only
  — no `@tadori/*` import, no fs, no better-sqlite3; state ownership: server
  owns graph/layout/snapshot data, React owns only view state (level,
  selection, open panels, filter toggles). Provenance edge legend is
  data-driven from `origin`/`confidence`/`resolution` (§10, frozen, fixed
  solid/dashed/dotted + muted doc/git).
  §16 performance budget context: package/file `limit<=500`, symbol
  `limit<=1000` for node/edge endpoints (search caps independently at 100
  per store contract above).
- **What does not exist yet** (`ls packages/`, `ls apps/` if present):
  `packages/server`, `apps/viz` are both `pending` (INDEX.md rows 07-01,
  08-02). This blueprint is written against the ARCHITECTURE.md-proposed
  contracts of both; the builder session for 08-05 assumes 08-02's scaffold
  (Sigma stage, camera/zoom API, selection store) already exists per its own
  blueprint by the time 08-05 executes.
- Files to read first: `packages/store/src/search.ts` (full search
  semantics), `packages/mcp/src/service.ts:155-166` (`searchNodes`
  delegate), `packages/mcp/src/contracts.ts:49-89` (`toolNodeSchema`,
  `toolEdgeSchema`), `blueprints/ARCHITECTURE.md` §3 (endpoint table) and §10
  (viz data contract), `blueprints/08-02-*.md` once it exists (Sigma
  stage/selection API this blueprint attaches to).
- Gotchas: `searchNodeFts` throws `RangeError` for out-of-range `limit`/
  `offset` — the UI must never let a user construct such a request (clamp
  client-side too, defense in depth, since the server 400s otherwise are
  cheap but a thrown `RangeError` from a store call inside the server handler
  must map to a structured `ApiError`, not a 500 — that mapping is 07-01's
  job, verify it exists rather than re-deriving it here). `total` can exceed
  `limit`; the UI must show "showing N of TOTAL", never silently truncate
  without saying so.

## 5. Scope

- Single search input (one text box, not per-filter-field text inputs)
  wired to `GET /api/v1/search`.
- Debounced query-as-you-type with cancellation of superseded in-flight
  requests (stale responses never overwrite a newer query's results).
- Result list rendering: entity kind icon/label, qualified name, file:line
  when present, exact-match badge when `exact_match` truthy, freshness/stale
  badge, fan-in count.
- Filter state model: relation filter (multi-select from the 11 frozen
  relations), kind filter (multi-select from the 13 frozen node kinds),
  provenance filter (origin/confidence/resolution multi-select from their
  frozen enums). Filters apply to **graph rendering** (dim/hide non-matching
  nodes/edges) and, where the field exists on the search result row
  (`kind`), to the search query itself via the server's `kind` param.
  Relation/provenance filters that have no server-side search parameter
  (search is a node-only query) apply only to the rendered graph, never
  silently rewritten as a fabricated search filter.
- Result navigation: selecting a result focuses and zooms the graph
  deterministically to that entity's frozen layout position (reads
  `/api/v1/layout`, no recompute — per ARCHITECTURE.md AD-005) and opens the
  inspection panel (08-06) for it.
- Keyboard-first interaction: full keyboard reachability and operability of
  search box, result list, and filter controls; documented focus order,
  shortcuts, and ARIA roles (§19).
- Empty-query, zero-result, and ambiguous-adjacent (many equally-ranked
  exact matches) states, each with distinct, explicit UI text — never a
  blank list with no explanation.

## 6. Non-goals

- No new server-side search algorithm, ranking function, or index — FTS5 +
  exact-boost is frozen store behavior, consumed as-is.
- No fuzzy/typo-tolerant search beyond what SQLite FTS5 prefix matching
  already provides.
- No saved searches, search history, or search-result export.
- No edge full-text search (search is node-only per the store contract);
  edge-level provenance filtering is graph-rendering-only in this blueprint.
- No inspection-panel internal layout (evidence lists, source view, ADR
  bodies) — owned entirely by 08-06; this blueprint only triggers opening it.
- No route/test/doc-specific displays — owned by 08-07.

## 7. Dependencies and prerequisites

- 08-02 must have delivered: the Sigma render surface, a camera/viewport API
  capable of deterministic focus-to-entity + zoom, and a selection store
  (or equivalent) that 08-06's panel already subscribes to. This blueprint
  does not redefine that API; it calls it.
- 07-01 must have delivered `GET /api/v1/search` matching ARCHITECTURE.md §3
  row 9 exactly (params `q`, `kind?`, `limit<=100`, `offset<=1000000`;
  response `FtsSearchResult`-shaped; `400 empty_query` on blank/whitespace
  `q`).

## 8. Architectural decisions

- **One search box, not a query-builder form.** Rationale: the store
  contract is a single free-text FTS5 query; a multi-field form would invite
  building a client-side query language the server does not support.
  Rejected: per-field search inputs (name/signature/path) — no server
  support, and duplicates what filters already do post-hoc on rendering.
- **Filters are a pure rendering/query overlay, never a data mutation.**
  Filter state lives in React view state only (ARCHITECTURE.md §10: "React
  owns only view state ... filter toggles"). Toggling a filter never deletes,
  hides-as-if-absent, or refetches a different graph — it changes which
  already-fetched nodes/edges are dimmed/hidden in the render and which
  `kind` param accompanies the next search request. Rejected: filters that
  trigger a fresh `/api/v1/nodes`/`/api/v1/edges` fetch with different data
  — this risks a filtered view silently becoming a smaller "world" that
  looks like the whole graph; the full fetched graph must remain the source
  of truth, filters only affect visibility.
- **Debounce + request-generation guard, not a request queue.** Each
  keystroke schedules a debounced (250 ms) fetch; a monotonic generation
  counter is attached to every request and only the response matching the
  latest generation is applied. Rejected: cancelling via `AbortController`
  alone — still correct but the generation counter is simpler to reason
  about alongside the existing view-state store and covers out-of-order
  resolution even if abort is unavailable in a test environment. Both may be
  used together (abort as an optimization, generation guard as the
  correctness backstop) — the generation guard is the one exact rule that
  is verified.
- **Client-side limit/offset clamping mirrors the server's exact range.**
  `limit` sent is always `min(userPageSize, 100)`; `offset` always
  `max(0, min(offset, 1_000_000))`. Rationale: avoids ever triggering the
  store's `RangeError` path through normal UI interaction (that error path
  is a defense against malformed direct API calls, not a UI-reachable state).
- **Result navigation reads persisted layout, never recomputes.** Selecting
  a result calls the camera API with the entity's `(x, y)` from
  `/api/v1/layout` (already loaded per 08-02/08-03/08-04's level fetches, or
  fetched fresh if the entity's level is not yet loaded client-side).
  Rejected: computing an ad-hoc "jump to" position from scratch — breaks the
  frozen "positions byte-identical across reloads" invariant (BACKLOG.md
  08-10) by introducing a second position source.
- **Ambiguous-adjacent state is informational, not a forced disambiguation
  step.** Unlike the MCP `path`/`symbol_context` tools, which return a
  `status: "ambiguous"` and block on disambiguation, search always returns a
  ranked list — "ambiguous" here means "many top results tie on
  exact-match," which the UI surfaces as a banner ("N results match
  exactly — refine your query to narrow further") rather than an error
  state, because unlike tool calls, a human browsing a list does not need
  the system to pick one. Rejected: reusing the MCP tools' `ambiguous`
  status semantics verbatim — that model exists for machine callers needing
  one resolved entity, not a human browsing options.
- **Filters never fabricate absent data.** If a provenance filter (e.g.
  `origin: doc`) matches zero currently-rendered edges, the UI states "no
  matching edges in the current view" — it never synthesizes a placeholder
  edge or silently removes the filter to "find something to show."

## 9. Exact file plan

All paths are proposed, under the not-yet-created `apps/viz` (scaffolded by
08-02; this blueprint adds files inside it).

- `apps/viz/src/features/search/SearchPanel.tsx` — create. Root search UI:
  input box, filter controls, result list. Exports `SearchPanel`
  (React component, no props — reads/writes the search store below).
- `apps/viz/src/features/search/useSearchStore.ts` — create. View-state
  store (hook or small state-management module consistent with whatever
  08-02 established — Zustand-style module-scope store if 08-02 introduced
  one, otherwise React context; **do not introduce a new state library**,
  reuse 08-02's choice). Exports `useSearchStore()` returning
  `{ query, filters, results, status, setQuery, setFilters, selectResult }`.
- `apps/viz/src/features/search/searchApi.ts` — create. `fetchSearch(query:
  string, filters: SearchFilters, page: {limit:number; offset:number},
  generation: number): Promise<SearchApiResult>` — the sole fetch wrapper for
  `GET /api/v1/search`; owns limit/offset clamping and generation-tag
  attachment.
- `apps/viz/src/features/search/filterState.ts` — create. Pure functions:
  `defaultFilters(): FilterState`, `applyFiltersToGraph(graph, filters):
  RenderableGraph` (dim/hide decision per node/edge, never mutates fetched
  data), `filtersActive(filters): boolean`.
- `apps/viz/src/features/search/ResultList.tsx` — create. Keyboard-navigable
  listbox rendering `SearchResultRow[]`; emits `onSelect(entityKey)`.
- `apps/viz/src/features/search/SearchPanel.test.tsx` — create. Component
  tests (see §13).
- `apps/viz/src/features/search/filterState.test.ts` — create. Pure-function
  unit tests.
- `apps/viz/src/features/search/searchApi.test.ts` — create. Fetch/generation
  guard unit tests (mocked fetch).

Integration points: `SearchPanel` mounts into whatever shell layout 08-02
defines (a persistent top-bar or left-rail slot — 08-02's decision, not
redecided here); `selectResult` calls into 08-02's camera/focus API and
08-06's panel-open API by name (exact function names resolved when those
blueprints' file plans exist; this blueprint treats them as an interface
— see §10).

## 10. Exact contracts

```ts
// searchApi.ts
export interface SearchFilters {
  kinds: NodeKind[];        // subset of the 13 frozen NODE_KINDS; [] = no kind restriction
  relations: Relation[];    // subset of the 11 frozen RELATIONS; graph-render filter only
  origins: Origin[];        // subset of the 6 frozen ORIGINS; graph-render filter only
  confidences: Confidence[];   // subset of the 3 frozen CONFIDENCES
  resolutions: Resolution[];   // subset of the 3 frozen RESOLUTIONS
}

export interface SearchResultRow {
  entityKey: string;
  kind: NodeKind;
  displayName: string;
  qualifiedName: string;
  file: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  exported: boolean;
  fanIn: number;
  exactMatch: boolean;       // from FtsMatchRow.exact_match
  freshness: "fresh" | "stale" | "unknown";
  stale: boolean;
}

export interface SearchApiResult {
  generation: number;
  rows: SearchResultRow[];
  total: number;
  offset: number;
  limit: number;
}

export function fetchSearch(
  query: string,
  filters: SearchFilters,
  page: { limit: number; offset: number },
  generation: number
): Promise<SearchApiResult>;
// GET /api/v1/search?q=<query>&kind=<filters.kinds[0] if exactly one>&limit=<clamped>&offset=<clamped>
// NOTE: server search `kind` param is singular (store signature: kind?: NodeKind) — if
// filters.kinds.length > 1, the client does NOT call search per-kind; it sends no kind
// param and applies the multi-kind filter client-side to the returned rows. This keeps
// exactly one server contract in play (see AD "filters are a rendering overlay").

// filterState.ts
export function defaultFilters(): SearchFilters;
export function filtersActive(filters: SearchFilters): boolean;
export function applyFiltersToGraph(
  graph: RenderableGraph,
  filters: SearchFilters
): RenderableGraph; // returns a new object; never mutates graph in place

// useSearchStore.ts
export interface SearchState {
  query: string;
  filters: SearchFilters;
  results: SearchApiResult | null;
  status: "idle" | "loading" | "ok" | "empty" | "ambiguous_adjacent" | "error";
  errorMessage: string | null;
}
export function useSearchStore(): SearchState & {
  setQuery(q: string): void;
  setFilters(f: SearchFilters): void;
  selectResult(entityKey: string): void;   // focuses+zooms graph, opens inspection panel
};
```

Empty/ambiguous state derivation (pure, deterministic from `SearchApiResult`):
- `query.trim() === ""` → `status: "idle"` (no request sent; store never
  calls `fetchSearch` for a blank query — matches store's `toFtsQuery`
  returning `null`/server's `400 empty_query`, never surfaced as a request).
- `results.total === 0` → `status: "empty"`.
- `results.rows.length >= 2 && results.rows[0].exactMatch &&
  results.rows[1].exactMatch` → `status: "ambiguous_adjacent"` (informational
  banner, list still fully shown and selectable).
- Otherwise `status: "ok"`.

## 11. Ordered implementation procedure

1. `filterState.ts` + `filterState.test.ts`: write `defaultFilters`,
   `filtersActive`, `applyFiltersToGraph` with tests asserting (a) default
   filters mark everything visible, (b) a kind filter hides non-matching
   nodes without removing them from the underlying graph object identity
   check, (c) `applyFiltersToGraph` never mutates its input (`Object.is`
   inequality check on returned vs input graph). Run `pnpm test` — green.
2. `searchApi.ts` + `searchApi.test.ts`: implement `fetchSearch` with
   limit/offset clamping and generation tagging; mock `fetch`, assert (a)
   query string is built correctly including the single-`kind`-or-none rule,
   (b) a response tagged with a stale generation is still returned by the
   promise (caller decides whether to apply it — the guard is the caller's
   job, tested in step 4) but the function itself always resolves with the
   `generation` it was given echoed back for the caller to compare.
3. `useSearchStore.ts`: implement the store wired to `fetchSearch` with a
   250 ms debounce and monotonic generation counter; state transitions per
   §10's derivation rules. Test: typing three queries in quick succession
   with out-of-order-resolving mocked responses results in the store
   reflecting only the last query's results (generation guard test).
4. `ResultList.tsx`: keyboard-navigable listbox (`role="listbox"`,
   `role="option"` rows, roving `tabindex`, arrow-key navigation, `Enter`/
   `Space` selects, per §19). Component test: arrow-down moves active
   descendant, `Enter` calls `onSelect` with the focused row's entityKey.
5. `SearchPanel.tsx`: compose input + filter controls + `ResultList`; wire
   `selectResult` to 08-02's camera-focus API and 08-06's panel-open API
   (call by the interface name those blueprints define — if not yet built
   in this session's checkout, stub with a documented `ASSUMPTION:` naming
   the expected function signature, per template rule). Component test:
   typing renders results; selecting a result invokes the focus/panel
   callbacks with the correct entityKey.
6. Wire empty/zero-result/ambiguous-adjacent banners into `SearchPanel`;
   assert each renders distinct, non-blank text (§13 test list).
7. Full gate run (§15); update `IMPLEMENTATION_STATUS.md` and this
   blueprint's status per the template.

## 12. Data and lifecycle flows

**Startup:** `SearchPanel` mounts idle; no request until first non-blank
keystroke.

**Query flow:** keystroke → debounce timer (250 ms) resets → on fire,
generation counter increments → `fetchSearch` called with clamped
limit/offset and the new generation → on resolve, store compares
`response.generation === currentGeneration`; if not equal, response is
discarded (a newer query is already in flight or resolved) → if equal,
`results`/`status` update, filters re-applied to the currently rendered
graph (a search does not change what's fetched at the graph-data level,
only the search-panel's own result list, per AD "filters are a rendering
overlay" — the graph nodes were already fetched by 08-02/03/04's level
loads).

**Selection flow:** `selectResult(entityKey)` → look up entity's frozen
layout position (already-loaded level cache, or fetch `/api/v1/layout` for
its level if not yet loaded) → camera API pans/zooms deterministically →
08-06 panel-open API called with `entityKey`.

**Filter-toggle flow:** filter checkbox change → `setFilters` →
`applyFiltersToGraph` recomputes visibility for the currently rendered
graph (no network call) → Sigma re-renders dimmed/hidden state.

**Failure:** `fetchSearch` network/HTTP error → `status: "error"`,
`errorMessage` set from the structured `ApiError.detail` (never a raw stack
trace) → banner shown with a retry affordance (re-fires the same query at
the current generation + 1).

**Shutdown:** no persistent connection owned by this feature; unmount clears
the debounce timer.

## 13. Test plan

Unit (Vitest, matching existing repo convention):
- `filterState.test.ts`: default-visible-all; kind filter hides
  non-matching; no-mutation invariant; multi-select relation/origin/
  confidence/resolution combinations narrow correctly (assert intersection
  semantics, not union, across different filter categories — a node/edge
  must satisfy *all* active category filters simultaneously).
- `searchApi.test.ts`: query-string construction (single vs. multi kind);
  limit clamp at 100; offset clamp at 1,000,000; generation echoed back.
- `useSearchStore` behavior tests: debounce timing (fake timers), generation
  guard discards stale response, idle/empty/ok/ambiguous_adjacent/error
  status derivation for representative `SearchApiResult` fixtures.

Component (React Testing Library, matching 08-02's chosen test setup):
- `SearchPanel.test.tsx`: typing populates results; blank query shows idle
  copy, not an empty-looking list; zero-result query shows explicit "no
  matches" copy distinct from idle copy; two-tied-exact-match fixture shows
  the ambiguous-adjacent banner; selecting a result calls the focus and
  panel-open callbacks with the right entityKey; filter toggle changes
  visible-count without a new network call (assert `fetch` mock call count
  unchanged across a filter toggle).
- `ResultList.test.tsx`: arrow-key roving focus; `Home`/`End` jump to
  first/last (per §19); `Enter`/`Space` selection; screen-reader label text
  present per row (kind + name, not just name).

Accessibility (executed here as a scoped pre-check; the full gate lives in
08-11): axe-core zero-violation check on `SearchPanel` in isolation
(rendered with a representative result set) — this blueprint's own test
suite includes this check; 08-11 re-runs it as part of the whole-app sweep
and is the blocking gate for release, not a duplicate requirement.

Regression: none pre-existing (new feature); no fixture files touched.

## 14. Acceptance criteria

- [ ] `GET /api/v1/search` is called with `limit<=100` and `offset<=1000000`
      on every request the UI issues, with no client path that can construct
      an out-of-range value.
- [ ] Result ordering in the rendered list matches server response order
      verbatim (exact-match-first, then rank) — the UI never re-sorts.
- [ ] Every rendered result row shows kind, name, file:line (when present),
      freshness/stale indicator; no row omits these silently.
- [ ] Toggling any filter category never triggers a `/api/v1/nodes` or
      `/api/v1/edges` network call (filters are render-only over already-
      fetched data) — verified by a test asserting fetch-mock call count is
      unchanged across a filter toggle.
- [ ] Blank query, zero-result query, and ambiguous-adjacent (tied exact
      matches) each render distinct, non-empty explanatory text.
- [ ] Selecting a result deterministically focuses/zooms to that entity's
      persisted layout position (no ad-hoc recompute) and opens exactly one
      inspection panel instance (never two, never a duplicate sidebar).
- [ ] Every interactive control (search input, each filter, every result
      row) is reachable and operable via keyboard alone, in the documented
      focus order (§19).
- [ ] axe-core reports zero violations on the `SearchPanel` component in
      isolation.
- [ ] Full existing repository gate remains green (§15).

## 15. Validation commands

Existing repository gate (preserved verbatim): `pnpm skills:check`;
`pnpm typecheck`; `pnpm lint`; `pnpm test`; `python validate_fixtures.py`;
`pnpm fixtures:validate`; `pnpm fixtures:index`; `pnpm fixtures:typecheck`;
`pnpm benchmark:incremental`; `git diff --check`; `git status --short`.

Blueprint-specific (this blueprint's own Vitest/RTL suite runs under the
existing `pnpm test`, so no separate command is added for unit/component
coverage). Post-08-11 gates this blueprint must also pass once 08-11 exists
(referenced, not defined, here): the Chromium full-flow suite's `search`
step; the keyboard-only traversal test over this surface; the axe-core
WCAG AA sweep including `SearchPanel`. These are invoked via 08-11's defined
commands (e.g. `pnpm test:e2e`, `pnpm test:a11y` — exact script names owned
by 08-11 §15) and are not re-defined here to avoid two sources of truth.

## 16. Performance budgets

- Server-side search latency: results returned in **< 150 ms** on the
  benchmark corpus DB (`scripts/benchmark-incremental.mts`'s 250,330-LOC
  corpus, indexed) for a representative query — measured server-side
  (excludes network/render), consistent with 07-01's endpoint budget; this
  blueprint's client issues no request pattern (e.g. per-keystroke without
  debounce) that would multiply that cost beyond one in-flight request per
  250 ms debounce window.
- Client-side: filter toggle re-render (`applyFiltersToGraph` +
  Sigma re-render) completes in **< 50 ms** for a package-level graph
  (<=500 nodes) so filter interaction feels immediate.
- Result-selection focus/zoom: camera animation start within **< 16 ms**
  (one frame) of the selection event — no synchronous network wait blocks
  the visual response (layout data for the current level is already
  client-resident from the level-load fetch).

## 17. Failure and recovery behavior

- Network/HTTP failure on search: `status: "error"`, explicit retry
  affordance; underlying graph render is unaffected (search failure never
  blurs/hides the graph).
- Malformed/unexpected server response shape: caught at the `searchApi.ts`
  boundary, surfaced as `status: "error"` with a generic message — never a
  raw JSON-parse exception reaching the component tree.
- Stale snapshot mid-search (server returns a `stale`/`refresh_pending`
  context): result rows still render with their own `freshness`/`stale`
  fields honestly shown per row (no global suppression of results just
  because the snapshot is refreshing) — the WS `refresh_pending`/
  `refresh_settled` events (07-01/08-09) may trigger a banner but do not
  need to be implemented by this blueprint; if 08-09 is not yet built, this
  blueprint's search UI simply does not yet show that banner —
  `ASSUMPTION:` line required if the builder session predates 08-09.
- A result's `entityKey` no longer resolves to a currently loaded level
  (e.g. its parent package was never expanded): `selectResult` falls back to
  expanding the necessary levels first (reuses 08-03/08-04's expand APIs)
  before focusing — never silently fails to navigate.

## 18. Security and privacy

- All requests target `127.0.0.1` only (inherited from the server's
  localhost-only binding — this blueprint adds no new origin).
- Query text is sent as a URL parameter to the local server only; never
  logged to any external service; the store's `toFtsQuery` already
  neutralizes FTS-syntax injection server-side, but the client also never
  constructs raw SQL/FTS syntax itself.
- No PII beyond what the repository's own source already contains
  (identifiers, file paths) is introduced by this feature.

## 19. Accessibility

- **Focus order:** search input is first in the panel's tab sequence,
  followed by filter category toggles (kind, relation, origin, confidence,
  resolution — in that fixed order), followed by the result list as one tab
  stop (roving tabindex inside).
- **Keyboard shortcuts:** `/` (when focus is not already in a text input)
  focuses the search box (documented, non-conflicting with browser
  shortcuts); `Escape` inside the search box clears the query and returns
  focus to the graph stage; within the result list, `ArrowUp`/`ArrowDown`
  move the active option, `Home`/`End` jump to first/last result,
  `Enter`/`Space` selects the active option, `Escape` closes the result
  list without clearing the query.
- **ARIA roles:** search input `role="searchbox"` with
  `aria-label="Search graph"`; result list `role="listbox"` with
  `aria-label="Search results"`; each row `role="option"`
  `aria-selected` reflecting active state; filter groups
  `role="group"` with `aria-label` naming the category
  (e.g. "Filter by kind"); live region (`aria-live="polite"`) announces
  result count and status changes ("12 of 47 results", "No matches",
  "Multiple exact matches — refine your query").
- **Screen-reader text:** each result row's accessible name includes kind
  and qualified name, not just display name, so a screen-reader user can
  disambiguate two nodes with the same display name.
- **Reduced motion:** the deterministic focus/zoom camera animation respects
  `prefers-reduced-motion` — when set, the camera jumps directly to the
  target position/zoom instead of animating (08-02's camera API is expected
  to expose this; this blueprint's `selectResult` call passes through
  whatever reduced-motion flag that API defines, never introduces a second
  animation path of its own).
- **Contrast:** filter/result-list text and focus rings meet WCAG AA
  contrast ratios (verified by 08-11's axe-core sweep; not re-litigated
  here).
- **Non-canvas fallback:** search results and filters are themselves
  ordinary DOM (not canvas-rendered), so they are inherently part of the
  accessible list/table alternative for graph content that 08-11 defines;
  this blueprint's `ResultList` is one of the surfaces 08-11's data-
  completeness contract checks against.

## 20. Documentation updates

`IMPLEMENTATION_STATUS.md` — add a dated entry once built, recording the
search/filter feature, test count added, and validation evidence. No other
existing documentation file requires edits for this blueprint's scope.

## 21. Builder final report

Require: summary; files changed; contracts implemented (confirm exact match
to §10); tests added (names + count); validation command output summary;
screenshots of the search panel in each state (idle/loading/ok/empty/
ambiguous_adjacent/error); commit SHA; known limitations; follow-on risks;
`ASSUMPTION:` lines (expected: naming of 08-02's camera/focus API and
08-06's panel-open API if built out of order).

## 22. Independent review result

Pending Wave 2 adversarial review.

## IF SOMETHING IS UNCLEAR

Smallest safe assumption + `ASSUMPTION:` line. If an assumption would let a
filter fabricate or hide the existence of data without saying so, or would
let search results silently reorder relative to the server response, stop
and report blocked — those are frozen-contract violations, not
implementation details.

## TADORI NON-NEGOTIABLES

Frozen v2.1; TS/JS only; ATLAS separate; exactly six MCP tools (this
blueprint consumes HTTP only, never MCP); stable 2D default; no seventh
tool; every visible relation keeps evidence/origin/confidence/resolution;
unresolved stays visibly unresolved; deterministic positions; no permanent
dual sidebars; localhost only; Graphify ignored reference only; never weaken
golden fixtures.
