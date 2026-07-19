---
graph_blueprint_version: 1
node_id: 08-07
state: review
phase: 8
risk: medium
complexity: M
predecessors: [08-04, 08-06]
successors: [08-11]
execution_card: blueprints/execution/08-07.md
dossier: blueprints/08-07-path-route-test-doc-displays.md
read_policy: execution-card-first
local_full_gate_budget: 1
independent_validation_budget: 1
architecture_review: on-demand-only
---

> **GRAPH EXECUTION MODE:** Read the execution card first. This long file is an evidence dossier, not mandatory context. Open only the sections linked by the card. Planning-time existence claims and line numbers are historical hints; live repository semantics win. Use one full local gate and one independent validation pass.

# BLUEPRINT 08-07: Path, route, test, and document displays

## 1. Header

- ID / Title / Phase: 08-07 — Path/route/test/doc displays — Phase 8
  (Guided 2D visualization)
- Status: review
- Primary builder: Claude Sonnet — three distinct display surfaces over
  already-frozen server endpoints and MCP `path`-tool semantics; the only
  invention risk is wording honesty (test-linkage) and parity verification,
  both fully specified below.
- Reviewer roles: Spec Guardian (parity claim, linkage-kind honesty
  wording), Accessibility Reviewer (keyboard/ARIA across three surfaces),
  Implementation Reviewer (route computed-path heuristic labeling
  correctness).
- Complexity: M (one focused builder session)
- Depends on: 08-04 (task-region symbol expansion — path/route/test/doc
  displays pivot into and out of the symbol-level graph view this provides),
  08-06 (inspection & evidence panels — this blueprint's route/test/doc rows
  open into 08-06's panel for full detail, and reuses its evidence-list/
  provenance-badge components rather than re-implementing them)
- Unlocks: 08-11 (this is a required full-flow test surface: "path display"
  is explicitly named in the Chromium flow enumeration)
- Estimated sessions: 1
- Related frozen-spec sections: six-tool MCP `path` tool (frozen tool set,
  `packages/mcp/src/contracts.ts` `TOOL_NAMES`); static test linkage is
  never presented as runtime coverage (non-negotiable list); agent
  observation honesty vocabulary ("not observed inspected";
  `complete_for_registered_sources | partial | unknown`); no seventh MCP
  tool — viz consumes HTTP, never MCP, for parity (ARCHITECTURE.md AD-002).

## 2. Objective

A user can (a) request a path between two entities in the visual graph and
see the identical result the MCP `path` tool would return for the same
query, (b) browse a route table listing every Express/Next route node with
honest labeling of which paths are literal versus computed/heuristic, (c)
see a "likely relevant tests" display that never claims a static link is
observed runtime coverage, and (d) browse documents/ADRs with their
doc-edge evidence — all as HTTP-only displays with no MCP call from the
browser.

## 3. Why this matters

- User value: path-finding and route/test/doc browsing are core "how does
  this work" questions a repository newcomer asks; without a visual answer
  they fall back to grepping, defeating the tool's purpose.
- System value: the `path`-tool-parity requirement is a trust guarantee —
  if the visual path display could ever disagree with what an agent sees
  via MCP `path`, the two surfaces would tell contradictory stories about
  the same repository.
- Downstream: 08-11 names "path display" explicitly in its required
  Chromium flow; 09-01 (review diff) and 08B-03 (walkthrough tours) both
  reuse route/test-linkage rendering patterns established here.

## 4. Current repository evidence

Verified current (2026-07-17):

- **`path` tool semantics** (`packages/mcp/src/contracts.ts` lines 387-417,
  `pathInputSchema`/`pathOutputSchema`): input `{from, to, relations?
  (default ["calls","imports"]), k? (default 3, max 10)}`; output
  `status: "ok"|"not_found"|"ambiguous"|"no_path"|"search_limit"`, `from`/
  `to` resolved nodes (nullable), `fromCandidates`/`toCandidates` (when
  ambiguous), `paths: {nodes, edges}[]` (up to `k`), `nearestApproach`
  (up to 5 nodes, populated only when no path was found — best-effort
  "closest you can get" hint), `message` (human-readable summary).
- **`path` tool implementation** (`packages/mcp/src/tools.ts` lines
  1623-1775, `TadoriTools.path`): resolves `from`/`to` via
  `GraphService.resolveEntity` (entity key exact match, then unique
  qualified name, then unique display name — ambiguous if multiple display-
  name matches); on ambiguity, returns bounded candidate lists (capped at
  `AMBIGUITY_LIMIT = 50` via `boundedCandidates`, lines 371-401) rather than
  guessing. Path search is **breadth-first, multiple paths up to k**: a
  queue of partial paths (lines 1670-1708), each edge filtered by the
  `relations` allow-set, self-intersection prevented
  (`current.nodeKeys.includes(edge.dstEntityKey)` skip, line 1693), capped
  at 64 edges per path and 50,000 total expansions/queue size (lines
  1683-1709, `depthLimited`/`queueLimited` flags feed a
  `path_search_safety_limit`/`path_depth_safety_limit` aggregate omission).
  When no path is found, a **reverse BFS from `to`** (lines 1710-1721,
  capped at 50,000 reached nodes) computes `nearestApproach`: the up-to-5
  forward-reached nodes ranked by `(ascending reverse-distance-to-target,
  descending forward-distance-from-source, entityKey)` (lines 1722-1737) —
  this is a **best-effort proximity hint**, not a path, and must be labeled
  as such, never rendered as if it were a route.
  `status: "search_limit"` fires when the safety limits truncated the
  search before finding `k` paths or exhausting the space — this must be
  shown as an explicit "search stopped at a safety limit" state, never
  silently treated the same as `"no_path"`.
