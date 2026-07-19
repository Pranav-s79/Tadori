---
graph_blueprint_version: 1
node_id: 00-01
state: validated
phase: 0
risk: low
complexity: S
predecessors: [00-01A]
successors: [00-02, 07-01]
execution_card: blueprints/execution/00-01.md
dossier: blueprints/00-01-repo-sync-and-readme.md
read_policy: execution-card-first
local_full_gate_budget: 1
independent_validation_budget: 1
architecture_review: on-demand-only
---

> **GRAPH EXECUTION MODE:** Read the execution card first. This long file is an evidence dossier, not mandatory context. Open only the sections linked by the card. Planning-time existence claims and line numbers are historical hints; live repository semantics win. Use one full local gate and one independent validation pass.

# BLUEPRINT 00-01: Repository sync & README correction

> RE-SCOPED 2026-07-17 (owner decision, option a): `origin/main` now advances
> only via owner-merged GitHub PRs (PR #1/#2 already merged as merge commits;
> Sprint6 and Sprint7 PRs to follow). The main fast-forward-to-Sprint7 and
> main-push steps below are void. Hygiene commits land on
> `Sprint7-core-visualization`; the push set is the four sprint branches only;
> local `main` fast-forwards to `origin/main` (`6e89fc1`). The `origin/main =
> d89bcfb` precondition is superseded by `origin/main = 6e89fc1`. All other
> steps unchanged.

BUILDER: Claude Sonnet, working alone, cold start, cannot ask questions.

MODEL CHOICE
Git ref surgery here is mechanical, but the root README requires accurate
product prose grounded strictly in IMPLEMENTATION_STATUS.md; Sonnet handles
both without Opus-class cost.

## GOAL

`origin/main` fast-forwarded to the Week-6 tip plus three hygiene commits; all
four sprint branches pushed; the root README describes the actual Tadori
product; the fixture guide relocated verbatim to `packages/fixtures/README.md`;
the planning vault (BACKLOG.md, blueprints/) committed.

## CURRENT REPOSITORY STATE

- Current phase: Week 6 complete (`15540b3`); Phase 7 not started.
- Branch tips verified 2026-07-15 (abort if they differ — see Step 1):
  - `main` = `7ff77ae`
  - `Sprint4-mcp-interface` = `c36440c`
  - `Sprint5-context-selection` = `6795399`
  - `Sprint6-incremental-indexing` = `15540b3`
  - `Sprint7-core-visualization` = `15540b3` (checked-out branch)
  - `origin/main` = `d89bcfb`
- History is strictly linear:
  `3bc1977 → d89bcfb → 322f03b → 66814be → 7ff77ae → c36440c → 6795399 → 15540b3`;
  `merge-base(main, Sprint7) = 7ff77ae`, so every merge below is a pure
  fast-forward. No force-push is ever required or permitted.
- Working tree: exactly `M .gitignore` (graphify allowance block at the end of
  the file) plus untracked `BACKLOG.md` and `blueprints/`.
- Existing implementation to reuse: none — this blueprint touches docs and git
  refs only.
- Existing tests and fixtures: 170/170 tests across 24 files; 5/5 golden
  fixtures exact. They must all still pass, untouched, at the end.
- Known limitations: none relevant.
- Dependencies on earlier blueprints: none (first blueprint).

## CONTEXT THE BUILDER NEEDS

### Files to read first

- `README.md` — current content is the golden-fixture guide (first line
  `# Tadori Golden Fixtures`); it moves verbatim.
- `IMPLEMENTATION_STATUS.md` — the only permitted source for status and
  capability claims. (Roadmap section sources from `BACKLOG.md` /
  `blueprints/INDEX.md`; `tadori serve .` wording sources from
  `docs/CLI_CONTRACT.md`.)
