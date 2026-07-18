# Wave 1 / Phase 0 Adversarial Blueprint Review

Reviewer: Blueprint Adversarial Reviewer (cold-implementer stance).
Reviewed against: `_TEMPLATE.md` (22-section structure),
`blueprints/research/EVIDENCE-BASELINE.md`, and live repository state at
`c:\SideProjects\Tadori` (branch `Sprint7-core-visualization`) on 2026-07-17.

Method: every quoted line range and behavioral claim in each blueprint was
checked against the actual current file. Findings are graded BLOCKER (would
cause a wrong/failed implementation), HIGH (likely rework or a factual error
about the repo), MEDIUM (quality/completeness gap that a cold builder would
have to guess at but could plausibly guess right).

---

## Blueprint 00-01A: allowJs scanner contract & regression

### Verified accurate

- `scan.ts` `classify()` (lines 104-124) unconditionally returns
  `{ indexed: true, language: "javascript" }` for `JS_EXTENSIONS` (line 114-116,
  matches "~114-116" claim) with no compiler-options access. `scanRepository`
  is at line 127 (exact match).
- `project.ts` gate 1 (`createProjectServices`, lines 231-241) and gate 2
  (`IncrementalProjectServices.computeRootFileNames`, lines 354-363) both
  independently compute `allowJs = compilerOptions.allowJs === true ||
  compilerOptions.checkJs === true` — matches blueprint §4 exactly.
- `parseTsconfig` (project.ts:174-205) resolves via
  `ts.parseJsonConfigFileContent`, confirming the extends-chain resolution
  claim.
- `indexRepository.ts:32-50` (`rejectSyntacticallyInvalidRepository`) iterates
  `scan.indexedFiles`, calls `getSyntacticDiagnostics` — confirmed crash path.
- Blast-radius grep confirmed exactly as claimed: `indexRepository.ts:37`
  (loop filter), `:84` (`captureRepository` calling `scanRepository`), `:86`
  (union file-content read), `:118` (language filter feeding
  `createProjectServices`); `incremental.ts:142-144` (`sourceFiles`, ts/js
  filter), `:187` (`filesByPath`, union), `:651/:659` (`affectedPaths` = all
  `indexedFiles` on full-rebuild), `:727` (`rejectSyntacticallyInvalidChanges`
  loop); `extract.ts:241,243,260,284` (`indexedByPath`, `selectedPaths`,
  seed-graph checks, `activeFiles`) — all confirmed at those exact lines;
  `mcp/service.ts:264-265` (`snapshotFreshness`, union hash) — confirmed.
- Union-invariance argument (workspace hash unaffected by reclassification
  because both `indexRepository.ts:86` and `service.ts:265` hash
  `[...indexedFiles, ...supportFiles]`) is verified true by reading both
  sites: `captureRepository` (indexRepository.ts:85-90) and
  `snapshotFreshness` (service.ts:264-268) both build the file list from the
  full union before hashing, and `computeWorkspaceHash` (indexRepository.ts:
  71-79) only consumes `{normalizedPath, contentHash}` pairs — reclassifying
  `indexed` vs `supportFiles` membership does not change which files
  contribute to the hash. Confirmed correct.
- `resolveRootCompilerOptions`: grepped the entire `packages/` tree — **zero
  existing matches**. No name collision. Confirmed safe additive export.
- No fixture contains `.js`/`.jsx`/`.mjs`/`.cjs` files (confirmed via
  `fixture-manifest.json` inspection and the evidence baseline's exhaustive
  find; re-verified no such files exist under `packages/fixtures`).
- `.mjs`/`.cjs` are already members of `JS_EXTENSIONS` (scan.ts:35) alongside
  `.js`/`.jsx` — confirmed, so a single `allowJs` gate covers all four
  uniformly (no separate code path needed).
- Root `tsconfig.json` (`c:\SideProjects\Tadori\tsconfig.json`) has no
  `files` array — only `include`/`exclude`. Confirmed.

