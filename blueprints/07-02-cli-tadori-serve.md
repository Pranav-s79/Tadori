# BLUEPRINT 07-02: `packages/cli` `tadori serve .`

## 1. Header

- ID / Title / Phase: 07-02 — `packages/cli` `tadori serve .` — Phase 7
- Status: review
- Primary builder: Claude Sonnet — sequential lifecycle wiring over
  already-built seams (`GraphService`-backed server from 07-01,
  `IncrementalRepositoryIndexer` from Week 6); flag parsing and step
  ordering, no new concurrency primitives (07-03 owns hardening).
- Reviewer roles: Spec Guardian (CLI_CONTRACT.md 1:1 mapping), Implementation
  Reviewer (teardown order, exit codes), CLI Adversary (flag edge cases).
- Complexity: M
- Depends on / Unlocks: Depends on **07-01** (server package + its
  `createServerApp`/`GraphState` contracts) and **00-01A** (allowJs scanner
  fix — `tadori serve .` must index arbitrary user repos, which commonly
  contain root `.js` config files; without the fix, `serve` crashes on any
  repo like Tadori's own). Unlocks **07-03** (hardening builds on this
  blueprint's lifecycle skeleton), **12-01** (privacy/purge needs the
  `.tadori/` layout this blueprint creates), **12-03** (bin packaging wraps
  this package's entry point).
- Estimated sessions: 1.
- Related frozen-spec sections: `docs/CLI_CONTRACT.md` (the full frozen
  9-step contract + frozen flags — this blueprint maps 1:1); ARCHITECTURE.md
  AD-003 (in-process server + reused refresh worker), AD-004 (canonical
  `.tadori/` layout), Section 5 (CLI lifecycle table).

## 2. Objective

`packages/cli` exists as a new pnpm workspace member providing `tadori serve
<path>`: a single command that resolves a repository, loads its config,
reuses/refreshes/rebuilds its graph snapshot, validates it, starts the 07-01
HTTP+WS server bound to `127.0.0.1`, serves a truthful status page in place
of the not-yet-built viz UI, opens a browser unless suppressed, prints
startup facts, and tears down cleanly on Ctrl+C — implementing all nine
frozen `CLI_CONTRACT.md` steps in order with the seven frozen flags parsed
exactly as specified.

## 3. Why this matters

- User value: this is the actual command a Tadori user types
  (`pnpm tadori serve .`, later `npx tadori serve .` per 12-03). Nothing in
  Phase 8+ (visualization) is reachable without this entry point existing.
- System value: proves the full stack (indexer → store → MCP query seam →
  HTTP server → CLI lifecycle) composes into one process without a new
  concurrency model — reuses Week 6's `ConcurrentRefreshController` verbatim
  (AD-003), avoiding a second isolation scheme.
- Downstream: 07-03 hardens exactly the seams this blueprint stands up
  (port selection, browser launch, teardown); 08-02 replaces this
  blueprint's stub status page with the real viz bundle without touching CLI
  lifecycle code; 12-01/12-03 build directly on this blueprint's `.tadori/`
  layout and package structure.

## 4. Current repository evidence

Verified current (2026-07-17):

- `packages/cli` does not exist. `docs/CLI_CONTRACT.md` (lines 1-6) explicitly
  states it freezes the contract "before the visualization milestone
  implements it... nothing here authorizes building the CLI ahead of the
  Weeks 7-8 visualization phase" — this blueprint is that authorized Phase 7
  build (BACKLOG.md Phase 7 row 07-02, status `pending`, explicitly scoped).
- **The exact 9-step contract** (`docs/CLI_CONTRACT.md:19-39`, verbatim,
  reproduced as this blueprint's implementation order in §11): resolve
  repository → load configuration → reuse/refresh/rebuild snapshot →
  validate → start local API (127.0.0.1) → start visualization (2D default)
  → open browser unless `--no-open` → print startup facts → stop all child
  processes on Ctrl+C.
- **The exact frozen flags** (`docs/CLI_CONTRACT.md:43-51`, verbatim):
  `--port <number>` (default: an open port), `--no-open`, `--reindex`,
  `--mode 2d|2.5d|3d-experiment` (default `2d`), `--snapshot <id>`.
- **Two existing, inconsistent `.tadori/tadori.sqlite` default behaviors**
  (EVIDENCE-BASELINE.md Section 7/8, ARCHITECTURE.md AD-004): `scripts/
  tadori.mts:15` defaults `dbPath = path.join(root, ".tadori",
  "tadori.sqlite")`, overridable via `--db`; `packages/mcp/src/cli.ts:10-33`
  requires `--db`/`--repo` explicitly with **no default** — throws
  `"Usage: tadori-mcp --db <sqlite-path> --repo <repository-root>"` if
  either is missing. **AD-004 resolves this**: the new unified `tadori`
  bin/dev-script follows `scripts/tadori.mts`'s default-path behavior; the
  MCP stdio CLI (`packages/mcp/src/cli.ts`) is explicitly left unchanged
  (it is the machine-facing MCP transport contract, out of this blueprint's
  scope — do not touch `packages/mcp/src/cli.ts`).
- **`IncrementalRepositoryIndexer` public surface** (`packages/indexer/src/
  incremental.ts:218-...`, verified): `constructor(db: Database, root:
  string, options?: IncrementalRepositoryIndexerOptions)`; `async
  initialize(): Promise<SnapshotHead>` (`incremental.ts:253-302` — reuses an
  existing `SnapshotHead` if `getSnapshotHead` finds one, else calls
  `indexRepositoryIntoStore`; on restart, compares
  `baselineCapture.workspaceHash` against the stored head's `workspace_hash`
  and the stored `analyzerVersion` against `ANALYZER_VERSION`, enqueuing a
  full rescan if either mismatches — **this is the exact "reuse or refresh"
  behavior CLI_CONTRACT.md step 3 requires, already built, no new code
  needed for the reuse/refresh/rebuild decision itself**); `state():
  IncrementalIndexerState` (`incremental.ts:304-315`); `isPathDirty(path):
  boolean`; `async refresh(changes): Promise<IncrementalIndexerState>`;
  `async waitForIdle(): Promise<void>`; `async stop(): Promise<void>`.
- **`ConcurrentRefreshController`** (`packages/mcp/src/concurrentRefresh.ts:
  52-219`) is the isolated worker-thread wrapper Week 6 already built for
  MCP stdio; `.start(db, repoRoot, {onError})` requires a file-backed DB
  (throws if `db.memory` — `concurrentRefresh.ts:69-71`). This is the exact
  worker AD-003 reuses for `tadori serve`'s background refresh — **no new
  process-management scheme is built by this blueprint.**
- **Teardown pattern to mirror**: `packages/mcp/src/cli.ts:46-61` — registers
  `stdin 'end'`, `SIGINT`, `SIGTERM`, `exit` handlers, all funneling into one
  idempotent `shutdown` function calling `runtime.close(status)` then
  `db.close()`. `packages/mcp/src/stdio.ts:66-107`'s `close()` order:
  finalize task → close server → `refresh.stop()`. This blueprint's
  teardown (§11 step 9, §12) generalizes that exact sequence to include the
  HTTP server and WS clients.
- `findTsconfig`/root-repo detection: `packages/indexer/src/project.ts:24-32`
  locates a root-level `tsconfig.json`; a repository with neither a
  `package.json` nor a `tsconfig.json` is the "unsupported repository" case
  CLI_CONTRACT.md step 1 requires an actionable failure for. No existing
  function centralizes "is this a supported repo root" — this blueprint adds
  a small check (§10) rather than reusing something that doesn't exist for
  this purpose.
- `.gitignore`/`.tadoriignore` loading: already fully handled inside
  `scanRepository` (`packages/indexer/src/scan.ts`) — union-applied per
  `.tadoriignore`'s own header comment ("Union-applied with .gitignore and
  built-in exclusions (frozen corrections §8)"). `tadori.rules.json` is
  **not yet read by any production code** (grep confirms no reader exists;
  09-03 owns boundary-rule *enforcement*, but this blueprint's step 2 must
  at least load/parse the file if present so future rule-consuming code has
  it available — see §6 non-goals for the exact boundary of what "load
  configuration" means here).
- **`.tadori/` already exists at repo root** (verified via directory
  listing) and is gitignored (`.gitignore` contains `.tadori/`) —
  confirms AD-004's default path is safe to create/use without touching
  version control.
- `package.json` scripts (`c:\SideProjects\Tadori\package.json:10-21`):
  existing `"tadori": "tsx scripts/tadori.mts"` script only implements
  `tadori diff <repo>`, not `serve`. This blueprint adds `pnpm tadori serve
  .` as a **new dev command** — see §8 decision on how the script dispatches
  between the legacy `diff` subcommand and the new `serve` subcommand
  without breaking the existing one.
- Files to read first: `docs/CLI_CONTRACT.md` (full), `scripts/tadori.mts`
  (33 lines, the closest existing analog), `packages/mcp/src/cli.ts` (the
  teardown pattern to mirror), `packages/indexer/src/incremental.ts:218-320`
  (indexer public surface), `packages/mcp/src/concurrentRefresh.ts` (worker
  reuse), `blueprints/07-01-server-graph-api.md` §9-§12 (the server contract
  this CLI wraps).
- Gotchas: `scripts/tadori.mts` imports `@tadori/indexer` via a **relative
  source path** (`../packages/indexer/src/index.ts`), not the package name,
  because it runs pre-build against source — the new `packages/cli` package
  must import via the normal `@tadori/*` package names (it is a real
  workspace package, not a root dev script) and must not repeat the
  relative-import pattern. `IncrementalRepositoryIndexer`'s `kind` option is
  typed `Extract<RepoStateKind, "working_tree">` — `tadori serve` always
  operates on `working_tree` snapshots except when `--snapshot <id>` pins to
  a specific stored one (see §10).

## 5. Scope

1. New `packages/cli` workspace package: `tadori` command with a `serve`
   subcommand implementing all 9 frozen steps in order.
2. Frozen flag parsing: `--port`, `--no-open`, `--reindex`, `--mode`,
   `--snapshot` — parsed exactly, with `--mode 2.5d`/`--mode 3d-experiment`
   failing with an honest "not implemented until Phase 10" error (those
   modes have no renderer yet; 08-02 ships 2D only, 10-01/10-02 ship the
   others).
3. Canonical `.tadori/tadori.sqlite` default path (AD-004), reconciling the
   `scripts/tadori.mts` vs `packages/mcp/src/cli.ts` inconsistency for this
   new unified entry point only (MCP stdio CLI is untouched).
4. `pnpm tadori serve .` dev-command wiring (extends the existing
   `package.json` `"tadori"` script to dispatch subcommands).
5. Teardown order on SIGINT/SIGTERM per ARCHITECTURE.md Section 5.
6. Exit codes (0/1/2/3/4) per ARCHITECTURE.md Section 5.
7. Minimal truthful status-page stub in place of the not-yet-built viz UI
   (08-02 replaces this; this blueprint's page must never claim to be a
   dashboard).
8. `bin` declaration is a **note only** — deferred to 12-03 (packaging).
   This blueprint's package has no `bin` field in `package.json` yet.

## 6. Non-goals

- **Not port-conflict fallback, browser-launch-failure recovery detail, or
  adversarial process-crash supervision** — those are 07-03's scope. This
  blueprint implements the happy-path port selection (`--port` if given,
  else OS-assigned) and the happy-path browser open, with the *contract*
  for failure behavior stated here (§17) but the *hardening test matrix*
  deferred to 07-03.
- **Not `tadori.rules.json` boundary-rule enforcement** (09-03's scope).
  This blueprint's "load configuration" step reads and JSON-parses the file
  if present (fail fast on malformed JSON, per CLI_CONTRACT step 1's
  "actionable message" spirit) but does not act on its contents — no
  boundary violation logic is written here.
- **Not the real visualization UI.** Step 6 serves a minimal truthful status
  page (repo root, snapshot id, mode, index state, a link to `/api/v1/
  snapshot`) — explicitly **not** a dashboard, not a placeholder graph
  render, not a progress spinner implying more than is true. 08-02 replaces
  this page wholesale.
- **Not the `bin` field / `npm pack` packaging** — 12-03 owns making
  `tadori` an installable global command. This blueprint's package is
  invoked via `pnpm --filter @tadori/cli exec tadori serve .` or the root
  `pnpm tadori serve .` dev-script wrapper only.
- **Not changes to `packages/mcp/src/cli.ts`** — that CLI stays exactly as
  is (explicit `--db`/`--repo`, no defaults); AD-004 explicitly rejects
  unifying it.
- **Not `--mode 2.5d`/`--mode 3d-experiment` rendering** — those modes are
  accepted as valid flag values (frozen contract requires the flag surface
  to exist) but fail at startup with a stated "not implemented until Phase
  10" error rather than silently falling back to 2D or crashing
  unexplained.

## 7. Dependencies and prerequisites

- **07-01** must have delivered `@tadori/server`'s `createServerApp(options):
  Promise<FastifyInstance>` and the `ServerAppOptions` shape (`{db, repoRoot,
  refresh}`) exactly as specified in `blueprints/07-01-server-graph-api.md`
  §10. This blueprint calls that function directly; it does not reimplement
  any HTTP route.
- **00-01A** must be `built`/`validated` — `tadori serve .` run against the
  Tadori repo itself (a natural manual smoke test and this blueprint's own
  dogfood check) contains root `.js` config files (`eslint.config.js`) and
  will crash during indexing without the allowJs scanner fix. This is a hard
  functional dependency for any repo containing JS files (which includes
  Tadori's own repo and most real-world user repos), not merely a soft one.

## 8. Architectural decisions

- **AD-003 applied as-is: one in-process Fastify server + the existing
  isolated `ConcurrentRefreshController` worker.** No second supervised
  process is spawned by this CLI. The CLI's own Node process hosts the
  Fastify server (via 07-01's `createServerApp`); the refresh
  worker-thread lives inside `ConcurrentRefreshController`, started and
  stopped by this CLI exactly as `stdio.ts` does for MCP. Rejected: a
  separate long-lived indexer child process supervised via `child_process`
  — duplicate machinery when the worker thread already provides isolation
  and has a clean, tested `stop()`.
- **AD-004 applied as-is: canonical `.tadori/tadori.sqlite` default.**
  `tadori serve <path>` resolves `dbPath = path.join(resolvedRoot, ".tadori",
  "tadori.sqlite")` unless a future `--db` override is added (not in the
  frozen flag list — **this blueprint does not add a `--db` flag**, since
  CLI_CONTRACT.md's frozen flag list has no `--db` entry; the default is
  the only path for `serve`). `mkdirSync(path.dirname(dbPath), {recursive:
  true})` before opening, mirroring `scripts/tadori.mts:18`. Rejected:
  requiring an explicit `--db` like `packages/mcp/src/cli.ts` — that CLI is
  machine-facing (a script invokes it with known paths); `tadori serve .` is
  human-facing and CLI_CONTRACT.md step 1 requires it to "just work" against
  a bare repository path.
- **`pnpm tadori serve .` dispatches through the existing root `"tadori"`
  script by making `scripts/tadori.mts` a thin subcommand router**: `args[0]
  === "diff"` keeps its exact current behavior (zero behavior change, same
  33-line flow, same usage string on missing args) and `args[0] === "serve"`
  delegates to `packages/cli`'s exported `runServe(argv)` function. Rejected:
  a second top-level `package.json` script (e.g. `"tadori:serve"`) — the
  frozen dev-command is explicitly `pnpm tadori serve .`
  (BACKLOG.md "Decisions locked 2026-07-15": "Dev command `pnpm tadori serve
  .`"), so the single `"tadori"` script must itself understand the `serve`
  subcommand; a second script name would not satisfy that exact invocation
  string. **`scripts/tadori.mts` modification is additive-only**: the
  existing `diff` branch's 8 steps (§ EVIDENCE-BASELINE Section 7) are
  copied into an `if (args[0] === "diff")` guard verbatim (no behavior
  change — same relative-source-path import pattern for `diff`, since it
  runs pre-build); a new `else if (args[0] === "serve")` branch imports
  `packages/cli/src/index.ts` (also via relative source path, consistent
  with the file's existing pre-build-execution pattern) and calls
  `runServe(args.slice(1))`.
- **`packages/cli`'s own internal imports use normal `@tadori/*` package
  names** (it is a real workspace member with its own `package.json`
  dependencies on `@tadori/store`, `@tadori/indexer`, `@tadori/server`,
  `@tadori/core`), unlike `scripts/tadori.mts`'s relative-source-path
  pattern which is specific to that root dev script running against
  unbuilt source. Rejected: making `packages/cli` also use relative source
  imports — it is a proper package and should resolve dependencies the same
  way every other package does (via `tsconfig.base.json` `paths` / pnpm
  workspace linking).
- **Repository-support check is a small new function**, `resolveRepoRoot
  (inputPath: string): {root: string} | {error: string}`, checking for
  either `package.json` or `tsconfig.json` at the resolved root (mirrors
  `findTsconfig`'s search semantics for "is there a tsconfig", extended with
  a `package.json` OR-check since a bare TS repo might have only one of the
  two). Rejected: requiring both files — over-strict, would reject valid
  repos that use only tsconfig or only package.json at the root; rejected:
  no check at all — CLI_CONTRACT.md step 1 explicitly requires "fail with an
  actionable message if the path is not a supported TypeScript/JavaScript
  repository," so *some* check is mandatory.
- **`--mode 2.5d`/`--mode 3d-experiment` are accepted by the flag parser
  (so the flag surface matches the frozen contract) but rejected at
  startup** with a stated error (`"Mode '2.5d' is not implemented until
  Phase 10 (10-01). Use --mode 2d."` / equivalent for `3d-experiment` citing
  10-02) — exit code 1. Rejected: silently falling back to `2d` — that
  would violate the principle that `tadori serve` must be honest about what
  it can do, and would make `--mode 3d-experiment` a silent no-op instead of
  a clear signal the feature doesn't exist yet. Rejected: making the flag
  parser itself reject unknown-to-Phase-7 mode values as a parse error
  indistinguishable from a genuinely invalid `--mode xyz` — the distinction
  matters (a real frozen mode not yet implemented vs. garbage input), so
  the "not implemented" message is a distinct, more specific error path
  than the generic bad-flag-value error.
- **Startup-facts printing is plain stdout text, not JSON** — CLI_CONTRACT.md
  step 8 says "print startup facts," and the human running `tadori serve .`
  in a terminal is the audience (contrast with `scripts/tadori.mts`'s `diff`
  output, which is JSON because it's meant to be piped/parsed). Rejected:
  JSON startup output — wrong audience for this specific command; a
  machine-readable variant can be added later behind an explicit flag if
  ever needed, not silently assumed here.
- **`bin` field deferred to 12-03, noted not implemented here.**
  `packages/cli/package.json` has no `"bin"` key in this blueprint; invoking
  the command during development is via the root `pnpm tadori serve .`
  script (§8 above) or `pnpm --filter @tadori/cli exec tsx src/cli.ts serve
  .` directly. Rejected: adding a stub `bin` field now — `npm pack`/`npx`
  behavior belongs entirely to 12-03's packaging blueprint, and a
  half-wired `bin` field with no corresponding build step would be
  misleading.

## 9. Exact file plan

- `packages/cli/package.json` — create. `name: "@tadori/cli"`,
  `type: "module"`, `main`/`types`: `./src/index.ts`. `dependencies`:
  `@tadori/core: workspace:*`, `@tadori/store: workspace:*`,
  `@tadori/indexer: workspace:*`, `@tadori/mcp: workspace:*`,
  `@tadori/server: workspace:*`, `open: "^10.x"` (cross-platform browser
  launcher — see §10 for allowlist justification), `simple-git` is **not**
  a direct dependency of this blueprint (no git operations are performed by
  `serve`; `simple-git` is reserved per the allowlist for 09-04's
  `changed_with` extraction). No `"bin"` field (§8).
- `packages/cli/src/index.ts` — create. Barrel: `export * from "./serve.js"`,
  `export * from "./flags.js"`.
- `packages/cli/src/flags.ts` — create. `parseServeFlags(argv: readonly
  string[]): ServeFlags | { error: string }` — the frozen-flag parser
  (§10).
- `packages/cli/src/repoResolve.ts` — create. `resolveRepoRoot(inputPath:
  string): {root: string} | {error: string}` (§8 decision).
- `packages/cli/src/config.ts` — create. `loadServeConfig(root: string):
  ServeConfig` — reads `tadori.rules.json` if present (JSON.parse, fail with
  actionable message on malformed JSON); records whether `.gitignore`/
  `.tadoriignore` exist (informational only — actual ignore application
  already happens inside `scanRepository`, not duplicated here).
- `packages/cli/src/statusPage.ts` — create. `renderStatusPage(facts:
  StartupFacts): string` — the minimal truthful HTML stub (§10).
- `packages/cli/src/serve.ts` — create. `runServe(argv: readonly string[]):
  Promise<number>` (returns the process exit code — the caller, `cli.ts` or
  `scripts/tadori.mts`'s `serve` branch, sets `process.exitCode`). Implements
  the full 9-step lifecycle (§11).
- `packages/cli/src/cli.ts` — create. Thin executable entry:
  `process.exitCode = await runServe(process.argv.slice(3))` guarded by a
  `args[2] === "serve"` dispatch (mirrors the eventual `bin` shape 12-03
  will wire, but invoked directly via `tsx` in this phase — no `bin` field
  yet per §8).
- `packages/cli/test/flags.test.ts` — create.
- `packages/cli/test/repoResolve.test.ts` — create.
- `packages/cli/test/config.test.ts` — create.
- `packages/cli/test/serve-lifecycle.test.ts` — create.
- `packages/cli/test/exit-codes.test.ts` — create.
- `scripts/tadori.mts` — modify. Wrap the existing `diff` flow in an
  `if (args[0] === "diff") { ...unchanged... } else if (args[0] === "serve")
  { ... }` dispatcher (§8); update the `usage()` string to
  `"Usage: tadori <diff|serve> <repository> [options]"`.
- `pnpm-workspace.yaml` — modify. Add `"packages/cli"` line.
- `tsconfig.json` — modify. Add `packages/cli/{src,test}/**/*.ts` to
  `include`.
- `tsconfig.base.json` — modify. Add `"@tadori/cli": ["packages/cli/src/index.ts"]`
  to `paths`.

## 10. Exact contracts

```ts
// packages/cli/src/flags.ts
export interface ServeFlags {
  port: number | null;          // null = OS-assigned (default)
  open: boolean;                 // default true; false when --no-open
  reindex: boolean;              // default false
  mode: "2d" | "2.5d" | "3d-experiment"; // default "2d"
  snapshotId: number | null;     // default null (serve active snapshot)
}
export function parseServeFlags(argv: readonly string[]):
  { ok: true; flags: ServeFlags } | { ok: false; error: string };
// Unknown flag -> {ok:false, error: `Unknown flag ${flag}`}
// --port with non-numeric value -> {ok:false, error: "--port requires a number"}
// --mode with a value outside the three literals -> {ok:false, error: `Unknown mode ${value}`}
// --snapshot with non-numeric value -> {ok:false, error: "--snapshot requires a numeric id"}
```

```ts
// packages/cli/src/repoResolve.ts
export function resolveRepoRoot(inputPath: string):
  { ok: true; root: string } | { ok: false; error: string };
// error message exact string when unsupported:
// "'<root>' is not a supported TypeScript/JavaScript repository (no package.json or tsconfig.json found at the repository root)."
```

```ts
// packages/cli/src/config.ts
export interface ServeConfig {
  root: string;
  hasGitignore: boolean;
  hasTadoriignore: boolean;
  rules: unknown | null;         // parsed tadori.rules.json contents, or null if absent
}
export function loadServeConfig(root: string): ServeConfig;
// Malformed tadori.rules.json throws:
// `Failed to parse tadori.rules.json: ${originalMessage}`
```

```ts
// packages/cli/src/serve.ts
export interface StartupFacts {
  repoRoot: string;
  dbPath: string;
  snapshotId: number;
  indexState: "fresh" | "refreshed" | "rebuilt" | "stale";
  mode: "2d";                    // only mode actually served in Phase 7
  port: number;
  url: string;
}
export async function runServe(argv: readonly string[]): Promise<number>;
// Exit codes:
//   0 clean shutdown (Ctrl+C after successful serve)
//   1 unexpected error
//   2 unsupported repository (resolveRepoRoot failed)
//   3 invalid/unservable snapshot with no valid fallback
//   4 port unavailable (only reachable when --port is explicit; see 07-03 for fallback-vs-explicit distinction)
```

```ts
// packages/cli/src/cli.ts (illustrative dispatcher shape; the real
// entry point is scripts/tadori.mts's "serve" branch during Phase 7)
export async function main(argv: readonly string[]): Promise<number>;
```

**Startup-facts print format** (exact, plain stdout, step 8):

```
Tadori serving <repoRoot>
  Snapshot:  #<snapshotId> (<indexState>)
  Mode:      <mode>
  URL:       <url>
Press Ctrl+C to stop.
```

**Status page** (`statusPage.ts`, served at `GET /` by the CLI wrapping
07-01's Fastify instance — NOT a 07-01 route, added by this blueprint on top
of the server instance returned by `createServerApp`): plain HTML, no JS
framework, states plainly: repo root, snapshot id + index state, mode,
a link to `/api/v1/snapshot`, and the sentence "The Tadori visualization UI
is not yet built (arrives in Phase 8, blueprint 08-02). This page reports
server status only." — explicitly not styled as a dashboard.

## 11. Ordered implementation procedure

1. `packages/cli/package.json` + workspace/tsconfig wiring (§9). Run
   `pnpm install`. Expected: `pnpm -w list --depth -1` shows `@tadori/cli`.
2. `packages/cli/src/flags.ts` + `flags.test.ts`. Tests: each frozen flag
   parses to the documented `ServeFlags` field; `--mode 2.5d` and `--mode
   3d-experiment` parse successfully (flag-level acceptance — the *runtime*
   rejection happens later, step 8); an unrecognized flag returns the exact
   `ok:false` error string. Expected: green, `pnpm typecheck` clean.
3. `packages/cli/src/repoResolve.ts` + `repoResolve.test.ts`. Tests: a temp
   dir with only `package.json` resolves ok; a temp dir with only
   `tsconfig.json` resolves ok; an empty temp dir returns the exact
   unsupported-repository error string (§10); a path that does not exist at
   all returns a distinct "path does not exist" error (not conflated with
   "unsupported repository").
4. `packages/cli/src/config.ts` + `config.test.ts`. Tests: a repo with a
   valid `tadori.rules.json` parses it into `rules`; a repo with none
   returns `rules: null`; a repo with malformed JSON throws the exact
   documented error message; `hasGitignore`/`hasTadoriignore` reflect actual
   file presence.
5. `packages/cli/src/statusPage.ts`. Test (folded into
   `serve-lifecycle.test.ts`, step 7): rendered HTML contains the repo root,
   snapshot id, mode, and the explicit "not yet built" sentence; does not
   contain the word "dashboard".
6. **Step-3/4 (reuse/refresh/rebuild + validate) implementation inside
   `serve.ts`**: `openDatabase(dbPath)` → `runMigrations(db)` →
   `new IncrementalRepositoryIndexer(db, root, {kind: "working_tree"})` →
   `await indexer.initialize()` (this call alone implements "reuse when
   fresh; incrementally refresh when stale; full index when incremental
   correctness cannot be proven" — Week 6's restart-reconciliation logic
   already does this, per §4 evidence, no new decision logic written here)
   → if `--reindex`, call `indexer.stop()` then re-run a **full**
   `indexRepositoryIntoStore` before proceeding (documented distinct path:
   `--reindex` forces a full rebuild rather than trusting the incremental
   reuse decision) → `foreignKeyCheck(db)` (validate step) → if the check
   finds violations, do **not** activate/serve; log the failure and keep the
   last valid snapshot (already active from a prior run) — if there is no
   prior valid snapshot at all, exit 3. If `--snapshot <id>` is given,
   `getSnapshot(db, id)` is validated (`findDanglingEndpoints` check) instead
   of the working-tree flow; an invalid or nonexistent `--snapshot` id exits
   3 with an actionable message naming the id.
7. `serve.ts` step-5/6/7 implementation: `ConcurrentRefreshController.start
   (db, root, {onError})` → `createServerApp({db, repoRoot: root, refresh})`
   (07-01) → register the status-page route on top of the returned
   `FastifyInstance` (`GET /` → `renderStatusPage`) → `app.listen({host:
   "127.0.0.1", port: flags.port ?? 0})` → read the bound port from
   `app.server.address().port` → build `url` → unless `flags.open === false`,
   call `open(url)` (the `open` package) — on rejection/throw, catch it and
   print `"Could not open a browser automatically. Open ${url} manually."`
   to stderr, **do not exit non-zero for this** (frozen: browser-launch
   failure is reported, not fatal). New file:
   `packages/cli/test/serve-lifecycle.test.ts` — tests: full lifecycle
   against a fixture repo temp copy (reuse `packages/fixtures/01-core-symbols`)
   completes steps 1-7 and the server responds 200 to
   `fastify.inject`-equivalent `fetch(url + "/api/v1/snapshot")`; a fixture
   repo passed with `--reindex` re-runs a full index (assert
   `indexResult.reused === false`... or the equivalent full-rebuild signal);
   a stubbed `open()` (dependency-injected or mocked) failure does not throw
   out of `runServe` and does not set a non-zero exit code.
8. `serve.ts` step-8 (startup facts) + `--mode` runtime rejection: print the
   exact format (§10); if `flags.mode !== "2d"`, print the "not implemented
   until Phase 10" error (citing 10-01 for `2.5d`, 10-02 for
   `3d-experiment`) to stderr and return exit code `1` **before** starting
   the server (fail fast, no partial server startup for an unservable mode).
   Test in `serve-lifecycle.test.ts`: `--mode 2.5d` returns exit code 1 and
   the exact cited-blueprint error text; no server is left listening
   afterward (assert no lingering handle / the returned promise resolves
   before any `listen` call was made — verified by asserting `createServerApp`
   was never invoked in this path, via a spy).
9. `serve.ts` step-9 (teardown): register `SIGINT`/`SIGTERM` handlers (once
   each) implementing the exact order from §12; the handler calls
   `process.exit(0)` only after all cleanup promises settle. New test file:
   `exit-codes.test.ts` — invokes `runServe` in a child process (or an
   in-process simulation via directly calling the internal teardown
   function without a real `process.exit`, whichever the builder judges
   more reliable in CI) and asserts: SIGINT triggers the documented order
   (server stops accepting new connections before `refresh.stop()` resolves
   — assert via call-order spies, not wall-clock timing); double SIGINT
   does not double-run teardown (idempotency, mirroring `cli.ts`'s
   `shuttingDown` guard pattern); process exits 0 after clean teardown.
10. `scripts/tadori.mts` dispatcher update (§8/§9). Test: manual/documented
    validation only (this file has no existing test file and this blueprint
    does not add one solely for the dispatcher — its `diff` branch is
    already covered by `packages/indexer/test/diff-working-tree.test.ts`
    exercising the underlying function; the dispatcher wiring itself is
    validated by the `pnpm tadori serve .` and `pnpm tadori diff .` manual
    validation commands in §15). Expected: `pnpm tadori diff .` behavior is
    byte-for-byte unchanged; `pnpm tadori serve .` invokes `runServe`.
11. Full validation pass (§15), including a manual `pnpm tadori serve .`
    smoke run against the Tadori repo itself (requires 00-01A already
    landed), Ctrl+C, confirm clean exit. Commit.

## 12. Data and lifecycle flows

**Startup** (the 9 steps, restated as data flow): `argv` → `parseServeFlags`
→ `resolveRepoRoot` (exit 2 on failure) → `loadServeConfig` → `openDatabase`
+ `runMigrations` → `IncrementalRepositoryIndexer.initialize()` (reuse/
refresh/rebuild decision made internally) → `foreignKeyCheck` +
dangling-endpoint validation (exit 3 on failure with no fallback) →
`ConcurrentRefreshController.start` → `createServerApp` (07-01) →
status-page route added → `app.listen(127.0.0.1, port)` → `open(url)`
(non-fatal on failure) → startup facts printed → process idles serving
requests until a signal arrives.

**Operation**: identical to 07-01 §12's steady-state — this blueprint's
process is simply the host for that server plus the extra `/` status route
and the flag-driven startup decisions.

**Refresh** (background, driven by the watcher inside
`ConcurrentRefreshController`'s worker thread — no CLI-level polling):
file change detected → worker computes affected region → publishes new
snapshot generation → server's `GraphState` (07-01) picks up the rotation
and broadcasts `snapshot_replaced` — this CLI blueprint does not intervene
in that flow at all; it only started the controller and will stop it on
teardown.

**Failure (validation fails, no prior valid snapshot)**: `initialize()`/
`foreignKeyCheck` finds a problem, no previously-active snapshot exists to
fall back to → print an actionable message naming the specific validation
failure → exit 3 → no server is started (CLI_CONTRACT.md: "the last valid
snapshot remains served instead" implies a fallback must exist; if none
does, failing closed with exit 3 is the only honest option, not serving a
known-broken snapshot).

**Shutdown (Ctrl+C / SIGINT / SIGTERM)**, exact order (ARCHITECTURE.md
Section 5, restated as this blueprint's implementation): (1) stop accepting
new HTTP/WS connections (`server.close()`'s built-in "reject new, drain
existing" semantics, or an explicit `app.server.closeAllConnections`-style
call if the builder finds Fastify's default drain too slow for a fast
Ctrl+C — record the exact choice in §21); (2) close active WS clients
(iterate connected sockets, send a close frame); (3) `await refresh.stop()`
(terminates the worker thread — reuses `ConcurrentRefreshController.stop()`
verbatim, already tested by Week 6); (4) `await app.close()` (Fastify
instance close); (5) `db.close()`; (6) `process.exit(0)`. This mirrors
`packages/mcp/src/stdio.ts`'s `close()` order (finalize → close server →
`refresh.stop()`) with the HTTP-specific steps (1)-(2) inserted ahead of it
because this process, unlike stdio, has live network clients to drain
first.

## 13. Test plan

- Unit: `flags.test.ts`, `repoResolve.test.ts`, `config.test.ts` — pure
  function tests, no I/O beyond temp-dir fixtures (see §11 steps 2-4 for
  exact assertions).
- Integration: `serve-lifecycle.test.ts` — full 9-step flow against a
  fixture-repo temp copy, using port `0` (OS-assigned) to avoid port
  conflicts in CI; asserts HTTP responses from the live server, status-page
  content, `--reindex` behavior, `--mode` rejection, browser-open
  non-fatal-failure behavior (§11 steps 6-8).
- Lifecycle/process: `exit-codes.test.ts` — teardown order and exit code
  assertions (§11 step 9).
- Adversarial (folded into the above files, not separate): empty directory
  as repo path (exit 2); malformed `tadori.rules.json` (actionable error,
  exit 1); `--snapshot <nonexistent-id>` (exit 3); double Ctrl+C
  (idempotent teardown, no crash).
- Regression: full existing suite (`pnpm test`) stays green — no existing
  package source is modified except the additive `scripts/tadori.mts`
  dispatcher wrapper, which must not change `diff`'s existing tested
  behavior (verified by `packages/indexer/test/diff-working-tree.test.ts`
  continuing to pass, since it exercises the function `scripts/tadori.mts`
  calls, and by a manual `pnpm tadori diff .` run producing identical
  output shape to before this change).
- Manual/adversarial-by-hand (documented in §21, not automated): `pnpm
  tadori serve .` against the Tadori repo itself, Ctrl+C after confirming
  the browser opened and the status page rendered — this is the closest
  thing to an end-to-end dogfood check and depends on 00-01A being landed.

## 14. Acceptance criteria

- [ ] `packages/cli` builds: `pnpm typecheck` exits 0 including the new
      package.
- [ ] `pnpm -w list --depth -1` includes `@tadori/cli`.
- [ ] All 9 CLI_CONTRACT.md steps are implemented in the documented order
      (verified by `serve-lifecycle.test.ts` asserting call/completion
      order via spies, not just end-state).
- [ ] All 5 frozen flags parse exactly as specified in §10; `--mode 2.5d`
      and `--mode 3d-experiment` are accepted by the parser but cause
      `runServe` to return exit code 1 with an error message citing the
      correct owning blueprint (10-01/10-02) before any server starts.
- [ ] Default DB path is `<root>/.tadori/tadori.sqlite`, created via
      `mkdirSync(recursive: true)` if absent; no `--db` flag exists on this
      command (it is not in the frozen flag list).
- [ ] `packages/mcp/src/cli.ts` is byte-identical to its pre-blueprint state
      (git diff shows zero changes to that file) — AD-004 explicitly does
      not touch the MCP stdio CLI.
- [ ] `pnpm tadori diff .` produces identical output shape to its
      pre-blueprint behavior (the dispatcher wrapper is transparent to the
      existing subcommand).
- [ ] `pnpm tadori serve .` is a valid invocation of the new subcommand
      (documented dev-command wiring works).
- [ ] Ctrl+C (SIGINT) during an active serve session exits with code 0 and,
      per the teardown order, `refresh.stop()` resolves before `db.close()`
      is called (assertable via spy call order in `exit-codes.test.ts`).
- [ ] An unsupported repository path (no `package.json`/`tsconfig.json`)
      exits 2 with the exact error string from §10.
- [ ] An invalid/nonexistent `--snapshot <id>` exits 3 with an actionable
      message naming the id.
- [ ] A stubbed browser-launch failure does not change the exit code and
      prints the URL to stderr (frozen: non-fatal).
- [ ] Status page HTML contains no occurrence of the word "dashboard" and
      explicitly states the real viz UI is not yet built.
- [ ] Full existing suite stays green: `pnpm test`, plus this blueprint's
      new tests, zero failures. 5/5 golden fixtures still PASS.

## 15. Validation commands

pnpm install; pnpm skills:check; pnpm typecheck; pnpm lint; pnpm test;
python validate_fixtures.py; pnpm fixtures:validate; pnpm fixtures:index;
pnpm fixtures:typecheck; pnpm benchmark:incremental; pnpm tadori diff .;
pnpm tadori serve . (manual smoke: confirm startup facts print, browser
opens or reports URL, Ctrl+C exits 0 — requires 00-01A landed); git diff
--check; git status --short

## 16. Performance budgets

- End-to-end `tadori serve .` time-to-listening (steps 1-5, excluding
  browser-open and human Ctrl+C wait) on the 250k-LOC benchmark corpus,
  **when the snapshot is already fresh (no reindex needed)**: no numeric
  gate is invented here beyond the existing `IncrementalRepositoryIndexer`
  gates already validated by `pnpm benchmark:incremental` (single-file p95
  < 2000 ms, package-invalidation < 10000 ms) — this blueprint adds no new
  indexing-performance work, only the lifecycle wrapper around already-gated
  code, so it inherits those gates rather than restating a new number.
- `createServerApp` + `app.listen` startup overhead itself is covered by
  07-01's own performance budget (its route-level `/nodes` p95 < 200 ms
  budget); this blueprint's lifecycle adds negligible fixed overhead
  (flag parsing, config load, `mkdirSync`) that is not separately budgeted.

## 17. Failure and recovery behavior

- Unsupported repository (no `package.json`/`tsconfig.json`): exit 2, exact
  message per §10, no DB is created, no server starts.
- Malformed `tadori.rules.json`: exit 1, message
  `"Failed to parse tadori.rules.json: <original error>"`.
- Invalid snapshot / foreign-key or dangling-endpoint violation with **no**
  prior valid snapshot to fall back to: exit 3, actionable message naming
  the specific check that failed; no server starts (fail closed — never
  serve a known-invalid snapshot, per the frozen non-negotiable).
- Invalid snapshot **with** a prior valid snapshot available: log the
  refresh failure to stderr, continue serving the last valid snapshot (this
  is the "last valid snapshot remains served instead" contract line) — the
  server does start in this case, with `context.stale: true` surfaced by
  07-01's routes.
- Invalid/nonexistent `--snapshot <id>`: exit 3, message naming the id and
  the specific validation failure (unknown id vs. dangling-endpoint
  failure are distinguished in the message text).
- Port unavailable **when `--port` is explicit**: this blueprint's
  happy-path behavior is to let the OS `EADDRINUSE` error surface as exit 4
  with the underlying error message; **the exact retry/fallback algorithm
  and the distinction between explicit-port-fails-hard vs.
  default-port-tries-OS-fallback is 07-03's scope** — this blueprint does
  not implement fallback logic, only the plain "attempt to listen, exit 4
  on failure" path, explicitly deferred (see §1 dependency note and
  07-03's own header).
- Browser-launch failure: caught, printed to stderr with the URL, exit code
  unaffected (non-fatal, frozen contract step 7).
- SIGINT/SIGTERM during an in-flight refresh: `refresh.stop()` is awaited as
  part of teardown regardless of the worker's current phase (`refreshing`,
  `dirty`, etc.) — `ConcurrentRefreshController.stop()` already handles this
  (sends a `{type: "stop"}` message and awaits `"stopped"`/`"fatal"`/exit,
  per `concurrentRefresh.ts:172-218`, already tested by Week 6). This
  blueprint does not add new worker-crash-mid-refresh test coverage — that
  adversarial scenario (kill -9 the worker mid-refresh) is explicitly
  07-03's scope.
- Double signal (SIGINT then SIGINT again before teardown completes):
  idempotent — the second signal is a no-op (mirrors `packages/mcp/src/
  cli.ts`'s `shuttingDown` boolean guard).

## 18. Security and privacy

- No new I/O beyond the repository root's own files (config loading,
  indexing) and the `.tadori/` directory it creates within that root —
  no writes outside repo confinement.
- Server bind is `127.0.0.1` only (inherited from 07-01's `createServerApp`;
  this blueprint passes no host override).
- Browser is opened only to the localhost URL this process itself is
  serving — never to an external or user-supplied URL.
- `tadori.rules.json` is parsed but not executed/evaluated as code (plain
  `JSON.parse`, no `eval`, no dynamic `require`).
- `.tadori/tadori.sqlite` is created with default OS file permissions
  inside the user's own repository; no new permission model is introduced.

## 19. Accessibility

Not applicable to the CLI process itself (terminal I/O + a browser launch).
The minimal status page (§10) is plain semantic HTML (no framework, no
custom widgets) — a `<h1>`/`<dl>`/`<a>` structure is sufficient; full
accessibility rigor (WCAG AA, keyboard nav for interactive elements) applies
starting at 08-02 once the page has interactive UI. This blueprint's status
page has no interactive elements beyond one link, so no additional a11y
test is added here.

## 20. Documentation updates

None outside `blueprints/`. `docs/CLI_CONTRACT.md` is not modified — this
blueprint implements it, does not amend it. Any future flag or step change
would require a separate frozen-contract amendment, out of scope here.

## 21. Builder final report

Require: summary; files changed (full list per §9, including the exact
diff shape of `scripts/tadori.mts`'s dispatcher wrapper); contracts
implemented (9-step checklist + 5-flag checklist, pass/fail each); tests
added (file names + count); validation command output summary (§15);
manual `pnpm tadori serve .` smoke-test transcript/description (startup
facts printed, browser behavior observed, Ctrl+C exit code); the exact
connection-drain mechanism chosen for teardown step (1) (§12); commit SHA;
`ASSUMPTION:` lines; explicit confirmation `packages/mcp/src/cli.ts` is
untouched.

## 22. Independent review result

- Status: review. §22 content: **Pending Wave 1 adversarial review.**

## IF SOMETHING IS UNCLEAR

Smallest safe assumption + `ASSUMPTION:` line. If an uncertainty could mean
serving an invalid snapshot, silently falling back on an unimplemented
`--mode`, or leaving an orphan process/worker after Ctrl+C, stop and report
blocked instead of guessing.

## TADORI NON-NEGOTIABLES

Frozen v2.1; TS/JS only; exactly six MCP tools (unaffected by this
blueprint); stable 2D default (`--mode 2d` is the only mode actually served
in Phase 7); no generic admin dashboard (the status page explicitly is not
one); invalid snapshots never served; `tadori serve .` is the normal
command; localhost default; no cloud dependency; Graphify is ignored
reference only; no seventh tool; no runtime tracing.