- `CLAUDE.md`, `AGENTS.md` — project rules the README must not contradict.
- `docs/CLI_CONTRACT.md` — for the roadmap section wording (`tadori serve .`).
- `.gitignore` — contains the uncommitted graphify block to commit as-is.
- `BACKLOG.md`, `blueprints/INDEX.md` — committed as-is, never edited here.

### Existing APIs and types

None. Git refs and markdown only.

### Real examples

- Owner push authorization (2026-07-15, verbatim): "this message is explicit
  authorization to push those existing validated branches and the resulting
  main, but not to publish releases or tags."
- Existing commit message style to imitate:
  `feat(indexer): complete Week 6 incremental indexing`.

### Gotchas

- `.gitattributes` enforces `* text=auto eol=lf`; write every new file with LF
  line endings.
- No script or tool references the root README path (verified by grep across
  `scripts/`, `packages/harness/src/`, `validate_fixtures.py`); re-verify with
  `grep -rn "README" scripts packages/harness/src validate_fixtures.py` before
  moving.
- The machine's global Node is 25.x and cannot build better-sqlite3; always
  run validation through pnpm (`.npmrc` pins Node 22.14.0).
- `origin/HEAD` already points at `main`; do not change it.
- Do not touch `origin/autonomous-roadmap`.
- No tags, no GitHub releases, no branch deletion — not authorized.

## SCOPE

### Files and directories allowed to change

- `README.md` (replaced)
- `IMPLEMENTATION_STATUS.md` (append one dated hygiene subsection only)
- `.gitignore` (commit the existing modification; no further edits)
- `BACKLOG.md`, `blueprints/**` (commit as-is)
- Git refs: local `main`; pushes to `origin`

### New files expected

- `packages/fixtures/README.md` (relocated fixture guide, byte-identical body)

### Must not change

- `packages/fixtures/**` (except adding README.md), `fixture-manifest.json`,
  `schemas/**`, `docs/Specs/**`, `docs/CLI_CONTRACT.md`, `agent-skills/**`,
  `.claude/**`, `.agents/**`, `packages/*/src/**`, `packages/*/test/**`,
  `validate_fixtures.py`, `package.json`, `pnpm-workspace.yaml`, tsconfigs,
  `vitest.config.ts`.

## ARCHITECTURAL DECISIONS

- **Fast-forward only.** History is verified linear; `git branch -f` moves
  local `main`, ordinary `git push` updates origin. Rejected: per-sprint merge
  commits (adds noise, no information). Rejected: force-push (never
  permitted).
- **Hygiene commits land on `Sprint7-core-visualization`**, then `main` is
  fast-forwarded to that tip. Keeps one linear history, keeps Sprint7 == main
  for Phase 7 to build on. Rejected: dedicated Sprint0 branch + PR — the
  owner's one-PR-per-phase rule governs build phases; Phase 0 is repo surgery
  under explicit authorization.
- **Fixture guide moves verbatim** (body byte-identical) to
  `packages/fixtures/README.md` because it documents that package. Rejected:
  `docs/FIXTURES.md` (loses colocation).
- **Root README content contract** — exactly these sections in this order,
  every factual claim verifiable in IMPLEMENTATION_STATUS.md, no aspirational
  claim in present tense:
  1. **What Tadori is** — provenance-typed repository graph for
     TypeScript/JavaScript; six-tool MCP context interface for agents plus a
     forthcoming local visual supervision layer; local-first, localhost-only,
     no cloud dependency.
  2. **Status** — Weeks 1–6 complete; 170/170 tests; five golden fixtures
     exact; incremental refresh gates met (single-file p95 1257.685 ms
     < 2000 ms on a 250,330-LOC corpus); next phase: local serving and 2D
     visualization (`tadori serve .`).
  3. **Quick start** — `pnpm install`, `pnpm test`, `pnpm tadori diff .`,
     `pnpm mcp:stdio --db .tadori/tadori.sqlite --repo .` (each with one-line
     description). The stdio command is a long-running server: "executes
     successfully" means it starts and shuts down cleanly when stdin is closed
     (verify with an empty-stdin pipe, e.g. `echo | pnpm mcp:stdio --db
     .tadori/tadori.sqlite --repo .`); a bare `pnpm mcp:stdio` exits 1 by
     design and must not appear in the README.
  4. **Architecture** — table of existing workspace packages (core, store,
     indexer, harness, mcp) with one-line purposes, plus the
     `packages/fixtures` directory described as a fixture corpus (it is not a
     workspace package — absent from `pnpm-workspace.yaml`); planned packages
     (cli, server, apps/viz, hooks, bench) explicitly marked "planned".
  5. **Frozen contracts** — the six MCP tools by name (`repo_overview`,
     `find_symbol`, `symbol_context`, `find_tests`, `impact`, `path`);
     fixtures are authoritative; pointers to `docs/Specs/` and
     `docs/CLI_CONTRACT.md`.
  6. **Roadmap** — pointer to `BACKLOG.md` and `blueprints/INDEX.md`.
  7. **Development** — commands table mirroring `package.json` scripts.
