# 09-01 — review-diff working_tree/staged data-path wiring

Branch: `bp/09-01-wt-staged-wiring` (on top of `main` @ 0a4f7bc, PR #22).

## What was implemented

`GET /api/v1/review/diff?kind=working_tree|staged` now returns a real diff of
the live disk / git-index against the served **active** snapshot, replacing the
honest 501 placeholders from PR #22. `kind=snapshot` (the default) is unchanged.

### Design (no active-snapshot mutation)

`insertSnapshotGraph` / `indexRepositoryIntoStore` **always activate** the
snapshot they persist. Persisting a live-capture head into the served DB would
therefore rotate the active snapshot — forbidden by the guardrails. So
`computeLiveComparison` (`packages/server/src/liveComparison.ts`):

1. captures the live tree — the working tree directly, or `captureStagedTree`'s
   materialized git index for `staged`;
2. indexes it into an **isolated temporary SQLite DB** via
   `indexRepositoryIntoStore` (never the served DB);
3. `loadSnapshotGraph`s both the temp head and the served active base;
4. diffs them in memory (`diffGraphs`) — the in-memory expression of the frozen
   §11 three-way edge set-difference plus node add/remove, keyed on stable
   entity keys, with deterministic output ordering;
5. disposes the temp DB + staged temp dir in `finally`.

The working tree and git index are never mutated; the served active snapshot is
never rotated.

### Reused seams (no parallel systems)

`captureStagedTree`, `indexRepositoryIntoStore`, `loadSnapshotGraph`,
`getActiveSnapshot` (served snapshot via `graphState.current().snapshot`),
`paginateReviewDiff`/`toToolNode` for the response, `EdgeDiffRow` shape.

### Bug fixed during wiring

`captureStagedTree` now materializes into a child dir named after the real repo
(`<mkdtemp>/<basename(root)>/`). The package node's identity falls back to the
root basename when a repo has no root `package.json` name (indexer
`extract.ts`); a mismatched temp-dir basename previously fabricated a spurious
top-level package add/remove in the staged diff. `dispose()` still removes the
whole temp tree; `captureStagedTree.test.ts` (which reads `capture.dir`) stays
green.

### Honest errors

- git not on PATH → 501 `git_unavailable`
- served repo not a git repo → 400 `not_a_git_repository`
- staged/live capture or index failure → 400 `staged_capture_failed` /
  `<kind>_capture_failed`
- any unexpected error is re-thrown (Fastify 500), never mislabeled as a known
  condition.

The live-capture head has no persisted snapshot row, so it is reported honestly
as `{ id: -1, kind, status: "live", label: "<kind> (live capture)" }` — never a
fabricated id.

## Tests & gates run

- `packages/server/test/reviewLive.test.ts` (new, real git + real SQLite, 9/9):
  working_tree add/remove/unchanged; staged addition/deletion/partial-staging;
  a working-tree-only change does **not** leak into the staged comparison;
  non-git repo → 400; no temp-dir leak and `git status --porcelain` unchanged
  after two comparisons (working tree + index untouched).
- `packages/server/test/review.test.ts`: the stale 501 assertions for
  working_tree/staged replaced with the wired behavior (working_tree empty diff
  for an unchanged tree; staged → 400 in the non-git fixture repo).
- `pnpm exec vitest run packages/server packages/indexer` → **159/159 pass**
  (includes the existing `captureStagedTree` suite under the nesting change).
- `pnpm typecheck` → exit 0.
- `pnpm exec eslint packages apps scripts` → exit 0 (the only `pnpm lint`
  failures are in untracked `.claude/worktrees/` agent copies, absent from the
  CI checkout).

## Testing-expectation coverage (from the execution card)

snapshot unchanged ✓ · working_tree uses live disk ✓ · staged uses git index ✓
· partial staging uses staged content ✓ · staged add/modify/delete appear ✓ ·
working-tree-only change excluded from staged ✓ · temp repos/DBs cleaned ✓ ·
git-unavailable / non-repo / capture failure → explicit errors ✓ · active vs
comparison snapshot not confused (temp DB, no rotation) ✓ · working tree + git
index never mutated ✓ · paths with spaces/metacharacters safe (inherited from
`captureStagedTree`) ✓ · Windows (this run) — Linux pending CI.

## Remaining 09-01 slice

Viz Slice B: typed `apps/viz/src/api/reviewDiff.ts` client + cursor state;
`ReviewDiffView` list (reusing 08-06 row components); non-moving
`DiffBadgeOverlay` reading `/api/v1/layout` coordinates with **zero** layout
recomputation. Split out as a follow-up PR (frontend slice consuming this
now-wired backend).
