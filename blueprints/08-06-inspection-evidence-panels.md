# BLUEPRINT 08-06: Inspection & evidence panels

## 1. Header

- ID / Title / Phase: 08-06 — Inspection & evidence panels — Phase 8 (Guided
  2D visualization)
- Status: review
- Primary builder: Claude Sonnet — a single dismissible side panel over
  already-frozen server endpoints (node/edge detail, evidence, source-slice);
  no new backend semantics, careful UI-state and safe-link construction.
- Reviewer roles: Spec Guardian (evidence/provenance honesty, source-slice
  confinement), Accessibility Reviewer (single-panel/no-dual-sidebar rule,
  keyboard), Security Reviewer (deep-link safe-link policy, root
  confinement).
- Complexity: M (one focused builder session)
- Depends on: 08-02 (`apps/viz` scaffold — provides the shell this panel
  docks into and the selection state it reads)
- Unlocks: 08-07 (path/route/test/doc displays reuse this panel's evidence-
  list and source-view components), 09-01 (review diff UI reuses the same
  evidence/provenance rendering), 08-11 (this is a required full-flow and
  keyboard-traversal test surface)
- Estimated sessions: 1
- Related frozen-spec sections: evidence/origin/confidence/resolution
  visible on every displayed relation (non-negotiable list); "no permanent
  dual sidebars" (non-negotiable list); inspect-only product, Tadori never
  edits repositories; `vscode://file/...` deep links with a safe-link policy
  (BACKLOG.md locked decisions); design rationale only from ADRs/docs,
  otherwise exactly "No documented design decision found" (non-negotiable
  list).

## 2. Objective

Selecting any node or edge in the graph opens exactly one dismissible side
panel showing its evidence (file:line anchors), a root-confined source
slice, ADR/design-rationale body when one exists (or the literal fallback
string when none does), a safe `vscode://` deep link, and provenance badges
— with stale source bodies clearly suppressed rather than silently shown as
current.

## 3. Why this matters

- User value: every claim the graph makes (an edge exists, a node has a
  certain kind) must be checkable against real source in one click, or the
  tool is just another unverifiable diagram.
- System value: this is the single reusable "detail surface" every other
  Phase 8/9 feature (search results, path displays, route tables, review
  diffs) opens into — building it once here, correctly, avoids five
  divergent detail-panel implementations later.
- Downstream: 08-07 (route/test/doc displays), 09-01 (review diff detail),
  08-05 (search result selection target).

## 4. Current repository evidence

Verified current (2026-07-17):

- ARCHITECTURE.md §3 (HTTP endpoint table), rows relevant to this blueprint:
  - `GET /api/v1/nodes/:entityKey` → `ToolNode & { outEdges: ToolEdge[];
    inEdges: ToolEdge[]; fanIn: number }`; errors `404 unknown_entity`,
    `409 ambiguous`. Owner 07-01.
  - `GET /api/v1/nodes/:entityKey/evidence` → `{ evidence: Evidence[];
    freshness }`; error `404`. Owner 07-01.
  - `GET /api/v1/source` (params `file` repo-relative, `lineStart?`,
    `lineEnd?`) → `{ body: string|null; freshness; staleReason }`; errors
    `403 outside_repository`, `404 not_in_snapshot`,
    `409 content_changed`. Owner 07-01.
  - `GET /api/v1/docs` (param `for?` entityKey) → `{ docs: {node:ToolNode;
    body:string|null}[] }` (ADR/doc bodies, root-confined). Owner 08-07 —
    this blueprint (08-06) renders a **single** ADR/doc body inline when the
    inspected entity has exactly one directly-linked `documents` edge; the
    full documents/ADR **panel** with doc-edge evidence tables is 08-07's
    scope (08-06 depends on 08-07 only for that larger surface, not for
    single-entity ADR-body rendering here — see §6 non-goals for the exact
    boundary).
  Shared `ApiContext`/`ApiError` envelope (§3 preamble): `ApiError` "never
  leaks abs paths" — this blueprint's error rendering must not print a raw
  filesystem path from a 403/404/409 body.