### BLOCKER findings

None. The diagnosis, fix location, and contracts are technically sound and
verified against live code — this is unusual for a blueprint under review and
is called out because it is not automatic.

### HIGH findings

**H-1. `resolveRootCompilerOptions` contract omits the two failure modes a
cold builder must reconcile: `findTsconfig`'s optional second parameter vs.
"live-disk variant."**

Quote (§9): `export function resolveRootCompilerOptions(root: string):
ts.CompilerOptions` wrapping `findTsconfig` + `parseTsconfig` (live-disk, no
captured texts); returns `{ ...DEFAULT_OPTIONS }` when no tsconfig."

Problem: `findTsconfig(root, capturedTexts?)` (project.ts:24-32) and
`parseTsconfig(root, tsconfigPath, capturedTexts?)` (project.ts:174-205) both
accept an optional `capturedTexts` map and behave differently when it is
supplied vs. omitted (`createCapturedFileSystem` branches on
`if (!capturedTexts)` at project.ts:77-86, returning a pass-through live `ts.sys`
implementation vs. an immutable captured view). The blueprint says "live-disk
variant" but never states explicitly that `resolveRootCompilerOptions` must
call both with the second argument *omitted* (not `undefined` explicitly
passed differently, not an empty Map). A cold builder implementing this from
the contract alone could pass an empty `Map()` instead of omitting the
argument — `createCapturedFileSystem` treats a supplied (even empty) Map as
the captured-mode branch (`if (!capturedTexts)` is falsy only for
`undefined`), which would silently make `fileExists`/`readFile` return false
for every real repo file inside `insideCapturedRepository`, and
`resolveRootCompilerOptions` would then behave as if the tsconfig doesn't
exist even when it does — the opposite of a "found tsconfig" case, gating
`allowJs` off unconditionally on every real scan. This produces the fix
silently no-op-ing (all JS always classified as unindexed) with no test
catching it if the test's temp-repo happens not to need `extends` resolution
beyond a trivial config.

Revision required: add one sentence to §9 and §10: "Call
`findTsconfig(root)` and `parseTsconfig(root, tsconfigPath)` with the second
argument omitted entirely (not an empty Map) so `createCapturedFileSystem`
takes its live `ts.sys` branch." Add this as an explicit assertion in test
(c) (the `extends`-chain regression test) so a wrong implementation fails
loudly rather than passing coincidentally.

**H-2. §13 test matrix has no case for a `.js` file that is NOT reachable by
any tsconfig `include` glob at all (only "no tsconfig" and "extends" cases
are covered) — a real-world root JS config file (the exact motivating bug)
is a distinct case from all seven listed tests.**

Quote (§13): tests (a)-(g) cover `allowJs`/`checkJs` on/off, `extends`,
no-tsconfig, `.d.ts`, and one incremental case. None of the seven exercises
the actual reproduction scenario described in §4: "`tsconfig.json` lists
`eslint.config.js` in `include` ... tsc silently skips without allowJs." In
that scenario the JS file **is named in `include`** yet still gets excluded
from program roots by the `allowJs` gate at the `programCompatible`/
`compatible` filters (project.ts:235-241, :357-363) regardless of `include`
membership, because those filters run after `parsed.fileNames` is already
resolved by TypeScript (project.ts:243-249 unions `parsed.fileNames` and
`scannedSourceAbsolutePaths`, both independently filtered by
`programCompatible`). Test (a) uses a bare `tool.config.js` created in a temp
dir with "no-allowJs tsconfig" but does not state whether that tsconfig's
`include` glob actually matches the JS file — this is exactly the detail that
made the real bug possible (tsc's own JSON config parser drops
`.js` entries from `include`-derived `fileNames` when `allowJs` is unset,
independent of the scan-side bug). A cold builder could write test (a) with
a config that never included the JS path in `include` at all, "pass" the
test, and still leave a variant of the original bug unexercised (e.g., a
`.js` file explicitly reachable via `include` glob but excluded by tsc's own
`allowJs`-gated file resolution, as opposed to a plain "not in tsconfig at
all" file).

Revision required: add to §13 test (a) an explicit assertion that the
tsconfig's `include` array contains a glob matching the JS file's path (e.g.
`"**/*.js"`), so the test reproduces the real defect's exact shape (JS file
nominally "included" by tsconfig glob syntax, still excluded from the
program), not just an arbitrary uncounted file.

