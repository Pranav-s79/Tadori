---
graph_blueprint_version: 1
node_id: 07-03
state: validated
phase: 7
risk: high
complexity: M
predecessors: [07-02]
successors: [08-01, 12-02, 12-03]
execution_card: blueprints/execution/07-03.md
dossier: blueprints/07-03-serve-hardening.md
read_policy: execution-card-first
local_full_gate_budget: 1
independent_validation_budget: 1
architecture_review: required-on-contract-delta
---

> **GRAPH EXECUTION MODE:** Read the execution card first. This long file is an evidence dossier, not mandatory context. Open only the sections linked by the card. Planning-time existence claims and line numbers are historical hints; live repository semantics win. Use one full local gate and one independent validation pass.

# BLUEPRINT 07-03: Serve hardening

## 1. Header

- ID / Title / Phase: 07-03 — Serve hardening — Phase 7
- Status: built (2026-07-18; frontier OpenAI correction re-review PASS with
  no blocker/high/medium; fresh full gate ALL PASS: 283/283 tests in 50
  files, exact golden fixtures 5/5 with zero dangling/FK rows, benchmark
  gates pass, `pnpm tadori diff .` exit 0, diff checks clean. Pinned-snapshot
  and failure-safe teardown review findings closed. CI + merge pending.)
- Primary builder: Claude Opus — concurrency/lifecycle sensitivity: exact
  process-exit-path enumeration (Ctrl+C, SIGTERM, parent death, worker
  crash), port-fallback ordering, and adversarial supervision tests are
  easy to get subtly wrong with a lighter-weight model; each failure mode
  interacts with the already-tested `ConcurrentRefreshController` in ways
  that require careful reasoning about message ordering and idempotency
  rather than pattern-following.
- Reviewer roles: Concurrency Reviewer (worker crash / orphan-process
  analysis), Spec Guardian (CLI_CONTRACT.md non-negotiable preservation),
  Test Adversary (adversarial matrix completeness).
- Complexity: M
- Depends on / Unlocks: Depends on **07-02** (`packages/cli` lifecycle
  skeleton — this blueprint replaces its happy-path port/browser/teardown
  logic with hardened versions) and transitively **07-01**. Unlocks
  **12-02** (failure hardening builds on this blueprint's crash-recovery
  evidence), **12-03** (packaging assumes a hardened lifecycle).
- Estimated sessions: 1.
- Related frozen-spec sections: `docs/CLI_CONTRACT.md` steps 5, 7, 9 (start
  API on 127.0.0.1; open browser, failure non-fatal; stop all child
  processes on Ctrl+C, no orphans); ARCHITECTURE.md AD-003 (reused isolated
  refresh worker), Section 5 (CLI lifecycle, port selection, teardown
  order); the store's crash-consistency guarantees (restart reconciliation,
  `IncrementalRepositoryIndexer.initialize()`'s baseline-mismatch handling).

## 2. Objective

`tadori serve .` behaves correctly under adversarial conditions: port
conflicts resolve via a defined fallback algorithm or fail hard with an
actionable message when a port was explicitly requested; a browser-launch
failure never aborts the session; the watcher/server pair leaves zero
orphan processes across every exit path (Ctrl+C, SIGTERM, parent death,
worker crash); `--snapshot`/`--reindex` paths behave correctly under
concurrent modification; and non-TS/empty-repo errors use exact, tested
message strings.

## 3. Why this matters

- User value: 07-02 only implements the happy path. A real user's machine
  has a port already bound, a browser that fails to launch (headless CI, a
  locked-down sandbox), or a Ctrl+C that lands mid-refresh — this blueprint
  is what makes `tadori serve .` trustworthy outside a clean demo.
- System value: orphan child processes (a leaked worker thread holding a
  WAL lock on `.tadori/tadori.sqlite`) would corrupt the "restart
  reconciliation" guarantee Week 6 already built and tested; this blueprint
  verifies that guarantee holds when the *new* CLI layer is the thing
  crashing, not just the indexer in isolation.
- Downstream: 12-02 (failure hardening) and 12-03 (packaging, where `npx
  tadori serve .` runs on machines this team does not control) both assume
  the crash-consistency and port/browser hardening this blueprint delivers.

## 4. Current repository evidence

Verified current (2026-07-17):

- **07-02's happy-path gaps this blueprint fills** (from
  `blueprints/07-02-cli-tadori-serve.md` §17, verbatim scope hand-off):
  "the exact retry/fallback algorithm and the distinction between
  explicit-port-fails-hard vs. default-port-tries-OS-fallback is 07-03's
  scope"; "that adversarial scenario (kill -9 the worker mid-refresh) is
  explicitly 07-03's scope."
- **`ConcurrentRefreshController`** (`packages/mcp/src/concurrentRefresh.ts:
  52-219`) already handles worker `exit`/`error` events during steady state:
  `.waitUntilReady()`'s post-ready listeners (`concurrentRefresh.ts:112-120`)
  record `workerExited = true` on exit and call `recordFatal` (setting
  `stateValue.phase = "failed"` and invoking `options.onError`) if the exit
  code is nonzero and `!this.stopped`. **This is the exact mechanism 07-03's
  worker-crash test exercises — no new crash-detection code is needed in
  the controller itself**; this blueprint's job is to verify the CLI layer
  built on top of it (07-02's `onError` wiring) actually surfaces the
  failure to the user and does not leave the HTTP server running against a
  permanently-stale, unrecoverable graph without saying so.
- **`.stop()`** (`concurrentRefresh.ts:172-218`): idempotent
  (`this.stopPromise` memoization, line 173-175), posts `{type: "stop"}` to
  the worker, awaits a `"stopped"`/`"fatal"` reply or the worker's `exit`
  event, and **always** calls `this.worker.terminate()` in a `finally`
  block (line 213-217) regardless of whether the graceful stop message
  round-trip succeeded — this is the existing orphan-prevention mechanism;
  this blueprint's job is to verify `terminate()` is reachable on every CLI
  exit path, not to rewrite it.
- **Restart reconciliation** (`packages/indexer/src/incremental.ts:253-302`,
  `initialize()`): on every `IncrementalRepositoryIndexer` construction, it
  compares `baselineCapture.workspaceHash` against the stored head's
  `workspace_hash` and `ANALYZER_VERSION` against the stored
  `analyzerVersion`; a mismatch (e.g., because a prior process was killed
  mid-write, or a different process modified the repo while this one was
  down) enqueues a full rescan (`incremental.ts:296-297`,
  `this.enqueue([{ path: ".", kind: "rescan" }])`) rather than trusting a
  possibly-inconsistent incremental state. **This is the exact
  crash-consistency mechanism CLI_CONTRACT.md step 3's "fall back to a full
  index when incremental correctness cannot be proven" already relies on**
  — this blueprint's adversarial test (kill -9 mid-refresh, then restart
  `tadori serve .` against the same `.tadori/tadori.sqlite`) verifies this
  reconciliation actually fires and produces a valid, servable snapshot
  rather than a corrupt one, using the already-built mechanism, not new
  code.