- `packages/mcp/src/contracts.ts` `toolNodeSchema` (lines 49-69) and
  `toolEdgeSchema` (lines 71-88) — the exact fields every panel must be able
  to render: node has `evidence: Evidence[]`, `evidenceOmittedCount`,
  `freshness`, `stale`, `staleReason`; edge has the same plus `origin`,
  `confidence`, `resolution`. `toolEvidenceSchema` (lines 36-47): `file`,
  `kind` (one of the 5 `EVIDENCE_KINDS`: source/documentation/git/
  human_annotation/tool_event), `lineStart`/`lineEnd` (1-based),
  `columnStart`/`columnEnd` (nullable), `commitSha` (nullable),
  `excerptHash` (nullable).
- `packages/mcp/src/service.ts` `GraphService.readBody` (lines 332-354):
  returns `{ body: string|null; status; stale; reason }`; `body` is `null`
  whenever the node has no file/line span, or the live file no longer
  matches the served snapshot (`loadSnapshotFile` freshness check, lines
  194-217: hashes the live file and compares to `snapshotFile.contentHash`;
  mismatch → `reason: "content_changed"`, `body: null` upstream). This is
  the **stale-body suppression** the objective refers to: a stale file is
  never rendered as if it were current — the server itself returns `null`
  body plus an honest `staleReason`, and the source-slice endpoint
  (`/api/v1/source`) is expected to surface the same `409 content_changed`/
  `staleReason` contract (07-01's responsibility to implement per §3; this
  blueprint's job is to render that response state honestly, never to
  paper over a `null` body with cached or guessed content).
- `packages/mcp/src/tools.ts` `evidence()` helper (lines 284-299):
  evidence array is capped at `EVIDENCE_RESULT_LIMIT = 20` per node/edge,
  with `evidenceOmittedCount` recording the remainder — the panel must show
  this count explicitly when nonzero ("+N more anchors"), never silently
  drop it.
- `docs/CLI_CONTRACT.md` / BACKLOG.md: inspect-only product — "Tadori never
  edits repositories." `vscode://file/...` deep links, safe-link policy:
  "only repository-root-confined absolute paths, encoded" (task
  instructions, consistent with `GraphService`'s own root-confinement logic
  at `service.ts:168-192` `resolveSnapshotPath` — resolves against
  `nativeRepoRoot`/`realRepoRoot` via `realpathSync.native`, rejects any
  path whose relative-to-root climbs above the root (`..` prefix check) —
  this is the exact confinement logic the source-slice endpoint (07-01)
  is expected to reuse; this blueprint's deep-link builder must independently
  never emit a path that escapes the repo root, as a client-side defense in
  depth even though the server is the enforcing boundary).
- ARCHITECTURE.md §10: viz is HTTP/WS-only, no fs access — this blueprint's
  "source view" is **always** a server round-trip to `/api/v1/source`,
  never a direct file read from the browser (browsers cannot do this
  anyway, but the constraint also forbids any Electron/Node-bridge shortcut
  later).
- Design rationale (ADR) rendering: no ADR/decision-linking endpoint beyond
  `/api/v1/docs` exists yet; `migrations.ts` migration 2 (`decision_entities`,
  `decision_links`, evidence pack §3) is the frozen schema this eventually
  reads from. When an inspected node/edge has no ADR/decision link
  reachable through that schema, the panel renders exactly the string
  `"No documented design decision found."` — never a fabricated rationale,
  never silence (an empty section with no text at all is not acceptable;
  the exact string is required per the frozen non-negotiable).
- Files to read first: `packages/mcp/src/contracts.ts:36-89` (node/edge/
  evidence schemas), `packages/mcp/src/service.ts:168-354` (root
  confinement, freshness, `readBody`), `blueprints/ARCHITECTURE.md` §3 (rows
  6-8, 13) and §10, `packages/store/src/migrations.ts` migration 2 section
  (decision schema, for the ADR-body query shape 07-01/08-07 will expose).
- **What does not exist yet**: `packages/server`, `apps/viz` (INDEX.md rows
  07-01, 08-02, both `pending`). This blueprint is written against the
  ARCHITECTURE.md-proposed contracts of both.
