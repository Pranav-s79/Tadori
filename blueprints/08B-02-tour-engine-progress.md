# BLUEPRINT 08B-02: Tour engine + progress state

## 1. Header

- ID / Title / Phase: 08B-02 — Tour engine + progress state — Phase 8B
  (Guided Explore mode)
- Status: review
- Primary builder: Claude Sonnet — deterministic state machine + file-backed
  persistence over an existing frozen layout; no UI framework decisions, no
  architectural latitude beyond what is fixed here.
- Reviewer roles: Spec Guardian (determinism/evidence honesty, frozen-layout
  non-movement), Test Adversary (corruption-recovery matrix, resume-across-
  restart matrix), Implementation Reviewer (`.tadori/` file contract,
  concurrency with the existing snapshot-refresh worker).
- Complexity: M (one focused builder session)
- Depends on: 08B-01 (subsystem/overview derivation — supplies `Subsystem`
  and entry-point data that seed the deterministic step ordering used by
  08B-03's tour types; this blueprint's engine is generic over `TourStep[]`
  and does not itself require 08B-01 to run, but the ordering rule in §8
  reuses 08B-01's fan-in/topo-order convention for consistency)
- Unlocks: 08B-03 (walkthrough tours are concrete `Tour` instances built on
  this engine's state machine and persistence contract)
- Estimated sessions: 1
- Related frozen-spec sections: ARCHITECTURE.md §8 (tour data model —
  `Tour`, `TourStep`, `TourProgress` types; `.tadori/progress.json`); §3 rows
  17-18 (`GET /api/v1/tour`, `GET/PUT /api/v1/tour/progress`); §5 AD-004
  (canonical `.tadori/` layout); §6 AD-005 (frozen layout — server
  materializes once, positions never move); ASSUMPTIONS.md A-105
  (deterministic, offline, reproducible, evidence-backed; no LLM at
  runtime).

## 2. Objective

A generic, deterministic tour engine: given an ordered `TourStep[]` (defined
by a tour-type-specific blueprint such as 08B-03), it exposes a step state
machine (Next/Back/Exit/Free-Explore/Resume), computes each step's camera
target as a pure function of the step's `focusEntityKeys` and the already-
materialized frozen layout (never recomputing or moving layout), and
persists progress to `.tadori/progress.json` with a versioned schema that
recovers from corruption without crashing. Resuming a tour after a `tadori
serve` restart, or after the underlying snapshot is replaced, produces a
correct, honestly-labeled continuation.

## 3. Why this matters

- User value: guided exploration that remembers where the user left off
  across restarts, never silently loses progress, and never moves the graph
  under the user's feet mid-tour (violating the frozen-layout non-
  negotiable would break spatial memory the user is building).
- System value: this is the one place tour state transitions and
  persistence are implemented — 08B-03's four tour types are pure data
  (`TourStep[]` lists) plugged into this engine, so behavior (keyboard
  handling, corruption recovery, resume semantics) is identical across all
  tour types by construction, not re-implemented four times.
- Downstream: any future tour type (beyond 08B-03's four) reuses this
  engine unchanged.

## 4. Current repository evidence

**Verified current:**

- ARCHITECTURE.md §8 (lines 400-409) fixes the exact types this blueprint
  implements against (restated verbatim in §10).
- ARCHITECTURE.md §5 AD-004 (lines 273-287): canonical `.tadori/` layout
  already names `progress.json` as a sibling of `tadori.sqlite`, created via
  `mkdirSync(recursive)` the same way the store DB directory is created.
  This blueprint is the **first and only** writer/reader of that file (no
  existing code touches it yet — verified via the `grep`-based evidence
  baseline finding no `packages/server`/`packages/cli` directories exist at
  all, EVIDENCE-BASELINE.md §8).
- ARCHITECTURE.md §6 AD-005 (lines 317-335): layout positions are
  materialized once per `(repoId, level, viewKey)` and **never recomputed on
  read** — "existing nodes never move (frozen coordinates)." This blueprint
  must not introduce any camera or step logic that requests a layout
  recompute; it only *reads* `GET /api/v1/layout` (ARCHITECTURE §3 row 15)
  to resolve `entityKey -> {x,y,z}` for camera targeting.
- ARCHITECTURE.md §3 rows 17-18 (lines 194-195): `GET /api/v1/tour` (`id?`
  param) and `GET/PUT /api/v1/tour/progress` (body
  `{tourId, stepIndex}`, persisted `.tadori/`) are already assigned to
  08B-02 in the endpoint table — this blueprint implements exactly those two
  routes' handlers (route registration into the 07-01 Fastify shell, same
  pattern as 08B-01's `overview.ts` route file).
- ARCHITECTURE.md §4 WebSocket contract (lines 205-229): `snapshot_replaced`
  event with `snapshotId`/`generation`/`workspaceHash` is the signal this
  blueprint's resume logic listens for to detect "snapshot replaced while a
  tour was open" (§8, §12, §17).
- `packages/core/src/identity.ts` (per EVIDENCE-BASELINE.md §3): `entityKey`
  is a stable 64-hex-char identity computed from `canonicalIdentity` —
  already the stable anchor this blueprint keys step-to-entity binding on
  (never a raw array index or a mutable display name).
- **What does not exist yet**: no `packages/cli`, `packages/server` — this
  blueprint's server-side pieces (route handlers, `.tadori/progress.json`
  read/write) are additive to those packages once built (07-01/07-02), same
  caveat as 08B-01 §7/§11 step 7.

**Files to read first:** `blueprints/ARCHITECTURE.md` §3 (rows 17-18), §4
(WS contract), §5 (AD-004, canonical `.tadori/` layout), §6 (AD-005, frozen
layout persistence), §8 (tour types); `blueprints/08B-01-subsystem-overview-
derivation.md` (for the `Subsystem`/entry-point shapes this engine's step
data will reference, produced by 08B-03's tour builders, not this
blueprint); `packages/core/src/identity.ts` (entity-key stability).

**Gotchas:** `.tadori/progress.json` is a **single file for the whole
repository**, not per-tour — a repository has at most one "current tour"
open at a time (switching tours overwrites progress; this is a deliberate
simplification stated in §8, not an oversight). The frozen layout
(AD-005) guarantees byte-identical positions across reloads, but **does
not** guarantee an entity present in one snapshot still exists in the next
— step anchoring must handle a vanished entity without crashing (§8, the
"entity-identity-based step anchoring" requirement from this task's
instructions).

## 5. Scope

1. `TourStep` state machine: states and transitions (Next / Back / Exit /
   Free-Explore / Resume), exact text diagram (§12).
2. Camera path as a deterministic pure function of step targets — reads
   already-materialized layout positions, never recomputes layout.
3. Progress persistence: `.tadori/progress.json` exact schema, versioning,
   corruption recovery (corrupt file → reset with notice, never crash).
4. Resume across `tadori serve` restarts (file-backed, already covered by
   persistence) and across snapshot replacement (entity-identity anchoring;
   vanished-anchor steps marked unavailable with reason, tour continues).
5. Keyboard accessibility: Tab/Arrow/Escape semantics exact mapping.
6. Free-Explore transition: leaving a tour to pan/zoom freely, and returning
   to the **exact** tour state (same step index, same camera target).
7. `GET /api/v1/tour` and `GET/PUT /api/v1/tour/progress` endpoint
   handlers.
8. Unit tests for the state machine, persistence corruption matrix, and
   resume-after-snapshot-replacement matrix.

## 6. Non-goals

- No concrete tour content (entry-point tour, route tour, dependency tour,
  test walkthrough are 08B-03's scope — this blueprint takes `TourStep[]`
  as an opaque input and never constructs one itself, except for a minimal
  synthetic fixture used in its own unit tests).
- No layout computation or movement — frozen per AD-005; this blueprint is
  a **read-only** consumer of `GET /api/v1/layout`.
- No multi-tour-at-once state (one active tour per repository at a time;
  see §8 for the rationale and §17 for what happens if the client requests
  a different tour while one is in progress — it is a plain overwrite, not
  a merge).
- No LLM narration generation — `TourStep.narration` is an
  `OverviewSentence` (already evidence-backed per ARCHITECTURE §8), authored
  by whichever tour-type blueprint builds the step list; this engine only
  stores and serves it, never generates it (A-105).
- No cross-device/cross-user sync — `.tadori/progress.json` is local-
  filesystem, single-machine state, matching the "no cloud dependency"
  non-negotiable.

## 7. Dependencies and prerequisites

- 08B-01: for the `OverviewSentence` type used inside `TourStep.narration`
  (already fixed in ARCHITECTURE §8, no new dependency beyond the type
  import).
- Transitively 07-01 (`packages/server`) for route registration and 08-01
  (layout engine) for `GET /api/v1/layout` to be servable — same caveat as
  08B-01 §7 regarding build-order deferral if those packages do not exist
  yet at implementation time.

## 8. Architectural decisions

**AD-08B02-1 — One active tour per repository; progress file is a single
object, not a collection.** `.tadori/progress.json` holds exactly one
`TourProgress` (plus a schema version wrapper, §10). Rationale: Guided
Explore is framed as a single guided path at a time (R-01 §5 "guided-
explore framing... your job after the pipeline is to be the guide" —
validates a single-thread narrative, not parallel tour tracks); a
multi-tour-progress store would require UI for "which tour was I on," which
is out of scope and unrequested. Rejected: per-tour-id progress map —
rejected as unrequested complexity (YAGNI) that also complicates the
corruption-recovery story (one object to validate vs. a map of them);
revisit only if a future blueprint explicitly requires resuming multiple
tours concurrently.

**AD-08B02-2 — Step ordering is fixed at tour-construction time, not
recomputed by the engine.** The engine treats `Tour.steps` as an immutable,
pre-ordered array; `Tour.deterministicSeed` (already in the ARCHITECTURE §8
type) is a string the tour-builder blueprint (08B-03) sets, not computed
here. This blueprint's job is state-machine transitions over a fixed
array index, not re-deriving order. Determinism responsibility for *why*
steps are in a given order belongs entirely to 08B-03; this blueprint only
guarantees that replaying the same `Tour` object produces the same
transitions and the same persisted state.

**AD-08B02-3 — Camera target is `centroid(focusEntityKeys' stored
positions)`, zero interpolation state persisted.** For a step with
`focusEntityKeys: string[]`, the camera target is computed as:

```ts
function cameraTargetFor(step: TourStep, positions: Map<string, {x,y,z}>): {x,y,z} | null {
  const pts = step.focusEntityKeys.map(k => positions.get(k)).filter(p => p !== undefined);
  if (pts.length === 0) return null;   // every anchor vanished — step unavailable, see AD-08B02-6
  return {
    x: pts.reduce((s,p)=>s+p.x,0) / pts.length,
    y: pts.reduce((s,p)=>s+p.y,0) / pts.length,
    z: pts.reduce((s,p)=>s+p.z,0) / pts.length,
  };
}
```

This is a pure function of already-persisted `x/y/z` values (read via `GET
/api/v1/layout`, AD-005) — no new coordinates are ever computed or written;
the "camera path" is the sequence of these centroids across
`Tour.steps`, computed fresh on each render from stored positions (so it is
trivially byte-identical across reloads, inheriting AD-005's guarantee).
Rejected: persisting a separate "camera position" per step in its own
table/file — rejected because it would duplicate data already recoverable
from `layout_positions` plus `focusEntityKeys`, and would need its own
invalidation story when positions are recomputed for new nodes (AD-005's
package-centroid placement). Rejected: animated tweening state persisted
across steps — out of scope; the *viz* layer (not numbered yet) owns
transition animation as ephemeral React view state, per ARCHITECTURE §10
"React owns only view state."

**AD-08B02-4 — State machine states and transitions (exact).** States:
`idle` (no tour active), `active` (a step is current), `free_explore`
(temporarily left the tour view without losing tour state), `exited` (tour
closed, progress cleared for that tour). Transitions:

```
                    start(tourId)
        idle ─────────────────────────────► active(stepIndex=0)

        active(i) ──Next───────────────────► active(i+1)      [if i+1 < steps.length]
        active(i) ──Next───────────────────► exited           [if i+1 == steps.length, tour complete]
        active(i) ──Back───────────────────► active(i-1)      [if i > 0]
        active(i) ──Back───────────────────► active(i)        [no-op if i == 0]
        active(i) ──Exit────────────────────► idle             [progress persisted at last i]
        active(i) ──FreeExplore─────────────► free_explore(i)  [i remembered]
        free_explore(i) ──Resume────────────► active(i)        [exact same step, same camera target]
        free_explore(i) ──Exit──────────────► idle             [progress persisted at i]
        exited ──start(tourId)───────────────► active(0)        [fresh tour, or same tourId restarts at 0]
```

No state has an unhandled transition — `Next` at the last step ends the
tour (`exited`, not an error); `Back` at step 0 is a no-op (not an error);
`Exit` is valid from any non-`idle` state.

**AD-08B02-5 — Corrupt `.tadori/progress.json` resets with a notice, never
crashes.** On read, if the file exists but fails JSON parse, fails schema
validation (§10), or has a `schemaVersion` newer than this engine
understands: the engine treats it as **no saved progress** (`idle` state),
overwrites the file with a fresh valid empty-progress object on the next
write, and returns a `recoveryNotice: string` field to the caller (surfaced
by the server as part of the `GET /api/v1/tour/progress` response body, not
a silent log-only event) reading exactly:

```
"Saved tour progress could not be read and was reset. Starting fresh."
```

This satisfies "corrupt progress file -> reset with notice, never crash"
verbatim. Rejected: attempting partial recovery (e.g. salvaging just
`tourId` from a malformed file) — rejected as unnecessary complexity for a
low-stakes, easily-regenerated file; the tour restarts, nothing else in the
system is affected.

**AD-08B02-6 — Entity-identity-based step anchoring; vanished anchor marks
the step unavailable, tour continues.** Each `TourStep.focusEntityKeys` is
resolved against the layout position map at *render/resume* time, not at
tour-construction time. If **all** of a step's `focusEntityKeys` are absent
from the current snapshot's node set (checked via `GET /api/v1/nodes/
:entityKey` returning 404, or equivalently the step's keys missing from the
loaded layout position map), the step is marked:

```ts
interface TourStepAvailability { available: boolean; reason: string | null; }
// reason, when available === false, is exactly:
"This step's focus could not be found in the current snapshot and was skipped."
```

The engine does **not** remove the step from `Tour.steps` (index stability
is preserved for `Back`/`Next` arithmetic) — it marks it unavailable and
`Next`/`Resume` **auto-advances past** any unavailable step (repeatedly, if
consecutive steps are all unavailable) until it lands on an available step
or reaches the end of the tour (in which case the tour ends, same as
running out of steps normally). If **some** (not all) of a step's
`focusEntityKeys` are still present, the step remains available and its
camera target is the centroid of only the surviving anchors (AD-08B02-3's
`.filter(p => p !== undefined)` already implements this partial-survival
case). Rejected: crashing or blocking the tour on a vanished anchor —
violates "tour continues" requirement; rejected: silently renumbering steps
— would break `stepIndex` persistence semantics across a resume.

**AD-08B02-7 — Free-Explore returns to exact tour state by construction, not
by snapshotting.** Because `free_explore(i)` retains `i` in the state
machine (AD-08B02-4) and the camera target is always recomputed from `i`
via the pure function in AD-08B02-3, "return to exact tour state" requires
no separate saved snapshot of camera/UI state — `Resume` simply re-enters
`active(i)`, and the camera target is recomputed identically because it is
a pure function of `(step, positions)`, both unchanged. This is the
lazy-but-correct answer: no extra persistence surface, no extra state to
go stale.

**AD-08B02-8 — Keyboard mapping (fixed).** `Tab` moves focus among the tour
panel's interactive controls (Next/Back/Exit/Free-Explore buttons) in DOM
order — standard browser tab order, no custom tabindex choreography.
`ArrowRight` / `ArrowDown` trigger `Next`; `ArrowLeft` / `ArrowUp` trigger
`Back`; `Escape` triggers `Exit` (from `active` or `free_explore`). These
bindings are active only while the tour panel has focus (not global
document-level capture, to avoid conflicting with search/other panel
keyboard handling per 08-05's scope). Rejected: overloading plain `Enter`
for `Next` — reserved for activating whatever control currently has focus
(standard button-activation semantics), avoiding a conflict between "the
tour's Next action" and "activate the focused Exit button."

## 9. Exact file plan

- `packages/mcp/src/tourEngine.ts` — **create**. Exports the state machine
  (`TourState`, `TourEngineAction`, `applyTourAction`), `cameraTargetFor`,
  `resolveStepAvailability`, and the progress-file codec
  (`serializeProgress`, `parseProgressFile` — the latter implements
  AD-08B02-5's corruption recovery). Pure, no filesystem I/O in this file
  (I/O lives in the CLI/server-facing wrapper below) — keeps the state
  machine unit-testable without a filesystem fixture.
- `packages/mcp/src/index.ts` — **modify**. Barrel-export the above (same
  additive pattern as 08B-01).
- `packages/mcp/test/tourEngine.test.ts` — **create**. State machine
  transition table tests, camera-target tests, corruption-recovery tests,
  vanished-anchor tests (§13).
- `packages/server/src/progressStore.ts` — **create** (assumes 07-01/07-02
  scaffold exists). Exports `readProgress(repoRoot: string):
  {progress: TourProgress | null; recoveryNotice: string | null}` and
  `writeProgress(repoRoot: string, progress: TourProgress): void`, both
  thin wrappers around `parseProgressFile`/`serializeProgress` plus
  `fs.readFileSync`/`fs.writeFileSync` against
  `path.join(repoRoot, ".tadori", "progress.json")` (matches AD-004's
  canonical layout exactly; reuses the same `mkdirSync(recursive)` pattern
  the store DB path already uses).
- `packages/server/src/routes/tour.ts` — **create** (assumes 07-01
  scaffold). Registers `GET /api/v1/tour` and `GET`/`PUT /api/v1/tour/
  progress` per §10.
- `packages/server/test/progressStore.test.ts` — **create**. Filesystem-
  level corruption matrix (real temp-dir files, not just in-memory strings)
  and restart-simulation test (write progress, construct a fresh
  `readProgress` call as if from a new process, assert identical resume
  state).
- `packages/server/test/tour.route.test.ts` — **create**. HTTP-level tests
  for both endpoints, including the snapshot-replaced resume scenario
  (§13).

## 10. Exact contracts

Types restated verbatim from ARCHITECTURE §8 (unchanged by this
blueprint):

```ts
type TourKind = "entry_point" | "route_request" | "dependency" | "test";
interface TourStep { index: number; title: string; focusEntityKeys: string[]; narration: OverviewSentence; cameraViewKey: "base"; }
interface Tour { id: string; kind: TourKind; title: string; steps: TourStep[]; deterministicSeed: string; }
interface TourProgress { tourId: string; stepIndex: number; updatedAt: string; }
```

New types this blueprint adds (additive, no ARCHITECTURE conflict):

```ts
type TourEngineState =
  | { mode: "idle" }
  | { mode: "active"; tourId: string; stepIndex: number }
  | { mode: "free_explore"; tourId: string; stepIndex: number };

type TourEngineAction =
  | { type: "start"; tourId: string }
  | { type: "next" } | { type: "back" }
  | { type: "exit" } | { type: "free_explore" } | { type: "resume" };

function applyTourAction(
  state: TourEngineState,
  action: TourEngineAction,
  tour: Tour,                                   // needed to know steps.length for end-of-tour detection
  stepAvailability: (step: TourStep) => boolean  // AD-08B02-6, injected so the pure fn stays IO-free
): TourEngineState;

interface CameraTarget { x: number; y: number; z: number; }
function cameraTargetFor(
  step: TourStep,
  positions: ReadonlyMap<string, { x: number; y: number; z: number }>
): CameraTarget | null;                          // null => AD-08B02-6 vanished-anchor case

interface StepAvailability { available: boolean; reason: string | null; }
function resolveStepAvailability(
  step: TourStep,
  positions: ReadonlyMap<string, { x: number; y: number; z: number }>
): StepAvailability;

// .tadori/progress.json on-disk schema (versioned)
interface ProgressFileV1 {
  schemaVersion: 1;
  progress: TourProgress | null;   // null = no tour ever started, or reset after corruption
}

function serializeProgress(progress: TourProgress | null): string;   // JSON.stringify(ProgressFileV1, null, 2) + "\n"
function parseProgressFile(raw: string): {
  progress: TourProgress | null;
  recoveryNotice: string | null;   // AD-08B02-5's fixed string, or null if the file was fine (or absent)
};
```

**Server endpoints (route handler contracts):**

```ts
// GET /api/v1/tour?id=<tourId>
// 200 -> { context: ApiContext; tour: Tour; stepAvailability: StepAvailability[] } // one entry per step, index-aligned
// 404 -> ApiError { code: "unknown_tour" }   // unknown/missing id
// (No id param behavior deferred to 08B-03: which tour is "default" is a tour-catalog
//  question owned by the walkthrough-tours blueprint, not this engine.)

// GET /api/v1/tour/progress
// 200 -> { context: ApiContext; progress: TourProgress | null; recoveryNotice: string | null }

// PUT /api/v1/tour/progress
// body: { tourId: string; stepIndex: number }
// 200 -> { context: ApiContext; progress: TourProgress }   // echoes back what was persisted, updatedAt server-stamped
// 400 -> ApiError { code: "invalid_step_index" }            // stepIndex out of bounds for the referenced tour
```

## 11. Ordered implementation procedure

1. Write `packages/mcp/test/tourEngine.test.ts` with the full state-
   transition table from AD-08B02-4 as failing assertions (a synthetic
   3-step `Tour` fixture is used — no dependency on 08B-03 or real graph
   data). Run `pnpm test` — new tests fail (module does not exist).
2. Implement `applyTourAction` in `packages/mcp/src/tourEngine.ts` exactly
   per the transition table. Test: state-machine assertions go green.
3. Implement `cameraTargetFor` and `resolveStepAvailability`
   (AD-08B02-3/6) against a small in-memory `positions` map fixture,
   including the "some anchors survive" partial case and the "all anchors
   vanished" full-unavailable case. Test: camera/availability assertions go
   green.
4. Implement `serializeProgress`/`parseProgressFile` (AD-08B02-5): valid
   round-trip, missing file (treated as `progress: null`, no notice),
   malformed JSON (notice fires), valid JSON but wrong schema shape (notice
   fires), future `schemaVersion` (notice fires). Test: corruption matrix
   goes green.
5. Barrel-export from `packages/mcp/src/index.ts`.
6. Create `packages/server/src/progressStore.ts` (filesystem wrapper) and
   its test: write-then-read round trip in a real temp directory; corrupt
   the file on disk between write and read, assert recovery notice and
   `idle`-equivalent `progress: null`; simulate "restart" by calling
   `readProgress` from a second, independent call (no shared in-memory
   state) and asserting identical output to what was written.
7. Create `packages/server/src/routes/tour.ts` (assumes 07-01 scaffold;
   defer with `BLOCKED:` note if not yet built, same as 08B-01 step 7) and
   its route tests, including: (a) normal Next/Back/Exit sequence via
   repeated `PUT` calls; (b) a "snapshot replaced" scenario — persist
   progress pointing at a step whose `focusEntityKeys` exist in snapshot A,
   swap in a fresh `GraphService` for snapshot B lacking those entity keys,
   call `GET /api/v1/tour` again, assert the step's
   `stepAvailability[i].available === false` with the exact reason string
   and that later, still-anchored steps remain `available: true`.
8. Run full validation gate (§15).

## 12. Data and lifecycle flows

**Text sequence diagram — tour start through resume across a restart:**

```
Client                     Server (packages/server)          Filesystem
  |--GET /api/v1/tour?id=X-->|                                   |
  |                          |--readProgress(repoRoot)---------->|  (no file yet -> progress: null)
  |<--200 {tour, stepAvail}--|                                   |
  |--PUT /tour/progress------>|  {tourId:X, stepIndex:0}         |
  |                          |--writeProgress------------------->|  progress.json written
  |<--200 {progress}----------|                                   |
  |   ... user clicks Next repeatedly, each PUT persists ...     |
  |--PUT /tour/progress------>|  {tourId:X, stepIndex:3}         |
  |                          |--writeProgress------------------->|  progress.json updated
  === process restarts (tadori serve . run again) ===
  |--GET /api/v1/tour/progress->|                                |
  |                          |--readProgress(repoRoot)---------->|  reads {tourId:X, stepIndex:3}
  |<--200 {progress:{X,3}}----|                                   |
  (client re-renders at step 3, camera target recomputed from current layout)
```

**Snapshot-replacement flow:** WS `snapshot_replaced` event arrives at the
client while a tour is `active` -> client re-fetches `GET /api/v1/tour?
id=<current>` -> server recomputes `stepAvailability[]` against the new
`GraphService`'s node set -> any step whose anchors vanished is flagged;
client's current `stepIndex` is preserved as-is (progress file is
untouched by a mere availability recompute — only `Next`/`Back`/`Exit`
write progress) but the *rendered* state for that step shows the
unavailable notice instead of a broken/empty camera move.

**Corruption-recovery flow:** any `readProgress` call that hits a malformed
file returns `{progress: null, recoveryNotice: "..."}"` immediately (no
retry, no backup-file lookup) -> the **next** `writeProgress` call
(triggered by the client's next `PUT`) overwrites the bad file with a fresh
valid one -> subsequent reads are clean. No crash at any point in this
flow.

## 13. Test plan

**Unit (`packages/mcp/test/tourEngine.test.ts`):**

- Full transition table from AD-08B02-4, once per row (a 3-step synthetic
  tour): `start` from `idle`; `next` mid-tour; `next` at last step ->
  `exited`; `back` mid-tour; `back` at step 0 -> no-op (same state);
  `exit` from `active` -> `idle`; `free_explore` from `active` -> retains
  `stepIndex`; `resume` from `free_explore` -> `active` with identical
  `stepIndex`; `exit` from `free_explore` -> `idle`; `start` from `exited`
  -> fresh `active(0)`.
- `cameraTargetFor`: all anchors present (centroid math, exact expected
  numbers for a 2-point and 3-point case); partial anchors present
  (centroid over survivors only); zero anchors present (`null`).
- `resolveStepAvailability`: mirrors the above three cases, asserting the
  exact `reason` string on the zero-anchors case and `reason: null` on both
  present cases.
- `parseProgressFile`: valid v1 JSON round-trips with `recoveryNotice:
  null`; empty string / non-JSON text -> `progress: null`, notice fires
  with the exact AD-08B02-5 string; valid JSON missing `schemaVersion` ->
  notice fires; `schemaVersion: 2` (future) -> notice fires; valid JSON
  with `progress: null` (legitimately no tour started yet) -> notice is
  `null` (this is not corruption, it's the empty state).

**Filesystem-level (`packages/server/test/progressStore.test.ts`):**

- Write-then-read round trip in a real `mkdtempSync` temp directory.
- Write valid, then overwrite the raw file with `"{not json"` on disk,
  call `readProgress` again -> recovery notice present, `progress: null`;
  call `writeProgress` next -> file is valid again; call `readProgress` a
  third time -> clean, no notice.
- "Restart" simulation: two independent `readProgress` calls (no shared
  module state between them beyond the filesystem) return identical
  results — proves resume does not depend on in-process memory.

**HTTP (`packages/server/test/tour.route.test.ts`, depends on 07-01
scaffold):**

- Full Next/Back/Exit sequence via repeated `PUT` + `GET` calls, asserting
  persisted `stepIndex` matches at each point.
- `PUT` with `stepIndex` out of bounds for the tour's `steps.length` ->
  `400 invalid_step_index`.
- `GET /api/v1/tour?id=<unknown>` -> `404 unknown_tour`.
- Snapshot-replacement scenario (§11 step 7's scripted test): assert
  `stepAvailability` correctly flags only the steps whose anchors vanished,
  and that `Next`/`Resume` semantics (via a subsequent client-driven
  sequence, tested at the engine-unit level per AD-08B02-6's auto-advance
  rule) skip unavailable steps without crashing.

**Regression:** full existing suite stays green; no golden fixture touched.

## 14. Acceptance criteria

- [ ] Every transition in the AD-08B02-4 table is covered by a passing
      unit test with an explicit before/after state assertion.
- [ ] `cameraTargetFor` and `resolveStepAvailability` agree (a `null`
      camera target and `available: false` occur on exactly the same
      condition — all anchors vanished — never one without the other).
- [ ] A corrupted `.tadori/progress.json` never throws; `readProgress`
      always returns a value; the exact recovery-notice string appears
      verbatim in the corruption test.
- [ ] A "restart" (two independent `readProgress` calls against the same
      file) returns identical `TourProgress`.
- [ ] A step whose `focusEntityKeys` all vanished after a simulated
      snapshot replacement is marked unavailable with the exact reason
      string, and steps with surviving anchors remain available and
      correctly targeted.
- [ ] `Escape`/arrow-key/Tab mappings are documented in code comments at
      the point the viz layer will wire them (this blueprint fixes the
      mapping table; actual DOM event wiring belongs to the `apps/viz`
      tour-panel component, not numbered yet — out of this blueprint's
      file-plan scope, but the contract must be unambiguous for that future
      builder).
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass with zero new
      failures; no golden fixture modified.

## 15. Validation commands

pnpm skills:check; pnpm typecheck; pnpm lint; pnpm test;
python validate_fixtures.py; pnpm fixtures:validate; pnpm fixtures:index;
pnpm fixtures:typecheck; git diff --check; git status --short

## 16. Performance budgets

State-machine transitions and camera-target computation are O(1)/O(steps)
in-memory operations — no measurable latency budget beyond "instant" (well
under any UI frame budget). Progress file read/write is a single small
JSON file (`< 1KB` typical) — filesystem I/O budget: `< 10ms` per read/
write on local disk, consistent with the "instant-feeling" requirement for
Next/Back navigation.

## 17. Failure and recovery behavior

- **Corrupt progress file**: reset with notice, never crash (AD-08B02-5,
  the core required behavior for this blueprint).
- **Missing `.tadori/` directory**: created via `mkdirSync(recursive:
  true)` on first write, matching the store DB's existing directory-
  creation pattern (AD-004).
- **Vanished step anchor after snapshot replacement**: step marked
  unavailable with reason, tour continues via auto-advance past
  consecutive unavailable steps (AD-08B02-6); if **every** remaining step
  from the current position onward is unavailable, the tour reaches its
  natural end (`exited`) rather than looping or erroring.
- **Switching tours mid-progress**: starting a different `tourId` while
  one is active is a plain overwrite of `.tadori/progress.json` (AD-08B02-
  1) — no merge, no warning beyond normal UI affordance (out of this
  blueprint's scope to design that confirmation UI; the engine itself
  performs the overwrite unconditionally when `start` is dispatched).
- **`PUT` with an invalid `stepIndex`** (negative, or `>= steps.length`):
  `400 invalid_step_index`, progress file is **not** written (reject before
  persist, so a bad client request never corrupts saved state).
- **Concurrent writes** (e.g. two browser tabs against the same `tadori
  serve` instance): last-write-wins on `.tadori/progress.json` — no locking
  introduced; this matches the single-user, single-machine, localhost-only
  design point and is a deliberate simplification (`ponytail:` scope: no
  file-lock protocol; if multi-tab contention becomes a real complaint,
  add a simple mtime-based CAS check on write).

## 18. Security and privacy

`.tadori/progress.json` contains only `tourId` (a small identifier string,
e.g. `"entry_point"`), `stepIndex` (a number), and `updatedAt` (ISO
timestamp) — no source code, no file contents, no absolute paths. File is
repo-local, confined to `<repoRoot>/.tadori/`, never read/written outside
that confinement (same root-confinement discipline as every other `.tadori/`
artifact). No network transmission beyond the existing localhost HTTP API.

## 19. Accessibility

Keyboard semantics fixed in AD-08B02-8: standard Tab order across tour
controls; Arrow keys for Next/Back; Escape for Exit; no custom focus traps.
Every state transition has a corresponding plain-language `narration`
sentence (from the `TourStep`, sourced elsewhere) suitable for screen-
reader announcement on step change — this blueprint's state machine
exposes the current step's `narration` on every state so a future
`aria-live` region (viz-layer concern) has something honest to announce.
Free-Explore transition is itself keyboard-triggerable (not mouse-only),
per the "keyboard accessible" requirement in this task's instructions.

## 20. Documentation updates

None beyond this blueprint file itself (INDEX.md/BACKLOG.md untouched
during drafting, per this task's instructions). The eventual builder
updates `IMPLEMENTATION_STATUS.md` and flips INDEX.md/BACKLOG.md status at
build time.

## 21. Builder final report

Require: summary; files changed; contracts implemented (confirm `Tour`/
`TourStep`/`TourProgress` match ARCHITECTURE §8 verbatim, and that the new
engine types in §10 are additive, not conflicting); tests added (names +
count); corruption-recovery evidence (paste the exact notice string as
observed in test output); restart-resume evidence; validation results;
commit SHA; known limitations (e.g. no cross-tab locking, single-tour-only
model); follow-on risks; `ASSUMPTION:` lines.

## 22. Independent review result

Pending Wave 3 adversarial review.

## IF SOMETHING IS UNCLEAR

Make the smallest safe assumption, record `ASSUMPTION: ...` in the report,
continue without expanding scope. If the uncertainty could violate a frozen
contract (e.g. any change that would let layout positions move mid-tour),
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
