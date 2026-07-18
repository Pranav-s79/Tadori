# BLUEPRINT 00-01A: allowJs scanner contract & regression

## 1. Header

- ID / Title / Phase: 00-01A — allowJs scanner contract & regression — Phase 0
- Status: ready (adversarially reviewed 2026-07-17; corrections applied — see §22)
- Primary builder: Claude Sonnet — single-file root-cause fix with a precise
  test matrix; no architectural latitude.
- Reviewer roles: Spec Guardian (fixture/scope), Test Adversary (regression
  matrix), Implementation Reviewer (blast radius).
- Complexity: S (one short builder session)
- Depends on: — (independent; first implementation item of Wave 0)
- Unlocks: 00-01 completion (README `pnpm tadori diff .` claim), 07-02
  (`tadori serve .` must index arbitrary user repos, which commonly contain
  root JS config files).
- Estimated sessions: 1
- Related frozen-spec sections: indexer scan/classification contract;
  IMPLEMENTATION_STATUS.md "Completed capabilities" — "allowJs-gated
  JavaScript support" (the documented behavior this fix restores).

## 2. Objective

`scanRepository` classifies `.js/.jsx/.mjs/.cjs` files as indexed **only**
when the repository's effective TypeScript configuration enables JavaScript
(`allowJs` or `checkJs`); otherwise they are support files (still captured
and hashed). `pnpm tadori diff .` completes successfully on Tadori's own
repository.

## 3. Why this matters

- User value: any real-world TS repo with a root `eslint.config.js`,
  `prettier.config.js`, etc. currently **crashes** the indexer
  (`Could not find source file`). This blocks `tadori diff .`, and would
  block `tadori serve .` (07-02) on most user repositories.
- System value: restores the documented "allowJs-gated JavaScript support"
  contract; removes a class of scan-vs-program inconsistency.
- Downstream: 00-01's README verification, Phase 7 serve flow, Phase 11
  benchmark corpora (which may contain JS config files).

## 4. Current repository evidence

Verified current (2026-07-17):

- Defect site: `packages/indexer/src/scan.ts` — `classifyFile` returns
  `{ indexed: true, language: "javascript" }` unconditionally for
  `JS_EXTENSIONS` (lines ~114-116). `scanRepository(root)` (line 127) never
  reads any tsconfig.
- Correct gates that expose the mismatch:
  `packages/indexer/src/project.ts` — `createProjectServices` computes
  `allowJs = compilerOptions.allowJs === true || compilerOptions.checkJs ===
  true` and filters JS program roots via `programCompatible` (lines
  ~232-241); `IncrementalProjectServices.computeRootFileNames` repeats the
  gate (lines ~354-363). `parseTsconfig` (lines ~174-205) resolves the
  `extends` chain via `ts.parseJsonConfigFileContent`.
- Crash path: `indexRepository` → `rejectSyntacticallyInvalidRepository`
  (`packages/indexer/src/indexRepository.ts:32-50`) iterates
  `scan.indexedFiles` (ts|js) and calls
  `languageService.getSyntacticDiagnostics(file.absolutePath)`; TypeScript
  throws `Could not find source file` for a file absent from the program.
- Reproduction: `pnpm tadori diff .` at the repo root — crashes on
  `eslint.config.js` (root `tsconfig.base.json` sets no `allowJs`;
  `tsconfig.json` lists `eslint.config.js` in `include`, which tsc silently
  skips without allowJs — `pnpm typecheck` passes).
- Blast radius (grep 2026-07-17): `scanRepository` callers —
  `indexRepository.ts:84` (captureRepository), `mcp/service.ts:264`
  (freshness re-scan). `ScanResult.indexedFiles` consumers —
  `indexRepository.ts:37,86,118`; `incremental.ts:142,187,651,659,727`;
  `extract.ts:241,243,260,284`; `mcp/service.ts:265`. Workspace hashing and
  MCP freshness always use the **union** `[...indexedFiles,
  ...supportFiles]` (`indexRepository.ts:86`, `incremental.ts:187`,
  `service.ts:265`), so a reclassification that keeps the union constant
  does not change workspace hashes.
- Fixtures: all five fixture repositories are pure TypeScript (no `.js`
  source), so golden expectations are unaffected. Harness `indexedFiles`
  contract: `packages/harness/src/compare.ts:205-215`.
- No pre-existing snapshot compatibility issue: repositories with JS files
  and no allowJs could never produce a snapshot (they crashed); allowJs-on
  repositories keep identical behavior.

