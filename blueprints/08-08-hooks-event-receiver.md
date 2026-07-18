# BLUEPRINT 08-08: `packages/hooks` event receiver

## 1. Header

- ID / Title / Phase: 08-08 — `packages/hooks` event receiver — Phase 8
- Status: review
- Primary builder: Claude Sonnet — narrow script package, no architectural
  latitude; the schema and write path are already decided in ARCHITECTURE.md
  AD-001/AD-007; this is wiring, not design.
- Reviewer roles: Spec Guardian (A-104 non-goal boundary), Security Reviewer
  (trust-boundary/localhost/schema-validation), Implementation Reviewer
  (EventLog kind-mapping accuracy)
- Complexity: M
- Depends on / Unlocks: Depends on 07-01 (`POST /api/v1/observations`
  endpoint must exist). Unlocks 08-09 (observation overlays consume the
  events this package produces).
- Estimated sessions: 1
- Related frozen-spec sections: ARCHITECTURE.md §7 (hooks event contract,
  AD-001, AD-007, C-2); BACKLOG.md locked decision "packages/hooks: narrow
  evidence receiver (retrieval/plan/file-read/modification/test events); not
  an agent runtime"; ASSUMPTIONS.md A-104, A-106.

## 2. Objective

`packages/hooks` ships a small set of Claude Code hook scripts that observe
five categories of agent activity (task start, plan mention, file read,
modification, test execution) and POST normalized, schema-shaped JSON to the
existing `POST /api/v1/observations` endpoint on the local Tadori server. The
package holds no database handle, performs no orchestration, and every event
it cannot validate or send is rejected-and-logged, never a crash.

## 3. Why this matters

- User value: agent activity becomes visible as an overlay on the frozen 2D
  map (08-09) without the user doing anything beyond registering hooks once.
- System value: completes the "evidence, not knowledge" observation loop the
  frozen spec requires — hooks are the only path by which live agent activity
  reaches the existing migration-003 store.
- Downstream: 08-09 (observation overlays) has no data source without this;
  09-05 (agent-change review overlays) depends transitively on the same
  event stream; 12-01 (purge) needs a stable retention target.

## 4. Current repository evidence

**Verified current:**

- `packages/hooks` does not exist (`ls packages/` = core, fixtures, harness,
  indexer, mcp, store — ARCHITECTURE.md line 6, EVIDENCE-BASELINE.md §8).
- The observation store already exists. Migration 003
  (`packages/store/src/migrations.ts:286-433`) creates `tasks`,
  `retrieval_events`, `retrieval_result_nodes`, `retrieval_result_edges`,
  `retrieval_omissions`, `agent_events`, `agent_event_targets`, `change_sets`,
  `change_set_files`, `test_runs`, `test_run_cases`. No new migration is
  introduced by this blueprint (AD-007 / C-2).
- `EventLog` (`packages/mcp/src/events.ts:65-360`) is the **only** writer of
  `agent_events`/`tasks` today, constructed with
  `(db, service: GraphService, agent, description)`. Its constructor
  (`events.ts:68-90`) inserts one `tasks` row with
  `observation_coverage = 'partial'` by default (`events.ts:83-84`) — this
  **is** the task-start write path; there is no separate `task_start` row in
  `agent_events`.
- `EventLog.recordAgentEvent(type, source, payload?, targets?)`
  (`events.ts:276-345`) is the exact write path this blueprint's server-side
  endpoint (07-01) calls. Its exported types, verbatim:
  ```ts
  export type AgentEventType =
    | "file_read_observed"
    | "plan_mentioned"
    | "modified"
    | "test_selected"
    | "test_executed"
    | "capture_interrupted";
  export type AgentEventSource = "claude_hook" | "codex_log" | "transcript" | "manual";
  ```
  (`events.ts:12-20`). `recordAgentEvent`'s `targets` parameter type is
  `Array<{ kind: "file" | "node"; entityId: number }>` (`events.ts:280`) —
  **no `"edge"` target kind exists for agent events.**