### MEDIUM findings

**M-1. §13 has no explicit test for a `.js` file named in tsconfig `files`
(not `include`).** The reviewer instructions flagged this as a required
check. Root `tsconfig.json` in this repo uses `include` only (no `files`
key), so this is not a repo-fact error, but TypeScript's `files` array
behaves differently from `include` (files listed in `files` are *always*
added to `parsed.fileNames` regardless of extension-based `include` matching,
though `programCompatible`/`compatible` still filter them by `allowJs`
post-hoc). Since `resolveRootCompilerOptions` and `scanRepository`'s new
`allowJs` gate are meant to have "same extends-resolved semantics as
project.ts parseTsconfig," an implementer should verify a `.js` file named
in `files` (not `include`) is still gated identically. Not a blocker because
`parsed.fileNames` unions both `include`- and `files`-derived entries
identically before the `programCompatible` filter runs — the gate applies
uniformly — but the blueprint should say so explicitly rather than leave the
cold builder to independently verify TypeScript's `ts.parseJsonConfigFileContent`
merges `files`/`include` before returning `fileNames`.

Revision required: add one line to §8 or §13: "`files`-listed JS entries are
gated identically to `include`-derived ones because both merge into
`parsed.fileNames` before the `allowJs` filter runs; no separate test
required, but note this in the builder's final report if verified."

**M-2. §13 does not distinguish `.jsx` from `.js`/`.mjs`/`.cjs` in any test,
even though `.jsx` requires `"jsx"` compiler option handling downstream in
extraction (not just scan/program-root filtering).**