- **Push set** (exact): `main`, `Sprint4-mcp-interface`,
  `Sprint5-context-selection`, `Sprint6-incremental-indexing`,
  `Sprint7-core-visualization`.
- **Failure behavior:** any rejected push → stop, leave local state as built,
  report blocked. Never force-push, never delete remote refs.
- **Determinism:** Step 1 asserts the exact SHAs above before any ref moves.

## DATA AND API CONTRACTS

Exact commit messages, in order:

1. `chore: allow graphify build-time artifacts in .gitignore`
2. `docs(planning): add remaining-roadmap backlog and blueprint vault`
3. `docs: replace root README with product overview; relocate fixture guide`

Exactly three commits. No other structural contracts.

## STEP-BY-STEP IMPLEMENTATION PLAN

1. **Preconditions** — run `git status --short` (expect only `M .gitignore`
   plus untracked `BACKLOG.md`, `blueprints/`); run
   `git log -1 --format=%h` for each of the five branches and compare with
   CURRENT REPOSITORY STATE; run `git fetch origin` and assert
   `origin/main` = `d89bcfb` and that `origin/Sprint4-mcp-interface`,
   `origin/Sprint5-context-selection`, `origin/Sprint6-incremental-indexing`
   equal their local tips (their pushes are then no-ops). Any mismatch → stop,
   report blocked. No tests.
2. **Commit 1** — `git add .gitignore`; commit with message 1. No tests.
3. **Commit 2** — `git add BACKLOG.md blueprints`; commit with message 2.
   No tests.
4. **Relocate guide** — `git mv README.md packages/fixtures/README.md`.
   Depends on step 3 (clean staging). No tests.
5. **New root `README.md`** — write per the content contract (LF endings).
   Cross-check every claim against `IMPLEMENTATION_STATUS.md`; cross-check
   every documented command against `package.json` scripts. No tests.
6. **Status note** — append to `IMPLEMENTATION_STATUS.md` a subsection
   `## Repository hygiene (2026-07-15)` with three bullets: README replaced
   and fixture guide relocated; planning vault added; `main` fast-forwarded to
   the current tip and pushed with sprint branches. Depends on step 5.
7. **Commit 3** — `git add -A`; verify staging contains only the README move,
   new README, status note; commit with message 3.
8. **Full validation** — run every command in VALIDATION COMMANDS; all pass
   or stop and report.
9. **Fast-forward main** — `git branch -f main Sprint7-core-visualization`;
   verify `git log main -1 --format=%h` equals the Sprint7 tip (commit 3).
10. **Push** — `git push origin main Sprint4-mcp-interface
    Sprint5-context-selection Sprint6-incremental-indexing
    Sprint7-core-visualization`. Note: `Sprint7-core-visualization` does not
    yet exist on origin; this push creates it ("new branch" output is
    expected, not divergence). Its pushed tip equals the authorized resulting
    `main`.