Files to read first: `packages/indexer/src/scan.ts`,
`packages/indexer/src/project.ts` (parseTsconfig + both gates),
`packages/indexer/src/indexRepository.ts`,
`packages/indexer/test/` (existing scan/coordinator tests for style).

Gotchas: `.gitattributes` forces LF; run everything through pnpm (Node 22
pin); `mcp/service.ts` re-scans on a hot path — keep the added tsconfig
parse cheap (single parse per `scanRepository` call, no per-file work).

## 5. Scope

1. `scanRepository(root)` resolves the effective root compiler options once
   per scan (same `extends`-resolved semantics as `project.ts`
   `parseTsconfig`, live-disk variant) and derives
   `allowJs = options.allowJs === true || options.checkJs === true`;
   missing/unparsable tsconfig → `allowJs = false` (matching
   `DEFAULT_OPTIONS` in `project.ts`, which sets neither flag).
2. JS classification becomes `{ indexed: allowJs, language: "javascript" }`.
   Gated-off JS files land in `supportFiles` — still captured, hashed, and
   part of the workspace hash; an edit to them still invalidates.
3. Regression test matrix (see §13).
4. `IMPLEMENTATION_STATUS.md` defect record updated (discovered 2026-07-17,
   fixed with commit SHA); INDEX/BACKLOG status flips.

## 6. Non-goals

- No change to `project.ts` gates (they stay as defense in depth).
- No nested/workspace tsconfig discovery (root-level only — existing
  documented limitation).
- No full `.gitignore` grammar work; no new node kinds/relations; no fixture
  or schema edits; no store/mcp source changes.
- Not the README push/main-sync step (that is 00-01's remainder).

## 7. Dependencies and prerequisites

None. First item of implementation Wave 0.

## 8. Architectural decisions

- **Fix in the scan, not the callers.** The scan is the single source of the
  indexed/support split all consumers route through; guarding in
  `rejectSyntacticallyInvalidRepository` alone would leave `extract.ts` file
  nodes and LS-root mismatches alive. Rejected: catching the TS exception
  (symptom patch); filtering in each consumer (N places, drift-prone).
- **`scanRepository` signature unchanged** (`(root: string)`), so zero
  caller edits. It performs its own tsconfig read on live disk. Rejected:
  threading an `allowJs` parameter through three call sites (API churn, and
  `service.ts` would need its own parse anyway).
- **Reuse `project.ts` parsing semantics.** Export the existing
  `extends`-resolving parse from `project.ts` (small named export, e.g.
  `resolveRootCompilerOptions(root): ts.CompilerOptions`) and call it from
  `scan.ts`, so scan and program can never diverge on tsconfig
  interpretation. Rejected: naive `JSON.parse` of tsconfig in scan.ts
  (breaks on `extends` — the exact class of bug being fixed).
- **Gated-off JS = support, not invisible.** Keeps the captured union (and
  therefore workspace hashes, freshness checks, and full-invalidation
  behavior) identical; deleting them from the scan would silently change
  hashes and stale detection. Determinism: classification depends only on
  captured tsconfig content, part of the generation capture; tsconfig
  changes already force full rebuild in the incremental coordinator.
- Failure semantics: unreadable/malformed tsconfig during scan follows
  `parseTsconfig`'s existing error behavior (fatal parse errors throw — the
  repository is unsupported, matching current project-services behavior).
- `files`-listed JS entries are gated identically to `include`-derived ones:
  `ts.parseJsonConfigFileContent` merges `files` and `include` into
  `parsed.fileNames` before the `programCompatible`/`compatible` filters
  run, so the allowJs gate applies uniformly. No separate test required;
  the builder notes this verification in the final report.

## 9. Exact file plan

- `packages/indexer/src/scan.ts` — modify. Import the exported options
  resolver from `./project.js`; compute `allowJs` once in `scanRepository`;
  pass it to `classifyFile`. Exports unchanged (`scanRepository`,
  `ScanResult`, `ScannedFile`).
- `packages/indexer/src/project.ts` — modify (additive export only):
  `export function resolveRootCompilerOptions(root: string):
  ts.CompilerOptions` wrapping `findTsconfig` + `parseTsconfig` (live-disk,
  no captured texts); returns `{ ...DEFAULT_OPTIONS }` when no tsconfig.
  CRITICAL: call `findTsconfig(root)` and `parseTsconfig(root, tsconfigPath)`
  with the second (`capturedTexts`) argument **omitted entirely — not an
  empty Map**. `createCapturedFileSystem` branches on `!capturedTexts`
  (project.ts:77); a supplied empty Map takes the captured branch, making
  every repo file (including the tsconfig) invisible, which would silently
  gate allowJs off on every scan — inverting the fix. Test (c) fails loudly
  on this wrong implementation (see §13). Existing exports untouched.
