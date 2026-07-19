---
graph_blueprint_version: 1
node_id: 00-02
state: validated
phase: 0
risk: low
complexity: S
predecessors: [00-01]
successors: [11-01, 12-03]
execution_card: blueprints/execution/00-02.md
dossier: blueprints/00-02-ci-pipeline.md
read_policy: execution-card-first
local_full_gate_budget: 1
independent_validation_budget: 1
architecture_review: on-demand-only
---

> **GRAPH EXECUTION MODE:** Read the execution card first. This long file is an evidence dossier, not mandatory context. Open only the sections linked by the card. Planning-time existence claims and line numbers are historical hints; live repository semantics win. Use one full local gate and one independent validation pass.

# BLUEPRINT 00-02: CI pipeline (Linux + Windows)

## 1. Header

- ID / Title / Phase: 00-02 — CI pipeline (Linux + Windows) — Phase 0
- Status: ready (adversarially reviewed 2026-07-17; corrections applied — see §22)
- Primary builder: Claude Haiku — mechanical single-file workflow authoring
  against an exact command list; escalate to Sonnet only if runner debugging
  exceeds two iterations.
- Reviewer roles: Implementation Reviewer (workflow correctness), Test
  Adversary (gate completeness vs local gate).
- Complexity: S
- Depends on: 00-01 (branches exist on origin so runs trigger; README
  documents the gate). 00-01A strongly recommended first so CI is green from
  run #1 — record as ordering preference, not a hard dependency.
- Unlocks: 11-01 (bench harness depends on CI per BACKLOG), 12-03 (Linux CI
  green is an acceptance input).
- Estimated sessions: 1
- Related frozen-spec sections: none (infrastructure); repository gate list
  from IMPLEMENTATION_STATUS.md validation tables.

## 2. Objective

Every push and pull request to `main` and `Sprint*` branches runs the full
frozen local gate on `ubuntu-latest` and `windows-latest`, and both jobs
pass.

## 3. Why this matters

- User value: none directly; protects every later phase.
- System value: the Week-6 gate currently exists only on one Windows
  machine; CI makes regressions visible per-push and proves the Node-22 /
  better-sqlite3 / LF constraints hold on Linux.
- Downstream: Phase 11 benchmarking and Phase 12 packaging both cite CI
  green as prerequisites.

## 4. Current repository evidence

Verified current (2026-07-17):

- No `.github/` directory exists (`Test-Path .github` → False).
- Gate commands and their expected results: IMPLEMENTATION_STATUS.md "Week 6
  full validation" table (skills:check, typecheck, lint, test 170/170,
  python validate_fixtures.py, fixtures:validate, fixtures:index 5/5 PASS,
  fixtures:typecheck ×5, git diff --check).
- `package.json` scripts (see EVIDENCE-BASELINE.md §2): `skills:sync`,
  `skills:check`, `typecheck`, `lint`, `test`, `mcp:stdio`,
  `fixtures:validate`, `fixtures:index`, `fixtures:typecheck`,
  `benchmark:incremental`, `tadori`. `packageManager: "pnpm@9.15.9"`.
- `.npmrc` pins `use-node-version=22.14.0` (pnpm downloads its own Node 22
  for run scripts; better-sqlite3 prebuilds exist for Node 22 on win32 and
  linux x64).
- `.gitattributes` forces `* text=auto eol=lf` — this is load-bearing:
  fixture file-node `bodyHash` values are SHA-256 over exact LF bytes;
  a CRLF checkout historically broke 12/13/11/6/6 node fields
  (IMPLEMENTATION_STATUS.md "Repository environment").
- `validate_fixtures.py` requires a Python 3 interpreter on the runner.
- Remote: `origin` = github.com/Pranav-s79/Tadori; branches main +
  Sprint4/5/6 exist on origin today; Sprint7 push pending under 00-01.

PROPOSED (created by this blueprint): `.github/workflows/ci.yml`.

Files to read first: `IMPLEMENTATION_STATUS.md` (validation tables),
`package.json`, `.npmrc`, `.gitattributes`,
`blueprints/research/EVIDENCE-BASELINE.md` §2.

Gotchas: do NOT add `actions/setup-node` cache tricks that bypass the
`.npmrc` node pin; pnpm must remain the only entry point for scripts. On
Windows runners the default shell is PowerShell — the gate commands are
shell-agnostic as written. `pnpm skills:sync` mutates files when out of
sync; CI runs `skills:check` only (read-only).

## 5. Scope

1. `.github/workflows/ci.yml`: one workflow, `ci`, triggered on
   `push` (branches: `main`, `Sprint*`) and `pull_request` (base `main`),
   with a concurrency group cancelling superseded runs per ref.
