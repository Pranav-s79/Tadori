---
graph_blueprint_version: 1
node_id: 09-05
state: review
phase: 9
risk: medium
complexity: M
predecessors: [08-09, 09-01]
successors: []
execution_card: blueprints/execution/09-05.md
dossier: blueprints/09-05-agent-change-review-overlays.md
read_policy: execution-card-first
local_full_gate_budget: 1
independent_validation_budget: 1
architecture_review: required-on-contract-delta
---

> **GRAPH EXECUTION MODE:** Read the execution card first. Planning-time line numbers are historical hints; live repository semantics win.

# BLUEPRINT 09-05: Agent-change review overlays

## 1. Header

- ID / Title / Phase: 09-05 — Agent-change review overlays — Phase 9
- Status: review
- Complexity: M
- Depends on: 08-09 (agent observations ingest — `agent_events`/`agent_event_targets`, `POST /observations`), 09-01 (review-diff — `ReviewDiffDto`, `/review/diff`).

## 2. Graph rewrite

Before: agent observations (`plan_mentioned`/`file_read_observed`/`modified`) are ingested and stored per task, and the review-diff shows what changed base→head, but the two are never correlated. After: a read-only endpoint correlates them into the three BACKLOG-row-09-05 indicators — **planned-scope vs modified**, **modified-but-not-retrieved**, over the **base-vs-patched** diff frame — and the viz surfaces them as honest per-file badges on the review-diff view.

## 3. Contract neighborhood

VERIFIED LIVE:
- `agent_events(id, task_id, snapshot_id, event_type, source, payload_json, created_at)` + `agent_event_targets(event_id, target_kind, file_id, node_id)`. event_type ∈ {file_read_observed, plan_mentioned, modified, test_selected, test_executed, capture_interrupted}. (`packages/store/src/migrations.ts:358`.)
- Observations are scoped by `task_id` (the serve session's task) — `EventLog.taskId` is `readonly` public. (`packages/mcp/src/events.ts:66`.)
- `ReviewDiffDto { base, head, nodesAdded, nodesRemoved, edges[], ... }`; changed nodes carry `.file`. (`packages/server/src/types.ts:261`.)
- `resolveFileEntityId` pattern (parameterized, snapshot-scoped) already exists in `observations.ts`; `file_entities`/`snapshot_files` map path↔id.
- No agent-events READ path exists today — 08-09 only ingests.

Frozen invariants preserved:
- Observations are read-only here; no mutation, no new migration (all tables exist).
- Truthful provenance: an indicator states exactly what the data supports — "not retrieved" means "no `file_read_observed` target for this file in this task", never an inference about intent.
- Snapshot/task scoping: the query is bounded to the CURRENT task_id and repo; cross-task/cross-repo rows are unreachable.

Rejected adjacent edges:
- No write path, no new observation types, no change to `/observations` ingest.
- No leaking `payload_json` (free-form agent text — possible PII/secret surface) to the client; only file paths + typed booleans/counts cross the boundary.

## 4. SWE + security design decisions

- **Scoping is the security boundary.** The correlation query filters `agent_events.task_id = :taskId` where `:taskId = eventLog.taskId` (server-owned, never client-supplied). A client cannot request another task's or repo's observations — there is no task_id query param. This prevents cross-session data disclosure by construction.
- **Parameterized SQL only.** Every value is a bound parameter, never interpolated — matching `observations.ts`/`gc.ts`. No client string ever reaches SQL text.
- **Least data across the trust boundary.** The DTO exposes repo-relative file paths and typed indicators (planned/retrieved/modifiedObserved/modifiedActual + derived risk flags) — NOT `payload_json`, timestamps, or internal ids. `payload_json` can hold arbitrary agent free-text (secret/PII risk); it never leaves the server.
- **Read-only, idempotent, safe verb.** `GET`. No side effects; safe to retry/cache. No CSRF surface (no state change), localhost-bound like every route.
- **Fails closed, degrades honestly.** No active task, no observations, or an empty diff → an empty overlay (`{ taskPresent:false, files: [] }`), never a 5xx and never a fabricated indicator. A file that changed with zero observations is reported as `modifiedButNotRetrieved: true` (the whole point), not omitted.
- **Deterministic.** Output sorted by path; set-membership booleans are order-independent. Same task+snapshot → byte-identical body.
- **Bounded work.** One indexed join per event-type over one task's events (small: an agent session's observations are O(files touched)); the diff's changed-file set is already computed by 09-01. No unbounded scan.

## 5. Contract

```ts
// GET /api/v1/review/observations-overlay  → ReviewObservationsOverlayDto
interface FileObservationOverlay {
  file: string;                    // repo-relative path
  planned: boolean;                // a plan_mentioned event targeted this file
  retrieved: boolean;              // a file_read_observed event targeted this file
  modifiedObserved: boolean;       // a `modified` event targeted this file
  modifiedActual: boolean;         // the review-diff changed a node in this file
  // Derived risk indicators (honest, data-backed):
  modifiedButNotRetrieved: boolean; // modifiedActual && !retrieved  (blind edit)
  plannedNotModified: boolean;      // planned && !modifiedActual     (scope shrank)
  modifiedNotPlanned: boolean;      // modifiedActual && !planned     (scope crept)
}

interface ReviewObservationsOverlayDto {
  taskPresent: boolean;            // false when no active task/observations
  files: FileObservationOverlay[]; // sorted by file; every planned|retrieved|modifiedObserved|modifiedActual file appears once
}
```

## 6. Artifact ownership

| Artifact | Action | Reason | Integration edge |
|---|---|---|---|
| `packages/server/src/reviewObservations.ts` | create | correlate observations × diff (reads db, parameterized) | called by review route |
| `packages/server/test/reviewObservations.test.ts` | create | proof of correlation + scoping + fail-closed | — |
| `packages/server/src/routes/review.ts` | modify | register `GET /review/observations-overlay` | one-hop route wiring |
| `packages/server/src/types.ts` | modify | `ReviewObservationsOverlayDto` / `FileObservationOverlay` | — |
| `apps/viz/src/features/review/observationOverlayApi.ts` | create | fetch wrapper + wire types (re-declared) | — |
| `apps/viz/src/features/review/ObservationOverlayBadges.tsx` | create | per-file honest badges over the review-diff view | mounted beside ReviewDiffView |
| `apps/viz/src/features/review/observationOverlay.test.tsx` | create | badge honesty + risk-flag rendering | — |

## 7. Proof cut

- Server: correlation flags a file modified-but-never-read as `modifiedButNotRetrieved`, a planned-not-modified file as `plannedNotModified`; scoping — an event under a different task_id never appears; fail-closed — no task → `taskPresent:false, files:[]`.
- viz: a `modifiedButNotRetrieved` file renders its risk badge with honest wording; a clean file renders no risk badge.
- One local gate: server + viz vitest, root typecheck.