- `packages/indexer/test/scan-allowjs.test.ts` — create. Temp-repo matrix
  below.
- `IMPLEMENTATION_STATUS.md` — modify: move the defect from "Discovered
  defects: none outstanding" to a dated fixed-defect record.
- `blueprints/INDEX.md`, `BACKLOG.md` — status flips.

## 10. Exact contracts

```ts
// project.ts (new export; wraps existing internals)
// MUST invoke findTsconfig(root) / parseTsconfig(root, path) with the
// capturedTexts argument omitted (live ts.sys branch). Never pass a Map.
export function resolveRootCompilerOptions(root: string): ts.CompilerOptions;

// scan.ts (internal change; public types unchanged)
function classifyFile(
  root: string,
  absolutePath: string,
  allowJs: boolean
): { indexed: boolean; language: ScannedFile["language"] };
// JS_EXTENSIONS → { indexed: allowJs, language: "javascript" }
```

Error behavior: `scanRepository` throws the existing
`Failed to parse <tsconfig>` error for fatally malformed tsconfig (identical
message shape to `parseTsconfig`).

## 11. Ordered implementation procedure

1. `packages/indexer/test/scan-allowjs.test.ts`: write failing tests (a)–(f)
   from §13 (temp dirs via the repo's existing test tmp helpers; each test
   writes its own tsconfig/files). Run `pnpm test` — new tests fail with the
   current crash/classification; 170 existing tests still pass.
2. `packages/indexer/src/project.ts`: add `resolveRootCompilerOptions`
   (live-disk wrapper over `findTsconfig` + `parseTsconfig`; returns
   `{ ...DEFAULT_OPTIONS }` when `findTsconfig` yields null). Reason: one
   shared tsconfig interpretation. Typecheck passes.
3. `packages/indexer/src/scan.ts`: compute `allowJs` in `scanRepository`
   via the new export; thread it into `classifyFile`; JS branch returns
   `indexed: allowJs`. Reason: root-cause gate. Tests (a)–(f) go green.
4. Run the full gate (§15) including `pnpm tadori diff .` on the Tadori repo
   (must exit 0 and print a diff summary) and
   `echo "" | pnpm mcp:stdio --db .tadori/tadori.sqlite --repo .` (starts,
   clean EOF shutdown, exit 0) — completing 00-01's outstanding README
   command verification for these two commands.
5. Update `IMPLEMENTATION_STATUS.md` (defect record + validation evidence),
   `blueprints/INDEX.md` (00-01A → built/validated; 00-01 unblocked),
   `BACKLOG.md`. Commit:
   `fix(indexer): gate JavaScript scan classification on effective allowJs`.

## 12. Data and lifecycle flows

Scan (per capture): resolve tsconfig once → walk tree → classify with
`allowJs` → indexed/support split → capture hashes union (unchanged).
Incremental: tsconfig edit → captured configuration input changes → existing
full-rebuild fallback (unchanged, already tested). Gated-off JS edit →
support-file hash change → generation supersedes → refresh (test g).

## 13. Test plan

`packages/indexer/test/scan-allowjs.test.ts` (unit/integration, temp repos):

- (a) no-allowJs tsconfig + `tool.config.js` + `src/a.ts`, where the
  tsconfig's `include` array contains a glob that MATCHES the JS file
  (e.g. `["src/**/*.ts", "**/*.js"]`) — reproducing the exact shape of the
  original bug (JS file nominally included by tsconfig glob, still excluded
  from the program by allowJs) → `scanRepository`: JS file in `supportFiles`
  with `indexed: false`; `indexRepository` completes; no file node for the
  JS file; workspace-hash input union still contains the JS path.
- (b) `allowJs: true` → a `.js` file (exactly `.js` in this test) in
  `indexedFiles`; file node exists; a function declared in the JS file
  becomes a function node.
- (b2) scan-level classification parity for the sibling extensions: with
  allowJs on, `.jsx`, `.mjs`, `.cjs` files land in `indexedFiles`; with
  allowJs off they land in `supportFiles` (membership assertions only — all
  four extensions share the single `JS_EXTENSIONS` gate at scan.ts:35, so
  full extraction assertions are not duplicated per extension).
- (c) `extends` chain: `allowJs: true` only in the extended base → gate
  resolves true (regression against naive JSON reads). This test also fails
  loudly if `resolveRootCompilerOptions` wrongly passes an empty Map as
  `capturedTexts` (the captured branch would hide the tsconfig →
  DEFAULT_OPTIONS → allowJs false → assertion failure).
