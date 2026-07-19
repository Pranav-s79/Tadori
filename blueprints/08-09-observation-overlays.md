---
graph_blueprint_version: 1
node_id: 08-09
state: review
phase: 8
risk: medium
complexity: M
predecessors: [08-02, 08-08]
successors: [09-05]
execution_card: blueprints/execution/08-09.md
dossier: blueprints/08-09-observation-overlays.md
read_policy: execution-card-first
local_full_gate_budget: 1
independent_validation_budget: 1
architecture_review: on-demand-only
---

> **GRAPH EXECUTION MODE:** Read the execution card first. This long file is an evidence dossier, not mandatory context. Open only the sections linked by the card. Planning-time existence claims and line numbers are historical hints; live repository semantics win. Use one full local gate and one independent validation pass.

# BLUEPRINT 08-09: Observation overlays

## 1. Header

- ID / Title / Phase: 08-09 — Observation overlays — Phase 8
- Status: review
- Primary builder: Claude Sonnet — three composable render-layer features on
  an existing frozen map component; no new persistence, no layout math.
- Reviewer roles: Spec Guardian (honesty-language + frozen-coordinates
  invariant), Accessibility Reviewer (color-only-encoding risk), Test
  Adversary (empty-state / stale-data cases)
- Complexity: M
- Depends on / Unlocks: Depends on 08-02 (`apps/viz` scaffold + package map)
  and 08-08 (hooks event receiver — the data source). Unlocks 09-05
  (agent-change review overlays reuse this overlay-composition pattern).
