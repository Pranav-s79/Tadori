---
graph_blueprint_version: 1
node_id: 10-01
state: review
phase: 10
risk: medium
complexity: M
predecessors: [08-10]
successors: [10-02, 10-03]
execution_card: blueprints/execution/10-01.md
dossier: blueprints/10-01-25d-fixed-tilt.md
read_policy: execution-card-first
local_full_gate_budget: 1
independent_validation_budget: 1
architecture_review: on-demand-only
---

> **GRAPH EXECUTION MODE:** Read the execution card first. This long file is an evidence dossier, not mandatory context. Open only the sections linked by the card. Planning-time existence claims and line numbers are historical hints; live repository semantics win. Use one full local gate and one independent validation pass.

# BLUEPRINT 10-01: 2.5D fixed-tilt mode

## 1. Header

- ID / Title / Phase: 10-01 — 2.5D fixed-tilt mode — Phase 10 (Depth experiments)
- Status: review
- Primary builder: Claude Sonnet — this is a projection/rendering-math change
  over an already-frozen data path (same nodes/edges/layout endpoints as 2D);
  no new architecture, no new package boundary, well-scoped for Sonnet.
- Reviewer roles: Spec Guardian (frozen-contract + depth-binding correctness),
  Implementation Reviewer (byte-identical layout claim, WebGL fallback path).