- **`getActiveSnapshot`** (`packages/store/src/snapshots.ts:626-661`) already
  enforces dangling-endpoint validation on every read — even if a crash left
  a half-written snapshot row, `getActiveSnapshot` will not select it as
  active unless it passes validation (store-level guarantee, pre-existing,
  not modified here).
- **No existing test exercises**: real port-in-use `EADDRINUSE` handling
  (grep of `packages/server`/`packages/cli` test files — those packages
  don't exist yet before 07-01/07-02 land, and this blueprint's own new
  tests are the first to cover it); a real SIGKILL of the refresh worker
  process from outside `ConcurrentRefreshController`'s own API (Week 6's
  `incremental-refresh.test.ts` and `refresh-integration.test.ts` test the
  coordinator's *internal* state machine, not an externally-forced process
  kill of the worker thread itself — worker *threads* in Node cannot be
  sent a POSIX signal the way a child *process* can; "kill -9 the worker"
  for a `worker_threads.Worker` means calling `.terminate()` on it from
  outside the controller, or simulating the `exit`/`error` events the real
  OS-level kill of a worker *process* would produce — see §8 decision for
  how this blueprint interprets the adversarial brief's "kill -9" phrasing
  given the actual worker-threads (not child-process) implementation).
- **`open` package behavior** (the browser-launcher 07-02 adds as a
  dependency): its documented behavior is to reject its returned promise or
  have its spawned child process exit nonzero when no display/browser is
  available (e.g., headless Linux CI) — 07-02 already catches this
  non-fatally; this blueprint adds the adversarial verification that a
  *corrupted*/*nonexistent* launcher binary (simulated via dependency
  injection, not by actually uninstalling the user's browser) still does
  not crash the process or block startup.
- Files to read first: `blueprints/07-02-cli-tadori-serve.md` (full,
  especially §11 step 9, §12, §17 — the exact seams this blueprint
  hardens), `packages/mcp/src/concurrentRefresh.ts` (full),
  `packages/indexer/src/incremental.ts:218-320` (`initialize()`'s
  reconciliation logic), `packages/store/src/snapshots.ts:626-661`
  (`getActiveSnapshot`'s validation guarantee).
- Gotchas: `worker_threads.Worker` (used by `ConcurrentRefreshController`,
  not `child_process`) shares the parent process's memory space
  boundary differently than a forked process — there is no OS PID to send
  `SIGKILL` to independently of the parent for a `Worker` the way there
  would be for a `child_process.fork()`; "kill -9 the worker mid-refresh"
  in the adversarial matrix must be interpreted as "force-terminate the
  worker via `Worker.terminate()` (the Node API's equivalent of an
  ungraceful kill for threads) bypassing the graceful `{type: "stop"}`
  message exchange," not a literal OS-level `kill -9 <pid>` (see §8).

## 5. Scope

1. **Port selection algorithm** (exact): default (no `--port`) → attempt
   `app.listen({host: "127.0.0.1", port: 0})` (OS-assigned) — this always
   succeeds barring total port exhaustion, so "fallback" for the default
   case is really "OS assignment is the only path, no conflict possible."
   Explicit `--port <N>` → preflight-bind `127.0.0.1:N` before server/worker
   construction; if free, release the probe and attempt
   `app.listen({host: "127.0.0.1", port: N})`. Either preflight or listen-site
   `EADDRINUSE` fails hard (exit 4) with an actionable message
   naming the port and suggesting `--port` omission or a different port —
   **no silent fallback to a different port when `--port` was explicit**
   (a user who pinned a port likely did so for a reason — e.g., a bookmark,
   a script expecting that port — silently picking another would violate
   that intent).
2. **Browser-launch failure path**: verified non-fatal with a corrupted/
   unavailable launcher, exact reported message.
3. **Orphan-free supervision**: every process-exit path enumerated (Ctrl+C/
   SIGINT, SIGTERM, parent process death, worker crash) with an explicit
   expected-cleanup assertion per path.
4. **`--snapshot <id>` and `--reindex` hardening**: concurrent-modification
   and invalid-id adversarial cases.
5. **Exact error strings** for non-TS repo and empty-repo cases (07-02
   defined the unsupported-repository message generically; this blueprint
   pins the exact string for the empty-repo sub-case if it differs, and
   verifies the non-TS-repo case, e.g. a pure-Python repo, produces the
   same honest message rather than a confusing internal error).
6. **Crash-consistency verification** against the store's existing restart
   reconciliation (verification only — no new store code).
7. Adversarial test matrix: kill -9 (interpreted per §8) the worker
   mid-refresh; occupy the port; corrupt/simulate-failed browser launcher;
   invalid `--snapshot` id.

## 6. Non-goals

- **Not new store-level crash recovery code.** `getActiveSnapshot`'s
  validation and `IncrementalRepositoryIndexer.initialize()`'s
  reconciliation already exist and are already tested at the store/indexer
  layer (Week 6). This blueprint verifies the *CLI* layer built in 07-02
  correctly relies on them under adversarial conditions — it does not
  modify `packages/store` or `packages/indexer` source.
- **Not corrupt-SQLite-file recovery** (a truncated/bit-flipped
  `.tadori/tadori.sqlite` file itself) — that is 12-02's broader "corrupt DB
  recovery" scope. This blueprint's crash scenarios leave the DB in a
  *valid* SQLite state (WAL-consistent) because `better-sqlite3`/SQLite's
  own WAL durability guarantees hold even across an ungraceful process
  kill; it does not simulate filesystem-level corruption.
- **Not a general process-supervisor library** (e.g., pm2-style respawn-on-
  crash). `tadori serve .` is a single foreground command a human runs and
  Ctrl+C's; this blueprint hardens *that* process's own child (the refresh
  worker) and its own exit paths, not a multi-process daemon architecture.
- **Not new MCP-tool-shaped surface** — no MCP protocol code touched.
- **Not port *scanning*** (trying port, port+1, port+2, ... until one is
  free) for the explicit `--port` case — explicitly rejected in §8; the
  default case's OS-assignment already avoids needing this.

## 7. Dependencies and prerequisites

- **07-02** must have delivered `runServe`, `parseServeFlags`,
  `resolveRepoRoot`, and the happy-path lifecycle exactly as specified in
  `blueprints/07-02-cli-tadori-serve.md` §10-§12. This blueprint modifies
  `packages/cli/src/serve.ts`'s port-selection, browser-launch, and
  teardown-registration logic in place; it does not re-architect the
  9-step ordering 07-02 established.
- **07-01** (transitively) — this blueprint's tests exercise the real
  `createServerApp`/`GraphState` surface under port conflicts, so 07-01's
  contracts must be stable.

## 8. Architectural decisions

- **Port algorithm: OS-assigned default, hard-fail explicit.** Concretely:
  `flags.port === null` → `listen({port: 0})`, read back the assigned port,
  no conflict is possible by construction (the OS guarantees an unused
  ephemeral port). `flags.port !== null` → preflight-bind the requested port
  before constructing server routes or a refresh worker, release it, then
  `listen({port: flags.port})`; catch `EADDRINUSE` at both the preflight and
  listen site (TOCTOU backstop), and exit 4 with
  message `"Port ${port} is already in use. Choose a different port with
  --port, or omit --port to let the OS pick one."`. Rejected: scanning
  `port, port+1, port+2, ...` on explicit-port conflict — silently serving
  on a different port than the one the user explicitly typed is more
  confusing than failing loudly, especially since the startup-facts print
  (07-02 step 8) would then show a port the user didn't ask for with no
  clear signal that a substitution happened; a hard, explained failure is
  more honest. Rejected: always trying the OS-assigned fallback even for
  explicit `--port` (i.e., treating `--port` as a mere hint) — this
  silently ignores an explicit user instruction, which is worse than
  failing.
- **"kill -9 the worker" adversarial test uses `Worker.terminate()`, not an
  OS-level signal.** `ConcurrentRefreshController`'s worker is a
  `worker_threads.Worker` (`concurrentRefresh.ts:3,32-46`), which has no
  independent OS PID a test can `SIGKILL` — `.terminate()` is the Node API
  that ungracefully stops a worker thread without running its cleanup
  handlers, which is the closest and correct analog to "the worker died
  without warning" for this specific implementation. The test calls
  `(controller as any)` internal worker's `.terminate()` directly (bypassing
  the controller's own graceful `.stop()` path) or, more robustly without
  reaching into private state, spawns a **second, throwaway**
  `ConcurrentRefreshController` in the test whose underlying worker script
  is swapped (via a test-only worker data flag or a wrapping test harness)
  for one that calls `process.exit(1)`-equivalent
  (`process.exit` inside a worker thread terminates only that thread) or
  throws synchronously during a refresh — producing the same observable
  `exit`/`error` event sequence `waitUntilReady`'s post-ready listeners
  already handle (`concurrentRefresh.ts:112-120`). The builder chooses
  whichever mechanism produces a real, unmodified `ConcurrentRefreshController`
  observing a real worker-exit event rather than mocking the controller's
  own state — the point of the test is to verify the *CLI's* reaction
  (does the HTTP server keep serving the last valid snapshot with an honest
  `watcher_error`, does teardown still terminate cleanly afterward), not to
  re-verify the controller's already-tested internals. Rejected: treating
  this requirement as untestable and skipping it — the adversarial brief
  explicitly names it; the correct move is reinterpreting the literal
  phrasing for the real implementation (worker threads, not child
  processes), not dropping the test.
- **Browser-launch failure simulation is dependency-injected, not a real
  broken environment.** 07-02 already shipped this exact seam:
  `RunServeDeps.openBrowser?` (`packages/cli/src/serve.ts:39-46`,
  defaulting to the real `open` package at `:76`), threaded as
  `runServe`'s second parameter and stubbed by every existing lifecycle
  test. This blueprint adds NO new injection mechanism — it only passes a
  stub that always rejects and pins the exact §10 stderr message.
  Rejected: trying to actually corrupt the CI environment's browser —
  flaky, platform-specific, and untestable on a developer's own machine
  where a real browser exists. Also rejected (2026-07-18 review): a new
  `RunServeOptions` interface — it would duplicate/conflict with the live
  `RunServeDeps` contract that 07-02's tests already consume.
- **Parent-process-death orphan check uses a real spawned child process in
  the test**, not a mock. The test spawns `tadori serve .` (via `tsx
  packages/cli/src/cli.ts serve <tmpRepo>` or the equivalent invocation, in
  a real `child_process.spawn`), waits for its "listening" stdout line,
  then kills the **parent test process's spawned child** via
  `child.kill("SIGKILL")` (simulating an ungraceful parent-side kill of the
  whole `tadori serve` process — the most direct way to test "parent death"
  from the worker's perspective is actually "this whole process dies
  including its worker thread," since a `worker_threads.Worker` cannot
  outlive its owning process; Node terminates all worker threads when the
  main thread's process exits) and asserts, via OS process listing
  (`tasklist`/`wmic` on Windows, `ps` on POSIX — this repo's primary
  platform is Windows per the environment) filtered by a distinctive
  marker (e.g., a `--tadori-test-marker` env var the spawned process
  echoes into a temp file at worker-ready time), that no process bearing
  that marker remains after a short grace period. Rejected: asserting via
  `Worker`-internal state (that only proves the controller's own bookkeeping,
  not that the OS actually has no leaked process) — an OS-level check is
  the only test that actually falsifies an orphan-process claim.
- **`--reindex` + concurrent modification**: `--reindex` forces a full
  `indexRepositoryIntoStore` (07-02 §11 step 6) regardless of the
  incremental reuse decision; this blueprint's test modifies a fixture file
  *during* the reindex (simulated via a slow/instrumented extraction hook
  if the builder can inject one, or by asserting the *sequential* outcome —
  reindex-then-immediately-refresh — produces a snapshot matching the
  post-modification state, i.e., no missed change) is the practical
  verification given `indexRepositoryIntoStore` is not designed to be
  paused mid-flight for a test to inject a race. Rejected: building new
  instrumentation into `indexRepositoryIntoStore` itself purely to make this
  race artificially reproducible — that would be production-code
  complexity added only to satisfy a test, contradicting the "no
  unrequested abstractions" discipline; the sequential-outcome check is the
  honest substitute.
- **Invalid `--snapshot <id>`**: `getSnapshot(db, id)` returning `undefined`
  (nonexistent id) and `getSnapshot` returning a row that then fails
  `findDanglingEndpoints` (a genuinely invalid snapshot) are two distinct
  cases, both producing exit 3 but with **different message text**
  (`"Snapshot #<id> does not exist."` vs. `"Snapshot #<id> failed
  validation: <n> dangling endpoint(s)."`) — distinguishing them is more
  actionable than one generic "invalid snapshot" message. Rejected: one
  merged error message for both cases — loses diagnostic value for a user
  who has a real (if broken) snapshot id vs. a typo'd one.
- **Exact non-TS/empty-repo message strings**: reusing 07-02's
  `resolveRepoRoot` error message verbatim for both the "genuinely empty
  directory" and "has files but none are TS/JS-configured" sub-cases (both
  reduce to "no package.json or tsconfig.json found") — **no new message
  variant is invented** unless the builder finds the two cases are
  actually distinguishable in a way a user would find more actionable (a
  pure-Python repo *does* often have neither file, collapsing to the same
  message honestly, since Tadori genuinely cannot tell "empty" from
  "wrong language" without a `package.json`/`tsconfig.json` signal either
  way). Rejected: inventing a "this looks like a non-JS/TS project" heuristic
  (e.g., detecting `requirements.txt`/`Cargo.toml`) — speculative,
  unrequested scope; the existing check already gives an honest, correct
  answer for both cases via the same signal.

## 9. Exact file plan

- `packages/cli/src/serve.ts` — modify. Carve the `EADDRINUSE` branch out
  of the current single outer `catch` into a dedicated try/catch around
  the `listen` call only (per §11 step 1 — the outer catch currently
  funnels `openDatabase`/`createServerApp`/listen errors together and
  must keep handling the non-port paths unchanged); pin the exact §10
  port and browser-failure message strings; add the `--snapshot` two-case
  error-message branch; wire `refresh`'s `onError` callback to broadcast
  a `watcher_error` (already a 07-01 WS event type) rather than crashing
  the process.
- NO new interface is added. The injection seam is 07-02's existing
  `export interface RunServeDeps { openBrowser?(url): Promise<unknown>;
  signal?: AbortSignal; stdout?(text): void; stderr?(text): void }`
  (`serve.ts:39-46`), already the optional second parameter of
  `runServe`, already defaulting to the real `open` package —
  **no behavior change for the real CLI entry point** (`cli.ts` calls
  `runServe(argv)` with no second argument, exactly as 07-02 specified).
- `packages/cli/test/port-fallback.test.ts` — create.
- `packages/cli/test/browser-launch-failure.test.ts` — create.
- `packages/cli/test/orphan-supervision.test.ts` — create.
- `packages/cli/test/snapshot-reindex-hardening.test.ts` — create.
- `packages/cli/test/repo-error-messages.test.ts` — create.
- `packages/cli/test/exit-codes.test.ts` — modify: pin the port message and
  prove cleanup continues through refresh/indexer/database after a server
  close failure.
- `packages/cli/test/fixtures/testMarkerWorker.ts` — create (test-only
  helper referenced by §8's parent-death test: a thin wrapper the test
  spawns that writes a marker file on worker-ready and on worker-exit, used
  only by `orphan-supervision.test.ts`; not imported by any production
  code).
- `packages/mcp/src/service.ts` / `packages/mcp/test/service.test.ts` — add
  the exact-snapshot open seam with repository/status/integrity validation.
- `packages/server/src/app.ts` / `packages/server/src/graphState.ts` — thread
  the optional pinned snapshot and suppress refresh-driven rotation for a
  pinned session.
- `IMPLEMENTATION_STATUS.md` — modify: record this blueprint's hardening
  gates once built/validated (per the project's "maintain
  IMPLEMENTATION_STATUS.md" rule) — deferred to the builder's final report
  per §20/§21, not written by this planning pass.

## 10. Exact contracts

```ts
// packages/cli/src/serve.ts — LIVE 07-02 surface, reused unchanged.
// (Corrected 2026-07-18: this blueprint originally invented a parallel
// `RunServeOptions` interface; the shipped seam is `RunServeDeps`.)
export interface RunServeDeps {
  openBrowser?(url: string): Promise<unknown>; // default: real `open` package
  signal?: AbortSignal; // test hook: awaited instead of real OS signals
  stdout?(text: string): void;
  stderr?(text: string): void;
}
export async function runServe(
  argv: readonly string[],
  deps?: RunServeDeps
): Promise<number>;
```

**Port selection outcomes** (exact):

| Condition | Behavior | Exit code |
|---|---|---|
| No `--port` | `listen({port: 0})`; OS assigns; always succeeds | n/a (proceeds) |
| `--port N`, N free | `listen({port: N})` succeeds | n/a (proceeds) |
| `--port N`, N occupied | `EADDRINUSE` caught; message `"Port ${N} is already in use. Choose a different port with --port, or omit --port to let the OS pick one."` printed to stderr | 4 |

**Browser-launch outcomes** (exact):

| Condition | Behavior | Exit code |
|---|---|---|
| `openBrowser` resolves | silent (or a one-line confirmation, builder's choice, non-blocking) | n/a |
| `openBrowser` rejects/throws | stderr: `"Could not open a browser automatically. Open ${url} manually."` | n/a (unchanged, proceeds) |

**`--snapshot` outcomes** (exact):

| Condition | Message | Exit code |
|---|---|---|
| id does not exist | `"Snapshot #${id} does not exist."` | 3 |
| id exists, fails dangling-endpoint validation | `"Snapshot #${id} failed validation: ${n} dangling endpoint(s)."` | 3 |

**Orphan-supervision exit-path matrix** (each row is a test case in
`orphan-supervision.test.ts`):

| Trigger | Expected cleanup |
|---|---|
| SIGINT (Ctrl+C) | Teardown order per 07-02 §12 completes; `refresh.stop()` resolves; worker thread gone; process exits 0 |
| SIGTERM | Identical teardown path to SIGINT (same handler) |
| Parent process killed (SIGKILL of the whole `tadori serve` process from outside) | Node terminates all worker threads with the process; OS process listing shows zero processes bearing the test's distinctive marker after a grace period |
| Worker crash (`Worker.terminate()` forced mid-refresh, or a worker-internal throw, per §8) | `ConcurrentRefreshController` observes the `exit`/`error` event, calls `onError`; CLI's `onError` wiring broadcasts `watcher_error` over WS and keeps the HTTP server serving the last valid snapshot; a subsequent SIGINT still tears down cleanly (worker already gone, `refresh.stop()` is idempotent per `concurrentRefresh.ts:173-175`) |

## 11. Ordered implementation procedure

1. `packages/cli/src/serve.ts`: refactor the port-listen call into the
   exact two-branch algorithm (§8/§10); catch `EADDRINUSE` specifically
   (check `(error as NodeJS.ErrnoException).code === "EADDRINUSE"`, not a
   string-match on `error.message`). CARVE-OUT CONSTRAINT (2026-07-18
   review): the live code funnels `EADDRINUSE` through the same single
   outer `catch` that handles `openDatabase`/`createServerApp` and other
   startup errors (currently emitting `"Port unavailable: ${message}"`).
   Wrap ONLY the `listen` call in its own try/catch for the exit-4 path
   with §10's exact message; every other error path must keep flowing
   through the outer catch with unchanged behavior, and 07-02's existing
   EADDRINUSE test must be updated to the new exact message in the same
   step (a message-text change, not a behavior change). New test file
   `port-fallback.test.ts`: (a) default (`--port` omitted) binds successfully
   and reports a nonzero OS-assigned port; (b) explicit free port succeeds
   and reports exactly that port; (c) explicit occupied port (bind a
   throwaway listener first in the test to occupy it) exits 4 with the
   exact message. Expected: green; typecheck clean.
2. `serve.ts`: the `RunServeDeps.openBrowser` injection point ALREADY
   exists (07-02) with the real `open` default and a non-fatal call site;
   this step only pins the browser-failure stderr text to §10's exact
   string (if the live text differs, update it and any test asserting the
   old text). New test file `browser-launch-failure.test.ts`: injected
   `openBrowser` that rejects → `runServe` still returns `0` on a
   subsequent clean SIGINT (i.e., the rejection does not propagate as a
   fatal error) and stderr contains the exact reported-URL message (capture
   via a stubbed `process.stderr.write` or an injectable logger, builder's
   choice, documented in §21).
3. `serve.ts`: wire `ConcurrentRefreshController`'s `onError` callback
   (already an option per `concurrentRefresh.ts:13-15`,
   `ConcurrentRefreshOptions.onError`) to call the server's WS
   `watcher_error` broadcast (07-01's `GraphState`/`ws.ts` already define
   this event type — this step only supplies the callback, no new event
   type is added). Test folded into `orphan-supervision.test.ts`'s
   worker-crash case (step 5 below) since it needs a real running server to
   observe the WS broadcast.
4. `serve.ts`: add the two-case `--snapshot` validation branch (§8/§10).
   New test file `snapshot-reindex-hardening.test.ts` part 1: (a) a
   nonexistent id exits 3 with the "does not exist" message; (b) a snapshot
   id belonging to a *different* repository's row (cross-repo id reuse —
   the id exists in the DB but is not a member of the current repo)
   produces the same "does not exist" behavior from this repo's perspective
   (never accidentally serves another repo's snapshot); (c) — dangling-
   endpoint-invalid case is difficult to construct without directly
   manipulating the DB; if the builder cannot cheaply construct a
   genuinely-invalid-but-present snapshot row through public APIs alone,
   this specific sub-case may use a direct SQL row mutation in the test
   setup (acceptable in a test file, never in production code) to force the
   condition, with an `ASSUMPTION:` line recording that choice.
5. `orphan-supervision.test.ts`: implement the four-row matrix from §10.
   SIGINT/SIGTERM cases: spawn `tadori serve .` via `child_process.spawn`
   against a temp fixture repo, wait for the "listening"/startup-facts
   stdout marker, send the signal, assert exit code 0 within a bounded
   timeout and that a post-exit OS process check (filtered by the test's
   marker mechanism, §8) finds nothing. Parent-death case: same spawn, kill
   the spawned process itself with `SIGKILL` (simulating the whole `tadori
   serve` process dying ungracefully, which is what "parent death" means
   from the worker thread's perspective per §8), assert no marked process
   remains after the grace period. Worker-crash case: per §8's chosen
   mechanism, force the worker to exit/error while the parent CLI process
   stays alive; assert (i) the HTTP server (queried via a real HTTP request
   to `/api/v1/snapshot` from the test) still returns the last valid
   snapshot with `context.stale: true` or an equivalent honest signal, (ii)
   a WS client observes a `watcher_error` frame, (iii) a subsequent SIGINT
   to the parent still exits 0 (teardown remains idempotent even with the
   worker already gone).
6. `repo-error-messages.test.ts`: (a) an empty temp directory produces the
   exact `resolveRepoRoot` message from 07-02 §10; (b) a temp directory
   containing only non-TS files (e.g., a `.py` file and a `README.md`, no
   `package.json`/`tsconfig.json`) produces the identical message (verifying
   the two cases are honestly indistinguishable given the actual signal
   Tadori uses, per §8's rejected-heuristic note — this test documents that
   equivalence rather than treating it as a gap).
7. Full validation pass (§15), including a manual OS-level process-listing
   spot check on the actual development machine (Windows) for at least one
   of the orphan-supervision cases, to corroborate the automated
   `tasklist`-based assertion isn't a false negative. Commit.

## 12. Data and lifecycle flows

**Port selection flow**: `flags.port` → branch (§8/§10) → `listen()` →
success path continues into 07-02's existing step 6-8 flow unchanged;
failure path (`EADDRINUSE` on explicit port) short-circuits directly to
exit 4, before any server routes are registered or any browser-open is
attempted (no partial startup).

**Browser-launch flow**: identical to 07-02 §12, with the injection point
added; failure is caught at the call site and never propagates past that
line — the startup-facts print (step 8) and the running server are
unaffected by a browser-launch failure either way.

**Worker-crash flow** (new, this blueprint's core addition): worker thread
exits/errors unexpectedly → `ConcurrentRefreshController.recordFatal` sets
`stateValue.phase = "failed"` and invokes `onError` (existing mechanism,
`concurrentRefresh.ts:131-142`) → CLI's `onError` callback (new, this
blueprint) broadcasts `watcher_error` over the already-defined WS channel →
HTTP reads continue serving the last valid snapshot (`GraphState`'s
`.current()` is unaffected — the crash does not touch the already-loaded
`GraphService` instance, only future refreshes) → user sees a `stale`/
`watcher_error` signal rather than silent staleness or a crashed server →
on eventual SIGINT, teardown proceeds normally (`refresh.stop()` on an
already-exited worker is a no-op per `stopWorker()`'s `workerExited` early
return, `concurrentRefresh.ts:181-183`).

**Parent-death flow**: OS delivers `SIGKILL` (or any unhandled fatal signal)
to the `tadori serve` process → Node's runtime guarantees all
`worker_threads.Worker` instances owned by that process terminate as part
of process teardown (no explicit cleanup code can run for a `SIGKILL`, by
definition — this is a Node/OS guarantee this blueprint verifies
empirically via the process-listing assertion, not a guarantee this
blueprint's code implements, since **nothing can run** cleanup code after
`SIGKILL`).

**`--reindex` flow**: unchanged from 07-02 §12 except the concurrent-
modification verification added in §11 step 4's outcome-based test — no
new production code path, only new test coverage confirming the existing
full-reindex-then-serve sequence reflects post-modification state.

## 13. Test plan

- `port-fallback.test.ts` — default/explicit-free/explicit-occupied port
  cases (§11 step 1).
- `browser-launch-failure.test.ts` — injected rejection, non-fatal
  confirmation (§11 step 2).
- `orphan-supervision.test.ts` — the four-row exit-path matrix, using real
  spawned child processes and real OS-level process-listing assertions,
  not mocks (§11 step 5). This is the adversarial centerpiece of this
  blueprint.
- `snapshot-reindex-hardening.test.ts` — `--snapshot` nonexistent/
  cross-repo/dangling-invalid cases; `--reindex`-under-modification
  outcome check (§11 steps 4 and the `--reindex` note in step 4's
  description).
- `repo-error-messages.test.ts` — empty-repo vs. non-TS-repo message
  equivalence (§11 step 6).
- Regression: full existing suite (`pnpm test`) stays green; 07-01/07-02's
  own test suites (already landed by the time this blueprint builds) stay
  green — this blueprint modifies `packages/cli/src/serve.ts` in place, so
  07-02's `serve-lifecycle.test.ts` and `exit-codes.test.ts` must still
  pass unmodified (exception: the EADDRINUSE test's expected message text
  updates to §10's exact string per §11 step 1; never a behavior change
  to the default `RunServeDeps` path).

## 14. Acceptance criteria

- [ ] `--port` omitted always succeeds via OS assignment; the reported port
      in startup facts matches `app.server.address().port`.
- [ ] `--port <occupied>` exits 4 with the exact message string from §10;
      no server routes are registered when this path is taken (verified via
      a spy asserting `createServerApp` is never called, mirroring 07-02's
      analogous `--mode` rejection assertion pattern).
- [ ] A rejecting `openBrowser` injection does not change `runServe`'s exit
      code and produces the exact stderr message from §10.
- [ ] SIGINT and SIGTERM both produce exit code 0 and leave zero processes
      bearing the test's marker after a bounded grace period (OS
      process-listing assertion, not an internal-state assertion).
- [ ] Killing the spawned `tadori serve` process itself (simulating parent
      death) leaves zero marked processes after the grace period.
- [ ] Forcing the refresh worker to exit/error mid-session: the HTTP server
      keeps responding to `/api/v1/snapshot` with the last valid snapshot
      and an honest stale/error signal; a WS-connected client receives a
      `watcher_error` frame; a subsequent SIGINT still exits 0.
- [ ] `--snapshot <nonexistent-id>` exits 3 with the "does not exist"
      message; a genuinely dangling-endpoint-invalid snapshot id exits 3
      with the distinct "failed validation" message.
- [ ] An empty repo directory and a non-TS-only repo directory produce the
      identical, exact `resolveRepoRoot` error string (documented
      equivalence, not a gap).
- [ ] 07-02's own `serve-lifecycle.test.ts` and `exit-codes.test.ts` pass
      unmodified in behavior (only the EADDRINUSE expected-message text
      may change per §11 step 1; the default `RunServeDeps` path stays
      behaviorally identical to pre-07-03 code).
- [ ] Full existing suite stays green: `pnpm test`, zero failures. 5/5
      golden fixtures still PASS.

## 15. Validation commands

pnpm install; pnpm skills:check; pnpm typecheck; pnpm lint; pnpm test;
python validate_fixtures.py; pnpm fixtures:validate; pnpm fixtures:index;
pnpm fixtures:typecheck; pnpm benchmark:incremental; pnpm tadori diff .;
git diff --check; git status --short

DECISION (2026-07-18 review, replaces builder discretion): the
orphan-supervision test probes the runner at setup — it attempts one
`tasklist` (win32) / `ps` (POSIX) invocation. If the probe succeeds, the
full OS-process-listing assertions run (expected on both GitHub-hosted
runners, which permit spawn/signals/process listing). If the probe fails,
those specific assertions `skip` with an explicit named reason visible in
CI output (`it.skipIf(...)` or equivalent), the spawn/signal/exit-code
assertions still run, and the skipped OS-listing assertions MUST be
verified locally on the primary Windows dev machine with the transcript
recorded in §21. Never silently weaken an OS-listing assertion to an
internal-state check — an internal check cannot falsify a real orphan.

## 16. Performance budgets

- No new latency budget introduced. This blueprint is a correctness/
  hardening pass over 07-02's lifecycle, not a new performance-sensitive
  code path. The orphan-supervision "grace period" (§10/§11) is a bounded
  wait (recommend 2000 ms, generous relative to `ConcurrentRefreshController.
  stop()`'s own message round-trip cost) for process-exit propagation to
  become observable to the OS process table, not a performance requirement
  — record the exact value chosen in §21.

## 17. Failure and recovery behavior

This blueprint *is* failure-and-recovery behavior; see §8 (decisions), §10
(exact contracts), and §12 (flows) for the full specification. Summary
table:

| Failure | Recovery |
|---|---|
| Port conflict, explicit `--port` | Fail hard, exit 4, actionable message |
| Port conflict, default | Impossible by construction (OS-assigned) |
| Browser launch fails | Report URL, continue, non-fatal |
| Worker crash mid-refresh | Keep serving last valid snapshot, honest `watcher_error`, teardown remains clean |
| Parent process killed | All child worker threads die with it (Node/OS guarantee); no code runs, verified empirically |
| Invalid `--snapshot` id | Exit 3, one of two distinct actionable messages |
| Empty/non-TS repo | Exit 2, existing 07-02 message, verified equivalent for both sub-cases |

## 18. Security and privacy

No new I/O surface beyond what 07-01/07-02 already established. The
test-only marker-file mechanism (`testMarkerWorker.ts`, §9) writes to a
temp directory, never the user's repository, and is not shipped in any
production bundle (test-only file, excluded from `packages/cli`'s
`package.json` `main`/`types`). No change to localhost-only binding,
path confinement, or the observation trust boundary established in 07-01.

## 19. Accessibility

Not applicable — no human-facing UI surface is added or changed by this
blueprint (CLI/process-lifecycle hardening only).

## 20. Documentation updates

`IMPLEMENTATION_STATUS.md` — the builder records this blueprint's hardening
gates (port algorithm, orphan-supervision matrix results, crash-consistency
verification) once built/validated, per the project's "maintain
IMPLEMENTATION_STATUS.md" rule. No `docs/CLI_CONTRACT.md` change — this
blueprint implements the frozen contract's non-negotiables more rigorously,
it does not amend them.

## 21. Builder final report

Require: summary; files changed (§9); exact port-fallback algorithm as
implemented (confirm matches §8/§10 exactly); browser-injection mechanism
chosen; orphan-supervision test results per the four-row matrix (§10),
including the exact OS process-listing command used (`tasklist`/`ps`) and
the grace-period value chosen; the mechanism chosen to simulate "kill -9
the worker" (§8) and why; the mechanism chosen to construct a
dangling-endpoint-invalid `--snapshot` test case (§11 step 4c) and its
`ASSUMPTION:` line if a direct SQL mutation was used; validation command
output summary (§15); any CI sandboxing constraint on OS-level process
checks; commit SHA; `ASSUMPTION:` lines; explicit confirmation 07-02's
existing tests still pass unmodified in behavior.

### 21.1 Builder implementation notes / deviations (2026-07-18)

- **Message-string reconciliation.** EADDRINUSE: adopted §10's exact string
  and updated 07-02's `exit-codes.test.ts:152` assertion (`toContain("Port
  unavailable")` → the §10 string) in the same step — a message-text change,
  not a behavior change, explicitly permitted by §11 step 1. `--snapshot`:
  adopted §10's exact strings (`"Snapshot #${id} does not exist."` and
  `"Snapshot #${id} failed validation: ${n} dangling endpoint(s)."`),
  replacing the live 07-02 text (`"Snapshot ${id} does not exist."` and the
  dangling-validation variant). Rationale: unlike EADDRINUSE, no shipped test
  pinned the old `--snapshot` text (the existing test asserts only
  `toContain("999999")`, still satisfied), and §4 designates §10 as this
  blueprint's intended contract for these strings — so no frozen-merged
  string is churned. The blueprint §10 text and live code now agree; §10 was
  NOT edited (it already matched the chosen contract).
- **Port carve-out.** The acceptance criterion "createServerApp is never
  called on the conflict path" requires the explicit-port check to happen
  before server construction. Chosen mechanism: a throwaway `net.createServer`
  probe of the explicit port before `createServerApp` (default port 0 skips
  the probe — OS-assigned, no conflict possible). The `app.listen` call keeps
  its own EADDRINUSE catch as the §11-step-1 carve-out and a TOCTOU backstop.
  No port scanning (§8 rejected). ponytail note: the probe/listen TOCTOU gap
  is acceptable for a single-user localhost dev tool.
- **onError → watcher_error wiring.** No new CLI-side broadcast was added:
  07-01's `GraphState` poll loop already emits `watcher_error` off
  `refresh.state()`'s `lastError` null→non-null transition, and
  `isSnapshotStale()`/`context.stale` already reflect `fatalError`. The CLI's
  `onError` stays an operator-facing stderr line. §11 step 3 said "supply the
  callback, no new event type" — the callback already existed; the broadcast
  path is the poll loop, verified end-to-end in the worker-crash test.
- **"kill -9 the worker" mechanism (§8).** In-process `runServe` with a real,
  unmodified `ConcurrentRefreshController` captured via a `start` spy; the
  test calls `.terminate()` on the controller's private `worker` (the Node
  worker-threads analog of an ungraceful kill), producing the real `exit`
  event `recordFatal` handles. Not a controller mock.
- **Dangling-invalid `--snapshot` construction (§11 step 4c).**
  `ASSUMPTION:` a genuinely-invalid-but-present snapshot cannot be built
  through public APIs (`insertSnapshotGraph` validates endpoints), so the test
  forces it with a direct SQL mutation in setup only (permitted here, never in
  production): `DELETE FROM snapshot_nodes` for one node that an edge in the
  snapshot references, making `findDanglingEndpoints` report the missing
  endpoint. The asserted count comes from `findDanglingEndpoints` at runtime.
- **Pinned/cross-repo `--snapshot` correction (§11 step 4b).** Independent
  review reproduced `requested=1, active=2, served=2`: the CLI validated the
  ID but `GraphState` reopened the active working-tree head. The correction
  adds `GraphService.openSnapshot`, threads `snapshotId` through
  `createServerApp`, disables refresh rotation for pinned sessions, and
  validates active status, repository ownership, foreign keys, and dangling
  endpoints. The cross-repo test now stores both repositories' snapshots in
  the same SQLite DB and proves an ID owned by the other `repo_id` is rejected.
- **Orphan test — spawn mechanism & OS-listing probe.** Spawned via direct
  `spawn(process.execPath, ["--import", <tsx/esm>, testMarkerWorker.ts, ...])`
  — NO `pnpm`/shell wrapper, so `child.pid` IS the node process killed (a
  wrapper would orphan the real node child for reasons unrelated to the code
  under test — this was observed and fixed during the build). OS-listing
  command: Windows `tasklist /FI "PID eq <pid>" /NH` (POSIX `ps -p <pid>`).
  Grace period: 2000 ms (§16). The setup probe SUCCEEDED on this Windows dev
  machine, so all three OS-listing assertions RAN (not skipped) with real
  `tasklist` verification. `it.skipIf(!probe.ok)` guards them for constrained
  runners, with the reason surfaced in the test name.
- **Windows graceful-signal constraint.** `child.kill('SIGINT'/'SIGTERM')`
  hard-terminates a spawned child on Windows (verified empirically: the
  handler never runs, exit signal is the sent signal). So graceful exit-0 +
  teardown-order is asserted through `serve.ts`'s `deps.signal` AbortSignal
  path — the SAME `teardown()` the `process.once('SIGINT'/'SIGTERM')`
  handlers invoke — not through a spawned child's signal. The orphan (no
  leaked process) guarantee IS verified via spawned children for all three
  kill types, since any kill removes the process from the OS table.
- **Signal/OS-listing correction.** Real spawned SIGINT/SIGTERM/SIGKILL exit
  assertions always run. Only the separate `tasklist`/`ps` PID checks use
  `skipIf` when the setup probe fails; POSIX SIGINT/SIGTERM require exit 0.
- **Teardown-failure correction.** Cleanup is centralized and independently
  attempts server/GraphState, refresh worker, incremental indexer, and DB
  shutdown. A server-close rejection falls back to raw socket closure, reports
  the failure, returns exit 1 within a bound, and cannot skip worker/DB cleanup.
- **07-02 tests unchanged in behavior.** `serve-lifecycle.test.ts` passes
  unmodified; `exit-codes.test.ts` changed only the EADDRINUSE expected
  message text (permitted). Default `RunServeDeps` path (cli.ts →
  `runServe(argv)` with no deps) is behaviorally identical to pre-07-03.
- **Grace-period value:** 2000 ms (§16). **WS client mechanism:**
  `@fastify/websocket`'s in-process `injectWS` (mirrors the server package's
  own `ws.test.ts`), captured via a `createServerApp` spy — no `ws` module
  specifier added to `@tadori/cli` (it is not a declared dependency).

## 22. Independent review result

- Status: PASS (2026-07-18). Initial review found one blocker (validated
  `--snapshot` ID was not the snapshot served), three high findings (conditional
  signal-test skips, vacuous reindex assertion, teardown could skip worker stop
  and hang), and precision gaps. All were corrected. Correction re-review found
  no remaining blocker/high/medium; independent targeted run 29/29, coordinator
  focused matrix 35/35, fresh repository suite 283/283.

## IF SOMETHING IS UNCLEAR

Smallest safe assumption + `ASSUMPTION:` line. If an uncertainty could mean
an orphaned process, a silently-served invalid snapshot, or a masked
worker-crash signal, stop and report blocked instead of guessing — this
blueprint exists specifically to remove those ambiguities, so a builder
finding a new one should treat it as a genuine finding, not paper over it.

## TADORI NON-NEGOTIABLES

Frozen v2.1; TS/JS only; exactly six MCP tools (unaffected); localhost
default; invalid snapshots never served (this blueprint's core guarantee);
`tadori serve .` is the normal command; no orphan processes (CLI_CONTRACT.md
step 9, this blueprint's core guarantee); no cloud dependency; Graphify is
ignored reference only; no seventh tool; no runtime tracing.