- Migration 003's CHECK constraints mirror this exactly:
  `agent_events.event_type` CHECK is the same six-value list
  (`migrations.ts:362-364`); `agent_event_targets.target_kind` CHECK is
  `('file','node')` only (`migrations.ts:373`), enforced further by the
  table's own CHECK requiring exactly one of `file_id`/`node_id`
  (`migrations.ts:376-377`) and two partial-unique indexes
  (`migrations.ts:380-386`).
- `recordAgentEvent` validates every target against snapshot membership
  before insert (`events.ts:301-311`: `SELECT 1 FROM snapshot_files/
  snapshot_nodes WHERE snapshot_id = ? AND file_id/node_id = ?`) — an
  unresolvable target throws, it is never fabricated.
- `capture_interrupted` forces `tasks.observation_coverage` back to
  `'partial'` unconditionally (`events.ts:337-341`); `setObservationCoverage`
  (`events.ts:347-353`) is the only other writer of that column, restricted
  to the three-value vocabulary `complete_for_registered_sources | partial |
  unknown` (also the migration-003 CHECK, `migrations.ts:300-302`).
- ARCHITECTURE.md §7's `ObservationEvent` wire shape (the schema this
  blueprint's hook scripts must produce) is a **proposal**, not yet
  cross-checked line-by-line against `events.ts` before this blueprint. Doing
  that check is this blueprint's job — see §8 finding below.
- `POST /api/v1/observations` is row #20 in ARCHITECTURE.md §3's endpoint
  table: `body ObservationEvent[]` → `{accepted:number}`; errors `400 schema,
  409 no_active_task`; owner `07-01/08-08`. This blueprint owns the **client**
  side (hook scripts producing and sending `ObservationEvent[]`); 07-01 owns
  the **server** side (the route handler that validates and calls
  `EventLog.recordAgentEvent`/constructs `EventLog` for task start).
- Server bind: `127.0.0.1` only, `/api/v1` prefix, no CORS beyond same-origin
  (ARCHITECTURE.md §3 preamble).
- Claude Code hook mechanism: hooks are configured under `.claude/settings.json`
  (project) or `~/.claude/settings.json` (user) as shell/script commands keyed
  to lifecycle events (e.g. `PreToolUse`, `PostToolUse`, `Stop`); Tadori does
  not control this mechanism, it only supplies scripts a user opts into
  registering (see §5 "hook installation story" and §11).

**PROPOSED / to be resolved by this blueprint (not yet in ARCHITECTURE.md):**

- The precise mapping from Claude Code hook lifecycle events to the six
  `AgentEventType` values (§8, §10).
- The `capture_interrupted` production trigger (a Stop/SubagentStop hook, or
  a client-side heuristic on transport failure — resolved in §8).

**Finding recorded, not silently patched (per task instructions):**
ARCHITECTURE.md §7's `ObservationEventType` list
(`"task_start" | "plan_mentioned" | "file_read_observed" | "modified" |
"test_selected" | "test_executed" | "capture_interrupted"`) does not match
`events.ts`'s `AgentEventType` in two ways: (1) `task_start` is not a member
of `AgentEventType` and not a legal `agent_events.event_type` value — task
start is structurally the `EventLog` constructor's `tasks` row insert
(`events.ts:74-90`), a different table and a different code path than
`recordAgentEvent`; (2) `ObservationEvent.targets[].kind` in ARCHITECTURE.md
allows `"edge"`, but `recordAgentEvent`'s target kind and the
`agent_event_targets` schema allow only `"file" | "node"`. This blueprint
does **not** invent a new kind or widen the schema to cover `task_start`/edge
targets; it maps hook scripts onto the six real `AgentEventType` values plus
the existing (separate) task-creation mechanism, and records the mismatch
here for 07-01/ARCHITECTURE.md correction rather than working around it
silently.

Files to read first: `packages/mcp/src/events.ts` (whole file, it is short),
`packages/store/src/migrations.ts:286-433` (migration 003), `packages/mcp/src/service.ts`
(`nodeEntityId`/`edgeEntityId` resolution helpers referenced by
ARCHITECTURE.md §7), ARCHITECTURE.md §3 row 20 and §7, BACKLOG.md's locked
hooks decision, `docs/CLI_CONTRACT.md` (server lifecycle hooks bind to).

