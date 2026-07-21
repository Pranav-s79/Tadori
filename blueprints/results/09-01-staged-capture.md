# Result — 09-01 staged capture primitive (slice 2)

- **Node:** 09-01 (Phase 9) — review diff. This slice delivers the staged-Git
  capture primitive the review-diff staged comparison kind depends on.
- **Branch:** `bp/09-01-staged-capture` (off `main` @ `93e084f`, which already
  has slice 1 / PR #19).
- **Decision applied (owner):** staged capture uses the installed Git CLI via
  Node `execFile` (shell disabled, args array) — NOT `simple-git`.

## What changed

- `packages/indexer/src/captureStagedTree.ts` (new) — `captureStagedTree(root)`
  materializes the git index into an isolated temp dir via
  `git checkout-index -a -f --prefix=<dir><sep>` and returns
  `{ dir, dispose }`. All git calls use `execFile` with `shell:false` and an
  argument array (never an interpolated command string); the prefix carries the
  platform-correct trailing separator so files land as children of the temp
  dir. The working tree and index are never mutated. `dispose()` removes the
  temp dir (idempotent) and callers dispose in `finally`; on capture failure the
  partially-created dir is cleaned before the error propagates.
- Typed honest errors: `GitUnavailableError` (git not on PATH),
  `NotAGitRepositoryError` (root not a repo), `StagedCaptureFailedError`
  (checkout / invalid-index failure).
- Exported from `packages/indexer/src/index.ts`. The materialized directory
  feeds the existing `indexRepository(rootPath, …)` path unchanged — no new
  indexing path.
- No new runtime dependency (git is treated as an existing prerequisite).

## Proof run

- `pnpm --filter @tadori/indexer exec tsc --noEmit` — exit 0.
- `pnpm exec vitest run packages/indexer/test/captureStagedTree.test.ts` —
  **9/9** (via the pinned Node per `.npmrc`). Cases: staged addition, staged
  modification, staged deletion (absent from staged tree), partially-staged file
  (staged content, NOT the later working-tree edit), filename with spaces,
  cleanup after success (+ idempotent dispose), cleanup after non-repo failure,
  shell-safe args (a `safe;rm -rf x.ts` filename materializes literally),
  git-unavailable (PATH cleared → `GitUnavailableError`, Windows-compatible).
  Temp repos pin `core.autocrlf=false` so checkout preserves LF cross-platform.

## Assumptions / deviations

- `checkout-index` is the primary plumbing (as directed). It writes the index
  contents of tracked files; a staged deletion correctly appears as the file
  being absent from the materialized tree.
- Route wiring for the `kind=staged` / `kind=working_tree` comparison paths in
  `/api/v1/review/diff`, and the viz raw-diff view, are the remaining 09-01
  slices (separate branches) — not in this PR.

## README impact

None.

## Next dependency unlocked

Enables the review-diff staged comparison kind (next 09-01 route slice). 09-02+
still await the full 09-01 (all comparison kinds + UI).
