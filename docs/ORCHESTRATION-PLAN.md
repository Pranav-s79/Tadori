# Orchestration plan — CI reset and delivery restart

**Date:** 2026-08-01
**Status:** proposed, awaiting go-ahead

## 1. Why we are stuck

Not one bug. Three compounding problems, one of which is how I worked.

### 1.1 The gate is a single monolith

`.github/workflows/ci.yml` defines one job, `gate`, that runs everything from
`pnpm install` through `package:smoke` — 17 steps, 30-minute timeout, five
matrix legs. The least deterministic step in the repository, an installed-package
GUI smoke driving headless Firefox on Linux, sits near the end.

Consequence: **nothing can be certified green while that one step is unstable.**
Typecheck, lint, 434 unit tests, fixtures, and the package build all pass on
every leg, and the matrix still reports failure. There is no way to see "the
product is fine, the browser gate is unstable" because the job cannot express it.

### 1.2 There is no green baseline

`main` is red. It has been red independently of this branch, at
`verify:viz:e2e`. So every branch inherits an unexplained base, and "did my
change break this?" has not been answerable at any point.

### 1.3 I pushed changes I had not fully verified — this is the big one

Five fix attempts on KF-001, and it is still red. The pattern is what the
debugging discipline explicitly warns about: three or more failed fixes means
the approach is wrong, not that the next hypothesis is better.

Concretely, several failures were **mine, and locally detectable**:

| Failure | Would a full local gate have caught it? |
|---|---|
| `pnpm lint` unused binding — all 5 legs | **Yes.** I ran typecheck and unit tests, not lint. |
| Stale 4-tab assertions in e2e and smoke | **Yes.** I never ran either gate locally before pushing. |
| axe contrast violation on Overview | **Yes.** `verify:viz:e2e` runs axe. |
| Canvas hidden behind Overview landing mode | **Yes.** Same. |

I was verifying a subset (`vitest` + `tsc`) and pushing, on top of an already-red
baseline, against a 10-minute remote feedback loop. That is the actual reason CI
"just isn't going green" — not any single defect.

### 1.4 The one genuinely hard problem

KF-001's remaining failure is environment-specific: `ubuntu-latest` + Node 22 +
headless Firefox. I cannot reproduce it on Windows, so every hypothesis costs a
full remote matrix run. The latest attempt (`data-graph-ready`) timed out waiting
for readiness, which is new information but was again bought at 10 minutes.

**This must stop being debugged remotely.**

## 2. Principles for the restart

1. **Never push what a local gate has not run.** One command, same steps as CI.
2. **A required check must be one we can keep green.** Anything we cannot yet
   keep green reports, but does not block, and says so out loud.
3. **Reproduce before fixing.** No remote guessing on environment defects.
4. **Small, verified increments onto a known-good base.**

## 3. Target CI architecture

Replace the single `gate` job with three tiers.

### Tier 1 — `verify` (required, fast, deterministic)

Runs on the full OS/Node matrix. Everything here is reproducible locally and
currently passes:

```
install → better-sqlite3 load → skills:check → typecheck → viz typecheck
→ lint → test → python validate_fixtures → fixtures:validate
→ fixtures:index → fixtures:typecheck → package:artifact → npm pack --dry-run
```

Target: **green on every leg, every push.** This is the merge gate.

### Tier 2 — `browser` (required, one leg)

`verify:viz:e2e` (Chrome) and `package:smoke` (Chromium). Both pass locally and
in CI today. Required on `ubuntu-latest / 22.14.0` with Chromium only.

### Tier 3 — `browser-firefox` (reporting only, until stabilized)

`package:smoke` with `TADORI_PACKAGE_BROWSER=firefox` on Linux — the KF-001 leg.
Runs with `continue-on-error: true` and uploads its probe artifact.

**This is not weakening the gate.** The assertion is unchanged and still fails
the job; the job simply does not block merges while a known, documented,
environment-specific defect is open. KF-001 stays open in
`docs/KNOWN_FAILURES.md` with its evidence, and Tier 3 returns to required the
moment it is green twice consecutively.

If this trade is not acceptable, the alternative is to block all delivery until
KF-001 is solved. That should be an explicit decision, not a default.

## 4. Local gate — the thing that actually fixes the loop

Add `pnpm gate` running exactly Tier 1 + Tier 2, and require it before any push.

Add `pnpm gate:firefox` running the Tier 3 leg in Docker against
`mcr.microsoft.com/playwright:v1.x-jammy` with Node 22, so the failing
environment is reproducible in **seconds, locally**, instead of 10 minutes
remotely. This is the single highest-value item in this plan: it converts
KF-001 from unfixable-by-guessing into an ordinary debugging problem.

## 5. Restart sequence

Work packages, in dependency order. Each ends green before the next starts.

| # | Package | Ends when |
|---|---|---|
| **WP0** | Cut `chore/ci-reset` from `main`. Establish what `main` actually fails: currently `verify:viz:e2e` boundary-outside-viewport. | `main`'s failure is reproduced locally and classified |
| **WP1** | Split the workflow into the three tiers above. No product change. | Tier 1 green on all 5 legs from `main` |
| **WP2** | Add `pnpm gate` and `pnpm gate:firefox` (Docker). | `pnpm gate` reproduces CI Tier 1+2 locally; `gate:firefox` reproduces the KF-001 leg |
| **WP3** | Fix `main`'s boundary-viewport defect using WP2's local loop. | `verify:viz:e2e` green on `main` |
| **WP4** | Land the verified product work from `feat/evidenced-project-regions` onto the now-green base, in reviewable slices, each behind `pnpm gate`. | Tier 1 + Tier 2 green with product work included |
| **WP5** | Debug KF-001 with `gate:firefox`. Evidence first; no speculative pushes. | Tier 3 green twice, then promoted to required |

## 6. What carries over from the current branch

All of it is verified locally and worth keeping — the work is sound; the
delivery process was not. Seven defects closed, each live-verified:

- Six level-of-detail derivation defects (Overview entry points, inspector
  continuations, Interview subject/tests, deep-link `select=`, `focusEntity`
  silent no-op, Overview coupling).
- The Inspector interpretation layer, with honesty rules locked by tests.
- AA contrast correction on the reading surfaces.

Current local state on that branch: 56 files / 434 tests, typecheck clean, root
lint clean, `verify:viz:e2e` exit 0, `package:smoke` green on Chromium **and**
Firefox locally.

WP4 re-lands this onto a green base rather than discarding it.

## 7. Decision needed

Section 3 Tier 3 — making the Firefox leg non-blocking while KF-001 stays open
and documented. Everything else follows from it.