- Gotchas: `evidenceOmittedCount` and `staleReason` must both always render
  — a panel that shows evidence but omits the omitted-count, or shows a
  body without checking `stale`, silently violates the honesty
  non-negotiable. The `/api/v1/nodes/:entityKey` `409 ambiguous` case (an
  entity key that somehow resolves to multiple candidates — should not
  normally occur since entity keys are unique per snapshot, but the
  endpoint contract reserves the code) must have a defined, non-crashing UI
  state even if rare.

## 5. Scope

- Single side panel component, mounted at most once at a time, dismissible
  (explicit close control + `Escape`), replacing its previous content
  (never stacking a second panel instance) when a new node/edge is
  selected.
- Node inspection view: kind, qualified/display name, file:line, signature,
  exported flag, fan-in, freshness/stale badge, evidence list, ADR/doc
  single-body section (or the fallback string), outgoing/incoming edge
  summary counts with a way to pivot to viewing those edges (does not
  itself render full route/test/doc tables — that is 08-07).
- Edge inspection view: relation, origin/confidence/resolution provenance
  badges (always visible, never omitted), source/destination entity
  references (clickable to pivot the panel to that node), evidence list,
  freshness/stale badge.
- Evidence list rendering: each anchor shows file, kind, line range,
  `commitSha` when present, and a safe `vscode://file/...` deep link built
  per the safe-link policy (§8/§18); `evidenceOmittedCount` rendered as an
  explicit "+N more" note when nonzero.
- Source view: fetches a bounded slice (never the whole file) via
  `/api/v1/source` for the entity's own span (or an evidence anchor's
  span when the user pivots to a specific anchor), renders read-only,
  monospace, line-numbered; honors the endpoint's stale/error responses
  honestly.
- ADR body rendering for the single directly-linked document/ADR (if any)
  on the inspected entity; exact fallback string when none.
- Provenance badges on every displayed edge and on the node's own header
  freshness indicator.
- Keyboard-first: full reachability/operability, documented focus order.

## 6. Non-goals

- No documents/ADR **panel** listing every doc-edge across the whole
  repository with a doc-edge evidence table — that full surface is 08-07's
  scope; 08-06 only renders the single ADR/doc body directly linked to
  *this* inspected entity, inline in the node view.
- No route table, no likely-test display with linkage-kind wording — 08-07.
- No path-tool-parity path display — 08-07.
- No editing of any kind (no rename, no comment, no annotation write) — the
  product is inspect-only; this panel has zero write network calls.
- No permanent/pinned second sidebar — only one panel instance, ever.
- No full-file dump — source view is always a bounded slice.
- No observation/overlay rendering (task focus, retrieval trace) — 08-09.

## 7. Dependencies and prerequisites

- 08-02 must supply: the shell/dock slot this panel mounts into, and a
  selection-state signal (entityKey + kind of selection: node vs edge) this
  panel subscribes to — the same signal 08-05's `selectResult` writes to.
- 07-01 must supply, matching ARCHITECTURE.md §3 exactly: `GET
  /api/v1/nodes/:entityKey`, `GET /api/v1/nodes/:entityKey/evidence`,
  `GET /api/v1/source`, and (for the single ADR-body case only) enough of
  `GET /api/v1/docs?for=<entityKey>` to fetch zero-or-one linked document
  bodies for a given entity.

## 8. Architectural decisions

- **Exactly one panel instance; new selection replaces content in place.**
  Rationale: the frozen non-negotiable forbids "permanent dual sidebars";
  generalizing that to "never more than one panel, period" is the
  simplest rule that cannot regress into two. Rejected: a stack/history of
  panels (breadcrumb-style) — adds state complexity for a feature not
  requested; a single "back" affordance (§8 below) covers the common
  pivot-then-return case without a stack.