2. Job matrix: `os: [ubuntu-latest, windows-latest]`, single Node track.
   Steps, in order: checkout (`actions/checkout@v4`);
   `actions/setup-python@v5` (python `3.12`); `pnpm/action-setup@v4`
   (version from `packageManager`); `actions/setup-node@v4`
   (`node-version: 22`, `cache: pnpm`); `pnpm install --frozen-lockfile`;
   `pnpm skills:check`; `pnpm typecheck`; `pnpm lint`; `pnpm test`;
   `python validate_fixtures.py`; `pnpm fixtures:validate`;
   `pnpm fixtures:index`; `pnpm fixtures:typecheck`; `git diff --check`;
   `git status --porcelain` asserted empty (fails if any gate mutated the
   tree).
3. Job timeout 30 minutes; no secrets required or referenced.
4. Badge line added to root `README.md` Development section.

## 6. Non-goals

- No benchmark job (`benchmark:incremental` is machine-variance-bound; a
  scheduled non-blocking benchmark job is future work — record in RISKS
  R-008, do not build now).
- No macOS runner (Phase 12 pilot smoke covers macOS manually).
- No release/publish/tag automation (not authorized).
- No browser/E2E jobs (arrive with 08-11).
- No caching of `.tadori/` or fixture databases.

## 7. Dependencies and prerequisites

00-01 delivered: branches on origin + README Development section to hold the
badge. Contract needed: none beyond existing package scripts. (00-01A is not
a hard dependency, but completing it first means CI is green from run #1
instead of red on the allowJs defect — see §1.)

## 8. Architectural decisions

- **One workflow, one matrix job** — every gate in one job per OS, exact
  local-gate order. Rejected: split lint/test/fixture jobs (parallel speed
  is not worth losing the "one gate, one truth" property and shared install
  cost is dominant).
- **pnpm as sole runner via `.npmrc` pin.** `setup-node@v4 node-version: 22`
  exists only to run pnpm itself; scripts execute under the pinned 22.14.0.
  Rejected: overriding the pin in CI (would test a different runtime than
  the contract).
- **`--frozen-lockfile`** — CI never resolves new versions. Rejected: plain
  install (silent drift).
- **Tree-mutation guard** (`git status --porcelain` empty) — catches gates
  that write artifacts (e.g. accidental skills:sync behavior or fixture DB
  litter) on both OSes. `.tadori/` is gitignored, so `tadori diff` litter
  would not trip it — but `tadori diff` is deliberately not in CI scope
  until 00-01A lands; add it to the CI gate list inside 00-01A's status
  update if that ships first (coordination note, not a blocker).
- Failure semantics: any step non-zero fails the job; both OS jobs are
  required (no `continue-on-error` anywhere).

## 9. Exact file plan

- `.github/workflows/ci.yml` — create. Responsibility: the full frozen gate
  on push/PR. No exports. Integrates with: branch protection (owner may add
  later on GitHub; not this blueprint).
- `README.md` — modify: one badge line
  (`![CI](https://github.com/Pranav-s79/Tadori/actions/workflows/ci.yml/badge.svg)`)
  at the top of the Development section.
- `IMPLEMENTATION_STATUS.md` — modify: dated subsection recording CI
  introduction and first green run IDs per OS.

## 10. Exact contracts

Workflow skeleton (authoritative structure; builder fills only versions
proven current):

```yaml
name: ci
on:
  push: { branches: [main, "Sprint*"] }
  pull_request: { branches: [main] }
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  gate:
    strategy: { fail-fast: false, matrix: { os: [ubuntu-latest, windows-latest] } }
    runs-on: ${{ matrix.os }}
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm skills:check
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: python validate_fixtures.py
      - run: pnpm fixtures:validate
      - run: pnpm fixtures:index
      - run: pnpm fixtures:typecheck
      - run: git diff --check
      - run: |
          git add -A
          git diff --cached --exit-code
```