- **Route nodes**: `NODE_KINDS` includes `"route"` (`packages/core/src/
  enums.ts` line 12); `RELATIONS` includes `"routes_to"` (line 32). The
  `repoOverview` tool method (`tools.ts` lines 551-552, 609) already
  filters `this.service.graph.nodes.filter((node) => node.kind ===
  "route")` and returns up to `OVERVIEW_RESULT_LIMIT = 100` routes — the
  same filter this blueprint's route table performs, just paginated
  properly instead of hard-capped at 100 (route table scope is dedicated,
  not an overview afterthought, so it must support the full set via
  `/api/v1/routes`, ARCHITECTURE.md §3 row 12).
  ARCHITECTURE.md §3 row 12: `GET /api/v1/routes` → `{ routes: ToolNode[]
  }` — no pagination params documented; if the served repo has more routes
  than fit one response comfortably, the route table's own client-side
  virtualization/pagination must not silently truncate without saying so
  (§8 decision on this).
  **Computed-path heuristic labeling**: no single frozen field in
  `toolNodeSchema` marks "this route path is literal vs. computed" — a
  route node's `signature`/`qualifiedName`/`displayName` are the fields
  available. Express routes with a literal path (e.g. `app.get("/users/:id",
  ...)`) versus Next.js file-based routes (where the path is derived from a
  file path, e.g. `pages/users/[id].tsx` → `/users/:id`) are structurally
  different provenance; this blueprint's route table renders a route's
  `origin` (via its `routes_to` edge, since routes carry provenance on the
  edge, not the node, per the frozen schema) as the honesty signal for
  "was this path derived heuristically or read directly" — `origin:
  "compiler"` implies a directly-extracted literal path, `origin:
  "heuristic"` implies a computed/derived path (e.g. Next.js file-route
  convention mapping) — labeled explicitly in the UI as
  "path source: direct" vs. "path source: derived (heuristic)" rather than
  inventing a new node field. See §8 for the exact rule.
- **Test linkage kinds** (`packages/mcp/src/tools.ts` lines 1290-1297,
  inside `findTests`): edge `origin` maps to a `linkage` enum —
  `origin === "compiler"` → `"statically_linked"`; `origin === "heuristic"`
  → `"naming_associated"`; `origin === "git"` → `"historically_associated"`;
  anything else → `"evidence_associated"`. The schema
  (`contracts.ts` lines 317-330, `testLinkSchema`) additionally reserves
  `"package_associated"` as a valid enum value that the current
  implementation never actually produces — this blueprint's UI must still
  handle rendering it (forward-compatibly) but must not assume it appears
  in fixture data today. `findTestsOutputSchema` (lines 332-342): `heading:
  z.literal("Likely relevant tests")` (frozen exact heading text),
  `message`, `target`, `candidates` (ambiguity), `tests: testLinkSchema[]`.
  Every `testLinkSchema` entry has `runHintStatus:
  z.literal("unavailable_in_snapshot")` and `runHint: z.string().nullable()`
  — always `null` in the current snapshot schema (no stored run command);
  the UI must render this as "run command not available" rather than
  omitting the field.
  **The frozen "not observed inspected" wording** (ARCHITECTURE.md §3 row
  11, the proposed `/api/v1/tests` endpoint): `{ tests: ToolNode[];
  observed:false; note:"not observed inspected" }` — this exact string is
  the required honesty wording this blueprint must render verbatim
  somewhere in the likely-test display (a caption/tooltip near the
  heading), making explicit that a static/heuristic/git-derived linkage is
  not a claim that the test was ever executed or observed running against
  this code.
