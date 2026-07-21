# Result — 09-01 review-diff comparison kinds (slice 3)

- **Node:** 09-01 (Phase 9) — review diff. Adds the `kind` comparison-kind
  parameter to `GET /api/v1/review/diff`.
- **Branch:** `bp/09-01-comparison-kinds` (off `main` @ `4f0bd8e`).

## What changed

- `packages/server/src/routes/review.ts` — `/review/diff` now accepts a `kind`
  query param over the three frozen comparison kinds
  (`snapshot` | `working_tree` | `staged`):
  - `snapshot` (default) — unchanged snapshot↔snapshot behavior.
  - unknown kind → `400 bad_comparison_kind`.
  - `working_tree` / `staged` → **`501 <kind>_comparison_unimplemented`**. Their
    capture→index→diff wiring (via the already-merged `captureStagedTree` /
    existing `diffWorkingTree`) is the next slice; the 501 keeps the contract
    honest rather than silently falling through to a snapshot diff.

This mirrors the existing `coalesce=coalesced → 501` honesty pattern: an
unsupported-yet mode refuses explicitly, never a silent substitution.

## Proof run

- `pnpm --filter @tadori/server exec tsc --noEmit` — exit 0.
- `pnpm exec vitest run packages/server/test/review.test.ts` — **9/9** (via
  pinned Node): the 6 prior route cases plus `bad_comparison_kind` (400),
  `working_tree`/`staged` (501), and default `kind=snapshot` behavior.

## Assumptions / deviations

- The full capture→index→diff data path for `working_tree`/`staged` is
  deliberately deferred to its own slice rather than shipped hastily — inserting
  a transient captured snapshot into the served store and diffing node-level
  adds/removes against the active snapshot (without polluting the store or
  racing the refresh worker) needs real-indexed-DB integration tests. Shipping
  the honest 501 contract first keeps the API truthful and un-blocks the viz
  view against `kind=snapshot`.

## README impact

None.

## Next dependency unlocked

The `kind=working_tree` / `kind=staged` capture→index→diff route slice, then the
viz `ReviewDiffView` + `DiffBadgeOverlay`.