The final step is the exact tree-mutation guard — no builder discretion:
`git diff --check` runs first (working tree, whitespace/conflict markers);
then `git add -A` stages every modification AND untracked file, and
`git diff --cached --exit-code` exits non-zero if anything differs from
HEAD. Both commands behave identically under bash and pwsh (the step's exit
code is the last command's exit code in both shells), so no `shell:`
override is needed; `git status --porcelain` must NOT be used as a guard —
it always exits 0 regardless of output.

Error codes: workflow success = all steps exit 0 on both OSes.

## 11. Ordered implementation procedure

1. Create `.github/workflows/ci.yml` per §10; validate YAML locally
   (`node -e` YAML parse or actionlint if available). Expected: file parses.
2. Add README badge line + IMPLEMENTATION_STATUS subsection stub.
3. Commit `ci: add Linux+Windows full-gate workflow`; push the current
   sprint branch only. Authorization: `blueprints/ASSUMPTIONS.md` A-001 and
   `BACKLOG.md` "Decisions locked 2026-07-15" ("Push authorized once for
   existing sprint branches + resulting `main`; no tags/releases") as
   re-scoped by the BACKLOG 2026-07-17 entry (sprint branches only; `main`
   via owner PRs; never force-push).
4. Observe both matrix jobs on GitHub Actions; iterate on runner-specific
   failures (each fix its own commit; never weaken a gate to pass — a gate
   that fails on Linux is a real finding, report it).
5. Record first green run URLs/IDs per OS in IMPLEMENTATION_STATUS.md;
   flip INDEX/BACKLOG statuses.

## 12. Data and lifecycle flows

Push → workflow trigger → two OS jobs in parallel → each runs the gate
sequence → both required green. Cancellation: new push to same ref cancels
in-flight run.

## 13. Test plan

The workflow IS the test. Adversarial checks the builder must perform:
(a) force a deliberate lint error on a scratch commit → CI fails →
revert (proves gates bite); (b) Windows LF verification is implicit in
`fixtures:index` passing (fixture bodyHash values are SHA-256 over exact LF
bytes; a CRLF checkout breaks them and the job fails) — no separate probe
step. If a stronger direct check is ever wanted, assert that every line of
`git ls-files --eol -- packages/fixtures` has a `w/` column reading exactly
`w/lf` — never a substring match, since the attr column always contains the
literal text `eol=lf`; (c) test-count parity mechanism: quote the vitest
summary line (`Tests  NNN passed (NNN)`) verbatim from BOTH the CI log
(each OS) and a local `pnpm test` run of the same commit in the builder's
final report; acceptance = the quoted counts are equal.

## 14. Acceptance criteria

- [ ] Both matrix jobs green on the same commit (run URLs recorded).
- [ ] The vitest summary lines (`Tests  NNN passed`) from both CI OS logs
      and the local run of the same commit are quoted verbatim in the
      builder report and show equal counts.
- [ ] `fixtures:index` prints 5/5 PASS in both OS logs.
- [ ] A deliberately broken scratch commit fails CI (evidence: run URL),
      then is reverted.
- [ ] No secrets referenced; no publish/tag steps exist in the workflow.
- [ ] Badge renders in README on the branch.

## 15. Validation commands

Local before push: pnpm skills:check; pnpm typecheck; pnpm lint; pnpm test;
python validate_fixtures.py; pnpm fixtures:validate; pnpm fixtures:index;
pnpm fixtures:typecheck; git diff --check. Remote: two green run URLs.

## 16. Performance budgets

Each OS job ≤ 30 minutes hard timeout — the only hard budget. No sub-timeout
target: Windows runners are commonly slower than Linux for equivalent work;
treat any green run under 30 minutes as passing regardless of duration.

## 17. Failure and recovery behavior

Runner flake → re-run failed jobs once; persistent OS-specific failure is a
finding to report, never a gate to delete. Lockfile mismatch →
`--frozen-lockfile` fails loudly. Superseded runs cancelled by concurrency
group.

## 18. Security and privacy

No secrets; read-only repo permissions (`permissions: contents: read` at
workflow level — builder adds this line); no artifact uploads containing
repository content beyond logs.

## 19. Accessibility

Not applicable.

## 20. Documentation updates

`README.md` (badge), `IMPLEMENTATION_STATUS.md` (dated CI subsection),
`blueprints/INDEX.md` + `BACKLOG.md` (status flips).

## 21. Builder final report

Files changed; both run URLs + durations per OS; CI vs local test-count
parity statement; the deliberate-failure evidence run URL; commit SHAs;
`ASSUMPTION:` lines; any OS-specific finding.

## 22. Independent review result

- 2026-07-17 Blueprint Adversarial Reviewer
  (`blueprints/reviews/wave1-phase0-review.md`): 1 blocker (B-1
  tree-mutation guard deferred to builder judgment — `git status
  --porcelain` always exits 0), 2 high (H-1 broken `findstr` LF probe that
  would always report success; H-2 non-command-verifiable test-count
  criterion), 3 medium. Corrections applied 2026-07-17 by Program Architect:
  §10 exact `git add -A && git diff --cached --exit-code` guard with
  shell-semantics note; §13 probe replaced with the fixtures:index implicit
  check + exact `w/` column rule; §13/§14 verbatim-quote count mechanism;
  §11 authorization citation resolved to ASSUMPTIONS A-001 + BACKLOG lines;
  §16 softened to the 30-minute-only budget; §7 00-01A ordering clause.
  Final review status: PASS conditions met → **ready**.

## IF SOMETHING IS UNCLEAR

Smallest safe assumption + `ASSUMPTION:` line. If a gate fails only on
Linux, stop and report the finding — do not weaken the gate.

## TADORI NON-NEGOTIABLES

Frozen v2.1; never weaken golden fixtures; no publish/tag automation; gates
run through pnpm under the Node-22 pin; LF checkout is load-bearing for
fixture hashes.