- Complexity: M
- Depends on / Unlocks: Depends on 08-10 (large-repo LOD performance, per
  BACKLOG) and transitively on 08-01 (layout persistence), 08-02 (viz
  scaffold), 07-01 (server API) — **none of these exist yet** (verified
  2026-07-17: `ls packages/` = core, fixtures, harness, indexer, mcp, store;
  `ls apps/` = nothing; see EVIDENCE-BASELINE.md Section 8). This blueprint is
  therefore a proposal layered on other still-`pending` proposals; its file
  plan (Section 9) states every assumed 2D symbol precisely so a reviewer can
  re-check it once 08-02/08-10 land. Unlocks: 10-02 (3D experimental flag
  reuses this blueprint's binding contract), 10-03 (depth-study
  instrumentation targets this mode's task set).
- Estimated sessions: 1
- Related frozen-spec sections: `docs/CLI_CONTRACT.md` `--mode 2.5d` flag
  (frozen); ARCHITECTURE.md Section 6 (layout persistence, migration 004);
  ARCHITECTURE.md Section 10 (viz data-loading contract); BACKLOG.md Phase 10
  frozen constraint "depth must derive from named queryable fields, never
  decoration."

## 2. Objective

`--mode 2.5d` (or the in-app toggle) renders the same 2D graph — same nodes,
same edges, same `x`/`y` layout positions, same interactions — under a fixed
orthographic tilt with a depth channel computed at render time from exactly
one named, SQL-expressible graph field. No new data path, no new persisted
column, no free camera.

## 3. Why this matters

- User value: depth as an additional visually-scannable dimension (e.g.
  "how deep is this file's abstraction layer") without the cost, risk, or
  disorientation of a free 3D camera — this is the intentionally conservative
  middle experiment between stable 2D and the 3D free-orbit experiment.
- System value: proves the "depth binds to one named field" contract end to
  end on the cheaper of the two depth modes before 10-02 spends an R3F
  dependency on it.
- Downstream: 10-02 reuses the identical binding contract (Section 8) so the
  two experiments cannot silently diverge on what "depth" means; 10-03's task
  set exercises this mode as one of its conditions.

## 4. Current repository evidence

Verified current (2026-07-17):

- `layout_positions` table already exists, **frozen migration 004**
  (`packages/store/src/migrations.ts:435-471`), columns `repo_id,
  abstraction_level CHECK IN ('package','file','symbol'), view_key DEFAULT
  'base', node_id, x REAL, y REAL, z REAL DEFAULT 0, pinned, anchor_group,
  layout_version, last_snapshot_id, updated_at`. No production reader/writer
  exists yet (grep confirms only migrations, its own migration test, and
  ARCHITECTURE.md specs reference it) — the writer is proposed by 08-01, not
  this blueprint.
- `docs/CLI_CONTRACT.md:48` (frozen, verbatim): `--mode 2.5d
  Depth-experiment mode (same data, added depth channel).` and line 54:
  "All modes render the same entities and relations; depth must derive from
  named queryable fields, never decoration."
- ARCHITECTURE.md Section 6 (AD-005): "the server materializes layout once,
  on first serve of a snapshot; the layout engine is a pure function. `apps/viz`
  never computes layout... Subsequent reads return the stored bytes ->
  byte-identical reload guaranteed by reading persisted `x/y/z`, never
  recomputing." This blueprint's acceptance criterion (Section 14) is a
  direct consequence: the `x`/`y` read path for 2.5D must be the *same* read
  as 2D, so bytes cannot differ.
- ARCHITECTURE.md Section 10 (viz data-loading contract, 08-02/08-10 owned):
  `apps/viz` is HTTP/WS-only, no `@tadori/*` import, no fs, no
  better-sqlite3; level-of-detail requests at package/file/symbol levels via
  `GET /api/v1/nodes?level=...` + `GET /api/v1/edges?...` + `GET
  /api/v1/layout?level=...`.
- ARCHITECTURE.md Section 3, endpoint 15 (07-01/08-01 owned, proposed):
  `GET /api/v1/layout` returns `{ positions: {entityKey, x, y, z, pinned}[];
  layoutVersion }`. **`z` is already present on the wire type today as
  proposed** — this blueprint must decide (Section 8) whether 2.5D's depth
  channel reads that stored `z` or computes depth independently, because the
  stored `z` in migration 004 defaults to `0` and has no defined producer
  yet.
- Frozen node kind enum (`packages/core/src/enums.ts:4-17`): 13 kinds
  including `package, file, function, method, class, interface, type, route,
  test, adr, doc_section, external_dep, unresolved` — used below to reject
  "abstraction layer" as a literal node-kind mapping (kinds are a flat CHECK
  enum, not an ordered hierarchy depth) in favor of `abstraction_level` on
  `layout_positions` itself, which IS an ordered three-value field.
- Frozen edge fields (`packages/store/src/diff.ts:4-15`, `EdgeDiffRow`):
  `before_origin/after_origin` (`Origin` = compiler/heuristic/git/doc/human/
  llm), `before_resolution/after_resolution` (`Resolution` =
  resolved/partial/unresolved), `change_kind` (added/removed/
  resolution_or_provenance_changed) — the exact SQL-expressible fields behind
  the "base-vs-patched membership" candidate (Section 8).
- Frozen `agent_events`/`ObservationEvent.source` (migration 003,
  `packages/mcp/src/events.ts:15`): `AgentEventSource = "claude_hook" |
  "codex_log" | "transcript" | "manual"` — the field behind the
  "repo-vs-agent-scope" candidate (Section 8); this is an event-source
  enum, not a per-node/per-edge property, which matters to the binding
  decision below.
- Files to read first (once 08-01/08-02 exist): the `writeLayout`/
  `readLayout` store functions (proposed, ARCHITECTURE.md Section 6), the
  `/api/v1/layout` handler (proposed, 07-01/08-01), and the `apps/viz`
  Sigma.js render setup (proposed, 08-02). None exist today — this blueprint
  states their proposed shapes as read (not modified) inputs.
- Gotchas: `layout_positions.z` already exists and defaults to `0` — a
  careless implementation could be tempted to just "turn on" that column
  without ever deciding what populates it. Section 8 forecloses that reading
  explicitly.

## 5. Scope

1. An orthographic fixed-tilt camera/projection for the existing 2D Sigma.js
   scene, entered only via `--mode 2.5d` or an in-app 2D<->2.5D toggle.
2. A render-time depth channel computed from exactly one bound field (Section
   8), applied as a screen-space Y-offset plus a depth-cued visual treatment
   (size/opacity falloff) — never as a change to stored `x`/`y`.
3. Reuse of every existing 2D data endpoint and 2D interaction (selection,
   package/file/symbol expansion, search, evidence panels, overlays) with no
   new endpoint added.
4. WebGL-capability detection and fallback to plain 2D.
5. Camera constraint enforcement (fixed tilt angle, no orbit, no free
   rotation).

## 6. Non-goals

- Free orbit / arbitrary camera rotation (that is 10-02, and only there).
- React-Three-Fiber or any 3D rendering library (2.5D stays inside the
  existing Sigma.js/WebGL 2D renderer — a tilted orthographic projection of
  the same 2D scene graph, not a 3D scene).
- Any new persisted column, migration, or endpoint.
- Populating `layout_positions.z` from a *stored* value — depth is computed
  at render time from the bound field, per the frozen "never decoration,
  always a named field" constraint and per Section 8's decision below.
- Changing the depth binding per-session or exposing a binding picker in the
  UI (out of scope for this experiment; the binding is fixed per Section 8).

## 7. Dependencies and prerequisites

- 08-10 (large-repo LOD performance) — BACKLOG-declared dependency; must
  deliver the LOD-budgeted node/edge/layout fetch contract this blueprint
  reuses unchanged.
- Transitively: 08-02 (`apps/viz` scaffold + Sigma.js render), 08-01 (layout
  persistence/materialization), 07-01 (`packages/server` HTTP API) — all
  `pending` as of 2026-07-17. This blueprint's file plan is written against
  their *proposed* contracts in ARCHITECTURE.md; if any of those contracts
  changes before this is built, this blueprint must be re-reviewed, not
  silently reinterpreted.

## 8. Architectural decisions

**DECISION 10-01-A — depth binds to `layout_positions.abstraction_level`
(package=0 / file=1 / symbol=2), not the stored `z` column.** Three
candidates were named in the task and are evaluated here:

1. **Abstraction layer** — candidate SQL expression:
   `CASE abstraction_level WHEN 'package' THEN 0 WHEN 'file' THEN 1 WHEN
   'symbol' THEN 2 END` read from `layout_positions.abstraction_level`
   (frozen migration 004 CHECK enum, already ordered by the semantic-zoom
   contract package -> file -> symbol). **CHOSEN.**
2. **Base-vs-patched membership** — candidate SQL expression: derived from
   `EdgeDiffRow.change_kind` (`packages/store/src/diff.ts:5`) via
   `diffSnapshotEdges(db, base, head)` — `CASE change_kind WHEN 'removed'
   THEN 0 WHEN 'resolution_or_provenance_changed' THEN 1 WHEN 'added' THEN 2
   END`, or equivalently a node-presence three-way (base-only / both /
   head-only). Rejected for this blueprint (see below).
3. **Repo-vs-agent-scope** — candidate SQL expression: `CASE WHEN EXISTS
   (SELECT 1 FROM agent_event_targets aet JOIN agent_events ae ON
   ae.id = aet.agent_event_id WHERE aet.node_id = node_entities.id) THEN 1
   ELSE 0 END` (binary: touched-by-an-observed-agent-event vs not, using the
   frozen migration-003 `agent_events`/`agent_event_targets` tables). Rejected
   for this blueprint (see below).

**Why (1) and not (2) or (3):** 10-01 is the *default-data* depth experiment —
it must render correctly for a snapshot with no diff context and no agent
observation history at all (a cold clone with `tadori serve .` and nothing
else). Candidates (2) and (3) are only meaningful when a base/head diff or an
agent task exists respectively; binding 2.5D's *default* rendering to either
would make depth vanish (collapse to a constant) for the common case, which
reads as decoration-that-sometimes-does-nothing — exactly what the frozen
constraint forbids. `abstraction_level` is populated for every node in every
snapshot unconditionally (it is assigned at layout-materialization time,
Section 6 of ARCHITECTURE.md, one row per node per level), so it is the only
candidate that always produces a real, non-constant three-value signal.
Candidates (2) and (3) remain valid future *view-key* bindings (10-02's
`/experiment` route or a later Phase 9 review-overlay mode) — this decision
does not foreclose them, it only picks the one correct default for 10-01.
Rejected alternative: read the stored `layout_positions.z` column directly —
rejected because no writer for it exists (Section 4), it defaults to `0` for
every row (would render a flat plane, i.e. decoration masquerading as a
computed field with nothing behind it), and "computed at render time from
the bound field" (task instruction) explicitly asks for a render-time
computation, not a stored-column read.

**DECISION 10-01-B — depth is derived client-side from data already on the
wire, not a new server computation.** `abstraction_level` is already the
`level` query parameter the client sends to `GET /api/v1/nodes?level=...`
(ARCHITECTURE.md Section 10) — the client already knows which level a given
render pass is showing. The depth value for a node is therefore
`{package: 0, file: 1, symbol: 2}[currentLevel]` computed in `apps/viz`, no
server round-trip needed, and identical across 2D/2.5D since the same
`/api/v1/nodes` response feeds both. Rejected: add a `depthValue` field to
the `/api/v1/nodes` response — rejected as unnecessary server-side
computation for a value fully determined by the `level` parameter the
client already supplied (violates the "does this need to exist" checkpoint —
the client already has the information).

**DECISION 10-01-C — fixed tilt angle: 35.264 degrees (isometric,
`atan(1/sqrt(2))`).** Chosen because it is the standard "true isometric"
projection angle (equal foreshortening on all three axes), a well-understood,
non-disorienting, commonly-recognized tilt (used in isometric games/CAD
views) that keeps the 2D `x`/`y` layout legible while giving visible depth
separation. Rejected: an arbitrary smaller angle (e.g. 15 degrees) —
insufficient depth separation to be visually meaningful; rejected: a
per-session adjustable tilt slider — scope creep into free-camera territory
that belongs to 10-02, not this fixed-tilt mode.

**DECISION 10-01-D — projection is a 2D affine transform, not a 3D scene.**
The tilt is implemented as a CSS-transform-equivalent (or Sigma.js
camera-space) linear transform applied to the existing 2D canvas render:
`screenY = y * cos(tilt) - depthOffset(node) * sin(tilt)`,
`screenX = x` (unchanged), where `depthOffset(node) = depthUnit *
levelIndex(node)` and `depthUnit` is a fixed pixel constant (proposed: 40px
per level, three levels max => 80px max offset, tuned during 08-02
implementation against the existing node-radius scale). Depth-cued opacity:
farther levels (lower `levelIndex` when viewed from the "camera," see camera
orientation note below) render at reduced opacity (frozen floor: never below
40% opacity, to keep evidence/origin/confidence/resolution — a frozen
non-negotiable — legible in every mode). Rejected: a true 3D perspective
projection (adds a dependency, is 10-02's job, and 2.5D is explicitly
orthographic per the task instruction).

**DECISION 10-01-E — same data paths/endpoints as 2D; zero new endpoints.**
2.5D calls exactly the same `GET /api/v1/nodes`, `GET /api/v1/edges`, `GET
/api/v1/layout` (for `x`/`y` only — `z` from that response is intentionally
ignored per 10-01-A/10-01-B), `GET /api/v1/nodes/:entityKey`, `GET
/api/v1/search`, `GET /api/v1/nodes/:entityKey/evidence`, and WS channel as
2D (ARCHITECTURE.md Section 3/4/10). Rejected: a `/api/v1/layout?view=2.5d`
variant — rejected because the `x`/`y` positions must be identical
(byte-identical acceptance criterion, Section 14), so a distinct view key
would only invite drift; the *only* new information 2.5D needs
(`abstraction_level`) is already present as the request-time `level`
parameter (10-01-B).

**DECISION 10-01-F — WebGL fallback: capability probe once at mode entry,
falls back to plain 2D, never a partial/broken 2.5D render.** On `--mode
2.5d` or in-app toggle, `apps/viz` probes `canvas.getContext("webgl2") ??
canvas.getContext("webgl")`; on `null`, 2.5D silently declines and the app
stays in / falls back to plain 2D with a one-line non-blocking notice ("2.5D
requires WebGL; showing 2D"). Rejected: attempting a software-rendered
degraded 2.5D — Sigma.js's WebGL renderer has no supported non-WebGL
fallback path of its own, and inventing one is out of scope; 2D-via-WebGL is
already the frozen default renderer (ARCHITECTURE.md line 13: "stable 2D
default (Sigma.js/WebGL...)"), so if WebGL is unavailable 2D itself is
already degraded — 2.5D must not make that situation worse by half-rendering.

## 9. Exact file plan

All paths below are **proposed** additions inside the not-yet-built
`apps/viz` package (08-02 scaffold) and `packages/cli` (07-02/07-03). No
existing file is modified by this blueprint because none of these packages
exist yet; this blueprint's builder session begins only after 08-02/08-10
land, and at that time this section is the authoritative file list.

- `apps/viz/src/render/depthBinding.ts` — create. Exports
  `LEVEL_DEPTH_ORDER: Record<AbstractionLevel, number>` (`{package: 0, file:
  1, symbol: 2}`) and `depthOffsetForLevel(level, depthUnit = 40): number`.
  Pure function, no framework import; unit-testable in isolation.
- `apps/viz/src/render/fixedTiltProjection.ts` — create. Exports
  `applyFixedTilt(x, y, depthOffset, tiltRadians = ISOMETRIC_TILT):
  {screenX, screenY}` and the `ISOMETRIC_TILT` constant
  (`Math.atan(1 / Math.sqrt(2))`). Pure function per 10-01-D.
- `apps/viz/src/render/webglCapability.ts` — create. Exports
  `probeWebglSupport(canvas?: HTMLCanvasElement): "webgl2" | "webgl" | null`.
- `apps/viz/src/modes/mode25d.tsx` — create. React component wrapping the
  existing 2D Sigma.js scene component (proposed 08-02 export, name TBD at
  that blueprint's build time) with the tilt transform and camera-lock
  (no-orbit) applied; renders the existing selection/expansion/overlay UI
  unchanged (imports the same panel components 2D uses — no fork).
- `apps/viz/src/modes/ModeToggle.tsx` — create. In-app 2D<->2.5D toggle
  control; calls `probeWebglSupport` before allowing the switch to 2.5D;
  disabled + tooltip explaining "WebGL unavailable" when probe fails.
- `packages/cli/src/flags.ts` (or wherever 07-02 lands `--mode` parsing) —
  modify (additive): recognize `2.5d` as a valid `--mode` value per the
  already-frozen `docs/CLI_CONTRACT.md` flag list; on `2.5d`, serve the same
  static `apps/viz` bundle 2D uses, with an initial-mode query/config flag
  read by `mode25d.tsx` at boot. No new bundle, no new build target — the
  2.5D code ships inside the same default `apps/viz` bundle as 2D (unlike
  10-02, which lazy-loads a separate chunk).
- `apps/viz/test/depthBinding.test.ts` — create. Unit tests for
  `depthOffsetForLevel` (level ordering, unit scaling).
- `apps/viz/test/fixedTiltProjection.test.ts` — create. Unit tests for
  `applyFixedTilt` (angle correctness, `x` passthrough, monotonic depth
  ordering).
- `apps/viz/test/mode25d.test.tsx` — create. Component/integration test:
  same node/edge/layout fetch calls fire in 2.5D as in 2D (spy on fetch);
  selection/expansion/overlay interactions still work; WebGL-fail path falls
  back to 2D.

## 10. Exact contracts

```ts
// apps/viz/src/render/depthBinding.ts
export type AbstractionLevel = "package" | "file" | "symbol"; // matches layout_positions.abstraction_level CHECK enum, packages/store/src/migrations.ts:443

export const LEVEL_DEPTH_ORDER: Record<AbstractionLevel, number> = {
  package: 0,
  file: 1,
  symbol: 2
};

export function depthOffsetForLevel(level: AbstractionLevel, depthUnit = 40): number {
  return LEVEL_DEPTH_ORDER[level] * depthUnit;
}

// apps/viz/src/render/fixedTiltProjection.ts
export const ISOMETRIC_TILT_RADIANS = Math.atan(1 / Math.sqrt(2)); // ~35.264 degrees

export function applyFixedTilt(
  x: number,
  y: number,
  depthOffset: number,
  tiltRadians: number = ISOMETRIC_TILT_RADIANS
): { screenX: number; screenY: number } {
  return {
    screenX: x,
    screenY: y * Math.cos(tiltRadians) - depthOffset * Math.sin(tiltRadians)
  };
}

// apps/viz/src/render/webglCapability.ts
export function probeWebglSupport(
  canvas: HTMLCanvasElement = document.createElement("canvas")
): "webgl2" | "webgl" | null {
  if (canvas.getContext("webgl2")) return "webgl2";
  if (canvas.getContext("webgl")) return "webgl";
  return null;
}
```

CLI: `--mode 2.5d` (already frozen in `docs/CLI_CONTRACT.md:48` — this
blueprint does not add a flag, it implements an existing one). No new HTTP
endpoint, no new WS message, no new config key, no new DB migration, no new
error code beyond the existing `apps/viz` fallback notice (not a server
error — a client-side render-mode decision).

## 11. Ordered implementation procedure

1. Confirm 08-02 (`apps/viz` scaffold) and 08-10 (LOD budgets) are `built`
   or `validated` in `blueprints/INDEX.md` before starting; if either is
   still `pending`, stop and report blocked (frozen dependency chain,
   Section 7).
2. `apps/viz/src/render/depthBinding.ts` + its test: write
   `depthOffsetForLevel` and its unit test first (TDD); confirm it passes.
   Reason: isolates the depth-binding decision (10-01-A/B) as one pure,
   independently-verifiable function before any rendering code touches it.
3. `apps/viz/src/render/fixedTiltProjection.ts` + its test: write
   `applyFixedTilt` and its unit test (angle math, `x` passthrough). Reason:
   isolates the projection math (10-01-D) from the depth-binding decision so
   either can be independently reviewed/changed.
4. `apps/viz/src/render/webglCapability.ts` + inline test: `probeWebglSupport`.
5. `apps/viz/src/modes/mode25d.tsx`: wrap the existing 2D scene component,
   apply `applyFixedTilt` per visible node using `depthOffsetForLevel(node's
   current fetch level)`, lock camera controls (disable any orbit/rotate
   input the underlying Sigma camera exposes — expose zoom/pan only, matching
   2D's existing pan/zoom). Reason: this is the actual mode; test after with
   `mode25d.test.tsx`.
6. `apps/viz/src/modes/ModeToggle.tsx`: wire `probeWebglSupport` as a guard;
   wire the toggle to switch `mode25d.tsx` in/out without remounting the
   underlying data-fetch layer (same `apiClient` instance, same in-flight
   node/edge cache) — this is what guarantees Decision 10-01-E holds at
   runtime, not just in the request code.
7. `packages/cli` flag wiring: accept `--mode 2.5d`, pass initial mode to the
   served bundle (query param or injected config, matching whatever
   mechanism 07-02 already used for `--mode 2d`/`3d-experiment` — reuse it,
   do not invent a second one).
8. Run the full validation gate (Section 15). Manual/browser verification:
   start `tadori serve . --mode 2.5d` against a real fixture repo, confirm
   package/file/symbol expansion, selection, search, and evidence panels all
   behave identically to 2D except for the tilt.
9. Byte-identical layout check (Section 14): capture `/api/v1/layout`
   response bytes for a snapshot under `--mode 2d`, then under `--mode
   2.5d`, diff them — must be byte-identical (same endpoint, same stored
   rows, per 10-01-E).

## 12. Data and lifecycle flows

**Startup:** `tadori serve . --mode 2.5d` → same 9-step CLI contract as 2D
(`docs/CLI_CONTRACT.md:19-39`, unchanged by this blueprint) → server serves
the same static bundle → client boots with initial mode = `2.5d` →
`probeWebglSupport()` → if `null`, boot in 2D with the fallback notice; else
boot `mode25d.tsx`.

**Operation:** identical to 2D's package -> file -> symbol expansion flow
(ARCHITECTURE.md Section 10) — every fetch is the same call; the only
difference is the render pass applies `applyFixedTilt` per node using that
node's `depthOffsetForLevel(level)` before handing coordinates to Sigma's
WebGL renderer.

**In-app toggle:** user clicks `ModeToggle` -> probe -> either re-render the
current scene with the tilt transform applied/removed (no re-fetch, no
snapshot change) or, on probe failure, toggle is disabled with the notice.

**Failure:** WebGL context loss mid-session (existing Sigma.js "webglcontext
lost" event) — same recovery path 2D already needs (08-02's responsibility);
2.5D adds no new failure mode here since it uses the same WebGL context 2D
does, just a different vertex transform.

**Shutdown:** unchanged — mode is pure client render state, nothing to tear
down beyond what 2D already tears down.

## 13. Test plan

- Unit: `depthBinding.test.ts` — `depthOffsetForLevel("package") === 0`,
  `depthOffsetForLevel("file") === 40`, `depthOffsetForLevel("symbol") ===
  80`, custom `depthUnit` scaling.
- Unit: `fixedTiltProjection.test.ts` — `applyFixedTilt(x, y, 0)` returns
  `screenX === x` for all `x`; `screenY` strictly decreases as `depthOffset`
  increases (monotonic); angle constant equals `Math.atan(1/Math.sqrt(2))`
  within floating-point tolerance.
- Unit: `webglCapability.test.ts` — mocked canvas returning `null` for both
  contexts yields `null`; mocked `webgl2` context yields `"webgl2"`.
- Integration: `mode25d.test.tsx` — spy/mock the API client; assert the
  exact same sequence of `GET /api/v1/nodes`, `/edges`, `/layout` calls fires
  in 2.5D as a recorded 2D baseline call sequence (same URLs, same query
  params); assert selection/expansion/search/evidence-panel components
  render (smoke, not full a11y — that is Section 19/08-11's job) in 2.5D
  mode; assert WebGL-probe failure renders the 2D fallback component instead
  of `mode25d.tsx`.
- Regression: full existing gate (Section 15) must stay green — this
  blueprint touches no frozen fixture, schema, or store code.
- Adversarial: attempt to read `layout_positions.z` from the layout response
  in `mode25d.tsx` — a review check (not an automated test) that no code
  path references the wire `z` field, enforcing Decision 10-01-A.

## 14. Acceptance criteria

- [ ] `--mode 2.5d` is accepted by the CLI and serves the visualization
      without error against a fixture repository.
- [ ] `/api/v1/layout` response bytes for a given snapshot are identical
      (byte-for-byte JSON) whether requested during a `--mode 2d` session or
      a `--mode 2.5d` session.
- [ ] No `GET`/`POST` request is made by `apps/viz` in 2.5D mode to any path
      absent from the frozen 2D endpoint list (ARCHITECTURE.md Section 3);
      zero new endpoints introduced.
- [ ] Depth offset for every rendered node equals
      `depthOffsetForLevel(nodeCurrentLevel)` exactly, computed client-side,
      never read from a server-provided depth/`z` field.
- [ ] Camera exposes zoom and pan only; no rotate/orbit control is reachable
      in 2.5D mode (manual/code-review check: no orbit event handler wired).
- [ ] Selection, package/file/symbol expansion, search, and evidence panels
      all function in 2.5D mode using the same components 2D uses (no
      forked panel implementation exists).
- [ ] WebGL-capability probe returning `null` results in a 2D render with a
      visible, non-blocking fallback notice; 2.5D mode is never partially
      rendered.
- [ ] Fixed tilt angle equals `atan(1/sqrt(2))` radians (~35.264 degrees) and
      is not adjustable via any UI control shipped by this blueprint.
- [ ] Full existing validation gate (Section 15) passes with zero fixture,
      schema, or frozen-contract deltas.

## 15. Validation commands

pnpm skills:check; pnpm typecheck; pnpm lint; pnpm test;
python validate_fixtures.py; pnpm fixtures:validate; pnpm fixtures:index;
pnpm fixtures:typecheck; pnpm benchmark:incremental; git diff --check;
git status --short; plus (once 08-02/08-10 land) the `apps/viz` test runner
command those blueprints establish (name not yet fixed — this blueprint adds
its three new test files to whatever that command is) and a manual
`tadori serve . --mode 2.5d` smoke session against a fixture repository.

## 16. Performance budgets

- Depth-transform computation: O(1) per visible node per frame, no
  allocation beyond the returned `{screenX, screenY}` pair — must not
  regress the existing 2D frame budget established by 08-10 (cold 150k LOC
  -> interactive < 5s; this blueprint adds a per-node multiply-add, not a
  new data fetch, so it must not measurably change that number).
- Mode toggle (2D <-> 2.5D): must not trigger a re-fetch of nodes/edges/
  layout (same in-memory data, transform-only) — toggle latency budget:
  under one animation frame (~16ms) for the transform recompute on the
  currently-loaded node set.

## 17. Failure and recovery behavior

- WebGL unavailable at mode entry: fall back to 2D, non-blocking notice
  (Section 8, Decision 10-01-F).
- WebGL context lost mid-session: same recovery 2D already implements
  (08-02's responsibility) — 2.5D adds no distinct recovery path.
- Malformed/stale layout data (e.g. `refresh_pending`): identical to 2D's
  existing staleness handling (ARCHITECTURE.md `ApiContext.stale`/
  `staleReason`) — 2.5D reads the same context object and renders the same
  staleness indicator 2D does; no new failure semantics invented here.
- Unsupported repository / invalid snapshot: unchanged from the frozen CLI
  contract (never served) — this blueprint does not touch snapshot
  validation.

## 18. Security and privacy

No new endpoint, no new data exposed beyond what 2D already serves over
`127.0.0.1`. No new file-system or path access from `apps/viz` (still
HTTP/WS-only per the frozen viz-isolation rule, ARCHITECTURE.md Section 1).
No new redaction surface — the depth channel is derived from
`abstraction_level`, an already-visible-to-2D classification, not new
sensitive content.

## 19. Accessibility

- Non-canvas fallback: the existing 2D accessible list/table alternative
  (08-11's deliverable) must remain available and unchanged in 2.5D mode —
  this blueprint adds no new canvas-only information (depth is a secondary
  visual cue on top of data already representable in the existing list/table
  view; the `abstraction_level`/`level` field already drives that view's
  grouping in 2D).
- Reduced motion: the 2D<->2.5D toggle transition must respect
  `prefers-reduced-motion` — no animated tilt transition when the media
  query is set; snap directly to the new projection instead.
- Keyboard: `ModeToggle` is a standard focusable, keyboard-activatable
  control (matches whatever accessible-toggle pattern 08-02/08-11
  establishes for other mode/view toggles — reuse it, do not invent a new
  one).
- Contrast: the depth-cued opacity floor (Decision 10-01-D, never below 40%)
  exists specifically so far-plane nodes remain legible against the
  background at the same contrast ratio 2D already validates under 08-11.

## 20. Documentation updates

- `docs/CLI_CONTRACT.md` — no change (the `--mode 2.5d` flag is already
  frozen and documented there; this blueprint implements it, does not amend
  the contract).
- `IMPLEMENTATION_STATUS.md` — add a dated entry recording 2.5D fixed-tilt
  mode implemented, the chosen depth binding (`abstraction_level`), the
  fixed tilt angle, and validation evidence, once built.

## 21. Builder final report

Require: summary; files changed (per Section 9); depth-binding function
implemented and its test results; projection function implemented and its
test results; byte-identical layout diff evidence (raw bytes or hash
comparison, 2D vs 2.5D); WebGL-fallback manual verification note; full
validation gate output; commit SHA; known limitations; follow-on risks
(e.g. tilt angle tuning feedback from 10-03's study); `ASSUMPTION:` lines for
anything this blueprint could not pin down before 08-02/08-10 existed (e.g.
exact component names to wrap).

## 22. Independent review result

Pending Wave 4 adversarial review.

## IF SOMETHING IS UNCLEAR

Make the smallest safe assumption, record `ASSUMPTION: ...` in the report,
continue without expanding scope. If the uncertainty could violate a frozen
contract (e.g. adding an endpoint, moving `x`/`y` values, allowing orbit),
stop that item and report blocked.

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