- **ARCHITECTURE.md §3 rows relevant to this blueprint:**
  - Row 10: `GET /api/v1/path` (`from`, `to`, `maxDepth?`) → `{ nodes:
    ToolNode[]; edges: ToolEdge[]; found:boolean }`. **Discrepancy note
    (flagged, not silently resolved):** this row's response shape
    (`nodes`/`edges`/`found`, no `k`-multiple-paths, no `status` enum, no
    `nearestApproach`) is **narrower** than the MCP tool's own
    `pathOutputSchema` (§4 above: `status`, `paths[]` plural,
    `nearestApproach`, `fromCandidates`/`toCandidates`). Per this
    blueprint's own parity requirement ("identical path results for
    identical queries, tested"), the HTTP endpoint's actual implementation
    (owned by 07-01) must return the **same** `pathOutputSchema`-shaped
    body the MCP tool returns — not the row's abbreviated sketch — because
    a narrower shape cannot carry `nearestApproach`/ambiguity/multi-path
    data the UI needs to be honest about search-limit and ambiguous
    states. This blueprint's own contract (§10) specifies the full
    `pathOutputSchema`-shaped response and treats ARCHITECTURE.md row 10 as
    an under-specified placeholder that 07-01 must reconcile to match the
    tool's actual output type, not as a shape this blueprint's UI can
    conform to as written. This is called out explicitly per instructions
    to surface contradictions rather than silently pick one.
  - Row 11: `GET /api/v1/tests` (`for?`) → `{ tests: ToolNode[];
    observed:false; note:"not observed inspected" }`. **Same discrepancy
    class**: this is also narrower than `findTestsOutputSchema` (no
    `testLinkSchema` with `linkage`/`edge`/`runHint`). This blueprint
    requires the richer `findTestsOutputSchema`-shaped response (same
    reconciliation note as above) so linkage-kind wording (the whole point
    of this blueprint's honesty requirement) is renderable at all.
  - Row 13: `GET /api/v1/docs` (`for?`) → `{ docs: {node:ToolNode;
    body:string|null}[] }` — this row's shape is sufficient as written for
    the documents/ADR panel (no reconciliation needed here); 08-06 already
    consumes a single-entity slice of the same endpoint for its inline
    ADR-body rendering, this blueprint's documents panel is the full
    listing-with-evidence surface.
- Files to read first: `packages/mcp/src/contracts.ts:387-417` (`path`
  schemas), `packages/mcp/src/tools.ts:1255-1346` (`findTests`),
  `packages/mcp/src/tools.ts:1623-1775` (`path`), `blueprints/
  ARCHITECTURE.md` §3 rows 10-13, `packages/core/src/enums.ts` (node
  kinds/relations/origins).
- **What does not exist yet**: `packages/server`, `apps/viz` (both
  `pending`). Written against ARCHITECTURE.md-proposed contracts, with the
  row 10/11 discrepancy explicitly flagged above rather than silently
  resolved by this blueprint alone (07-01 must confirm/implement the
  reconciled shape; this blueprint's §10 states the shape this UI requires
  and treats it as the effective contract for 08-07's own implementation).
- Gotchas: `nearestApproach` is populated **only** when `paths.length ===
  0` — a UI that always tries to render both `paths` and
  `nearestApproach` sections must gate the latter on emptiness of the
  former, otherwise it would show a misleading "nearest approach" hint next
  to a set of paths that already fully answer the query.

## 5. Scope

- **Path display**: from/to entity pickers (reusing 08-05's
  resolve-by-reference logic where possible, or a simpler direct-entity-
  key/name input), relation-set and `k` controls (bounded to the same
  `[1,10]` `k` range and 11-relation set as the tool schema), rendered
  path(s) as an ordered node/edge sequence with the same status-driven UI
  states as the tool (`ok`/`not_found`/`ambiguous`/`no_path`/
  `search_limit`), nearest-approach hint section (gated on empty `paths`),
  ambiguous-candidate picker reusing 08-06's entity-reference pivot
  pattern.
- **Route table**: paginated/virtualized table of all `route`-kind nodes,
  each row showing path (qualified/display name), method (from signature
  when derivable, else "unknown"), path-source label (direct vs. derived-
  heuristic, per §4/§8), and a link to open the row in 08-06's inspection
  panel.
  **Discovered scope gap** (not a contradiction, a gap): the frozen schema
  has no explicit "HTTP method" field on a route node; this blueprint
  derives a best-effort method label from the node's `signature`/
  `qualifiedName` text when a recognizable Express/Next convention is
  present (e.g. `app.get`, `router.post`), and renders `"method: unknown"`
  explicitly rather than guessing when it is not recognizable — never
  fabricating a method the source doesn't show.
- **Likely-test display**: reuses/renders `findTestsOutputSchema`-shaped
  data with the frozen `"Likely relevant tests"` heading, per-test linkage-
  kind badges with the exact honesty wording (§8), the frozen
  `"not observed inspected"` caption, `runHint`/`runHintStatus` rendering.
- **Documents/ADR panel**: listing of `adr`/`doc_section`-kind nodes with
  their `documents`-relation edges (doc-edge evidence), each row opens
  0-detail in 08-06's inspection panel for the full ADR body + evidence.
- Keyboard-first across all three/four surfaces: documented focus order,
  shortcuts, ARIA roles per surface.

## 6. Non-goals

- No new MCP tool, no seventh tool, no MCP protocol call from the browser —
  these displays call HTTP endpoints that internally reuse `GraphService`
  (ARCHITECTURE.md AD-002); the browser never speaks MCP.
- No boundary-rule violation badges (09-03) on the route table.
- No review-diff-specific route/test change indicators (09-05).
- No tour/walkthrough sequencing over these displays (08B-03) — this
  blueprint provides the raw browsable surfaces the tours may later link
  into, not the guided sequence itself.
- No editing of route/test/doc content — inspect-only.
- No new evidence/provenance rendering primitives — reuses 08-06's
  `EvidenceList`/badge components verbatim.

## 7. Dependencies and prerequisites

- 08-04 must supply: the symbol-level graph view and its expand/navigate
  API, so path/route/test/doc rows can pivot the main graph view to a
  specific symbol-level node when the user chooses "show in graph."
- 08-06 must supply: `useInspectionStore().openEntity`, `EvidenceList`,
  provenance-badge components — reused, not reimplemented.
- 07-01 must supply `GET /api/v1/path`, `/api/v1/routes`, `/api/v1/tests`,
  `/api/v1/docs` with response shapes reconciled to §4's discrepancy note
  (full `pathOutputSchema`/`findTestsOutputSchema` parity, not the
  abbreviated ARCHITECTURE.md row sketches).

## 8. Architectural decisions

- **Path-tool parity is verified by a shared fixture, not by trusting
  identical code paths.** "Parity" means: for a fixed `(from, to, relations,
  k)` input against a fixed snapshot, the HTTP endpoint's JSON response and
  the MCP `path` tool's JSON response are **structurally identical**
  (same `status`, same `paths` node/edge sequences in the same order, same
  `nearestApproach`). This is enforced by a parity test (§13) that calls
  both the tool method directly (in-process, via `TadoriTools.path`) and
  the HTTP endpoint (via an HTTP client against a test server instance)
  against the same fixture database and asserts deep equality of the
  response bodies (modulo the `context` block's wall-clock-independent
  fields). Rejected: asserting parity only by code review / shared-
  implementation argument — the whole point of a parity *test* is that a
  future refactor of either path cannot silently diverge without a failing
  test catching it.
- **Route path-source labeling derives from the `routes_to` edge's
  `origin`, never a new node field.** Rationale: the frozen node/edge
  schema already carries provenance on edges; adding a bespoke "is this
  computed" boolean to route nodes would be a schema change this blueprint
  has no authority to make (frozen migrations 001-006, evidence pack §3).
  Mapping: `origin: "compiler"` → "path source: direct" (extracted from a
  literal route-registration call); `origin: "heuristic"` → "path source:
  derived (heuristic)" (e.g. Next.js file-route convention); any other
  origin renders its own honest label (e.g. `"doc"` → "path source:
  documented, not code-extracted") rather than forcing every route into a
  binary direct/derived choice. Rejected: inventing a new `pathSource`
  field on the node payload — out of scope for a display blueprint and
  duplicates information the edge already carries.
- **HTTP method label is best-effort text derived client-side from
  `signature`/`qualifiedName`, explicitly `"unknown"` when unrecognized.**
  Rationale: no frozen field carries this; deriving it via a small,
  documented regex/convention table (`app.(get|post|put|delete|patch)`,
  Next.js `export function GET/POST/...`) is display-only inference that
  never touches stored data, and the explicit "unknown" fallback keeps this
  from becoming a silent fabrication. Rejected: leaving the method column
  blank when unrecognized — blank reads as "forgot to render," `"unknown"`
  reads as "checked, couldn't tell."
- **Likely-test display renders the frozen wording verbatim, not a
  paraphrase.** The heading is exactly `"Likely relevant tests"` (matches
  the tool schema's literal type) and the honesty caption is exactly
  `"not observed inspected"` somewhere near it (matching the proposed
  `/api/v1/tests` endpoint's `note` field) — both are frozen strings this
  blueprint's components render as literal string constants, not built
  from template fragments that could drift.
- **Documents panel groups by target entity, showing doc-edge evidence
  inline per row**, rather than a flat unstructured list of ADR nodes —
  rationale: an ADR/doc section is only useful in context of *what it
  documents*; grouping by `documents`-edge destination (or listing
  "ungrounded" docs with no outgoing `documents` edge as their own
  explicit section, never silently dropped) keeps the evidence chain
  visible. Rejected: a flat alphabetical doc list with no relation context
  — defeats the "evidence lists with file:line anchors" requirement this
  panel exists to satisfy.
- **All four surfaces are separate routed/tabbed views within one
  secondary panel area, not four permanent simultaneous sidebars.**
  Consistent with 08-06's "no permanent dual sidebars" rule generalized:
  path/route/test/doc displays are mutually exclusive tabs (or a single
  secondary panel that swaps content), never four panels open at once.
  Rejected: docking all four as always-visible panels — visually and
  keyboard-navigation-wise this recreates the forbidden "generic admin
  dashboard" layout the non-negotiables list explicitly rejects.

## 9. Exact file plan

All paths proposed, under `apps/viz`.

- `apps/viz/src/features/explore/ExploreTabs.tsx` — create. Tab container
  hosting Path / Routes / Tests / Docs as mutually exclusive views.
- `apps/viz/src/features/explore/PathFinder.tsx` — create. From/to pickers,
  relation/`k` controls, path results rendering, ambiguous/no-path/
  search-limit states, nearest-approach section.
- `apps/viz/src/features/explore/pathApi.ts` — create.
  `fetchPath(input): Promise<PathApiResult>`.
- `apps/viz/src/features/explore/RouteTable.tsx` — create. Paginated/
  virtualized route listing with path-source and method labels.
- `apps/viz/src/features/explore/routeLabels.ts` — create. Pure functions:
  `pathSourceLabel(origin: Origin): string`,
  `deriveMethodLabel(node: ToolNode): string`.
- `apps/viz/src/features/explore/routesApi.ts` — create.
  `fetchRoutes(): Promise<ToolNode[]>` (with route `routes_to` edge origin
  resolved per row — via the node detail's `outEdges`/`inEdges`, or a
  batched lookup; exact batching strategy decided in §11 step 3).
- `apps/viz/src/features/explore/LikelyTests.tsx` — create. Renders
  `findTestsOutputSchema`-shaped data with linkage badges and the frozen
  wording.
- `apps/viz/src/features/explore/testsApi.ts` — create.
  `fetchLikelyTests(target: string): Promise<FindTestsApiResult>`.
- `apps/viz/src/features/explore/DocumentsPanel.tsx` — create. Grouped
  ADR/doc listing with doc-edge evidence.
- `apps/viz/src/features/explore/docsApi.ts` — create.
  `fetchDocs(forEntityKey?: string): Promise<DocsApiResult>`.
- `apps/viz/src/features/explore/PathFinder.test.tsx` — create.
- `apps/viz/src/features/explore/routeLabels.test.ts` — create.
- `apps/viz/src/features/explore/LikelyTests.test.tsx` — create.
- `apps/viz/src/features/explore/DocumentsPanel.test.tsx` — create.
- `packages/server/test/path-parity.test.ts` — create (owned jointly with
  07-01's package, since the parity test must run the actual HTTP server;
  if 07-01's test scaffolding does not yet exist at this blueprint's
  execution time, this file's creation is deferred with an `ASSUMPTION:`
  line, and the parity assertion is instead written as a same-session
  TODO-marked skipped test, never silently omitted).

Integration points: `ExploreTabs` mounts into 08-02's shell (a secondary
panel slot distinct from 08-06's primary inspection panel — the two panels
may be open simultaneously since they serve different purposes: inspection
detail vs. explore/browse — but this blueprint's own four sub-views remain
mutually exclusive within `ExploreTabs` itself, per §8's decision); rows in
each view call 08-06's `useInspectionStore().openEntity` to pivot into full
detail.

## 10. Exact contracts

```ts
// pathApi.ts — full pathOutputSchema-shaped response (see §4 discrepancy note)
export interface PathQuery {
  from: string; to: string;
  relations: Relation[];   // default ["calls","imports"], 1-11 unique
  k: number;                // 1-10, default 3
}
export interface PathApiResult {
  status: "ok" | "not_found" | "ambiguous" | "no_path" | "search_limit";
  from: ToolNode | null;
  to: ToolNode | null;
  fromCandidates: ToolNode[];
  toCandidates: ToolNode[];
  paths: { nodes: ToolNode[]; edges: ToolEdge[] }[];
  nearestApproach: ToolNode[];   // populated only when paths.length === 0
  message: string;
}
export function fetchPath(query: PathQuery): Promise<PathApiResult>;

// routeLabels.ts
export function pathSourceLabel(origin: Origin): string;
// "compiler" -> "path source: direct"
// "heuristic" -> "path source: derived (heuristic)"
// "doc" -> "path source: documented, not code-extracted"
// "git" -> "path source: derived from history"
// "human" -> "path source: human-annotated"
// "llm" -> "path source: LLM-derived"   [documented for completeness; not
//           expected to occur for route-origin edges under current extraction]
export function deriveMethodLabel(node: ToolNode): string;
// recognized Express/Next convention -> "GET"/"POST"/"PUT"/"DELETE"/"PATCH"
// unrecognized -> "unknown"

// routesApi.ts
export interface RouteRow {
  node: ToolNode;
  pathSourceOrigin: Origin | null;   // null only if the route has no routes_to edge (edge case, rendered explicitly)
  methodLabel: string;
}
export function fetchRoutes(): Promise<RouteRow[]>;

// testsApi.ts — full findTestsOutputSchema-shaped response
export interface FindTestsApiResult {
  status: "ok" | "not_found" | "ambiguous";
  heading: "Likely relevant tests";   // frozen literal
  message: string;
  target: ToolNode | null;
  candidates: ToolNode[];
  tests: {
    test: ToolNode;
    edge: ToolEdge;
    linkage: "statically_linked" | "naming_associated" | "package_associated"
      | "historically_associated" | "evidence_associated";
    runHint: string | null;
    runHintStatus: "unavailable_in_snapshot";
  }[];
}
export function fetchLikelyTests(target: string): Promise<FindTestsApiResult>;

// docsApi.ts
export interface DocsApiResult {
  docs: { node: ToolNode; body: string | null; documents: ToolEdge[] }[];
  ungrouped: { node: ToolNode; body: string | null }[];  // no outgoing documents edge
}
export function fetchDocs(forEntityKey?: string): Promise<DocsApiResult>;
```

Linkage-kind wording map (frozen honesty phrasing, rendered per test row in
`LikelyTests.tsx`):

| `linkage` value | Rendered label |
|---|---|
| `statically_linked` | "Statically linked (compiler-verified reference)" |
| `naming_associated` | "Naming-associated (heuristic match)" |
| `package_associated` | "Package-associated (same package, no direct link)" |
| `historically_associated` | "Historically associated (co-change pattern)" |
| `evidence_associated` | "Evidence-associated (documented or annotated link)" |

Every row additionally carries the frozen caption
`"not observed inspected"` near the section heading, and never a phrase
like "verified passing," "covers," or "tested by" that would imply runtime
execution was observed.

## 11. Ordered implementation procedure

1. `routeLabels.ts` + `routeLabels.test.ts`: implement `pathSourceLabel`
   (exhaustive switch over all 6 `Origin` values, no `default` fallthrough
   so a future new origin fails typecheck rather than silently mislabeling)
   and `deriveMethodLabel` (regex table + explicit `"unknown"` fallback).
   Tests: each origin maps to its documented label; recognized Express/Next
   patterns map to the right method; an unrecognized signature yields
   `"unknown"`.
2. `pathApi.ts` + a parity fixture test: implement `fetchPath`; write
   `packages/server/test/path-parity.test.ts` (or the deferred/skipped
   version per §9's note) asserting deep-equal `paths`/`status`/
   `nearestApproach` between `TadoriTools.path(input)` called in-process and
   the HTTP endpoint's JSON response for 3 representative queries (an
   `"ok"` multi-path case, a `"no_path"` case with a populated
   `nearestApproach`, and an `"ambiguous"` case) against one of the existing
   fixture repositories/snapshots.
3. `routesApi.ts`: implement `fetchRoutes`, resolving each route's
   `routes_to` edge origin via the node detail's `inEdges` (a route node is
   typically the destination of a `routes_to` edge from its handler/file —
   confirm edge direction against a fixture before finalizing; if the
   fixture shows the reverse direction, resolve via `outEdges` instead —
   `ASSUMPTION:` line required either way, verified against fixture 02/03
   data, `packages/fixtures/02-express-routes`/`03-next-routes`).
4. `PathFinder.tsx`: from/to inputs, relation/`k` controls, status-driven
   result rendering (`ok`/`not_found`/`ambiguous`/`no_path`/
   `search_limit`), nearest-approach section gated on `paths.length === 0`.
   Tests: each status renders distinct, correctly-worded UI; nearest-
   approach section absent when paths are present.
5. `RouteTable.tsx`: virtualized/paginated table using `fetchRoutes`'s
   `RouteRow[]`; row click opens 08-06's inspection panel via
   `openEntity`. Test: path-source and method columns render the documented
   labels; `pathSourceOrigin: null` case renders an explicit
   "no route-registration edge found" cell rather than a blank one.
6. `LikelyTests.tsx`: renders `FindTestsApiResult` with the frozen heading,
   linkage badges (exact wording table above), the `"not observed
   inspected"` caption, and `runHint`/`runHintStatus` rendering ("run
   command not available" when `runHint === null`). Test: every linkage
   kind (including the schema-reserved but currently-unproduced
   `package_associated`) renders its documented label without crashing;
   the frozen heading and caption strings are asserted verbatim.
7. `DocumentsPanel.tsx`: grouped rendering per §8's decision, with an
   explicit "documents with no outgoing citation" section for the
   `ungrouped` array (never silently dropped). Test: a doc with zero
   `documents` edges appears in the ungrouped section, not omitted.
8. `ExploreTabs.tsx`: mutually exclusive tab composition; wires each view's
   row-click to `openEntity`. Test: switching tabs never leaves two views
   simultaneously mounted.
9. Full gate run (§15); update `IMPLEMENTATION_STATUS.md`.

## 12. Data and lifecycle flows

**Path query:** user fills from/to (+ optional relation/`k` overrides) →
submit → `fetchPath` → status-driven render (ambiguous → candidate picker
reusing 08-06's entity-pivot pattern; no_path → nearest-approach hint;
search_limit → explicit "search stopped at a safety limit, narrow your
query" notice; ok → ordered node/edge sequence per found path, each
node/edge clickable into 08-06's panel).

**Route browse:** tab opens → `fetchRoutes` (paginated/virtualized) →
table renders; row click → `openEntity` (08-06) for full detail, and
optionally "show in graph" pivots the main Sigma view to that route's
symbol-level position (reuses 08-04's expand-to-node API).

**Likely-test browse:** user provides a target reference (from a route row,
a node's inspection panel "show likely tests" action, or a direct input in
this tab) → `fetchLikelyTests` → rendered per §10's wording table.

**Documents browse:** tab opens → `fetchDocs()` (all docs) or
`fetchDocs(entityKey)` (scoped from an inspection-panel pivot) → grouped
render; row click → `openEntity`.

**Failure:** any of the four fetches erroring renders that tab's own error
notice, not a whole-panel crash — tabs are independent failure domains.

## 13. Test plan

Unit (Vitest): `routeLabels.test.ts` (exhaustive origin/method mapping);
`routesApi.test.ts` (edge-direction resolution, mocked fixture data);
`pathApi.test.ts` (query construction, status pass-through).

Parity (integration, the blueprint's most important test):
`packages/server/test/path-parity.test.ts` — in-process `TadoriTools.path`
vs. HTTP endpoint, deep-equal assertion (excluding wall-clock context
fields) across the three representative query classes in §11 step 2. This
test is the binding acceptance mechanism for the "parity means identical
path results for identical queries, tested" requirement — not a UI
snapshot test.

Component (React Testing Library): `PathFinder.test.tsx` (all 5 status
states render distinct correct text); `RouteTable.test.tsx` (label
columns, null-origin cell); `LikelyTests.test.tsx` (all 5 linkage kinds,
frozen heading/caption strings asserted verbatim, `runHint` null-state
text); `DocumentsPanel.test.tsx` (grouped vs. ungrouped sections both
render, nothing dropped).

Accessibility (scoped pre-check; full gate in 08-11): axe-core
zero-violation check on `ExploreTabs` cycled through all four tab states.

Regression: none pre-existing; fixture repositories 02 (`express-routes`)
and 03 (`next-routes`) are read-only inputs to the route-edge-direction
`ASSUMPTION:` verification in step 3, never modified.

## 14. Acceptance criteria

- [ ] The path parity test (`path-parity.test.ts`) passes for all three
      representative query classes with deep-equal `status`/`paths`/
      `nearestApproach` between the in-process tool call and the HTTP
      endpoint.
- [ ] `nearestApproach` is rendered only when `paths.length === 0`; never
      alongside a populated `paths` array.
- [ ] Every route row shows a path-source label and a method label (never
      blank — `"unknown"`/explicit null-origin text used instead of empty
      cells).
- [ ] The likely-test display's heading reads exactly `"Likely relevant
      tests"` and the `"not observed inspected"` caption is present and
      verbatim, on every render of that view.
- [ ] No test-linkage wording anywhere in this blueprint's output implies
      the test was executed or observed passing (verified by a text-content
      assertion that none of the five documented labels or the heading/
      caption contain the words "passing," "verified running," or "covers"
      in a coverage-claiming sense).
- [ ] Documents panel shows every fetched doc node exactly once, in either
      the grouped or ungrouped section — none silently dropped (count
      assertion: `docs.length + ungrouped.length === total fetched`).
- [ ] `ExploreTabs` never renders two of its four sub-views simultaneously.
- [ ] Every interactive control across all four surfaces is reachable and
      operable via keyboard alone (§19).
- [ ] axe-core reports zero violations on `ExploreTabs` across all four tab
      states.
- [ ] Full existing repository gate remains green (§15).

## 15. Validation commands

Existing repository gate (preserved verbatim): `pnpm skills:check`;
`pnpm typecheck`; `pnpm lint`; `pnpm test`; `python validate_fixtures.py`;
`pnpm fixtures:validate`; `pnpm fixtures:index`; `pnpm fixtures:typecheck`;
`pnpm benchmark:incremental`; `git diff --check`; `git status --short`.
The parity test runs under `pnpm test` (no separate script needed — it is
an ordinary Vitest file in `packages/server/test/`).

Post-08-11 gates this blueprint must also pass once 08-11 exists
(referenced, not defined): Chromium full-flow suite's "path display" step
(named explicitly in 08-11's flow enumeration); keyboard-only traversal
test over all four `ExploreTabs` views; axe-core WCAG AA sweep including
`ExploreTabs`.

## 16. Performance budgets

- Path query: server-side response in **< 150 ms** for a `k<=10` query on
  the benchmark corpus (consistent with the search budget in 08-05 and
  07-01's endpoint budgets generally) — the BFS/reverse-BFS safety limits
  (50,000 expansions) already bound worst-case server compute independent
  of this UI's behavior.
- Route table initial render: **< 100 ms** after `fetchRoutes` resolves,
  for up to 500 routes (virtualized list, not full DOM materialization of
  every row at once).
- Panel-open-after-row-click: inherits 08-06's **< 100 ms** post-data-arrival
  budget (this blueprint does not redefine it, only invokes
  `openEntity`).

## 17. Failure and recovery behavior

- Path query network/HTTP failure: `PathFinder` shows an explicit error
  notice with retry; does not clear previously successful results until
  the retry resolves.
- Route/test/doc fetch failure: that tab alone shows an error notice;
  switching to another tab is unaffected (independent failure domains, per
  §12).
- Ambiguous from/to in path query: candidate picker reuses 08-06's pivot
  pattern — selecting a candidate re-issues the query with the resolved
  entity key substituted for the ambiguous reference string.
- Stale snapshot mid-browse: route/test/doc rows carry their own
  `freshness`/`stale` fields (via `ToolNode`) rendered honestly per row,
  same pattern as 08-05/08-06 — no global suppression.

## 18. Security and privacy

- All fetches target `127.0.0.1` only.
- No write requests anywhere in this blueprint's API wrappers (inspect-only
  product).
- Route/test/doc content is repository source-derived text already subject
  to the server's own confinement/redaction rules (07-01's responsibility);
  this blueprint introduces no new file-read path of its own (it consumes
  `/api/v1/routes`/`/api/v1/tests`/`/api/v1/docs`/`/api/v1/path`, never
  `/api/v1/source` directly — source viewing for any entity surfaced here
  goes through 08-06's panel, which owns that boundary).

## 19. Accessibility

- **Focus order (per tab):** tab list itself first (standard tab-panel
  keyboard pattern: `ArrowLeft`/`ArrowRight` moves between tabs, `Tab` key
  moves into the active panel's content), then the active view's own
  controls in reading order (PathFinder: from input, to input, relation
  filter, `k` control, submit, results list; RouteTable: table with
  standard row/cell navigation; LikelyTests: target input then results
  list; DocumentsPanel: grouped list with roving tabindex).
- **Keyboard shortcuts:** standard ARIA tabs pattern
  (`ArrowLeft`/`ArrowRight`/`Home`/`End` within the tab list, `Enter`/
  `Space` activates a tab); no additional global shortcuts introduced by
  this blueprint beyond what 08-05/08-06 already define.
- **ARIA roles:** `ExploreTabs` root uses `role="tablist"` with each tab
  `role="tab"` `aria-selected` and each view `role="tabpanel"`
  `aria-labelledby` its tab; `RouteTable` uses a real `<table>` with
  `<th scope="col">` headers (path, method, path-source, actions) so
  screen readers get standard table navigation; `LikelyTests`' result list
  uses `role="list"`/`role="listitem"` with each item's accessible name
  including the linkage-kind label, not just the test name.
- **Screen-reader text:** the frozen `"not observed inspected"` caption
  and linkage-kind labels are real text content (not icon-only), read in
  full by assistive tech.
- **Reduced motion:** tab-switch transitions (if any) respect
  `prefers-reduced-motion`; "show in graph" pivots reuse 08-02/08-05's
  reduced-motion-aware camera behavior, not a new animation.
- **Contrast:** table text, badges, and tab indicators meet WCAG AA
  (verified by 08-11's sweep).
- **Non-canvas fallback:** `RouteTable` in particular is itself a literal
  table — it is one of the concrete surfaces satisfying 08-11's accessible
  list/table alternative for graph content, specifically for `route`-kind
  nodes; this blueprint's route/test/doc data must appear in that
  alternative with the same provenance fields as the canvas view (08-11's
  data-completeness contract references this blueprint's output as a
  source of truth for that check).

## 20. Documentation updates

`IMPLEMENTATION_STATUS.md` — dated entry once built. The ARCHITECTURE.md
§3 rows 10/11 discrepancy (narrow row sketch vs. required full
`pathOutputSchema`/`findTestsOutputSchema` parity) should be reconciled in
ARCHITECTURE.md itself by whichever of 07-01/08-07 lands first — this
blueprint does not edit ARCHITECTURE.md itself (out of this blueprint's
file-edit scope per the task's "do not edit existing files" instruction);
it is flagged here for the reviewer/next planning pass to correct there.

## 21. Builder final report

Require: summary; files changed; contracts implemented (confirm match to
§10, and explicit confirmation of how the row 10/11 discrepancy was
resolved in the actual 07-01 implementation encountered); tests added
(names + count, with the parity test's three query classes named
explicitly); validation output summary; screenshots of each of the four
tab states including at least one non-`"ok"` status per surface; commit
SHA; known limitations; follow-on risks; `ASSUMPTION:` lines (expected:
`routes_to` edge direction verified against fixture 02/03; parity test
deferred/skipped status if 07-01's server test scaffolding did not yet
exist).

## 22. Independent review result

Pending Wave 2 adversarial review.

## IF SOMETHING IS UNCLEAR

Smallest safe assumption + `ASSUMPTION:` line. If an assumption would let
the path display disagree with the MCP tool's actual output for the same
query, or would let test-linkage wording imply observed runtime coverage,
stop and report blocked — those are frozen-contract violations, not
implementation details.

## TADORI NON-NEGOTIABLES

Frozen v2.1; TS/JS only; ATLAS separate; exactly six MCP tools, no
seventh — viz consumes HTTP only, this blueprint's path display never
calls MCP directly; stable 2D default; every visible relation keeps
evidence/origin/confidence/resolution; static test linkage is never
runtime coverage (this blueprint's central honesty requirement); agent
observation honesty vocabulary; localhost only; Graphify ignored reference
only; never weaken golden fixtures.