## 5. Scope

1. `packages/hooks` workspace package: a small set of standalone Node scripts,
   one per observed Claude Code lifecycle point, each producing a normalized
   JSON event and POSTing it to the local server.
2. A minimal shared client module (`postObservation`) used by every script:
   HTTP POST to `/api/v1/observations`, retry-free (fire-and-forget with a
   short timeout), localhost-only target resolution.
3. Mapping table: Claude Code hook lifecycle event → `ObservationEvent`
   (client wire shape) → server-side `AgentEventType` (or task-creation call)
   — see §8/§10.
4. Trust-boundary behavior for malformed/oversized/unreachable-server cases:
   log-and-continue, never throw uncaught, never block the host Claude Code
   session.
5. Documented (not automated) hook installation instructions: exact
   `.claude/settings.json` stanza a user adds to register these scripts.
6. Pointer to 12-01 for retention/purge — this blueprint does not implement
   purge.

## 6. Non-goals

- **`packages/hooks` is never an orchestrator, agent runtime, workflow
  system, memory platform, or multi-agent framework.** It has no scheduling,
  no decision logic beyond "map this lifecycle event to that observation
  event," no cross-event state beyond what is needed to attach a
  `taskId`/`entityKey`, and no ability to trigger, alter, or gate agent
  behavior. It cannot read agent reasoning or intent — only externally
  observable actions (a tool was called, a file was read, a command ran).
- No new database schema, no new migration, no direct `better-sqlite3` writer
  in this package (AD-001).
- No auto-installation of hooks into a user's `.claude/settings.json` — this
  blueprint documents the stanza; it does not write the user's config file.
- No runtime tracing (no call-graph capture, no instruction-level tracing, no
  reasoning-step capture) — only the six coarse-grained event kinds already
  defined by migration 003.
- No retention/purge implementation (pointer to 12-01 only).
- No changes to `EventLog`, `events.ts`, or migration 003 itself — this
  blueprint is a pure client of the existing server endpoint.
- No new `AgentEventSource` value — `"claude_hook"` already exists
  (`events.ts:20`) and is the only source this package emits.

## 7. Dependencies and prerequisites

- 07-01 must have delivered `POST /api/v1/observations` bound to
  `127.0.0.1:<port>` accepting the envelope in §10, returning
  `{accepted:number}` on success and `400`/`409` on the documented error
  paths (ARCHITECTURE.md §3 row 20). If 07-01 is not yet built when this
  blueprint's builder session starts, the hook scripts and their tests still
  compile/typecheck/unit-test against a mocked HTTP layer; the integration
  test (§13) is marked pending until 07-01 lands and is not required for this
  blueprint's own acceptance criteria — see §14.

## 8. Architectural decisions

- **DECISION 08-08-A — hooks POST; they never open the store.** Restates
  AD-001. Rationale already established in ARCHITECTURE.md: a second SQLite
  writer alongside the refresh worker and server-ingest path triples the
  write surface and duplicates `EventLog`'s honesty invariants. Rejected:
  direct `better-sqlite3` writer in `packages/hooks` (rejected by
  ARCHITECTURE.md AD-001 already; not reopened here).
- **DECISION 08-08-B (corrected 2026-07-17 per 07-01 resolution + ARCHITECTURE
  AD-011) — no task-start call exists.** The server (07-01) owns one
  `EventLog`/task per server-process lifetime, created at server startup and
  rotated on `snapshot_replaced`; hooks attach observations to the server's
  already-running task. The hooks package therefore ships NO task-start
  script and never requests task creation. Rejected: the previous proposal
  (client sends type `"task_start"` to `/observations` and the server
  branches it to task creation/reuse) — unconstructible against frozen
  migration 003 and `EventLog`'s one-task-per-instance design, and it
  contradicted 07-01's server-lifetime task model. Rejected (unchanged):
  renaming `task_start` to an existing `AgentEventType` (honesty violation);
  editing the frozen migration-003 CHECK.