- **Pivoting between entities from within the panel is a replace + one-slot
  back reference, not a navigation stack.** Clicking a source/destination
  entity reference inside an edge view, or an evidence anchor's owning
  entity, replaces the panel's content and remembers exactly the
  immediately-previous entityKey for a single "back" control. Rejected: an
  unbounded history stack — unrequested complexity; one level of "back"
  satisfies the natural "look at the edge, jump to its target, come back"
  flow without open-ended state.
- **Source view fetches only the entity's own declared span by default,
  never the whole file.** Matches the server's slice-only endpoint and the
  explicit "never full-file dumps beyond slice budget" constraint. A
  "view more context" affordance may request a wider but still explicitly
  bounded range (e.g. ±20 lines) via the same endpoint's `lineStart`/
  `lineEnd` params — never an unbounded fetch. Rejected: fetching the whole
  file and slicing client-side — defeats the server's root-confinement/
  slice-budget contract and reintroduces exactly the "full-file dump" the
  frozen constraint forbids.
- **Stale body is a distinct rendered state, never silently substituted.**
  When `/api/v1/source` (or the node's own `readBody`-backed detail)
  reports `stale: true`/a non-`matches_snapshot` `staleReason`, the panel
  renders an explicit "source has changed since this snapshot was indexed"
  notice **in place of** the body, never alongside a body that might be
  outdated. Rejected: showing the last-known body with a small stale badge
  — too easy to miss; a wrong-but-plausible-looking source excerpt is worse
  than an honest gap.
- **ADR/design-rationale fallback is the literal frozen string.** When no
  ADR/decision link resolves for the inspected entity, the panel renders
  exactly `"No documented design decision found."` — not a paraphrase, not
  an empty section. Rationale: this exact wording is a frozen product
  requirement (non-negotiable list) so automated a11y/text-content checks
  (08-11) can assert on it verbatim.
- **`vscode://` deep links are built client-side from the server-confirmed
  repo-relative path, never from a raw filesystem path the client
  constructs itself.** The link builder takes the entity/evidence's
  `file` (already repo-relative, as returned by the node/evidence schema)
  and the server's own repository root (obtained once from
  `GET /api/v1/snapshot`'s `context.repository`, which is an absolute,
  server-resolved path) and joins them with `path.posix.join`-equivalent
  logic, URL-encodes each path segment, and rejects (renders no link,
  rather than a broken one) if the joined path is not repo-root-confined
  itself (a redundant client-side check even though the server is the
  actual boundary — the same "confined path" test `resolveSnapshotPath`
  performs server-side, reimplemented as a pure client-side string check
  since the browser cannot call `realpathSync`). Rejected: trusting the
  `file` field verbatim without any join/confinement check — a defense-in-
  depth omission given deep links are user-clickable and could otherwise be
  crafted to reference something outside the intended target if a future
  endpoint ever returned an unconfined path by mistake.
- **Evidence-omitted count and freshness badges are structural parts of the
  evidence-list and node/edge-header components, not optional props.**
  Rationale: making them non-optional in the component's TypeScript props
  means a caller cannot compile a panel that forgets to pass them — the
  honesty requirement is enforced by the type system, not just code review
  discipline.

## 9. Exact file plan

All paths proposed, under `apps/viz` (scaffolded by 08-02).

- `apps/viz/src/features/inspect/InspectionPanel.tsx` — create. Root panel
  component; mounts at most once; reads current selection from the shared
  selection-state signal (08-02); renders `NodeView` or `EdgeView`.
- `apps/viz/src/features/inspect/NodeView.tsx` — create. Node detail
  layout: header, evidence list, source view, ADR-body section, edge-count
  summary with pivot links.
- `apps/viz/src/features/inspect/EdgeView.tsx` — create. Edge detail
  layout: provenance badges, endpoint references (pivotable), evidence
  list.
- `apps/viz/src/features/inspect/EvidenceList.tsx` — create. Shared
  evidence-anchor list component used by both views; renders deep links.
- `apps/viz/src/features/inspect/SourceView.tsx` — create. Bounded,
  line-numbered, read-only source slice renderer; stale-state notice.
- `apps/viz/src/features/inspect/deepLink.ts` — create. Pure function(s)
  building/validating `vscode://file/...` URLs per the safe-link policy.
