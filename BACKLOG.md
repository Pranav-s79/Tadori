# Tadori v2.1 — Remaining Build Backlog

Source of truth for remaining work. Maintained by the planning model; consumed
by builder agents via `blueprints/`. State lives in files, never in chat.

Last updated: 2026-07-17
Verified repository state: Week 6 complete at `15540b3` (170/170 tests, 5/5
fixtures exact, incremental gates pass). Branch `Sprint7-core-visualization`.
2026-07-17: `origin/main` moved to `6e89fc1` — the owner merged PR #1
(Sprint4) and PR #2 (Sprint5) on GitHub as merge commits. Content-identical to
the Sprint5 tip (`git diff 6795399 origin/main` empty) but the topology is no
longer linear. Owner decision 2026-07-17: continue the GitHub PR-merge
workflow (option a). 00-01 re-scoped: hygiene commits land on
`Sprint7-core-visualization`; push the four sprint branches only (creates
Sprint7 on origin); local `main` fast-forwards to `origin/main`; `main`
advances only via owner-merged PRs (Sprint6, later Sprint7). Never
force-push.

2026-07-17 (later): 00-01 execution built commits `7891a99` (gitignore),
`1f97ee1` (planning vault), `a4ab158` (README replacement + fixture-guide
relocation), all local on `Sprint7-core-visualization`. Full gate green
(170/170 tests, 5/5 fixtures exact, zero dangling endpoints / FK rows).
The blueprint's adversarial README-command check then exposed a real defect:
`pnpm tadori diff .` crashes on Tadori's own repository — `scan.ts` (~L114)
classifies `.js` files as indexed unconditionally while `project.ts` correctly
gates program roots on `allowJs` (unset here), so the reject pass queries the
language service for `eslint.config.js`, which is not in the program. Item
00-01A (corrective, Phase 0) owns the fix; 00-01 is blocked on it plus the
deferred push/main-sync step. MCP-stdio and benchmark README command
verification also remain outstanding under 00-01. A full-project planning
run (all phases through 12) started 2026-07-17: planning only — no production
code, no pushes, no merges, no tags.

2026-07-17 (autonomous run): 00-01A implemented and validated (commit
`8be4741`: allowJs gate in `scanRepository`, 8-test regression matrix, full
gate 178/178, `pnpm tadori diff .` exit 0 on Tadori itself, MCP-stdio and
benchmark README commands verified, adversarial review PASS with 0
blocker/high). Baseline PR #4 merged `main` to the Week 6 + planning-vault
state (`a79a29e`); local `main` fast-forwarded. 00-01 unblocked; its
remainder is the README verification record and status reconciliation.

2026-07-17 (autonomous run, later): 00-01 completed — all four README
quick-start commands verified on `06d951f` (install clean; test 178/178;
`tadori diff .` exit 0; mcp:stdio clean EOF exit 0); README counts refreshed
to 178/25; `git tag` empty; five branches on origin with
`autonomous-roadmap` untouched. Next dependency-ready task: 00-02 (CI).

Frozen constraints (never reopened by any item): six MCP tools only; stable 2D
default (Sigma.js/WebGL, seeded frozen layout, semantic zoom packages → files →
exported symbols); provenance edge legend fixed; evidence/origin/confidence/
resolution visible everywhere; localhost-only; no cloud dependency; invalid
snapshots never served; fixtures authoritative; Graphify is ignored reference
material only; TypeScript/JavaScript only; ATLAS separate; no runtime tracing.

Decisions locked 2026-07-15 (owner answers):
- Push authorized once for existing sprint branches + resulting `main`; no tags/releases.
- One `Sprint<N>-<slug>` branch per phase; local commits per blueprint; one PR per phase.
- Deps allowed: spec-named runtime deps (react, sigma, graphology, fastify,
  simple-git; R3F behind experiment flag only) + minimal tooling (Vite). Anything
  else: justified in-blueprint, reviewed before addition.
- Dev command `pnpm tadori serve .`; Phase 12 ships installable bin (`npm pack`, `npx`).
- OS: Windows primary; Linux in CI; macOS full pilot smoke before RC.
- Browsers: Chromium full; Firefox critical-flow smoke; Safari basic smoke when macOS available.
- Guided Explore: deterministic-only, offline, reproducible, evidence-backed. LLM narration deferred.
- Inspect-only + `vscode://file/...` deep links. Tadori never edits repositories.
- A11y: keyboard access (search/panels/tours/filters/inspection), WCAG AA
  non-canvas UI, accessible list/table alternative for visible graph content.
- Human studies: build infrastructure + protocol docs only; never fabricate or auto-execute results.
- Benchmark baselines: both `codebase-memory-mcp` and `codegraph`; unreproducible installs documented, never guessed.
- `packages/hooks`: narrow evidence receiver (retrieval/plan/file-read/modification/test events); not an agent runtime.
- Pilot: 6–10 participants (owner, TAMU peers, external TS devs).