- Estimated sessions: 1
- Related frozen-spec sections: ARCHITECTURE.md §4 (WS observation envelope),
  §7 (hooks event contract, honesty semantics), §10 (viz LOD contract, "every
  visible relation keeps evidence/origin/confidence/resolution," "deterministic
  positions"); BACKLOG.md 08-09 row; ASSUMPTIONS.md A-104/A-106; TADORI
  NON-NEGOTIABLES "agent observation honesty."

## 2. Objective

Three independently toggleable visual overlays — task focus, retrieval trace,
planned scope — render on top of the existing frozen 2D package/file/symbol
map using data from the server's observation endpoints and the WS
`observation` channel, without moving, resizing, or otherwise altering any
node's stored `(x, y, z)` position, and every overlay states plainly whether
its data is observed, partially observed, or not observed at all.

## 3. Why this matters

- User value: a developer using Tadori alongside an agent session can see, at
  a glance, what the agent focused on, retrieved, and planned to touch,
  without that visualization ever overstating what was actually captured.
- System value: this is the visual half of the "evidence, not knowledge"
  contract — the receiver (08-08) is worthless without a rendering that
  respects its honesty semantics.
- Downstream: 09-05 (agent-change review overlays) and 08-11 (accessibility
  validation) both build directly on the overlay toggle/legend pattern
  established here.

## 4. Current repository evidence

**Verified current:**

- `apps/viz` does not exist yet (`ls packages/` confirms; ARCHITECTURE.md
  line 6). This blueprint's file plan targets 08-02's scaffold, which is
  itself still `pending` — see §7 for how this blueprint stays buildable in
  isolation regardless of build order.
- Frozen layout persistence: migration 004's `layout_positions` table
  (`packages/store/src/migrations.ts:442-458`) is the single source of node
  `(x, y, z)`; ARCHITECTURE.md AD-005 states the server materializes layout
  once and viz "never computes" it — reload is byte-identical because
  positions are read, never recomputed. **Overlays consume this same
  read-only position stream; they must never write to `layout_positions` or
  compute alternate coordinates.**
- ARCHITECTURE.md §10 provenance edge legend rule: encoding is derived from
  each edge's `origin`/`confidence`/`resolution` fields, already present on
  every `ToolEdge` (`packages/mcp/src/contracts.ts:71-...`,
  `toolEdgeSchema`). Overlays add a **second, independent** visual channel
  (dimming/coloring/outlining) that must not collide with or replace this
  existing provenance encoding — both must remain legible simultaneously
  (e.g., a retrieved edge keeps its solid/dashed/dotted provenance style and
  additionally sits inside the green retrieval-trace color range).
- ARCHITECTURE.md §4 WS envelope (verbatim relevant member):
  ```ts
  type ServerEvent =
    | ...
    | { type: "observation"; event: ObservationEvent };  // 08-09 overlay feed
  ```
  Owner noted as 08-09 for this member. Reconnect semantics: WS is a
  change-signal only; state of record is re-fetched via HTTP on reconnect
  (AD-010) — overlays must not assume WS delivers a complete history; the
  HTTP observation-read endpoints (proposed in §8, since ARCHITECTURE.md §3
  does not yet enumerate a GET-side observation-read endpoint beyond the
  `POST /api/v1/observations` write path) are the source of truth for "what
  has happened so far in this task," WS is only "something just happened,
  refetch."
- Honesty vocabulary is frozen and exact:
  `tasks.observation_coverage` CHECK constraint
  (`packages/store/src/migrations.ts:300-302`) is
  `'complete_for_registered_sources' | 'partial' | 'unknown'` — no fourth
  value, no synonyms. `EventLog.recordAgentEvent` forces coverage back to
  `'partial'` on any `capture_interrupted` event (`packages/mcp/src/events.ts:337-341`).
  Non-negotiables text: "not observed inspected" is the frozen phrase for
  absence of observation (already used verbatim in ARCHITECTURE.md §3 row 11
  for the `/tests` endpoint's `note` field) — this blueprint's empty/absent
  states reuse the identical phrase, not a paraphrase.
- `AgentEventType` (`packages/mcp/src/events.ts:12-18`) is the exhaustive set
  of observation kinds this overlay renders:
  `file_read_observed | plan_mentioned | modified | test_selected |
  test_executed | capture_interrupted`. Retrieval trace additionally draws on
  `retrieval_events`/`retrieval_result_nodes`/`retrieval_result_edges`/
  `retrieval_omissions` (migration 003, `migrations.ts:309-356`), a
  **separate** table family from `agent_events`, already written by
  `EventLog.logRetrieval` (`events.ts:92-274`) for every MCP tool call — this
  is the "retrieved entities" data source, distinct from the hooks-fed
  `agent_events` table that back task-focus and planned-scope.
- 08-08 (this blueprint's direct dependency) emits `plan_mentioned` events
  with `targets[].kind: "file"|"node"` — planned-scope overlay draws its red
  outline from these targets, not from a separate "plan" table (none exists).
- No existing HTTP endpoint reads `agent_events`/`retrieval_events` back out
  for overlay rendering — ARCHITECTURE.md §3's table has no
  `GET /api/v1/observations` or `GET /api/v1/tasks/:id` row. This is a real
  gap this blueprint must resolve in §8 (a proposed additive endpoint, owned
  jointly with 07-01, since 07-01 already owns all other GETs).

**PROPOSED / to be resolved by this blueprint:**

- The exact GET endpoint(s) serving overlay data (§8, §10) — additive to
  ARCHITECTURE.md §3's table, not yet present there.
- The overlay-to-entity-identity binding across zoom levels (§8, using the
  same stable `entityKey`/`node_id` identity every other frozen-position
  mechanism already uses).

Files to read first: `packages/mcp/src/events.ts` (full file),
`packages/store/src/migrations.ts:286-433` (migration 003 shape),
ARCHITECTURE.md §3/§4/§7/§10, `packages/mcp/src/contracts.ts` (`toolNodeSchema`/
`toolEdgeSchema`, `responseContextSchema`), 08-08's blueprint (data producer
contract), 08-01/08-02's planned exact contracts once written (this
blueprint reads their planned shapes from ARCHITECTURE.md since their files
do not exist yet).

## 5. Scope

1. **Task focus overlay**: entities not associated with the currently
   selected/active task are rendered at 15% opacity; entities associated with
   it (via `agent_event_targets`/`retrieval_result_nodes`/`retrieval_result_edges`
   membership) stay at full opacity.
2. **Retrieval trace overlay**: entities present in `retrieval_result_nodes`/
   `retrieval_result_edges` for the active task are colored on a green scale
   keyed to recency (most-recent retrieval = brightest green) and count
   (repeated retrieval = saturation increase, capped); entities never
   retrieved render neutral gray; a coverage stat line above/beside the map
   names the exact `observation_coverage` value for the active task.
3. **Planned scope overlay**: entities named as `targets` on any
   `plan_mentioned` event for the active task get a red outline (stroke only,
   no fill change, so it composes with the other two overlays' fill/opacity
   changes without visual conflict).
4. Overlays are **individually toggleable** (three independent UI toggles,
   any combination on/off simultaneously) and **composable** (task-focus
   dimming, retrieval-trace fill, planned-scope outline can all apply to the
   same node at once — dimming multiplies opacity, fill and outline are
   orthogonal visual channels).
5. Overlay data is fetched from server observation-read endpoints (§8
   proposal) plus live-updated via the WS `observation` channel (re-fetch on
   receipt, per AD-010's re-fetch-on-signal pattern).
6. A shared overlay legend panel states, in words, what each overlay
   represents and explicitly uses "observed"/"not observed inspected"
   language — never implying access to agent reasoning.
7. Overlay behavior across zoom-level expansion (08-03/08-04): when a package
   or file node expands into its children, the overlay state for each child
   entity is derived from the same underlying task data by that child's own
   `entityKey` — the overlay follows entity identity, not screen position.
8. Empty states: a task with zero observation events for the current snapshot
   renders all three overlays in their neutral/gray/no-outline state plus a
   single visible message, "No observation events for this snapshot."

## 6. Non-goals

- Overlays **never move, resize, or recompute node positions**. The frozen
  `(x, y, z)` from `layout_positions` (via 08-01's read endpoint) is the only
  position source; an overlay is a pure paint pass over the existing
  Sigma.js render, never a force-directed re-layout, never a filter that
  removes nodes from the canvas (dimming, not hiding — a dimmed node is still
  present and inspectable).
- No new database schema or migration — overlays are read-only consumers of
  migration-003 tables via the additive GET endpoint proposed in §8; no
  `layout_positions` write, no new observation table.
- No agent-reasoning display of any kind — overlays render only externally
  observable facts (file was read, node was retrieved, target was named in a
  plan-mention event); they never claim to show *why* an agent did something,
  only *what was observed*.
- No runtime tracing — overlays consume the same coarse six-kind
  `AgentEventType` stream 08-08 produces; no new finer-grained instrumentation
  is introduced to feed richer overlays.
- Not a replacement for the provenance edge legend (ARCHITECTURE.md §10) —
  that legend's solid/dashed/dotted/muted encoding stays exactly as frozen;
  this blueprint adds independent overlay channels alongside it.
- No cross-task aggregation view ("show me all tasks ever") — overlays render
  exactly one active task's data at a time (task selection UI, if needed
  beyond "currently active task," is out of scope here and belongs to a
  future task-picker blueprint if the backlog adds one).
- No offline/exported-report form of the overlay (e.g. a static image export)
  — purely an interactive in-browser layer.

## 7. Dependencies and prerequisites

- 08-02 must have delivered the base Sigma.js package-map render and its
  React component structure (panel/toggle conventions this blueprint's UI
  reuses) before this blueprint's UI code is wired in; this blueprint's
  server-facing contract (§8) and data-shape work can proceed independently
  of 08-02's exact component tree, since the overlay is specified here as a
  pure function of `(entityKey) -> overlay visual state`, pluggable into
  whatever render loop 08-02 establishes.
- 08-08 must be delivering (or have delivered) `agent_events`/
  `retrieval_events` rows via the hooks path; if 08-08 has not landed when
  this blueprint's builder session starts, overlay unit tests use synthetic
  fixture rows inserted directly against the migration-003 schema (bypassing
  `EventLog`, test-only) so overlay rendering logic is verifiable
  independent of build order — the live end-to-end path is deferred to an
  integration test marked pending 08-08, same pattern as 08-08's own §13.

## 8. Architectural decisions

- **DECISION 08-09-A — additive observation-read endpoint, owned jointly with
  07-01.** ARCHITECTURE.md §3 has no GET endpoint for reading back
  `agent_events`/`retrieval_events`/`tasks`. This blueprint proposes:
  ```
  GET /api/v1/tasks/:id/observations
    -> { context: ApiContext; task: { id, observationCoverage, status };
         agentEvents: {type, targets, at}[];
         retrievalResultNodes: {entityKey, rank, at}[];
         retrievalResultEdges: {entityKey, rank, at}[] }
  GET /api/v1/tasks/active
    -> { taskId: number | null }   // most recent non-ended task for this repo, or null
  ```
  Rationale: the overlay needs exactly this shape, and no other consumer of
  the codebase needs a richer observation-read API today (YAGNI on a general
  task-query API). Rejected: reusing `/api/v1/observations` (the write
  endpoint) as a combined read/write route — REST semantics and the frozen
  "read-only GETs, sole write is POST /observations" rule (ARCHITECTURE.md §3
  preamble) both argue for a separate GET path. This is a **finding/gap**
  against ARCHITECTURE.md §3, recorded for 07-01's builder to adopt or
  countermand, not a silent extension of an existing endpoint.
- **DECISION 08-09-B — overlay state is a pure function of server data, cached
  client-side per fetch, invalidated by the WS `observation` signal.** No
  client-side accumulation of raw events into a mutable store beyond a simple
  fetched-snapshot cache; every WS `observation` message triggers a re-fetch
  of `GET /api/v1/tasks/:id/observations` (matching AD-010's "WS is a
  change-signal only" rule) rather than incrementally patching client state
  from the WS payload. Rejected: incremental client-side event accumulation
  (risks drifting from server truth on missed messages, reconnects, or
  multi-tab use — the same class of bug AD-010 already rejected for refresh
  state).
- **DECISION 08-09-C — overlay visual channels are orthogonal and multiply,
  never replace.** Task-focus = opacity multiplier (dim to 0.15 when
  non-focused); retrieval-trace = fill/marker color (green scale or gray);
  planned-scope = stroke-only outline (red, 2px, no fill change). All three
  can apply to one node simultaneously without contradiction because they
  occupy different visual properties (opacity vs. fill vs. stroke).
  Provenance edge style (solid/dashed/dotted/muted) is untouched — edges keep
  their existing style and can additionally sit inside a dimmed/highlighted
  node pair. Rejected: a single blended "observation score color" that
  replaces provenance styling — would violate "every visible relation keeps
  evidence, origin, confidence, resolution" by making that encoding
  invisible under an overlay.
- **DECISION 08-09-D — coverage stat line is mandatory, not optional chrome.**
  The retrieval trace overlay's legend always displays the literal
  `observation_coverage` value (`complete_for_registered_sources`, `partial`,
  or `unknown`) for the active task — never omitted, never paraphrased into
  vaguer language like "mostly observed." Rejected: a simplified traffic-light
  indicator (green/yellow/red dot) *replacing* the text — a dot alone fails
  the "coverage states exactly complete_for_registered_sources | partial |
  unknown" instruction; a dot may accompany the text as a secondary
  affordance but the text is the source of truth and must render even if the
  dot cannot (a11y requirement, §19).
- **DECISION 08-09-E — no active task means all overlays render their neutral
  empty state, not an error.** `GET /api/v1/tasks/active` returning `taskId:
  null` (no task has been created for this repo/session, e.g. no hooks have
  fired yet) is a normal, expected condition — not a 404. Overlays render
  fully neutral (no dimming, all gray, no outlines) plus the
  "no observation events for this snapshot" message. Rejected: hiding overlay
  toggles entirely when no task exists — toggles stay visible and functional
  so the user understands overlays exist and are simply inactive for lack of
  data, matching the "absence = not observed inspected" honesty principle
  (absence is stated, not hidden).
- **DECISION 08-09-F — entity-identity-following overlay across zoom levels.**
  When 08-03/08-04 expand a package into files or a file into symbols, the
  overlay re-evaluates each newly-visible child node's `entityKey` against
  the same cached task-observation data (no re-fetch required if the cache is
  still warm for the active task) — a file that was itself directly read
  shows the file-read-observed color; a file merely containing a
  never-mentioned symbol shows neutral, even though its parent package might
  have been dimmed/highlighted for an unrelated reason. Rejected: propagating
  a package-level overlay color down to all children uniformly (would imply
  observation of things never actually observed — a honesty violation).

## 9. Exact file plan

- `apps/viz/src/overlays/types.ts` — create. `OverlayKind = "taskFocus" |
  "retrievalTrace" | "plannedScope"`; `TaskObservationSnapshot` (client-side
  shape mirroring §8's GET response); `EntityOverlayState { opacity: number;
  fillColor: string | null; outline: boolean }`.
- `apps/viz/src/overlays/useTaskObservations.ts` — create. React hook: fetches
  `GET /api/v1/tasks/active` then `GET /api/v1/tasks/:id/observations`;
  subscribes to the WS `observation` channel and re-fetches on receipt (per
  DECISION 08-09-B); exposes `{ data, coverage, loading, isEmpty }`.
- `apps/viz/src/overlays/computeOverlayState.ts` — create. Pure function
  `(entityKey: string, kind: OverlayKind, snapshot: TaskObservationSnapshot |
  null) => EntityOverlayState` — the single place all three overlays'
  per-node visual rules live, unit-testable without any React/Sigma
  dependency.
- `apps/viz/src/overlays/OverlayLegend.tsx` — create. Renders the three
  toggle checkboxes, the coverage stat line (verbatim value), and the honesty
  wording block (§10).
- `apps/viz/src/overlays/OverlayEmptyState.tsx` — create. Renders "No
  observation events for this snapshot" when `isEmpty`.
- `apps/viz/src/overlays/applyOverlaysToRenderer.ts` — create. Bridges
  `computeOverlayState` output into whatever Sigma.js node-reducer/
  edge-reducer hook 08-02 establishes (Sigma.js supports per-node/per-edge
  render-attribute overrides via reducers — this file is the integration
  seam, written against 08-02's expected renderer API which this blueprint
  treats as a stable interface per §7).
- `apps/viz/test/computeOverlayState.test.ts` — create. Pure-function unit
  tests: dimming math, green-scale recency/count mapping, gray fallback, red
  outline membership, composition of all three simultaneously, empty-state
  neutral output.
- `apps/viz/test/useTaskObservations.test.ts` — create. Hook behavior against
  a mocked fetch + mocked WS: initial fetch, re-fetch on WS signal, `taskId:
  null` empty path, coverage value passthrough exactness.

## 10. Exact contracts

```ts
// apps/viz/src/overlays/types.ts
export type OverlayKind = "taskFocus" | "retrievalTrace" | "plannedScope";

export interface TaskObservationSnapshot {
  taskId: number;
  observationCoverage: "complete_for_registered_sources" | "partial" | "unknown";
  focusedEntityKeys: Set<string>;       // union of agent_event_targets + retrieval result keys for this task
  retrieval: Map<string, { rank: number; lastSeenAt: string; count: number }>; // entityKey -> recency/count
  plannedEntityKeys: Set<string>;       // targets of plan_mentioned events
}

export interface EntityOverlayState {
  opacity: number;        // 1.0 normal, 0.15 when taskFocus on and entity not focused
  fillColor: string | null; // green-scale hex when retrievalTrace on and retrieved; "gray" when on and not retrieved; null when off
  outline: boolean;       // true when plannedScope on and entity in plannedEntityKeys
}

export function computeOverlayState(
  entityKey: string,
  active: { taskFocus: boolean; retrievalTrace: boolean; plannedScope: boolean },
  snapshot: TaskObservationSnapshot | null
): EntityOverlayState;
```

```ts
// server contract this blueprint depends on (proposed, joint with 07-01 — see DECISION 08-09-A)
interface ApiTaskObservations {
  context: ApiContext;              // reused envelope, ARCHITECTURE.md §3
  task: { id: number; observationCoverage: "complete_for_registered_sources"|"partial"|"unknown"; status: string };
  agentEvents: { type: AgentEventType; targets: {kind:"file"|"node"; ref:string}[]; at: string }[];
  retrievalResultNodes: { entityKey: string; rank: number; at: string }[];
  retrievalResultEdges: { entityKey: string; rank: number; at: string }[];
}
// GET /api/v1/tasks/active -> { taskId: number | null }
// GET /api/v1/tasks/:id/observations -> ApiTaskObservations
```

Green-scale mapping (recency by count, deterministic, no external palette
dependency — reuses whatever Tadori's existing viz color convention is,
proposed here as the concrete rule since none is frozen yet):
`lightness = clamp(85 - (rank_recency_percentile * 50) - min(count, 5) * 3, 20, 85)`
expressed as an HSL green (`hsl(140, 55%, ${lightness}%)`); never-retrieved =
a fixed neutral gray (`#9aa0a6`) distinct from any green value at any
lightness, so retrieved-vs-not is distinguishable independent of exact
recency (a11y non-color-alone requirement, §19, is additionally satisfied by
the coverage stat line and legend text, not color alone).

## 11. Ordered implementation procedure

1. `apps/viz/src/overlays/types.ts`: define the four interfaces above.
   Reason: shared vocabulary before logic. No test (types only).
2. `apps/viz/src/overlays/computeOverlayState.ts` +
   `apps/viz/test/computeOverlayState.test.ts`: implement and test the pure
   function against synthetic `TaskObservationSnapshot` fixtures covering:
   task-focus dimming on/off, retrieval green-scale recency ordering,
   never-retrieved gray, planned-scope outline membership, all-three-combined
   composition, `snapshot: null` (no active task) neutral output. Reason:
   pure logic is the highest-value, cheapest-to-test unit; get it exactly
   right before any rendering integration. Test: every case above passes.
3. `apps/viz/src/overlays/useTaskObservations.ts` +
   `apps/viz/test/useTaskObservations.test.ts`: implement the fetch/
   subscribe/re-fetch hook against mocked `fetch`/WS. Reason: isolates
   server-communication concerns from render concerns. Test: initial load,
   WS-triggered re-fetch, `taskId: null` empty path, coverage passthrough.
4. `apps/viz/src/overlays/OverlayLegend.tsx` +
   `apps/viz/src/overlays/OverlayEmptyState.tsx`: implement the toggle UI and
   honesty-wording legend (verbatim phrases from §10/§18) plus the empty-state
   message. Reason: the human-facing honesty surface, kept in a
   single small component pair for easy review. Test: legend renders the
   exact `observationCoverage` string for each of the three enum values;
   empty-state message renders verbatim when `isEmpty`.
5. `apps/viz/src/overlays/applyOverlaysToRenderer.ts`: wire
   `computeOverlayState` output into 08-02's Sigma.js reducer seam. Reason:
   final integration point; kept as one small bridging file so 08-02's exact
   renderer API can change without touching overlay logic. Test: a smoke
   test (or, if 08-02 is not yet built, a typed stub matching its documented
   reducer signature) confirming the bridge calls `computeOverlayState` once
   per visible node/edge per render pass, not per frame (perf guard).
6. Wire the three toggles into whatever top-level panel/sidebar 08-02
   establishes; confirm toggle state persists only as React view state (no
   server round-trip needed to toggle — matches ARCHITECTURE.md §10 "React
   owns only view state").
7. Zoom-level interaction test: expand a package to files, confirm each
   child's overlay state is independently computed from its own `entityKey`
   (§8-F) — write as an integration test once 08-03/08-04 exist, or as a
   pure-function-level test today asserting `computeOverlayState` is called
   with the child's own key, not inherited from the parent (verifiable
   without 08-03/08-04's actual expansion UI, since `computeOverlayState` is
   already unit-tested as key-driven, not tree-position-driven).
8. Run full validation gate (§15).

## 12. Data and lifecycle flows

**Startup:** viz app loads → `useTaskObservations` fires
`GET /api/v1/tasks/active` → if `taskId` present, fetches
`GET /api/v1/tasks/:id/observations` → overlay toggles default to whatever UI
default 08-02 establishes for new panels (proposed default: all three off
until the user opts in, so the base map's frozen appearance is what a
first-time user sees — matches "stable 2D default" non-negotiable).

**Operation:** user toggles an overlay on → `applyOverlaysToRenderer` invokes
`computeOverlayState` per visible node/edge using the already-fetched
snapshot → Sigma.js repaints with the new opacity/fill/outline, no position
change, no re-fetch triggered by the toggle itself (toggle is pure view
state).

**Refresh (agent activity continues):** hooks (08-08) POST new events → server
processes them → server pushes `{type: "observation", event}` over WS → viz's
`useTaskObservations` receives it → re-fetches
`GET /api/v1/tasks/:id/observations` (not incremental patch, per DECISION
08-09-B) → overlay recomputes and repaints.

**Snapshot replacement (new commit/working-tree change while overlays are
on):** `snapshot_replaced` WS message arrives (07-01's existing signal) → viz
re-fetches nodes/edges/layout as 08-02 already handles → overlay re-fetches
task observations too (the active task's `base_snapshot_id` may now differ
from the newly served snapshot; entities not present in the new snapshot
simply have no overlay to apply — `computeOverlayState` keyed by `entityKey`
naturally handles this since a stale key just never matches a visible node).

**Failure:** observation-read endpoint unreachable or errors → hook resolves
`{data: null, loading: false, error}` → overlays render their neutral
empty-adjacent state (not a crash, not a blank map) with a legend note that
observation data could not be loaded (distinct wording from "no observation
events," since this is a fetch failure, not a confirmed-empty task — honesty
requires distinguishing "we don't know" from "we checked and there is
none").

**Shutdown:** WS disconnects on tab close; no cleanup beyond standard
React unmount of the subscription (existing 08-02 WS-lifecycle pattern,
reused).

## 13. Test plan

- Unit: `computeOverlayState.test.ts` — every combination in §11 step 2.
- Unit: `useTaskObservations.test.ts` — fetch lifecycle, WS re-fetch trigger,
  null-task path, coverage exactness, fetch-error path.
- Component: `OverlayLegend.test.tsx` — renders exact coverage string for
  each of the three enum values; never renders a fourth/paraphrased value
  (assert against a hardcoded forbidden-strings list: "mostly," "likely
  complete," "fully observed" must never appear).
- Component: `OverlayEmptyState.test.tsx` — renders the exact string "No
  observation events for this snapshot" when `isEmpty` is true, nothing
  otherwise.
- Integration (pending 08-02/08-08 availability, marked `describe.skip` with
  a comment citing this blueprint and the specific dependency, same pattern
  as 08-08 §13): live toggle-and-repaint against a running viz + server +
  hooks-fed task.
- Accessibility: overlay state is never encoded by color alone — verify (a)
  the coverage stat line is always present as text, (b) planned-scope uses a
  stroke (shape-level) change, not a hue-only change, (c) a colorblind-safe
  contrast check on the green-scale-vs-gray distinction (documented manual
  check, automated contrast-ratio assertion where feasible).
- Regression: full existing suite unaffected (this package adds no
  store/migration/mcp changes).

## 14. Acceptance criteria

- [ ] All three overlays render correctly from `computeOverlayState` unit
      tests, including all-three-combined composition.
- [ ] No overlay-related code path ever writes to `layout_positions` or
      calls anything that recomputes `(x, y, z)` — `git diff` against
      `packages/store/src/migrations.ts` and any 08-01 layout-writer module
      is empty.
- [ ] The literal string `observation_coverage` value
      (`complete_for_registered_sources`/`partial`/`unknown`) is rendered
      verbatim in the legend for every task fixture tested — no paraphrase.
- [ ] Empty state renders the exact string "No observation events for this
      snapshot" when a task has zero agent/retrieval events.
- [ ] Toggling any overlay does not trigger a network request (pure client
      view-state change, verified via a mocked-fetch call-count assertion
      before/after toggle).
- [ ] Zoom-level expansion test confirms overlay state is computed per child
      `entityKey`, never inherited uniformly from a parent node.
- [ ] Full existing suite stays green; 5/5 fixtures PASS unchanged (this
      package touches no fixture/migration surface).
- [ ] The §8 endpoint gap (no existing GET for task observations) is recorded
      as a finding for 07-01, not silently implemented as an unreviewed
      addition to a frozen endpoint table.

## 15. Validation commands

pnpm skills:check; pnpm typecheck; pnpm lint; pnpm test;
python validate_fixtures.py; pnpm fixtures:validate; pnpm fixtures:index;
pnpm fixtures:typecheck; git diff --check

## 16. Performance budgets

`computeOverlayState` runs once per visible node/edge per render pass (not
per animation frame) — for the 08-10 150k-LOC corpus at package level
(<=500 nodes per LOD budget), overlay computation must add under 5 ms to a
single render pass. Re-fetch on WS `observation` signal is debounced to at
most once per 250 ms if multiple observation events arrive in a burst (hook
scripts firing rapidly during an active agent session) — avoids a
re-fetch-storm; this debounce is client-side only and does not affect server
load budgets owned by 07-01/08-10.

## 17. Failure and recovery behavior

- Observation-read endpoint unreachable/errors: overlays show a distinct
  "observation data unavailable" state (not conflated with "confirmed empty,"
  per §12).
- WS disconnects mid-session: per AD-010, on reconnect the viz re-fetches
  `/api/v1/snapshot`/`/api/v1/refresh`; this blueprint's hook additionally
  re-fetches `/api/v1/tasks/active` + observations on the same reconnect
  event, so overlay data recovers via the identical re-fetch pattern the rest
  of the app already uses.
- Task ends (`tasks.status` becomes `completed`/`aborted`) mid-session:
  overlay continues to render the last-fetched snapshot for that task (a
  completed task's history is still valid data to display) until a new
  active task exists or the user navigates away.
- Entity referenced by an observation event no longer exists in the current
  snapshot (renamed/deleted since the event was recorded): `computeOverlayState`
  simply never matches that stale `entityKey` against any visible node —
  no error, the overlay silently has nothing to paint for that key (this is
  correct behavior, not a bug, since the map only shows what is in the
  current snapshot).

## 18. Security and privacy

- No new write path — overlays are pure GET consumers; nothing in this
  blueprint increases the write attack surface established by 08-08/07-01.
- `detail`/redacted fields from `agent_events` (e.g. test command text) are
  not rendered by these overlays at all — overlays only ever display
  `entityKey`/`type`/`at`/rank/count, never free-text `detail`, avoiding any
  accidental surfacing of redaction-pending content in a highly visible map
  view.
- Honesty-language legend text is fixed, reviewed copy — never
  user-suppliable, never templated from untrusted input (agent-supplied
  `detail` strings are never interpolated into the legend).

## 19. Accessibility

- Every overlay-encoded fact has a non-color channel: task-focus uses opacity
  (already a non-hue channel, but additionally exposed via a "focused" list
  in an accessible side panel — not implemented by 08-06, referenced only as
  the pattern this blueprint's data should feed if 08-06's panel wants it);
  retrieval-trace pairs color with the mandatory text coverage stat and rank/
  count values available on hover/focus (keyboard-reachable tooltip, not
  mouse-hover-only); planned-scope uses a stroke/shape change, not hue alone.
- Legend and empty-state text meet WCAG AA contrast against both light and
  dark backgrounds (matches the frozen a11y non-negotiable: "WCAG AA
  non-canvas UI").
- Overlay toggles are keyboard-operable checkboxes with visible focus
  indicators and accessible labels naming the overlay and its current
  on/off state.
- The non-canvas accessible list/table alternative (owned by a future/08-06-
  adjacent blueprint) must be able to surface the same overlay facts in text
  form — this blueprint exposes `computeOverlayState`/`TaskObservationSnapshot`
  as plain data structures precisely so a non-canvas renderer can consume
  them without depending on Sigma.js.

## 20. Documentation updates

- This blueprint file records the §8 endpoint-gap finding (no existing GET
  observation-read route in ARCHITECTURE.md §3) for reconciliation by
  07-01's builder or a future architecture-pass update.
- No changes to `IMPLEMENTATION_STATUS.md`/`ARCHITECTURE.md`/`BACKLOG.md` by
  this planning blueprint itself (builder updates `IMPLEMENTATION_STATUS.md`
  at build time per standing CLAUDE.md rule).

## 21. Builder final report

Require: summary; files changed; contracts implemented (§10, including
whether 07-01 adopted the proposed GET endpoints or countermanded them);
tests added (names + count); validation results; screenshots of all three
overlays individually and combined, plus the empty state; commit SHA; known
limitations; follow-on risks (e.g. no cross-task history view); `ASSUMPTION:`
lines.

## 22. Independent review result

Pending Wave 2 adversarial review.

## IF SOMETHING IS UNCLEAR

Smallest safe assumption + `ASSUMPTION:` line. The missing GET
observation-read endpoint (§8-A) is exactly the kind of gap that could
tempt a silent workaround (e.g., reading the DB directly from viz) — that
would violate the frozen "viz is HTTP/WS-only, no `@tadori/*`/fs/sqlite
import" rule (AD-009) and is explicitly rejected; the correct response is to
propose the additive endpoint and flag it, which this blueprint does.

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