- `apps/viz/src/features/inspect/inspectApi.ts` — create. Fetch wrappers for
  `/api/v1/nodes/:entityKey`, `/api/v1/nodes/:entityKey/evidence`,
  `/api/v1/source`, and the single-doc lookup against `/api/v1/docs`.
- `apps/viz/src/features/inspect/useInspectionStore.ts` — create. View-state
  store: current entity, one-level back reference, panel open/closed.
- `apps/viz/src/features/inspect/InspectionPanel.test.tsx` — create.
- `apps/viz/src/features/inspect/deepLink.test.ts` — create.
- `apps/viz/src/features/inspect/SourceView.test.tsx` — create.

Integration points: opened by 08-05's `selectResult`, by graph-node/edge
click handlers from 08-02/08-03/08-04, and (once built) by 08-07's route/
test/doc rows and 09-01's review diff rows — all via the same
`useInspectionStore().open(entityKey, kind)` call.

## 10. Exact contracts

```ts
// inspectApi.ts
export interface NodeDetail extends ToolNode {
  outEdges: ToolEdge[];
  inEdges: ToolEdge[];
  fanIn: number;
}
export function fetchNodeDetail(entityKey: string): Promise<
  { status: "ok"; node: NodeDetail } |
  { status: "not_found" } |
  { status: "ambiguous" } |
  { status: "error"; message: string }
>;
export function fetchEvidence(entityKey: string): Promise<
  { evidence: Evidence[]; freshness: FreshnessInfo } | { status: "error"; message: string }
>;
export interface SourceSliceResult {
  body: string | null;
  freshness: "fresh" | "stale" | "unknown";
  staleReason:
    | "matches_snapshot" | "content_changed" | "refresh_pending"
    | "unreadable" | "outside_repository" | "not_in_snapshot";
}
export function fetchSourceSlice(
  file: string, lineStart?: number, lineEnd?: number
): Promise<SourceSliceResult | { status: "error"; code: string; message: string }>;
export function fetchLinkedDoc(entityKey: string): Promise<
  { node: ToolNode; body: string | null } | null // null = no directly-linked doc
>;

// deepLink.ts
export function buildDeepLink(
  repositoryRootAbsolutePath: string,   // from ApiContext.repository
  fileRepoRelativePath: string,         // from ToolNode.file / Evidence.file
  lineStart: number
): string | null;   // null when the joined path is not root-confined; never throws
export function isRootConfined(
  repositoryRootAbsolutePath: string,
  candidateAbsolutePath: string
): boolean;   // pure string-based confinement check (no fs access, no realpath)

// useInspectionStore.ts
export interface InspectionState {
  open: boolean;
  current: { entityKey: string; kind: "node" | "edge" } | null;
  previous: { entityKey: string; kind: "node" | "edge" } | null; // one-level back
}
export function useInspectionStore(): InspectionState & {
  openEntity(entityKey: string, kind: "node" | "edge"): void; // replaces current, sets previous
  goBack(): void;    // swaps current<->previous if previous is set; no-op otherwise
  close(): void;
};
```

Deep-link URL shape (encoded, per the safe-link policy): each path segment
percent-encoded individually, joined with `/`, prefixed
`vscode://file/`, suffixed `:<lineStart>` (1-based, matching evidence's
own 1-based line convention) — e.g.
`vscode://file/C%3A/SideProjects/Tadori/packages/store/src/search.ts:83`.

## 11. Ordered implementation procedure

