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

## Current frontier observed in INDEX

- `08-02` — `apps/viz` scaffold + package map; state `review`. Predecessor
  `08-01` is validated, so `08-02` is dependency-ready.
- Immediate action: read `execution/08-02.md`, confirm its contracts/completion
  cut, then implement. It consumes layout coordinates only (never imports the
  store, graphology, or a second layout implementation).
- Next dependent node after `08-02`: `08-03`.

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

- 2026-07-19: `08-01` validated and delivered on branch
  `bp/08-01-layout-engine-persistence` (two commits: graph substrate +
  layout engine). Full gate + benchmark green; independent validator PASS.
- Next frontier node: `08-02` (`apps/viz` scaffold + package map).