- **DECISION 08-08-C — no edge targets from hooks.** Hook-observed events
  (file reads, modifications, test selection/execution, plan mentions) are
  always file- or node-scoped from the hook's vantage point (a file path, or
  a resolved symbol). Edge-scoped observations (e.g. "this import edge was
  exercised") are not observable by a hook watching tool calls and are out of
  scope; `targets[].kind` in this package's wire shape is restricted to
  `"file" | "node"` to match `recordAgentEvent`'s real signature — never
  `"edge"`. This corrects the ARCHITECTURE.md §7 draft schema, which is
  wider than the code it targets (see §4 finding).
- **DECISION 08-08-D — localhost-only, schema-validated, size-capped, fail
  silent-to-log.** The hook script's HTTP client resolves the server URL from
  an environment variable (`TADORI_SERVER_URL`, set by `tadori serve .` into
  the environment of any child process it may spawn, or documented for the
  user to set manually since hooks run in a separate Claude Code process tree
  that does not inherit CLI-launched env by default — see §12) defaulting to
  `http://127.0.0.1:<lastKnownPort>` read from `.tadori/progress.json`-adjacent
  state if present, else a fixed conventional default port is NOT assumed
  (no default port is frozen anywhere in the CLI contract — `--port` is
  user-chosen or OS-assigned, `docs/CLI_CONTRACT.md:43-51`). Concretely: the
  hook script requires `TADORI_SERVER_URL` (or `--server-url`) to be set; if
  unset, it logs a single line to stderr and exits 0 (never blocks the host
  Claude Code process). Payload size is capped at 16 KiB per event (matches
  typical single-file-read/modification detail sizes; a payload over the cap
  is rejected client-side before send, logged, not transmitted). The server
  independently schema-validates and rejects malformed events (07-01's job);
  this package additionally validates client-side before sending so a
  malformed event never leaves the process, and a send failure (network
  refused, non-2xx, timeout) is caught, logged to a local rotating log file
  under `.tadori/hooks.log`, and never thrown to the calling hook's shell
  (nonzero exit from a Claude Code hook can abort the tool call it wraps —
  this package always exits 0 regardless of send outcome, unless the input
  itself is unreadable, per §17).
- **DECISION 08-08-E — one HTTP call per hook invocation, no batching.** Each
  hook script sends exactly one `ObservationEvent` per invocation (Claude Code
  invokes each hook once per lifecycle point). No client-side queue, no
  retry-with-backoff, no batching — that would add orchestration-shaped
  behavior to a package whose non-goal is exactly that. Rejected: an
  in-process queue/batcher (adds state and a lifecycle the package must
  manage — the kind of "runtime" behavior explicitly excluded).

## 9. Exact file plan

- `packages/hooks/package.json` — create. Name `@tadori/hooks`, `"type":
  "module"`, no runtime deps beyond Node built-ins (`node:http`/`node:https`
  or the global `fetch` already available in Node 22 — no new dependency;
  ladder rung 3, stdlib `fetch` covers this, no axios/undici addition).
- `packages/hooks/src/index.ts` — create. Barrel re-exporting the client and
  types.
- `packages/hooks/src/client.ts` — create. `postObservation(event)`: validates
  size/shape, resolves server URL, sends, catches/logs failures. Exported:
  `postObservation`, `HooksClientError` (not thrown across the process
  boundary, but usable in tests).
- `packages/hooks/src/types.ts` — create. `ObservationEvent`,
  `ObservationEventType`, `ObservationTarget` — mirrors §10 exactly, corrected
  per §8-B/§8-C.
- `packages/hooks/src/scripts/plan.ts` — create. Maps a plan-related hook
  invocation (e.g. `PreToolUse` on a planning-tool call, or `ExitPlanMode`) to
  `type: "plan_mentioned"`.
- `packages/hooks/src/scripts/file-read.ts` — create. Maps a `PostToolUse`
  hook on a read-shaped tool (Read/Grep/Glob) to `type: "file_read_observed"`.
- `packages/hooks/src/scripts/modification.ts` — create. Maps a `PostToolUse`
  hook on a write-shaped tool (Edit/Write) to `type: "modified"`.
- `packages/hooks/src/scripts/test.ts` — create. Maps a `PostToolUse` hook on
  a Bash tool call whose command matches a test-runner heuristic to
  `type: "test_selected"` (command observed, not yet run) or
  `type: "test_executed"` (exit code observed) — see §10 heuristic note.
- `packages/hooks/src/log.ts` — create. Append-only local logger to
  `.tadori/hooks.log` for rejected/failed events (rotation: truncate past
  5 MiB, matches the "size-capped" trust-boundary requirement applied to the
  log itself).
- `packages/hooks/test/client.test.ts` — create. Validates size cap, shape
  validation, failure-to-log behavior, never-throws guarantee.
- `packages/hooks/test/mapping.test.ts` — create. Each script's lifecycle-input
  to `ObservationEvent` mapping, using synthetic Claude Code hook JSON inputs.
- `pnpm-workspace.yaml` — modify (additive line `"packages/hooks"`, per
  ARCHITECTURE.md §1; owned nominally by 07-01 but this blueprint's builder
  adds its own line since 08-08 may land before/after 07-01 lands the rest —
  coordinate via a single additive line, never remove others).
- `tsconfig.json` — modify (additive include glob
  `packages/hooks/{src,test}/**/*.ts`, matching ARCHITECTURE.md §1's stated
  plan).
- `tsconfig.base.json` `paths` — modify (additive `@tadori/hooks` entry).

## 10. Exact contracts

Client-side wire shape (corrected per §8-B/§8-C; this is the proposal this
blueprint sends to `POST /api/v1/observations`, cross-referenced against
`events.ts` exports):

```ts
// packages/hooks/src/types.ts
export type ObservationEventType =
  | "plan_mentioned"       // == AgentEventType "plan_mentioned"
  | "file_read_observed"   // == AgentEventType "file_read_observed"
  | "modified"             // == AgentEventType "modified"
  | "test_selected"        // == AgentEventType "test_selected"
  | "test_executed"        // == AgentEventType "test_executed"
  | "capture_interrupted"; // == AgentEventType "capture_interrupted"

export interface ObservationTarget {
  kind: "file" | "node";   // NEVER "edge" — recordAgentEvent has no edge target (events.ts:280)
  ref: string;             // repo-relative path (file) or entityKey (node)
}

export interface ObservationEvent {
  type: ObservationEventType;
  source: "claude_hook";   // the only AgentEventSource value this package emits
  at: string;              // ISO timestamp, client-supplied, server re-stamps created_at
  taskId?: number;         // optional; when omitted the server attaches the event to its current server-lifetime task
  targets?: ObservationTarget[];
  detail?: string;         // e.g. tool name, test command (redacted per 12-01 policy), never a correctness claim
}
```

```ts
// packages/hooks/src/client.ts
export interface PostObservationResult { sent: boolean; reason?: string; }
export function postObservation(event: ObservationEvent): Promise<PostObservationResult>;
// Never rejects/throws to the caller; failures resolve { sent: false, reason }
// and are appended to .tadori/hooks.log.
```

**Server-side mapping this blueprint assumes 07-01 implements** (documented
here as the contract this package's events depend on; not implemented by
this blueprint — this is the contract 07-01 implements, not this blueprint):

```
POST /api/v1/observations
  body: ObservationEvent[]
  -> for every event: server resolves event.targets via
     GraphService.nodeEntityId/fileEntityId, calls
     EventLog.recordAgentEvent(event.type, "claude_hook", detail, targets)
     against the server's current server-lifetime task
  response: { accepted: number }
  errors: 400 schema (malformed/oversized/unknown type — including any
    "task_start" payload, which is now simply an unknown type), 409
    no_active_task (event arriving in the narrow post-rotation window before
    the replacement EventLog exists)
```

**Test-selected vs test-executed heuristic (client-side, coarse, declared
uncertain where it is):** a `PostToolUse` Bash-tool hook whose command string
matches a configurable test-runner pattern (e.g. `vitest`, `pnpm test`) before
the command has an exit code available emits `test_selected`; the same hook
firing with an exit code present emits `test_executed` with `detail` carrying
only the exit code and matched pattern — never raw stdout/stderr (redaction,
§18).

## 11. Ordered implementation procedure

1. `packages/hooks/package.json` + `src/types.ts`: define the corrected
   `ObservationEvent` shape (§10). Reason: schema first, scripts second.
   No test yet (types only).
2. `packages/hooks/src/client.ts` + `packages/hooks/test/client.test.ts`:
   implement `postObservation` against a mocked `fetch` (size cap rejection,
   malformed-shape rejection, network-failure log-and-continue, 2xx success
   path, non-2xx logged-not-thrown). Reason: the shared primitive every
   script depends on. Test: all five paths pass; a deliberately huge payload
   (>16 KiB) never reaches the mocked transport.
3. `packages/hooks/src/log.ts` + a truncation test: append then verify
   rotation past 5 MiB. Reason: bounded local log, no unbounded disk growth.
4. `packages/hooks/src/scripts/plan.ts` +
   `packages/hooks/src/scripts/file-read.ts` +
   `packages/hooks/src/scripts/modification.ts` +
   `packages/hooks/src/scripts/test.ts`, each with a `mapping.test.ts` case
   using a synthetic Claude Code hook stdin payload (documented shape per
   Claude Code's hook input contract: JSON on stdin containing at minimum
   `hook_event_name`, `tool_name`, `tool_input`, `tool_response` where
   applicable). Reason: one script per observed lifecycle point, matching
   BACKLOG's locked five-category list exactly. Test: each script maps a
   representative synthetic input to the exact expected `ObservationEvent`.
5. Wire `pnpm-workspace.yaml`, `tsconfig.json` includes,
   `tsconfig.base.json` paths (additive lines only). Reason: package must
   build under the existing gates. Test: `pnpm typecheck` passes.
6. Write the hook-installation documentation stanza (§20) into this
   blueprint's own `docs/HOOKS_INSTALL.md` proposal (file plan §9 — actually,
   per non-goal "document, don't auto-install," this is a documentation
   deliverable of §20, not a runtime file the package writes).
7. Run full validation gate (§15). Reason: confirm zero regression to the
   existing 170+ tests and 5/5 fixtures; this package cannot touch fixtures
   or migrations, so a fixture delta here is an immediate stop condition.

## 12. Data and lifecycle flows

**Startup:** user has already run `tadori serve .` (07-01/07-02); a
`TADORI_SERVER_URL` value is available to the hook scripts either because the
user exported it in the shell that also launches Claude Code, or because they
pasted the URL `tadori serve .` printed at startup (per ARCHITECTURE.md §5
step 8, "print startup facts") into their hook script's config. Tadori's CLI
process and the Claude Code process are separate process trees — **no
automatic environment inheritance is assumed** (ASSUMPTION, recorded per
template rule, smallest safe assumption: the user manually configures the
URL once; no auto-discovery mechanism is invented here).

**Operation:** Claude Code invokes a registered hook script for a lifecycle
event → script reads stdin JSON → maps to `ObservationEvent` → calls
`postObservation` → script exits 0 regardless of send outcome (per DECISION
08-08-D) → Claude Code continues its own flow unaffected.

**Failure:** server unreachable (not yet started, wrong port, port changed
after a restart) → `postObservation` catches the fetch error → logs one line
to `.tadori/hooks.log` → returns `{sent:false}` → script exits 0. Malformed
stdin (Claude Code contract violated, or a future Claude Code version changes
hook input shape) → script catches the parse error, logs, exits 0 — **never**
propagates an exception that could abort the wrapped tool call.

**Retention:** rows land in the existing `agent_events`/`tasks` tables via the
07-01 endpoint; this package has no retention logic. See 12-01 for the purge
command (`DELETE FROM agent_events WHERE task_id IN (...)` plus `detail`
redaction, per ARCHITECTURE.md §7 "Retention" paragraph).

**Shutdown:** no persistent process — each script is a one-shot invocation
per hook call; nothing to tear down.

## 13. Test plan

- Unit: `client.test.ts` — size cap, shape validation, mocked-fetch success/
  failure/non-2xx, log-on-failure, never-throws.
- Unit: `mapping.test.ts` — one case per script mapping synthetic Claude Code
  hook JSON → exact `ObservationEvent`.
- Unit: `log.test.ts` — append + rotation-past-5MiB truncation.
- Integration (pending 07-01, not required for this blueprint's own
  acceptance — see §14): a script run against a live local server confirms a
  `202`/`200`-equivalent `{accepted:1}` response and a corresponding
  `agent_events` row via a follow-up `GraphService` read. Named
  `packages/hooks/test/integration.server.test.ts`, skipped
  (`describe.skip`) until 07-01 is `built`, with a comment citing this
  blueprint ID and the 07-01 dependency.
- Adversarial: malformed stdin (truncated JSON, wrong hook name, missing
  `tool_input`) for every script — asserts log-and-exit-0, never a thrown
  error escaping the script's `main()`.
- Regression: full existing suite (170+ tests) and 5/5 fixtures unaffected
  (this package adds no fixture/migration surface).

## 14. Acceptance criteria

- [ ] `packages/hooks` builds under `pnpm typecheck` with zero errors, as an
      additive workspace member (no existing package's build output changes).
- [ ] Four scripts exist (plan, file-read, modification, test), each
      producing exactly the `ObservationEvent` shape in §10.
- [ ] `postObservation` never throws synchronously or via unhandled rejection
      in any of the five branches tested in `client.test.ts`.
- [ ] A payload exceeding 16 KiB is rejected client-side before any network
      call (assert via a mocked-fetch call-count of zero in that test case).
- [ ] `ObservationTarget.kind` type only admits `"file" | "node"` — a
      TypeScript compile error results from constructing `{kind: "edge", ...}`
      (asserted via a `// @ts-expect-error` line in the test file).
- [ ] Zero `AgentEventType`/`agent_events` schema changes; `git diff` against
      `packages/store/src/migrations.ts` and `packages/mcp/src/events.ts` is
      empty.
- [ ] Full existing suite stays green (170+ tests, count not decreased);
      5/5 fixtures PASS unchanged.
- [ ] The finding in §4 (task_start / edge-target mismatch) is recorded in
      this file and reported in the builder final report — not silently
      patched into `events.ts` or migration 003.
- [ ] No auto-installation code writes to any `.claude/settings.json` file.

## 15. Validation commands

pnpm skills:check; pnpm typecheck; pnpm lint; pnpm test;
python validate_fixtures.py; pnpm fixtures:validate; pnpm fixtures:index;
pnpm fixtures:typecheck; git diff --check

## 16. Performance budgets

Each hook script invocation: process start + stdin parse + one HTTP call must
add negligible overhead to the wrapped Claude Code tool call — target under
50 ms of script-side latency before the network call is issued (the network
call itself is fire-and-forget with a client-side timeout of 500 ms after
which the script logs-and-exits rather than waiting). No batching, no
in-memory queue growth (DECISION 08-08-E) — memory footprint per invocation
is O(1) relative to event count.

## 17. Failure and recovery behavior

- Malformed stdin JSON: caught, logged to `.tadori/hooks.log`, script exits 0.
- Unreachable/refused/timeout server connection: caught, logged, exits 0.
- Oversized payload (>16 KiB): rejected before send, logged, exits 0.
- Unknown/unmapped Claude Code hook event name: script's `main()` recognizes
  only the lifecycle events it maps (§10); an unrecognized event name is
  logged and the script exits 0 without sending anything (fail-closed on
  ambiguity, never guesses a type).
- Server responds `400` (schema rejected server-side too): treated the same
  as a network failure — logged, `{sent:false}`, exit 0. Server responds
  `409 no_active_task`: logged with the specific reason string from the
  response body, exit 0 (this event's `taskId` was stale, e.g. task already
  ended — not a hooks-package bug, but not silently retried either, per
  DECISION 08-08-E no-retry policy).
- `.tadori/hooks.log` unwritable (permissions, disk full): falls back to a
  single best-effort stderr write; script still exits 0 — a broken log must
  never abort the host Claude Code tool call.

## 18. Security and privacy

- Localhost-only: the client only ever targets the URL supplied via
  `TADORI_SERVER_URL`/`--server-url`; no hardcoded remote fallback exists;
  the package never resolves a non-loopback host (a basic guard rejects and
  logs if the resolved URL's hostname is not `127.0.0.1`/`localhost`).
- Schema-validated at the boundary in both directions: this package validates
  before send (defense in depth); 07-01's endpoint independently validates on
  receipt (07-01's responsibility, not re-implemented here).
- Size-capped: 16 KiB per event, enforced client-side before transmission.
- `detail` redaction: test-command details carry only the matched pattern and
  exit code, never raw stdout/stderr (which could contain secrets, file
  contents, or credentials surfaced during a test run). File-read/modification
  `targets[].ref` carries only repo-relative paths already normalized by the
  existing `normalizePath` convention (`packages/indexer/src/scan.ts:43-49`
  behavior) — never an absolute path, matching the frozen "never leaks
  absolute paths" API error convention (ARCHITECTURE.md §3 `ApiError`
  comment).
- Retention: no new retention table; rows are deleted via existing FK cascade
  when a task/snapshot is pruned; 12-01 additionally offers targeted deletion
  plus `detail` redaction (ARCHITECTURE.md §7, restated here as a pointer,
  not implemented by this blueprint).
- Malformed/untrusted producers: hooks are explicitly documented (§20) as
  running with the user's own Claude Code session privileges; the trust
  boundary is the HTTP call to the server, which independently re-validates —
  a compromised or buggy hook script can at worst send malformed/oversized
  junk that the server rejects, never gain direct DB access (AD-001).

## 19. Accessibility

Not applicable — no human-facing UI in this package (scripts only). The
overlays that render this data (08-09) carry the accessibility requirements.

## 20. Documentation updates

- `packages/hooks/README.md` — create (package-local, allowed under "document,
  don't auto-install"): exact `.claude/settings.json` stanza a user adds,
  e.g. (illustrative shape, exact Claude Code hook config keys per Claude
  Code's own hook documentation):
  ```json
  {
    "hooks": {
      // SessionStart needs no hook — the server already owns its task
      // (created at server startup, rotated on snapshot_replaced; see
      // ARCHITECTURE.md AD-011 and blueprint 07-01).
      "PostToolUse": [{ "hooks": [{ "type": "command", "command": "node packages/hooks/dist/scripts/file-read.js" }] }]
    }
  }
  ```
  plus the required `TADORI_SERVER_URL` environment variable and a pointer to
  where `tadori serve .` prints its URL at startup.
- `IMPLEMENTATION_STATUS.md` — not modified by this blueprint (builder
  updates it at build time, per CLAUDE.md's standing rule, not by this
  planning blueprint).
- This blueprint file itself records the §4/§8-B/§8-C mismatch finding for
  ARCHITECTURE.md's authors to reconcile in a future architecture pass.

## 21. Builder final report

Require: summary; files changed; the five scripts + client + types; tests
added (names + count); validation results (§15 output summary); explicit
statement of the task_start/edge-target finding and how the server contract
note (§10) was or was not adopted by 07-01 at build time; commit SHA; known
limitations; follow-on risks (e.g. no auto env-var propagation from `tadori
serve .` to a separately-launched Claude Code session); `ASSUMPTION:` lines.

## 22. Independent review result

Pending Wave 2 adversarial review.

## IF SOMETHING IS UNCLEAR

Smallest safe assumption + `ASSUMPTION:` line. The task_start/edge-target
mismatch found in §4 is exactly the kind of frozen-contract-adjacent
uncertainty the template flags as "stop and report blocked" — this blueprint
resolves it by *not* changing the frozen schema and instead proposing a
narrow server-side branch (§8-B) as a note for 07-01, which is the smallest
change that respects both the existing `AgentEventType` union and the
ARCHITECTURE.md intent. (superseded by corrected 08-08-B, 2026-07-17: the
server-side branch proposal was rejected in favor of 07-01's server-lifetime
task model; no task_start call exists at all.)

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