1. `deepLink.ts` + `deepLink.test.ts`: implement `isRootConfined` (pure
   string-prefix + `..`-segment check, matching the semantics of
   `service.ts:168-192`'s intent without filesystem access) and
   `buildDeepLink`. Tests: confined path builds a valid encoded URL;
   `../`-escaping path returns `null`; path with spaces/special characters
   is correctly percent-encoded; Windows-style absolute root + forward-
   slash repo-relative file join produces the documented URL shape.
2. `inspectApi.ts`: implement the four fetch wrappers with explicit status
   discrimination (`ok`/`not_found`/`ambiguous`/`error` for node detail;
   analogous for source slice's 403/404/409). Unit tests mock `fetch` for
   each documented HTTP status from ARCHITECTURE.md §3 rows 6/8.
3. `useInspectionStore.ts`: implement `openEntity`/`goBack`/`close` with the
   one-level-back semantics. Tests: opening B after A sets `previous: A`;
   `goBack` swaps; opening C after B (with A as previous) drops A (only one
   level remembered, not a stack — assert `previous` after the third open is
   B, not A).
4. `EvidenceList.tsx`: render anchors with deep links (calling `deepLink.ts`)
   and the `evidenceOmittedCount` "+N more" note when nonzero. Test: a
   fixture with `evidenceOmittedCount: 3` renders the note; a fixture with
   `0` does not render it (absence of the note, not a "+0 more" string).
5. `SourceView.tsx`: renders `SourceSliceResult`; when `staleReason !==
   "matches_snapshot"`, renders the stale notice **instead of** any body
   text even if `body` happens to be non-null in a malformed response
   (defensive: body is only rendered when `staleReason === "matches_snapshot"
   && body !== null`). Test: stale-reason fixture never renders body text.
6. `NodeView.tsx` / `EdgeView.tsx`: compose header (provenance badges for
   edges; freshness badge for both), `EvidenceList`, `SourceView`, and (node
   only) the ADR-body section using `fetchLinkedDoc` — rendering the exact
   fallback string when the result is `null`. Test: fallback string
   rendered verbatim when no doc link resolves.
7. `InspectionPanel.tsx`: single-mount root wiring `useInspectionStore` to
   `NodeView`/`EdgeView`, close control, `Escape` handling, focus
   management (§19). Test: opening a second entity while one is open
   replaces content (assert only one panel DOM root ever present); pivot
   click inside `EdgeView` calls `openEntity` for the endpoint node.
8. Full gate run (§15); update `IMPLEMENTATION_STATUS.md`.

## 12. Data and lifecycle flows

**Open:** selection event (from search, graph click, or another panel's
pivot) → `openEntity(entityKey, kind)` → panel mounts/updates → parallel
fetch of node/edge detail + evidence (evidence is already embedded in the
detail response per `toolNodeSchema`/`toolEdgeSchema`, so no second network
round-trip is needed for the evidence list itself — only the source slice
and linked-doc lookups are separate calls) → source slice and linked-doc
fetched for the entity's own declared span.

**Pivot:** click on an edge endpoint or an evidence anchor's owning entity →
`openEntity` again with the new key → previous entity remembered as
`previous` → panel content replaced.

**Back:** `goBack()` → swaps `current`/`previous` → panel content replaced
again (no fetch avoided just because it was "just seen" — always re-fetch
current data rather than caching stale detail across a back-navigation,
since a refresh could have occurred in between).

**Close:** explicit control or `Escape` → panel unmounts, selection-state
signal cleared so the graph shows no "active" highlight for a closed panel.

**Failure:** any fetch returns `error`/unexpected status → the panel still
renders its shell (header with whatever fields resolved) with an inline
error notice for the failed section only — a source-slice failure does not
blank the whole panel, only the source-view section.

## 13. Test plan

Unit (Vitest):
- `deepLink.test.ts`: confinement pass/fail cases, encoding correctness,
  Windows-path join correctness.
- `inspectApi.test.ts`: status discrimination for each documented HTTP
  response shape (200/404/409/403).
- `useInspectionStore.test.ts`: open/back/close/one-level-history semantics.

Component (React Testing Library):
- `InspectionPanel.test.tsx`: single-instance invariant (opening twice never
  yields two panel DOM roots); pivot-then-back round-trip; close via button
  and via `Escape`; focus returns to the triggering element on close (§19).
- `EvidenceList.test.tsx`: omitted-count rendering rule; deep-link `href`
  present and well-formed for a confined path, absent (not a broken link)
  for a hypothetically unconfined one.
- `SourceView.test.tsx`: stale-suppression invariant (never renders body
  text when `staleReason !== "matches_snapshot"`).
- `NodeView.test.tsx` / `EdgeView.test.tsx`: provenance badges always
  present for edges (origin/confidence/resolution all three, every render);
  ADR fallback string rendered verbatim when no doc link.

Accessibility (scoped pre-check here; full gate in 08-11): axe-core
zero-violation check on `InspectionPanel` rendered with a representative
node and a representative edge fixture.

Regression: none pre-existing; no fixture files touched.

## 14. Acceptance criteria

- [ ] At no point does more than one `InspectionPanel` DOM instance exist
      simultaneously (assert via a test that opens two different entities in
      sequence and counts panel roots).
- [ ] Every rendered edge shows all three of origin, confidence, and
      resolution badges — no edge view can compile/render without them
      (props are non-optional).
- [ ] `evidenceOmittedCount > 0` always renders an explicit "+N more" note;
      `0` never renders that note.
- [ ] Source view never displays body text when the fetched slice's
      `staleReason !== "matches_snapshot"`.
- [ ] ADR/design-rationale section renders exactly `"No documented design
      decision found."` when no doc link resolves for the entity — verified
      by a snapshot/text-content test asserting the literal string.
- [ ] Every deep link's target path is verified root-confined by
      `isRootConfined` before rendering; a non-confined result renders no
      link element at all (not a link with a broken/dangerous href).
- [ ] Panel is fully operable via keyboard alone: open (from a focused
      result/node), pivot, back, close, in the documented focus order (§19).
- [ ] axe-core reports zero violations on `InspectionPanel` in isolation.
- [ ] Full existing repository gate remains green (§15).

## 15. Validation commands

Existing repository gate (preserved verbatim): `pnpm skills:check`;
`pnpm typecheck`; `pnpm lint`; `pnpm test`; `python validate_fixtures.py`;
`pnpm fixtures:validate`; `pnpm fixtures:index`; `pnpm fixtures:typecheck`;
`pnpm benchmark:incremental`; `git diff --check`; `git status --short`.

Post-08-11 gates this blueprint must also pass once 08-11 exists
(referenced, not defined): Chromium full-flow suite's `inspect` step;
keyboard-only traversal test over this panel; axe-core WCAG AA sweep
including `InspectionPanel` in both node and edge states.

## 16. Performance budgets

- Panel open latency: **< 100 ms** measured from selection event to first
  paint of the panel shell with header fields populated, **after** the
  node/edge detail data has already arrived (the fetch itself is not
  counted against this budget — this is the render-after-data budget named
  in the task; the fetch's own latency is bounded by 07-01's endpoint
  budgets, not re-specified here).
- Source-slice fetch: bounded by the server's slice-budget contract (07-01);
  this blueprint never requests an unbounded range, keeping response size
  small regardless of the underlying file's total length.
- Evidence list render: renders up to the `EVIDENCE_RESULT_LIMIT = 20`
  anchors already capped server-side; no additional client-side pagination
  needed at this scale.

## 17. Failure and recovery behavior

- `404 unknown_entity` on node/edge detail: panel shows "This entity is no
  longer present in the current snapshot" instead of a blank/crashing
  panel — covers the case where a stale search result or deep link is
  clicked after a refresh replaced the snapshot.
- `409 ambiguous`: panel shows an explicit "multiple entities matched"
  notice (should not occur for a well-formed entityKey lookup, but the
  endpoint contract reserves the code, so the UI must not crash on it).
- `403 outside_repository` / `404 not_in_snapshot` / `409 content_changed`
  on source slice: each renders its own distinct notice in the source-view
  section only (§12 failure flow) — never a raw error code shown to the
  user without an explanation.
- Interrupted fetch (component unmounts mid-request, e.g. rapid re-selection):
  in-flight requests for a superseded entityKey are ignored on resolution
  (same generation-guard pattern as 08-05, scoped to this store).

## 18. Security and privacy

- Localhost-only: all fetches target the local server origin only.
- Root confinement: deep links are never rendered unless
  `isRootConfined` passes; this is client-side defense in depth — the
  server's own `/api/v1/source` enforces the actual boundary
  (`403 outside_repository`) and this blueprint never treats a client-side
  pass as sufficient without the server round-trip also succeeding for the
  source view itself (the deep-link check and the source-fetch check are
  independent; both must pass for their respective UI elements to render).
- `ApiError` bodies are never displayed verbatim if they could contain an
  absolute filesystem path — per the shared envelope's own contract
  ("never leaks abs paths"), and this blueprint's error rendering uses only
  the structured `code`/a short mapped message, never `error`/`detail`
  fields verbatim without inspection.
- Inspect-only: this blueprint issues zero write requests (no PUT/POST/
  DELETE anywhere in `inspectApi.ts`).

## 19. Accessibility

- **Focus order:** on open, focus moves to the panel's close button (or
  panel heading if no close button is the first focusable element);
  within the panel, header actions, then evidence list (as one roving-
  tabindex group), then source view (read-only, but its "view more
  context" control if present is focusable), then ADR section, in that
  fixed order.
- **Keyboard shortcuts:** `Escape` closes the panel and returns focus to
  the element that triggered the open (graph node/edge, search result row,
  or another panel's pivot control); no other global shortcuts are claimed
  by this panel (search's `/` shortcut, per 08-05, is unaffected).
- **ARIA roles:** panel root `role="dialog"` `aria-modal="false"` (it is a
  persistent dockable panel, not a blocking modal — the graph remains
  operable behind it) with `aria-labelledby` pointing at the entity name
  heading; evidence list `role="list"`/`role="listitem"` (a plain
  navigable list, not a listbox, since single-selection semantics don't
  apply here); provenance badges carry `aria-label`s spelling out the full
  value (e.g. `aria-label="Origin: compiler"`) since badge glyphs/colors
  alone are not a screen-reader-accessible channel.
- **Screen-reader text:** the stale-source notice and the
  "No documented design decision found." fallback are both real text
  content (not decorative/icon-only), so they are read by assistive tech
  without extra markup.
- **Reduced motion:** panel open/close uses no motion beyond what
  `prefers-reduced-motion` allows (an instant show/hide when reduced motion
  is requested; the panel is not part of the graph camera system so this is
  a simpler transition than 08-05's focus/zoom).
- **Contrast:** provenance badges and stale-notice text meet WCAG AA
  contrast (verified by 08-11's axe-core sweep).
- **Non-canvas fallback:** the panel itself is ordinary DOM, already part of
  the accessible surface; it is also the mechanism by which the accessible
  list/table alternative (08-11's contract) lets a keyboard/screen-reader
  user reach full evidence/provenance detail for any node/edge listed there
  — 08-11's data-completeness contract depends on this panel opening
  correctly from that list view, not only from canvas clicks.

## 20. Documentation updates

`IMPLEMENTATION_STATUS.md` — dated entry once built, recording the panel
feature, test count, validation evidence. No other existing documentation
file requires edits.

## 21. Builder final report

Require: summary; files changed; contracts implemented (confirm match to
§10); tests added (names + count); validation output summary; screenshots
of node view, edge view, stale-source state, ADR-fallback state; commit
SHA; known limitations; follow-on risks; `ASSUMPTION:` lines (expected:
exact shape of `/api/v1/docs` single-entity lookup if 07-01/08-07 have not
yet finalized it).

## 22. Independent review result

Pending Wave 2 adversarial review.

## IF SOMETHING IS UNCLEAR

Smallest safe assumption + `ASSUMPTION:` line. If an assumption would let
provenance badges be omitted, let a stale body render as current, or let a
deep link escape the repository root, stop and report blocked — those are
frozen-contract/security violations, not implementation details.

## TADORI NON-NEGOTIABLES

Frozen v2.1; TS/JS only; ATLAS separate; exactly six MCP tools (HTTP only
here); stable 2D default; no permanent dual sidebars (this blueprint's
entire premise); every visible relation keeps evidence/origin/confidence/
resolution; unresolved stays visibly unresolved; design rationale only from
ADRs/docs, otherwise the exact fallback string; inspect-only, never edits
repositories; localhost only; Graphify ignored reference only; never weaken
golden fixtures.