Item sizing rule: every item below is one coherent builder session. Status:
`pending` → `blueprinted` → `built` → `validated`.

## Phase 6 — Incremental indexing — COMPLETE (no open items)

All twelve Phase-6 concerns (watching, deterministic batching, stale handling,
changed-file detection, affected-region invalidation, dependency-region
refresh, atomic replacement, failed-refresh recovery, cancellation, concurrent
MCP reads, watcher restart, benchmarks) shipped in `15540b3` and are recorded
with gates in `IMPLEMENTATION_STATUS.md`. Do not rebuild; later phases reuse.

## Phase 0 — Repository hygiene (cross-cutting, first)

| ID | Item | Scope | Depends | Status |
|---|---|---|---|---|
| 00-01 | Repo sync & README correction | Hygiene commits on Sprint7; push sprint branches only (main via owner PRs — re-scoped 2026-07-17); relocate fixture README to `packages/fixtures/README.md`; new product root README; commit planning vault | 00-01A | validated (2026-07-17; PR #4 landed hygiene commits, README commands verified post-00-01A, README counts refreshed, statuses reconciled) |
| 00-01A | allowJs scanner contract & regression | Fix `scan.ts` unconditional JS classification: gate `.js/.jsx/.mjs/.cjs` indexing on effective `allowJs`/`checkJs` from the extends-resolved root tsconfig; JS reclassifies to support (captured, hashed) when gated off; regression tests both directions; unblocks `pnpm tadori diff .` on Tadori itself | — | validated (2026-07-17, commit `8be4741`; full gate 178/178; `tadori diff .` exit 0 on Tadori) |
| 00-02 | CI pipeline | GitHub Actions: Linux + Windows; typecheck, lint, test, fixtures:validate/index/typecheck, skills:check; Node 22 pin; better-sqlite3 prebuilds | 00-01 | pending |

## Phase 7 — Local serving & API foundation

| ID | Item | Scope | Depends | Status |
|---|---|---|---|---|
| 07-01 | `packages/server` graph API | Fastify HTTP+WS on 127.0.0.1; read-only snapshot/nodes/edges/evidence/search endpoints over `@tadori/store`; snapshot pinning; `refresh_pending` surface | 00-01 | pending |
| 07-02 | `packages/cli` `tadori serve .` | Frozen CLI contract end-to-end: resolve repo, load config (`.gitignore`/`.tadoriignore`/`tadori.rules.json`), reuse/refresh/rebuild snapshot, validate, start server, open browser, print startup facts, Ctrl+C teardown; frozen flags | 07-01 | pending |
| 07-03 | Serve hardening | Port conflict/fallback, browser-launch failure path, orphan-free supervision of watcher+server, `--snapshot`/`--reindex` paths, non-TS repo errors | 07-02 | pending |

## Phase 8 — Guided 2D visualization

| ID | Item | Scope | Depends | Status |
|---|---|---|---|---|
| 08-01 | Layout engine + persistence | graphology seeded force-directed run once; persist into the existing frozen migration-004 `layout_positions` table (no new migration — ARCHITECTURE.md C-1); frozen positions; new-node package-centroid placement w/ local relaxation; byte-identical reload | 07-01 | pending |
| 08-02 | `apps/viz` scaffold + package map | React+Vite+Sigma.js, fully offline bundle; package-level base map, convex hulls + labels; provenance edge legend (solid/dashed/dotted, muted doc/git) | 08-01 | pending |
| 08-03 | Semantic zoom: file expansion | Package → files level; deterministic; no global movement | 08-02 | pending |
| 08-04 | Task-region symbol expansion | File → exported symbols level (third and final zoom level) | 08-03 | pending |
| 08-05 | Search & filters | Snapshot-scoped FTS5-backed search; relation/kind/provenance filters; keyboard accessible | 08-02 | pending |
| 08-06 | Inspection & evidence panels | Side panels: node/edge inspection, evidence lists w/ file:line, source view (root-confined reads), ADR bodies, `vscode://` deep links | 08-02 | pending |
| 08-07 | Path, route, test, doc displays | `path`-tool parity display, route tables, likely-test display ("not observed inspected" language), documents panel | 08-04, 08-06 | pending |
| 08-08 | `packages/hooks` event receiver | Narrow Claude Code hook receivers: task-start, plan, file-read, modification, test events → observation store; evidence receiver only | 07-01 | pending |
| 08-09 | Observation overlays | Task focus (15% dim), retrieval trace (greens/gray + coverage stat), planned scope (red outline); composable, toggleable, frozen coordinates | 08-02, 08-08 | pending |
| 08-10 | Large-repo performance | Cold 150k LOC → interactive < 5 s; positions byte-identical across reloads; level-of-detail budgets | 08-04 | pending |
| 08-11 | Browser & accessibility validation | Chromium full flows; Firefox critical smoke; keyboard nav; WCAG AA non-canvas; accessible list/table graph alternative | 08-05, 08-06, 08-07 | pending |

## Phase 8B — Guided Explore mode (deterministic only)

| ID | Item | Scope | Depends | Status |
|---|---|---|---|---|
| 08B-01 | Subsystem & overview derivation | Deterministic plain-language repository overview + major-subsystem identification from graph facts (packages, entry points, routes, fan-in), every sentence evidence-backed | 08-02 | pending |
| 08B-02 | Tour engine + progress state | Ordered, reproducible tour steps over frozen layout; progress persisted in `.tadori/`; resume; free-explore transition | 08B-01 | pending |
| 08B-03 | Walkthrough tours | Entry-point, route/request, dependency, and test walkthroughs; recommended exploration sequence; anti-hairball guarantee | 08B-02 | pending |

## Phase 9 — Review mode

| ID | Item | Scope | Depends | Status |
|---|---|---|---|---|
| 09-01 | Review diff API + raw diff UI | Snapshot↔snapshot, working-tree, staged comparisons; added/removed nodes/edges; provenance/confidence/resolution changes; three-way store diff reuse | 08-06 | pending |
| 09-02 | Rename/move coalescing views | Stage A/B coalesced view over raw diff; fixture 04 raw + coalesced artifacts validated | 09-01 | pending |
| 09-03 | Boundary rules & violations | `tadori.rules.json` boundary declarations; violation badges + static warning glyphs; seeded-violation fixture checks | 09-01 | pending |
| 09-04 | `changed_with` extraction | simple-git co-change relation (deferred relation activated); harness un-defer; churn availability for ranking | 09-01 | pending |
| 09-05 | Agent-change review overlays | Base-vs-patched view, planned-scope vs modified, modified-but-not-retrieved indicators | 08-09, 09-01 | pending |

## Phase 10 — Depth experiments

| ID | Item | Scope | Depends | Status |
|---|---|---|---|---|
| 10-01 | 2.5D fixed-tilt mode | Orthographic fixed tilt; depth bound to exactly one SQL-expressible field (layer / base-vs-patched / repo-vs-agent-scope); same data paths as 2D | 08-10 | pending |
| 10-02 | 3D experimental flag | R3F quarantined behind `/experiment`; free orbit only here; z bound to named field; zero cost to default bundle | 10-01 | pending |
| 10-03 | Depth study instrumentation | §8 protocol document, task sets, measurement capture (time, navigation errors, TLX forms), 3D removal criteria pre-registered; no fabricated results | 10-01, 10-02 | pending |

## Phase 11 — Benchmarking

| ID | Item | Scope | Depends | Status |
|---|---|---|---|---|
| 11-01 | `packages/bench` harness | Task runner, per-run raw logs, metrics capture (success, regressions, files inspected, boundary violations, unsupported claims, tokens where observable, wall time), reproducible seeds | 00-02 | pending |
| 11-02 | Seeded-trap repos + task sets | 3 TS corpora 50–150k LOC; 24–30 tasks incl. 6–8 seeded traps; held-out test suites define success | 11-01 | pending |
| 11-03 | Competitor profiles + protocol | Isolated profiles: plain Claude Code, codebase-memory-mcp, codegraph, Tadori MCP, Tadori visual; install reproducibility documented; failures documented not guessed | 11-02 | pending |

## Phase 12 — Hardening & pilot

| ID | Item | Scope | Depends | Status |
|---|---|---|---|---|
| 12-01 | Privacy & data lifecycle | Redaction, ignore rules, retention, purge command, repository-root confinement audit | 07-02 | pending |
| 12-02 | Failure hardening | Corrupt DB recovery, interrupted migration, watcher failure, malformed/unsupported repos, invalid TS, port/browser failures, MCP recovery | 07-03 | pending |
| 12-03 | Packaging & cross-platform | Installable `tadori` bin via `npm pack`; `npx` verification; Linux CI green; macOS pilot smoke | 07-03, 00-02 | pending |
| 12-04 | Documentation & demo | Architecture docs, user guide, demo script/recording plan | 08-11, 09-02 | pending |
| 12-05 | Pilot package & RC | Pilot protocol (6–10 participants), feedback survey, known-limitations doc, release-candidate checklist | 12-01..12-04 | pending |

## Research (blueprints/research/, read-only inputs, no product code)

| ID | Item | Notes |
|---|---|---|
| R-01 | Graphify UX observations | Ignored reference only; what to avoid (hairball) and steal conceptually (report tone); never import/copy code |
| R-02 | Competitor install reproducibility | codebase-memory-mcp + codegraph install/run recipes for 11-03 |