- (d) `checkJs: true` without `allowJs` → treated as JS-enabled (parity with
  `project.ts`).
- (e) no tsconfig at all → JS gated off; `indexRepository` completes.
- (f) `.d.ts` classification unchanged (`indexed: false`,
  language `typescript`).
- (g) incremental: with allowJs off, editing the support JS file triggers a
  successful refresh (no crash, publishes or supersedes deterministically) —
  extend the existing coordinator test pattern in
  `packages/indexer/test/incremental-refresh.test.ts` style.

Adversarial/regression: `pnpm tadori diff .` on the Tadori repository itself
(validation command, not a unit test — environment-dependent). Full existing
suite: 170 tests + 5/5 fixtures must stay green (fixtures are TS-only; any
fixture delta = frozen-contract violation → stop).

## 14. Acceptance criteria

- [ ] `pnpm tadori diff .` exits 0 at the Tadori repo root and prints a diff
      summary.
- [ ] Tests (a)–(g) plus (b2) pass; full suite = exactly 170 existing + the
      new tests in `scan-allowjs.test.ts` (8 per §13), 0 failures. Any test
      beyond the §13 matrix is permitted only if named and justified in the
      builder's final report.
- [ ] 5/5 fixtures PASS with zero missing/unexpected/mismatched entities and
      zero dangling endpoints / FK rows.
- [ ] `echo "" | pnpm mcp:stdio --db .tadori/tadori.sqlite --repo .` exits 0
      after clean EOF shutdown.
- [ ] `pnpm benchmark:incremental` gates still pass (single-file p95
      < 2000 ms on the benchmark corpus).
- [ ] No public API signature changed except the additive
      `resolveRootCompilerOptions` export.
- [ ] `IMPLEMENTATION_STATUS.md` records the defect + fix with commit SHA.

## 15. Validation commands

pnpm skills:check; pnpm typecheck; pnpm lint; pnpm test;
python validate_fixtures.py; pnpm fixtures:validate; pnpm fixtures:index;
pnpm fixtures:typecheck; pnpm benchmark:incremental; pnpm tadori diff .;
echo "" | pnpm mcp:stdio --db .tadori/tadori.sqlite --repo .;
git diff --check; git status --short

## 16. Performance budgets

One tsconfig read+parse per `scanRepository` call (including the
`mcp/service.ts` freshness path): added cost must stay under 10 ms on the
benchmark corpus machine; incremental p95 gate (< 2000 ms) must not regress.

## 17. Failure and recovery behavior

Malformed tsconfig → existing `Failed to parse` error (repository
unsupported; no partial snapshot). Missing tsconfig → JS gated off,
TypeScript-only indexing proceeds. No other failure surface changes.

## 18. Security and privacy

No new I/O beyond reading the repository's own tsconfig (already inside
root confinement). No network, no new paths.

## 19. Accessibility

Not applicable (no human-facing surface).

## 20. Documentation updates

`IMPLEMENTATION_STATUS.md` (defect record + validation evidence);
`blueprints/INDEX.md`; `BACKLOG.md`. README needs no change — the fix makes
its existing claims true.

## 21. Builder final report

Summary; files changed; new export; tests added (names + count); full
validation output summary (test count, fixture PASS lines, tadori diff exit,
stdio check, benchmark gates); commit SHA; `ASSUMPTION:` lines; explicit
statement whether 00-01 is now unblocked.

## 22. Independent review result

- 2026-07-17 Program Architect (root-cause diagnosis + blast-radius grep):
  fix location and union-invariance argument verified against live code.
- 2026-07-17 Blueprint Adversarial Reviewer
  (`blueprints/reviews/wave1-phase0-review.md`): 0 blockers, 2 high
  (H-1 capturedTexts-omission ambiguity; H-2 test matrix missing the exact
  include-glob bug shape), 3 medium. All verified factual claims held
  against live code. Corrections applied 2026-07-17 by Program Architect:
  §9/§10 omission contract + wrong-implementation failure path in test (c);
  test (a) include-glob requirement; test (b)/(b2) extension coverage;
  §8 files-array note; §14 exact test accounting. Final review status:
  PASS conditions met → **ready**.

## IF SOMETHING IS UNCLEAR

Smallest safe assumption + `ASSUMPTION:` line; if any fixture comparison
changes, stop — that is a frozen-contract violation, not an implementation
detail.

## TADORI NON-NEGOTIABLES

Frozen v2.1; TS/JS only; exactly six MCP tools; never weaken golden
fixtures; deterministic output; evidence/origin/confidence/resolution
honest; invalid snapshots never served; localhost only; no runtime tracing;
Graphify ignored reference only.
