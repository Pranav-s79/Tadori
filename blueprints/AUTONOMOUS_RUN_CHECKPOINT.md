# Autonomous run checkpoint

This file stores only the current execution frontier. Historical task details
belong in Git/PRs and INDEX, not here.

## Snapshot basis

- Live Git branch/SHA: **verify at session start**; this file cannot prove
  the current working tree.
- Machine-readable scheduler: `blueprints/TASK_GRAPH.json`.
- Execution protocol: `blueprints/GRAPH_ENGINEERING.md`.
- Environment fact: `.npmrc` pins `use-node-version=22.14.0` (a newer machine
  Node has no better-sqlite3 prebuilds/toolchain). Always run tests via
  `pnpm`; bare `npx vitest` bypasses the pin and fails on native ABI.

## Closed nodes observed in INDEX

- Phase 0: `00-01`, `00-01A`, `00-02` validated.
- Phase 7: `07-01`, `07-02`, `07-03` validated.
- Phase 8: `08-01` validated 2026-07-19 (full gate green, 293/293, layout
  benchmark within budget, independent validator PASS, no blocker/high).

Do not rediscover or rebuild these nodes unless live Git proves INDEX false.

## Delivery policy (owner directive 2026-07-20)

- Branch-per-task: each completed node is pushed to its own `bp/<id>-*` branch
  with a PR. **Do not merge** — the owner merges. Do not delete task branches.
- A node depending on an as-yet-unmerged predecessor branches off that
  predecessor's branch (not `main`), since `main` lacks the predecessor code.

## Current frontier observed in INDEX

- `08-02` — DONE on branch `bp/08-02-viz-package-map`, commit `65af9e5`,
  PR #13 open (CI running), not merged. viz 90/90 (adds offline-bundle test),
  root 315/315 unaffected, offline bundle verified, eslint import boundary
  present, labels truncate at 24, single shared `edgeVisualStyle`.
- Next dependency-ready nodes (all depend only on `08-02`): `08-03`, `08-05`,
  `08-06`, `08B-01`. Because `08-02` is not merged to `main`, each must branch
  off `bp/08-02-viz-package-map`.

Independent frontier nodes also exist (`11-01`, `12-01`, `12-02`, `12-03`),
but parallel production work is allowed only with separate worktrees and
disjoint write/contract sets.

## Preserved external state

- The earlier run reported a stash for unexplained `headroom-ai` dependency
  changes. Verify with `git stash list`; do not apply, drop, or include it in
  task PRs without owner direction.

## Resume protocol

1. `git fetch --all --prune`
2. inspect branch, status, recent log, open PRs, and stash list;
3. reconcile only this frontier section with live evidence;
4. choose the next node from TASK_GRAPH;
5. read its execution card, not the full dossier;
6. execute slices and checkpoint after each coherent graph rewrite.

## Last safe stop

- 2026-07-19: `08-01` MERGED via PR #12 (squash), local+origin `main` at
  `99c205a`. Included the graph substrate + the layout engine. Branch deleted.
- In progress: `08-02` (`apps/viz` scaffold + package map) on branch
  `bp/08-02-viz-package-map` off `99c205a`. Contracts verified against live
  enums/routes (edgeVisualStyle, WS backoff 500/1000/2000/4000/5000-cap, API
  types). Coding agent implementing all five slices in `apps/viz` +
  `pnpm-workspace.yaml` + root `eslint.config.js` ignores.
- Next dependent node after `08-02`: `08-03` (semantic zoom: file expansion).
