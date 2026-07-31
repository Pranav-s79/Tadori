# CI failure matrix — 2026-07-31

Frozen base: `56c82f1` (PR #53). No product commits added to that PR.

## Run 30665869341 — branch `feat/evidenced-project-regions` @ 56c82f1

| Job | Matrix leg | Failing step | Exact error | KF-001? | Logs retrieved |
|---|---|---|---|---|---|
| 91272663882 | ubuntu-latest, 22.14.0 | `Run pnpm lint` | `overviewModel.ts:159:71 'nodes' is assigned a value but never used` | No | Yes |
| 91272663841 | ubuntu-latest, 24.18.0 | `Run pnpm lint` | same | No | Yes |
| 91272663846 | ubuntu-latest, 26.5.0 | `Run pnpm lint` | same | No | Yes |
| 91272663862 | windows-latest, 22.14.0 | `Run pnpm lint` | same | No | Yes |
| 91272663925 | macos-latest, 22.14.0 | `Run pnpm lint` | same | No | Yes |

**One root cause across all five legs.** Introduced by product commit `80c77c5`
when coupling moved off the rendered node set and left the binding unused.
Reproduced locally with `pnpm lint` (exit 1, identical message) before any fix.

No leg is a cancellation, and none is a consequence of an earlier failure —
`lint` is the first failing step in each, and each leg runs independently.

**KF-001 did not execute at this SHA.** `lint` precedes `package:smoke` in the
job, so the run aborted before the installed-GUI keyboard descent was reached.
KF-001's status at `56c82f1` is unknown, not failing.

## Run on `main` @ b641c1c — a distinct, pre-existing failure

| Job | Matrix leg | Failing step | Exact error | KF-001? | Logs retrieved |
|---|---|---|---|---|---|
| 90786312904 | ubuntu-latest, 22.14.0 | `Run pnpm verify:viz:e2e` | `AssertionError [ERR_ASSERTION]: Expanded package boundary projected outside the map viewport: {"x":755.235,"y":931.298,"width":1088,"height":916}` at `scripts/verify-viz-e2e.mts:211` | No | Yes, via `gh api repos/.../actions/jobs/90786312904/logs` |

Four of five legs pass on `main`; only ubuntu 22.14.0 fails.

`gh run view --log-failed` did not surface this; the direct job-log endpoint did.

### Classification

This is **not** KF-001. KF-001 is keyboard descent in `package:smoke` under
headless Firefox, where no keydown reaches the canvas. This is a boundary badge
projecting at `y = 931.3` in a `916`-tall viewport — roughly 15px below the
fold — asserted by the Chrome-driven `verify:viz:e2e` script.

The captured log lists mode tabs `mode-tab-changes` and `mode-tab-table` with no
`overview` or `interview` tab, confirming the run predates the Overview and
Interview work. **Pre-existing, and unrelated to any product commit on the
branch.**

## Summary

- **Three distinct failures**, not one:
  1. `pnpm lint` unused binding — all 5 legs on the branch. Mine. Fixed on
     `feat/inspector-interpretation` as `2fb8ab0`.
  2. `verify:viz:e2e` boundary-outside-viewport — 1 leg on `main`. Pre-existing.
  3. KF-001 keyboard descent — parked, and **not currently red anywhere**
     because it has not been reached since the lint break.
- **No green base exists.** `main` is red on one leg.
- No speculative CI change was made.