11. **Verify remote** — `git fetch origin` then `git log origin/main -1
    --oneline` must show commit 3; `git ls-remote --heads origin` must list
    all five branches; `git tag` must print nothing.
12. **Handoff report** per HANDOFF OUTPUT.

## TEST PLAN

### Unit tests
None added (docs/git-only blueprint).

### Integration tests
Full existing suite must remain green: `pnpm test` → 170 passing tests,
24 files, zero failures.

### Fixture or golden validation
`python validate_fixtures.py`, `pnpm fixtures:validate`, `pnpm fixtures:index`
(5/5 PASS, zero dangling endpoints / FK rows), `pnpm fixtures:typecheck` —
proves the README relocation touched no fixture content.

### Adversarial tests
- Every command shown in the new README must execute successfully as written.
- `git diff HEAD~1 --name-only` for commit 3 contains only `README.md`,
  `packages/fixtures/README.md`, `IMPLEMENTATION_STATUS.md`.
- Hash comparison between pre-move root README body and
  `packages/fixtures/README.md` — byte-identical.
- `git tag` output empty after all steps.

### Performance tests
Not applicable.

### Browser tests
Not applicable.

## VALIDATION COMMANDS

pnpm skills:check
pnpm typecheck
pnpm lint
pnpm test
python validate_fixtures.py
pnpm fixtures:validate
pnpm fixtures:index
pnpm fixtures:typecheck
git diff --check
git status --short
git tag
git log origin/main -1 --oneline   (after push)
git ls-remote --heads origin       (after push)

## DEFINITION OF DONE

- [ ] Exactly three new commits with the exact messages, in order.
- [ ] `packages/fixtures/README.md` body byte-identical to the pre-move root README.
- [ ] Root README contains all seven contracted sections; every documented command runs.
- [ ] `pnpm test` → 170/170; fixtures 5/5 PASS; `validate_fixtures.py` passes.
- [ ] Local `main` == `Sprint7-core-visualization` tip == `origin/main`.
- [ ] All five branches present on origin; `origin/autonomous-roadmap` untouched; `git tag` empty.
- [ ] Nothing modified under `packages/fixtures/` (beyond the added README), `schemas/`, `docs/Specs/`, `agent-skills/`.
- [ ] `IMPLEMENTATION_STATUS.md` records the hygiene subsection.
- [ ] `git status --short` clean; `git diff --check` clean.

## REVIEW SUBAGENTS

- **Specification guardian:** confirm no frozen artifact changed (fixtures,
  schemas, Specs, CLI contract, skills); confirm README claims stay inside
  frozen scope (six tools only, no runtime-tracing or coverage claims, static
  linkage wording).
- **Implementation reviewer:** verify SHA preconditions, fast-forward-only ref
  moves, push set matches the authorization exactly, no force-push/tag/delete
  path exists in what was run.
- **Test adversary:** hunt for README claims not backed by
  IMPLEMENTATION_STATUS.md; execute every documented command; attempt to find
  a fixture byte changed by the move.

## HANDOFF OUTPUT

Report: files changed; the three commit SHAs; push results
(`git ls-remote --heads origin` output); test counts; fixture results;
assumptions (`ASSUMPTION:` lines); blocked items if any; next blueprint =
`00-02-ci-pipeline` (pending — do not start it).

## IF SOMETHING IS UNCLEAR

Make the smallest safe assumption, record `ASSUMPTION: ...` in the report,
continue without expanding scope. If remote state diverges from the recorded
SHAs, or any push is rejected: stop that item, report blocked, never
force-push.

## TADORI NON-NEGOTIABLES (every blueprint)

Frozen v2.1; TS/JS only; ATLAS separate; exactly six MCP tools; stable 2D
default; evidence/origin/confidence/resolution always visible; invalid
snapshots never served; localhost default; no cloud dependency; Graphify is
ignored reference only — never import/copy/ship; never weaken golden fixtures;
no seventh tool; no runtime tracing; no inferred design rationale as fact.