`JS_EXTENSIONS` groups all four extensions identically at the scan/gate
level (confirmed), so the allowJs gate itself is extension-agnostic — this
is not a defect in the fix. But test (b) ("`allowJs: true` → JS file in
`indexedFiles`; file node exists; a function declared in the JS file becomes
a function node") uses an unspecified extension. If the builder picks `.js`
for test (b) and never exercises `.jsx`/`.mjs`/`.cjs`, a regression specific
to one of those three extensions (e.g. a JSX file with an unset `jsx`
compiler option, which TypeScript's LS will diagnose or behave differently
on than plain `.js`) would ship unverified. Given the objective explicitly
lists `.js/.jsx/.mjs/.cjs` in §2, at least one of (a)-(g) should pin down
which extension is used and ideally cover more than one.

Revision required: specify in §13 that test (b) uses `.js` and add "(b2)" or
extend (b) to also cover `.jsx` and `.mjs`/`.cjs` file extensions with the
same assertions, or explicitly scope the non-goal ("only `.js` is
regression-tested; `.jsx`/`.mjs`/`.cjs` share the identical code path per
`JS_EXTENSIONS`, verified by inspection, not by a duplicate test") so the
cold builder isn't left guessing whether thin coverage is acceptable.

**M-3. Acceptance criterion "full suite ≥ 177 tests" is arithmetically
unverified in the blueprint itself.** §14 states "≥ 177" (170 existing + 7
new from (a)-(g)), which is correct arithmetic (170+7=177), but the
blueprint's own §11 step 1 says "170 existing tests still pass" while §13
lists seven letter-cases (a)-(g) in one file — consistent, not a defect, but
worth noting the "≥" allows silent additional-test creep without being
flagged; a stricter "= 177" would be more binary-verifiable per the
template's §14 requirement ("Binary and verifiable only"). Not upgraded to
HIGH because "≥" is still binary-checkable by a script; noted for tightening
only.

Revision required (optional tightening): change "≥ 177" to "exactly 177
(170 existing + 7 new in `scan-allowjs.test.ts`)" for stricter verifiability,
or state explicitly that additional test cases beyond (a)-(g) are permitted
if the builder finds gaps (e.g., from H-2/M-2 above).

### Verdict: 00-01A

**FAIL** — two HIGH findings stand (H-1: capturedTexts-argument ambiguity
that can silently invert the fix's correctness; H-2: test matrix doesn't
reproduce the exact `include`-glob shape of the original bug). Both are
concrete, correctable in a few added sentences, and do not require
re-architecting the blueprint. Flips to PASS once H-1 and H-2 are addressed
in the text.

---

## Blueprint 00-02: CI pipeline (Linux + Windows)

### Verified accurate

- No `.github/` directory exists (confirmed: `ls .github` → "No such file or
  directory").
- `package.json` scripts match the blueprint's §4/§10 command list exactly:
  `skills:check`, `typecheck`, `lint`, `test`, `mcp:stdio`,
  `fixtures:validate`, `fixtures:index`, `fixtures:typecheck`,
  `benchmark:incremental`, `tadori` — all present, verbatim commands match
  EVIDENCE-BASELINE.md's table. `packageManager: "pnpm@9.15.9"` confirmed
  verbatim in `package.json` line 9.
- `.npmrc` pin (`use-node-version=22.14.0`) confirmed verbatim.
- `.gitattributes` (`* text=auto eol=lf`) confirmed verbatim, plus the binary
  overrides for pdf/png/jpg/ico.
- `origin` remote confirmed as `https://github.com/Pranav-s79/Tadori.git`.
- `.tadori/` is gitignored (confirmed, `.gitignore` line 6), supporting the
  §8 architectural-decision claim that "`tadori diff` litter would not trip"
  the `git status --porcelain` tree-mutation guard (since 00-01A's `tadori
  diff .` validation command is not yet in the CI gate list per this
  blueprint's explicit scope note).
- Workflow skeleton step order (checkout → setup-python → pnpm/action-setup
  → setup-node with `cache: pnpm` → install) is the *correct* order for the
  known real-world gotcha: `actions/setup-node@v4`'s `cache: pnpm` option
  requires `pnpm` to already be resolvable on PATH to compute the cache key
  from `pnpm-lock.yaml`; `pnpm/action-setup@v4` runs first here, so this
  specific failure mode is avoided. This is not a defect — flagged as
  correctly ordered.
- `pnpm/action-setup@v4` reads `packageManager` from `package.json`
  automatically **only when no `version:` input is given** — the skeleton in
  §10 omits any `version:` field under `pnpm/action-setup@v4`, consistent
  with §5's "(version from `packageManager`)" prose. Confirmed self-consistent.

### BLOCKER findings

**B-1. §10's skeleton and §13(b)'s adversarial check both assume `git diff
--check` and a portable "assert empty" for `git status --porcelain` without
specifying the actual shell commands — but §4's own Gotchas section states
"On Windows runners the default shell is PowerShell," and PowerShell does not
interpret a bare `run: git status --porcelain` step's exit code as a
pass/fail signal for emptiness at all.**

Quote (§10): 
```
- run: git diff --check
- run: git status --porcelain
# assert empty: builder implements the emptiness check portably
```

Problem: `git status --porcelain` always exits 0 whether or not it prints
output (it is not a "check" subcommand — unlike `git diff --check`, which
does exit non-zero on conflict markers/whitespace errors). The comment
"builder implements the emptiness check portably" defers the single most
platform-fragile line in the entire workflow to an unscripted, unreviewed
decision, with zero guidance on syntax. On `windows-latest` (PowerShell
core, `pwsh` or `powershell.exe` depending on `shell:` default for the
`actions/runner`'s Windows image — GitHub's Windows runners default `run:`
steps to `pwsh`, not `powershell.exe`, which is itself a fact the blueprint
never states or verifies), a naive bash-idiom translation like
`if [ -n "$(git status --porcelain)" ]; then exit 1; fi` is a **syntax error**
in PowerShell. A cold builder without prior GitHub Actions Windows experience
has at least three plausible-looking but wrong implementations available
(bash test syntax under pwsh; `$(git status --porcelain)` truthiness
semantics differ from bash; forgetting `shell: bash` override entirely) and
no acceptance criterion in §14 distinguishes "the step ran" from "the step
actually asserted emptiness" — a workflow where this line is a silent no-op
on Windows would still show green in the Actions UI, defeating the entire
purpose of the tree-mutation guard on the one OS most likely to introduce
CRLF/path-separator artifacts.

Revision required: §10 must specify the exact command, not defer it. Two
concrete, portable options exist and the blueprint must pick one:
(1) `- run: git diff --exit-code` (also catches untracked-file-independent
modifications, but not untracked files) combined with a separate
`- uses: actions/github-script@v7` or explicit shell block; or more simply
(2) replace both lines with a single cross-shell-safe step using `git diff
--exit-code` for tracked-file mutations plus an explicit `git status
--porcelain` piped through a `git` plumbing command that itself has a
non-zero exit code, e.g.:
```yaml
- run: |
    git add -A
    git diff --cached --exit-code
```
which works identically under `bash` and `pwsh` because `git diff --exit-code`
(not `--check`) is the portable "fail if anything differs" primitive and
`git add -A` stages untracked files so they participate in the diff. The
blueprint must state the exact command and confirm (by the builder, during
implementation) that it behaves identically in both shells — this cannot be
left as an implementation detail per the template's §10 "Exact contracts"
requirement ("concrete... no open choices left to the builder").

### HIGH findings

**H-1. §13(b)'s adversarial check — "verify Windows job checked out LF" via
`git ls-files --eol -- packages/fixtures | findstr /V "lf"` — mixes a Unix
pipe-invocation convention with a Windows-only command (`findstr`) inside a
prose sentence that never states which shell or step this runs under, and
`findstr /V "lf"` will also match header/blank lines and w/crlf attr text,
producing false positives that a cold builder cannot resolve without
independently reverse-engineering `git ls-files --eol` output format.**

Quote (§13): "(b) verify Windows job checked out LF (add a one-step probe
`git ls-files --eol -- packages/fixtures | findstr /V "lf"` equivalent or
rely on fixtures:index PASS which fails on CRLF)."

Problem: this is presented as a real command but is not directly usable:
`git ls-files --eol` output format is `i/lf    w/lf    attr/text=auto eol=lf    <path>`
per file — grepping for absence of the substring `"lf"` would match if *any*
of the three eol fields (i/lf, w/lf) is not `lf`, but the attr field always
contains the literal substring `eol=lf` regardless of actual working-tree
line endings, so `findstr /V "lf"` would frequently show **zero** matches
(false "all LF") even on a CRLF checkout, because the `attr=` column's
`eol=lf` substring satisfies the naive `findstr` filter regardless of the
`w/` (working tree) column's actual value. The blueprint's own fallback
("or rely on fixtures:index PASS") is the actually-reliable check (confirmed
correct: fixture bodyHash values are SHA-256 over exact LF bytes per
`.gitattributes`'s comment, so a CRLF checkout would break those hashes and
`fixtures:index` would fail) — but the primary probe offered first is
broken and would be implemented literally by a cold builder who takes the
blueprint's command at face value, producing a check that always reports
success regardless of the actual line-ending state, silently defeating
adversarial test (b)'s entire purpose.

Revision required: delete the `findstr` probe entirely and state only the
reliable check: "(b) Windows LF verification is implicit in `fixtures:index`
passing (fixture bodyHash values are SHA-256 over exact LF bytes; a CRLF
checkout breaks them) — no separate probe step needed; if a stronger direct
check is wanted, use `git ls-files --eol -- packages/fixtures` and assert
every line's `w/` column reads exactly `w/lf` (not `w/crlf` or `w/mixed`),
not a substring match."

**H-2. §14's acceptance criterion "CI test count equals local test count for
that commit" and §13(c) ("verify `pnpm test` count in CI log equals the
local count (170, or 177+ post 00-01A)") give no exact command or log
pattern to check against — "verify... equals" is not a verifiable-by-command
acceptance criterion as required by the template's §14 ("Binary and
verifiable only").**

Quote (§14): "CI test count equals local test count for that commit."

Problem: `pnpm test` (vitest run) prints a summary line whose exact format
depends on the vitest version/reporter (e.g. `Test Files  24 passed (24)` /
`Tests  170 passed (170)`), but the blueprint never specifies which reporter
line to grep, whether to use vitest's `--reporter=json` for a
machine-checkable count, or what "equals" means operationally (byte-diff of
log lines? A separate `grep` command? Manual visual inspection by the
builder?). Given the blueprint's own template requires acceptance criteria
be "verifiable... by a command," and Complexity is rated S with a Haiku
primary builder ("escalate to Sonnet only if runner debugging exceeds two
iterations" — implying minimal judgment calls expected), this criterion as
written requires the builder to invent a parsing/comparison mechanism from
scratch with no specified command, output format, or tolerance.

Revision required: specify the exact mechanism, e.g.: "Add
`--reporter=verbose` or capture vitest's summary line via
`pnpm test 2>&1 | tee test-output.log`; acceptance = manual visual
comparison by the builder in the final report between the CI log's `Tests
NNN passed` line and the local `pnpm test` run's line, both quoted verbatim
in the Builder Final Report (§21)." This turns an unverifiable-by-command
criterion into a template-compliant "quote both lines" criterion, appropriate
for an S-complexity infra blueprint that explicitly does not want CI to add
new tooling (no non-goal violation).

### MEDIUM findings

**M-1. §11 step 3 says "push the current sprint branch (push authorization
per 00-01/A-001 — sprint branches only)" but neither this blueprint nor the
reviewed evidence baseline resolves what "A-001" refers to — it is an
undefined cross-reference.**

Quote (§11): "push the current sprint branch (push authorization per
00-01/A-001 — sprint branches only)."

Problem: "00-01/A-001" is not a blueprint ID pattern used anywhere else in
this document, in `blueprints/INDEX.md`, or in `BACKLOG.md` (which uses plain
prose "Owner decision 2026-07-17" and "Decisions locked 2026-07-15" — no
`A-001` identifier appears in either file, confirmed by inspection). A cold
builder cannot verify this authorization reference points to a real, current
approval and would have to either trust it blindly (risk: CLAUDE.md's "Do
not push, publish, or create a remote without explicit approval" is a
non-negotiable project rule and this blueprint's only citation for push
authorization is an unresolvable pointer) or stop and ask — which defeats
the "cold builder, no questions" premise of this document.

Revision required: replace "per 00-01/A-001" with the actual verifiable
citation — per `BACKLOG.md`'s own text (verified in this review): "Push
authorized once for existing sprint branches + resulting `main`; no
tags/releases" (Decisions locked 2026-07-15 section) and "push the four
sprint branches only... local `main` fast-forwards to `origin/main`" (2026-07-17
entry). Cite the exact `BACKLOG.md` line/section instead of an ID that
does not exist anywhere in the repository.

**M-2. §16 performance budget "Windows runner typically 2-3x slower" is an
unsourced estimate presented adjacent to hard gate numbers, with no
consequence specified if the estimate is wrong (e.g., a 30-minute timeout is
hit).**

Quote (§16): "expected ≈ 6-12 min (install + 170-test suite ≈ 1 min local +
fixture indexing ≈ 5 s local; Windows runner typically 2-3x slower)."

Not a blocker (the 30-minute hard timeout in §5/§10 is the actual gate and is
unambiguous), but the "2-3x slower" figure has no citation and §17's failure
handling doesn't mention "runner slower than estimated but within 30 min
timeout" as a non-failure — a cold builder hitting a 18-minute Windows run
might wrongly treat it as an anomaly to "fix" rather than an expected,
harmless variance. Low-impact wording gap only.

Revision required: soften to "no hard sub-timeout budget beyond the 30-minute
job timeout; Windows runners are commonly slower than Linux for equivalent
work — treat any run under 30 minutes as passing regardless of duration."

**M-3. §7's "Dependencies and prerequisites" states 00-02 "Depends on: 00-01"
(hard dependency, §1 header) while §1 itself says "00-01A strongly
recommended first... record as ordering preference, not a hard dependency" —
these two statements are consistent on inspection, but §7's body text omits
restating the 00-01A ordering-preference nuance, so a reader who skips §1 and
jumps to §7 sees only the 00-01 hard dependency and no mention of 00-01A at
all.**

Quote (§7): "00-01 delivered: branches on origin + README Development
section to hold the badge. Contract needed: none beyond existing package
scripts."

This is not contradictory, just incomplete — §7 is the section a builder
would check last before starting, and it silently drops the 00-01A ordering
note that §1 introduces. Minor cross-section consistency gap.

Revision required: add one clause to §7: "(00-01A not a hard dependency, but
completing it first means CI is green from run #1 instead of red on the
allowJs defect — see §1)."

### Verdict: 00-02

**FAIL** — one BLOCKER stands (B-1: the tree-mutation emptiness check is
left as an unscripted, platform-ambiguous "builder implements portably" note
for the single most fragile cross-OS line in the workflow) plus two HIGH
findings (H-1: the offered Windows LF probe command is actively wrong and
would falsely report success; H-2: the CI-vs-local test-count acceptance
criterion is not command-verifiable as required by the template). All three
are concrete and fixable by specifying exact commands/text; none require
re-scoping the blueprint.

---

## Summary

| Blueprint | Blockers | High | Medium | Verdict |
|---|---:|---:|---:|---|
| 00-01A allowJs scanner contract | 0 | 2 | 3 | FAIL |
| 00-02 CI pipeline | 1 | 2 | 3 | FAIL |

Most important finding overall: **00-02 B-1** — the workflow's tree-mutation
guard (`git status --porcelain` "assert empty... builder implements the
emptiness check portably") is the one line in either blueprint that is both
(a) explicitly deferred to unscripted implementer judgment, in direct tension
with the template's "no open choices left to the builder" requirement for
Exact Contracts, and (b) trivially capable of silently no-op'ing on the
Windows runner specifically — the OS this whole CI pipeline exists partly to
validate against CRLF/LF regressions. A wrong implementation would not fail
loudly; it would report green while providing zero actual protection,
which is worse than not having the check at all because it creates false
confidence.

---

## Addendum — 2026-07-17: post-correction reconciliation

The original FAIL verdicts and all findings above remain preserved unchanged
as historical review evidence. Both blueprints were subsequently corrected;
their §22 sections record the corrected state. All blocker and high-severity
findings were corrected.

- **00-01A now passes review.** Corrections verified against the blueprint
  text: §9/§10 now state explicitly that `findTsconfig(root)` and
  `parseTsconfig(root, tsconfigPath)` are called with the `capturedTexts`
  argument omitted entirely (resolves H-1, with the wrong-implementation
  failure path asserted in test (c)); §13 test (a) now requires the tsconfig
  `include` array to contain a glob matching the JS file's path, reproducing
  the original include-glob/allowJs regression shape (resolves H-2).
- **00-02 now passes review.** Corrections verified against the blueprint
  text: §10 replaces the deferred "builder implements portably" note with an
  actual tree-mutation failure command — `git add -A` followed by
  `git diff --cached --exit-code`, with a shell-semantics note (resolves
  B-1); §13 deletes the broken `findstr` LF probe and replaces it with the
  reliable `fixtures:index` implicit check plus the exact `w/` column rule
  for any direct probe (resolves H-1).
- No production implementation was performed during the correction; the
  changes were blueprint-text only.
