# BLUEPRINT 09-01: Review diff API + raw diff UI

## 1. Header

- ID / Title / Phase: 09-01 — Review diff API + raw diff UI — Phase 9
- Status: review
- Primary builder: Claude Opus — cross-layer work (server route + UI view)
  touching both the store diff seam and the frozen provenance/evidence
  rendering contract in one coherent session; the raw-vs-coalesced
  presentation boundary and pagination/budget accounting need one builder
  who can reason about both the wire contract and the on-map rendering
  without a hand-off gap.
- Reviewer roles: Spec Guardian (fixture 04 oracle fidelity, frozen-layout
  non-movement), API Contract Reviewer (`ReviewDiff`/`ApiContext` shape),
  Security Reviewer (root confinement on `base`/`head` refs).
- Complexity: L (recommend split — see §1a below if a single session slips)
- Depends on / Unlocks: Depends on 08-06 (inspection/evidence panels — the
  raw diff UI reuses the node/edge inspector shell) and, transitively,
  07-01 (`GraphService`, `diffSnapshotEdges`, `ApiContext`), 08-02 (viz
  scaffold), 08-01 (frozen layout positions the badge overlay must not
  move). Unlocks 09-02 (coalescing view wraps this endpoint's raw output),
  09-03 (violation badges render inside this same diff/inspection shell),
  09-04 (`changed_with` edges flow through this same `ReviewDiff` shape
  once activated), 09-05 (agent-change overlays compose on top of this
  view).
- Estimated sessions: 1, but see split recommendation below — treat as 2 if
  the WS/budget accounting plus the on-map badge renderer both need full
  attention.
- Related frozen-spec sections: ARCHITECTURE.md §9 (Review diff model),
  §3 endpoint #19 (`GET /api/v1/review/diff`), §10 (viz data-loading
  contract — no global layout movement), frozen non-negotiables
  (evidence/origin/confidence/resolution visible everywhere; deterministic
  positions; every visible relation keeps provenance).

### 1a. Split recommendation if L exceeds one session

If the builder's session runs long, split along the existing API/UI seam:
**09-01a** (server: `GET /api/v1/review/diff` route, `ReviewDiff` types,
pagination/omission accounting, unit tests against `diffSnapshotEdges` and
`diffWorkingTree`) ships first; **09-01b** (raw diff UI: list view, on-map
badge overlay, pagination controls) consumes 09-01a's contract once frozen.
Do not split the contract itself — §10 of this blueprint is binding for
both halves.

## 2. Objective

`GET /api/v1/review/diff` returns a `ReviewDiff` (added/removed/changed
nodes and edges, each edge-change row carrying explicit
provenance/confidence/resolution deltas) for any of three comparison
kinds — snapshot↔snapshot, working-tree-vs-active, staged-vs-active — and
the viz app renders it as a raw diff list plus non-moving on-map badge
overlay on the frozen layout, with omission accounting for diffs too large
to return in one page.

## 3. Why this matters

- User value: this is the first screen where a developer sees "what
  changed" in graph terms rather than raw diff text — the entry point to
  the whole Phase 9 review mode.
- System value: proves the store's three-way edge diff
  (`diffSnapshotEdges`) and the indexer's working-tree diff flow
  (`diffWorkingTree`) can back an HTTP-served, paginated, evidence-honest
  view without inventing a second diff algorithm.
- Downstream: 09-02 (coalescing), 09-03 (violation badges), 09-04
  (`changed_with` edges appear as ordinary rows here once activated), 09-05
  (agent-change overlays) all render inside or alongside this view; none of
  them can start until the `ReviewDiff` wire shape is frozen.

## 4. Current repository evidence

Verified current (2026-07-17):

- `diffSnapshotEdges(db, baseSnapshotId, headSnapshotId)`
  (`packages/store/src/diff.ts:21-104`) returns `EdgeDiffRow[]` — exact
  fields: `change_kind: "added" | "removed" |
  "resolution_or_provenance_changed"`, `source`, `relation`,
  `destination` (all `qualified_name` strings, not entity keys — see §8
  decision on re-keying), `before_origin`/`before_confidence`/
  `before_resolution` (null when `change_kind === "added"`),
  `after_origin`/`after_confidence`/`after_resolution` (null when
  `change_kind === "removed"`). This is a **frozen corrections §11**
  algorithm; the SQL is not to be modified by this blueprint.
- `diffWorkingTree(db, rootPath)` (`packages/indexer/src/diffWorkingTree.ts:
  24-61`) returns `WorkingTreeDiffResult { repoRoot, baseSnapshotId,
  headSnapshotId, changed: boolean, edges: EdgeDiffRow[] }`. It resolves
  `base = getActiveSnapshot(db, repo.id, "working_tree")` falling back to
  `getActiveSnapshot(db, repo.id, "commit")`, builds a fresh in-memory head
  snapshot via a throwaway `IncrementalRepositoryIndexer`, and always
  `finally { await indexer.stop() }`. **This is the exact flow
  working-tree-vs-active reuses** — it already returns raw `EdgeDiffRow[]`,
  so the server does not reimplement the working-tree comparison, it calls
  this function directly.
- Node-level add/remove is **not** returned by either store function —
  ARCHITECTURE.md §9 states node add/remove "is derived by
  set-differencing the two `loadSnapshotGraph` node sets" — this blueprint
  implements that set-difference in the server (new code, not a store
  change): `loadSnapshotGraph(db, baseId).nodes` vs
  `loadSnapshotGraph(db, headId).nodes`, keyed by `entityKey`.
- `ApiContext` (ARCHITECTURE.md §3) is the shared response envelope every
  endpoint returns; `SnapshotRefInfo` does not yet exist anywhere in the
  repo — this blueprint defines it (§10) as the minimal shape needed to
  describe "what base/head actually were" (id, kind, label, commit sha).
- `GraphService` has no diff method (`packages/mcp/src/service.ts:66-355`
  read in full — its surface is snapshot-scoped reads, fan-in, search,
  resolve, freshness; no diff). The route therefore calls `@tadori/store`'s
  `diffSnapshotEdges`/`loadSnapshotGraph` directly on the same `db` handle
  the server already holds, exactly as `GraphService.open` does — no new
  abstraction layer.
- `toolNodeSchema`/`toolEdgeSchema` (`packages/mcp/src/contracts.ts:49-88`)
  are the frozen wire shapes every other endpoint reuses (ARCHITECTURE.md
  AD-008); `ReviewDiff.nodesAdded`/`nodesRemoved` must use `ToolNode[]`
  verbatim so the raw diff list can share the existing node-inspector
  component (08-06) unmodified.
- Fixture oracle: `packages/fixtures/04-diff-coalescing/expected/
  raw-diff.json` (validated by `packages/harness/src/validateFixtures.ts:
  75-92` against `schemas/expected-diff.schema.json`) is schema-shaped as
  `addedNodes`/`removedNodes`/`changedNodeMemberships`/`addedEdges`/
  `removedEdges`/`changedEdgeMemberships` — the **raw-mode branch** of the
  `oneOf` in `expected-diff.schema.json:164-174`. This blueprint's
  `ReviewDiff` in raw mode must be able to losslessly express every field
  that oracle carries (node/edge full shape including `bodyHash`,
  `canonicalIdentity`, `entityKey`, evidence arrays) — verify this before
  building the response mapper, not after.
- No `packages/server` code exists yet (blueprint 07-01 is `review` status,
  not yet built) — this blueprint's route slots into 07-01's route table
  at endpoint #19 (ARCHITECTURE.md §3) and depends on 07-01's `ApiContext`/
  route-registration pattern once 07-01 ships. Read
  `blueprints/07-01-server-graph-api.md` §9/§10 for the exact Fastify
  route-registration convention before writing this route (do not invent a
  second convention).
- `EdgeDiffRow.source`/`.destination` are `qualified_name`, not
  `entityKey` — a materially different join than every other endpoint's
  `entityKey`-keyed responses. §8 records the decision to re-key at the
  server boundary rather than propagate qualified-name-keyed rows into the
  wire contract.

Files to read first: `packages/store/src/diff.ts`,
`packages/indexer/src/diffWorkingTree.ts`,
`packages/store/src/snapshots.ts` (`loadSnapshotGraph`, `SnapshotRow`),
`packages/mcp/src/contracts.ts` (`toolNodeSchema`, `toolEdgeSchema`,
`responseContextSchema`), `packages/fixtures/04-diff-coalescing/expected/
raw-diff.json`, `schemas/expected-diff.schema.json`,
`blueprints/07-01-server-graph-api.md`.

Gotchas: `diffWorkingTree` spins up a real `IncrementalRepositoryIndexer`
per call — it is not free; do not call it per-page-request, call it once
per diff request and paginate the in-memory result (§16 budget). The
`00-01A` allowJs scanner fix must be built (or the working-tree diff will
crash on this repo's own `.js` config files during dev/test).

## 5. Scope

1. `GET /api/v1/review/diff` route: query params `base` (snapshot id or
   `"working_tree"` or `"staged"`), `head` (snapshot id or `"active"`),
   `coalesce=raw|coalesced` (this blueprint implements `raw` only;
   `coalesced` is a 404/`not_implemented` stub reserved for 09-02 — see §6).
2. Three comparison kinds: snapshot-id↔snapshot-id (direct
   `diffSnapshotEdges` call), working-tree-vs-active (`diffWorkingTree`
   reuse), staged-vs-active (new: build a staged-tree snapshot the same way
   `diffWorkingTree` builds a working-tree snapshot, but capturing the git
   index instead of the working tree — see §8 for the exact mechanism).
3. Node add/remove set-difference over `loadSnapshotGraph` node sets.
4. `ReviewDiff` response assembly: `context`, `base`/`head`
   `SnapshotRefInfo`, `nodesAdded`/`nodesRemoved` (`ToolNode[]`), `edges`
   (`EdgeDiffRow[]`, re-keyed to `entityKey`-addressable form — §8),
   `presentation: "raw"`.
5. Pagination: `cursor`/`limit` over the edge-diff and node-diff arrays
   independently; omission accounting (`Page<T>.total` plus an explicit
   `omittedCount` note) when a diff exceeds the page budget.
6. Raw diff UI: a list view (grouped by `change_kind`) reusing the 08-06
   node/edge inspector shell, plus an on-map badge overlay on the existing
   frozen layout (08-01) — badges only, **zero layout recomputation**.
7. Error handling: unknown snapshot id → 404; `base === head` → 400;
   repository has no working-tree/staged source available → 404 with an
   actionable message (not a silent empty diff).

## 6. Non-goals

- Coalesced/Stage A/B presentation — that is 09-02, which wraps this
  endpoint's raw output; this blueprint's `coalesce=coalesced` returns
  `501 not_implemented` with a clear message, not a fake stub payload.
- Boundary-violation badges — 09-03.
- `changed_with` edges — this blueprint's edge diff already surfaces any
  edge whatever relation it is (the SQL is relation-agnostic), but no
  `changed_with` edges exist until 09-04 activates the extractor; nothing
  here needs to special-case that relation.
- Agent-change overlays (base-vs-patched, planned-scope) — 09-05.
- Any mutation of the diffed snapshots. This is read-only.
- Diffing across repositories or arbitrary git refs beyond
  snapshot-id/working_tree/staged/active — out of scope; git ref-name
  comparison (e.g. `base=HEAD~3`) is not built here.

## 7. Dependencies and prerequisites

- 07-01 must have shipped: `ApiContext`, route-registration pattern, the
  server's `db`/`GraphService` construction (`GraphService.open`).
- 08-06 must have shipped: node/edge inspector shell components the raw
  diff list reuses.
- 08-01 must have shipped: frozen layout positions the badge overlay reads
  (read-only; this blueprint never writes `layout_positions`).
- 00-01A (allowJs scanner fix) must be built for working-tree diff to
  function against any real-world repo containing plain `.js` files
  (including Tadori's own dev loop).

## 8. Architectural decisions

- **Re-key `EdgeDiffRow` at the server boundary; do not change the store
  function.** `diffSnapshotEdges` returns `source`/`destination` as
  `qualified_name` strings (frozen corrections §11 SQL, `diff.ts:88-90`).
  The server looks up each row's node by `qualified_name` against the
  already-loaded head (or base, for `removed` rows) node set to attach
  `srcEntityKey`/`dstEntityKey` before returning `ReviewEdgeDiffRow` over
  the wire. Rejected: changing `diff.ts`'s SQL to join `entityKey` instead
  — rejected because `diff.ts` is a frozen corrections §11 artifact and the
  store package has no fixture-contract reason to change; the re-keying is
  cheap (one map lookup per row, node sets already in memory) and keeps the
  frozen SQL untouched.
- **Staged-vs-active reuses `diffWorkingTree`'s pattern, not its code
  path.** `diffWorkingTree` is hard-wired to the working tree
  (`IncrementalRepositoryIndexer` reads live files on disk). Staged
  comparison needs a snapshot built from `git show :<path>` content (the
  git index) instead of live disk content. Decision: a new indexer-side
  helper `captureStagedTree(rootPath)` (owned by this blueprint, additive
  to `@tadori/indexer`, mirroring `captureRepository`'s shape but sourcing
  file bytes from `simple-git`'s `show` on `:path` for tracked+staged
  paths) feeds the same `indexRepositoryIntoStore`-style flow. **This is
  the first production use of `simple-git`** in the repo (grep confirms
  zero current imports) — it is in the frozen deps allowlist
  (ARCHITECTURE.md, BACKLOG.md locked decisions) so no new-dependency
  justification is needed beyond citing that allowlist entry. Rejected:
  shelling out to `git show` via `child_process` directly — rejected
  because `simple-git` is already the sanctioned dependency for git
  operations (09-04 also needs it; sharing one library avoids two
  git-invocation strategies in the same phase).
- **`coalesce=coalesced` is a reserved, explicit 501, not silently ignored
  or silently equal to raw.** Rejected: accepting the param and always
  returning raw regardless of value — rejected because that would silently
  misrepresent presentation mode to the client, violating the "unresolved
  stays visibly unresolved" honesty non-negotiable applied to API
  contracts generally.
- **Badge overlay never moves the frozen layout.** The raw diff UI reads
  existing `/api/v1/layout` positions (08-01, read-only) and overlays
  colored/shaped badges at those exact coordinates; it does not run a new
  layout pass, does not add nodes to the graph that aren't already
  positioned (a genuinely new node with no `layout_positions` row is
  placed at its package centroid per the existing 08-01 new-node rule —
  reused, not reinvented here), and does not shift camera automatically
  except an optional "frame changed nodes" button the user must click.
  Rejected: auto-panning/zooming to changes on load — rejected because it
  contradicts "deterministic positions" and "no layout movement" read
  together with user-initiated navigation expectations already set by
  08-02/08-03.
- **Omission accounting is explicit counts, not silent truncation.**
  Mirrors the frozen MCP six-tool omission-accounting pattern
  (IMPLEMENTATION_STATUS.md: "every truncated response includes named
  and/or aggregate omission accounting for nodes and edges, reasons,
  continuation"). `ReviewDiff` pages carry `nodesOmitted`/`edgesOmitted`
  counts plus a `continuation` cursor; the UI must render "N more changes
  not shown, load more" rather than truncating invisibly.

## 9. Exact file plan

- `packages/server/src/routes/reviewDiff.ts` — create. Registers
  `GET /api/v1/review/diff`; resolves `base`/`head` refs to snapshot ids
  (or builds an ephemeral working-tree/staged snapshot); calls
  `diffSnapshotEdges`/`diffWorkingTree`/the new staged-diff helper;
  assembles `ReviewDiff`; paginates.
- `packages/server/src/reviewDiffAssembly.ts` — create. Pure functions:
  `resolveSnapshotRef(db, repoId, ref): SnapshotRefInfo`,
  `diffNodesByEntityKey(baseGraph, headGraph): {added, removed}`,
  `rekeyEdgeDiffRows(rows, baseGraph, headGraph): ReviewEdgeDiffRow[]`,
  `paginateReviewDiff(diff, cursor, limit): {page, nextCursor,
  nodesOmitted, edgesOmitted}`.
- `packages/indexer/src/captureStagedTree.ts` — create. Additive export
  `captureStagedTree(rootPath): Promise<RepositoryCapture>` using
  `simple-git`'s `show`; mirrors `captureRepository`'s output shape so it
  slots into the same `indexRepository`-style pipeline. Adds `simple-git`
  to `packages/indexer/package.json` dependencies (first real use).
- `packages/indexer/src/index.ts` — modify (additive export of
  `captureStagedTree`).
- `apps/viz/src/views/ReviewDiffView.tsx` — create. List view grouped by
  `change_kind`; reuses 08-06's node/edge inspector row component.
- `apps/viz/src/overlays/DiffBadgeOverlay.tsx` — create. Reads
  `/api/v1/layout` positions (already fetched by the base map view) plus
  the diff response; renders badges at existing coordinates only.
- `apps/viz/src/api/reviewDiff.ts` — create. Typed fetch client for the
  endpoint; owns cursor/pagination state.
- `packages/server/test/reviewDiff.test.ts` — create.
- `packages/indexer/test/captureStagedTree.test.ts` — create.
- `blueprints/ARCHITECTURE.md` — **not edited** by this blueprint (per
  task instructions, no existing file is modified); any contract delta
  discovered during build is reported in §21, not silently patched into
  ARCHITECTURE.md.

## 10. Exact contracts

```ts
// packages/server/src/reviewDiffAssembly.ts
export interface SnapshotRefInfo {
  ref: string;                       // the raw query param, echoed back
  snapshotId: number;
  kind: "commit" | "working_tree" | "staged" | "patch";
  label: string | null;
  baseCommitSha: string | null;
  ephemeral: boolean;                // true for working_tree/staged (not a stored snapshot row)
}

export interface ReviewEdgeDiffRow {
  changeKind: "added" | "removed" | "resolution_or_provenance_changed";
  srcEntityKey: string | null;       // null only if the endpoint node itself is unresolved
  srcQualifiedName: string;
  relation: Relation;
  dstEntityKey: string | null;
  dstQualifiedName: string;
  before: { origin: Origin; confidence: Confidence; resolution: Resolution } | null;
  after: { origin: Origin; confidence: Confidence; resolution: Resolution } | null;
}

export interface ReviewDiff {
  context: ApiContext;
  base: SnapshotRefInfo;
  head: SnapshotRefInfo;
  nodesAdded: ToolNode[];
  nodesRemoved: ToolNode[];
  edges: ReviewEdgeDiffRow[];
  presentation: "raw";
  nodesOmitted: number;
  edgesOmitted: number;
  nextCursor: string | null;
}

export interface ReviewDiffQuery {
  base: string;                      // snapshot id, "working_tree", or "staged"
  head: string;                      // snapshot id or "active"
  coalesce?: "raw" | "coalesced";    // "coalesced" -> 501 in this blueprint
  cursor?: string;
  limit?: number;                    // default 500, max 2000 edges per page
}
```

HTTP behavior:

| Condition | Response |
|---|---|
| `base === head` (same resolved snapshot id) | 400 `{code: "same_snapshot"}` |
| unknown snapshot id in `base`/`head` | 404 `{code: "unknown_snapshot"}` |
| `coalesce=coalesced` | 501 `{code: "not_implemented", detail: "coalesced presentation ships in 09-02"}` |
| working-tree/staged requested but repo has no such state (e.g. bare clone) | 404 `{code: "no_working_tree"}` / `{code: "no_staged_changes"}` |
| success | 200 `ReviewDiff` |

```ts
// packages/indexer/src/captureStagedTree.ts (additive @tadori/indexer export)
export async function captureStagedTree(rootPath: string): Promise<RepositoryCapture>;
// Sources file bytes for tracked+staged paths via simple-git `show :path`
// (git index content, not working-tree content); paths with no staged
// version (deleted-in-index) are excluded from the capture, matching how
// diffWorkingTree treats deletions as absence from the head snapshot.
```

## 11. Ordered implementation procedure

1. Write `packages/indexer/test/captureStagedTree.test.ts` covering:
   a temp git repo with a staged add, a staged modify, a staged delete,
   and an unstaged-only change (must NOT appear). Add `simple-git` to
   `packages/indexer/package.json`. Implement `captureStagedTree`. Reason:
   staged diff has no existing store/indexer primitive; build and pin its
   contract before the route depends on it. Expected: new tests fail then
   pass; existing indexer suite (170+) stays green.
2. Write `packages/server/test/reviewDiffAssembly.test.ts` for
   `diffNodesByEntityKey`, `rekeyEdgeDiffRows`, `paginateReviewDiff` against
   fixture 04's `before-graph.json`/`after-graph.json` (loaded via
   `@tadori/harness`'s `loadExpectedGraph`, not through the live indexer —
   these are pure functions over already-loaded graphs). Assert the raw
   output is loss-lessly comparable to `expected/raw-diff.json`'s
   `addedNodes`/`removedNodes`/`addedEdges`/`removedEdges`/
   `changedEdgeMemberships` shape (field-by-field, not byte-identical JSON
   — the wire shape differs from the fixture oracle's shape by design,
   documented in §13). Implement the three functions. Expected: green.
3. Write `packages/server/test/reviewDiff.test.ts`: route registration,
   the five HTTP-behavior rows in §10's table, snapshot↔snapshot happy
   path against a real indexed fixture-04 before/after pair inserted into a
   temp store DB. Implement `packages/server/src/routes/reviewDiff.ts`
   wiring the three comparison kinds. Expected: green; `pnpm typecheck`
   clean.
4. Build `apps/viz/src/api/reviewDiff.ts` typed client + cursor state.
5. Build `apps/viz/src/views/ReviewDiffView.tsx` (list, reusing 08-06 row
   components) and `apps/viz/src/overlays/DiffBadgeOverlay.tsx` (reads
   existing layout positions; renders badges; no recomputation). Manual
   verification: load the view against fixture 04's before/after snapshots
   served through a real running server, confirm badges land on the
   already-fixed layout coordinates and the list matches `raw-diff.json`
   semantically.
6. Full validation gate (§15).

## 12. Data and lifecycle flows

**Snapshot↔snapshot request:** client `GET
/api/v1/review/diff?base=12&head=15` → server resolves both ids via
`getSnapshot` → `loadSnapshotGraph` both → `diffSnapshotEdges(db, 12, 15)`
→ re-key rows → set-diff nodes → paginate → respond.

**Working-tree-vs-active request:** client `GET
/api/v1/review/diff?base=working_tree&head=active` → server resolves
`head` to the current active snapshot id → calls `diffWorkingTree(db,
repoRoot)` (which internally picks its own base per its documented
fallback) → **note**: `diffWorkingTree`'s internal base-selection may not
exactly equal the caller's requested `head`; if they diverge the response
`base`/`head` `SnapshotRefInfo` reports what was **actually diffed**, per
the frozen "server must surface the actual served snapshot.kind" principle
(ARCHITECTURE.md §2 freshness caveat) — never silently substitute without
disclosure.

**Staged-vs-active request:** client `GET
/api/v1/review/diff?base=staged&head=active` → server calls
`captureStagedTree(repoRoot)` → feeds it through the same
`indexRepositoryIntoStore`-style extraction as `diffWorkingTree` does for
the working tree, producing an ephemeral head snapshot → diffs against the
active snapshot → **the ephemeral snapshot is never persisted as a
reusable row** (matches `diffWorkingTree`'s `finally { await
indexer.stop() }` cleanup discipline — no orphan snapshot rows left
behind).

**Failure/retry:** any extraction failure (syntax error in working tree,
git command failure for staged) surfaces as a 500 with a redacted message
(no absolute paths) and the server logs the underlying error; no partial
`ReviewDiff` is ever returned.

## 13. Test plan

- Unit: `captureStagedTree` (staged add/modify/delete/unstaged-exclusion —
  4 cases minimum).
- Unit: `diffNodesByEntityKey`, `rekeyEdgeDiffRows`, `paginateReviewDiff`
  against fixture 04's expected graphs; assert every node/edge present in
  `raw-diff.json`'s `addedNodes`/`removedNodes`/`addedEdges`/`removedEdges`
  appears in the assembled `ReviewDiff` (by `entityKey`), and every
  `changedEdgeMemberships` entry appears as a
  `resolution_or_provenance_changed` row with matching before/after triples.
- Integration: `GET /api/v1/review/diff` route — all three comparison
  kinds, all five error rows in §10's table, pagination with a
  synthetic >2000-edge diff (assert `edgesOmitted > 0` and `nextCursor`
  present, then assert a second page with the cursor returns the
  remainder and eventual `edgesOmitted === 0`).
- Fixture regression: run the assembled `ReviewDiff` (raw mode) for
  fixture 04 before→after through the full server route (not just the
  pure functions) and assert semantic equivalence with
  `expected/raw-diff.json`'s node/edge sets — this is the acceptance
  oracle for this blueprint's raw path (09-02 owns the coalesced oracle).
- Browser (manual, recorded in §21): load `ReviewDiffView` + badge overlay
  against a real served fixture-04 diff; screenshot showing badges at
  frozen layout coordinates with zero movement from the base map view.
- Regression: full existing 170+ test suite stays green; 5/5 fixtures
  exact.

## 14. Acceptance criteria

- [ ] `GET /api/v1/review/diff` implements all three comparison kinds and
      the five response rows in §10's HTTP-behavior table.
- [ ] `ReviewDiff.edges` for fixture 04 before→after semantically matches
      every node/edge in `expected/raw-diff.json` (add/remove/changed-edge
      sets equal by entity key).
- [ ] `coalesce=coalesced` returns 501, never a silent raw substitution.
- [ ] Pagination returns explicit `nodesOmitted`/`edgesOmitted` counts and
      a working `nextCursor`; a paginated multi-page fetch reconstructs the
      full diff with zero duplicate or missing rows.
- [ ] The raw diff UI badge overlay renders at coordinates read from
      `/api/v1/layout` with zero layout recomputation calls (verified: no
      graphology layout invocation in the viz bundle's diff view code
      path).
- [ ] `captureStagedTree` excludes unstaged-only changes and includes
      staged deletes as absent from the head capture.
- [ ] Full existing suite (170+ tests) and 5/5 fixtures stay green.
- [ ] `pnpm typecheck`, `pnpm lint` clean on all new files.

## 15. Validation commands

pnpm skills:check; pnpm typecheck; pnpm lint; pnpm test;
python validate_fixtures.py; pnpm fixtures:validate; pnpm fixtures:index;
pnpm fixtures:typecheck; pnpm benchmark:incremental; git diff --check;
git status --short; (new) manual server-start + browser check of
`ReviewDiffView` against a fixture-04 served instance, screenshot attached
to §21.

## 16. Performance budgets

- Snapshot↔snapshot diff over the 150k-LOC benchmark corpus: `diffSnapshotEdges`
  SQL executes in < 500 ms (SQL-only, no extraction cost).
- Working-tree/staged diff: bounded by the existing incremental-refresh p95
  gate (< 2000 ms single-file, per `benchmark-incremental.mts`) plus one
  full `captureStagedTree`/`diffWorkingTree` invocation — no additional
  budget beyond the already-gated incremental refresh cost.
- Pagination: default page 500 edges / 500 nodes; hard cap 2000 edges per
  page (matches the `/api/v1/edges` cap in ARCHITECTURE.md §3 row 5).
- Badge overlay render: no additional network round-trip beyond the
  already-fetched layout positions and the diff response itself (2 fetches
  total for the combined view).

## 17. Failure and recovery behavior

- Unknown snapshot id → 404, no partial response.
- Working tree contains a syntactically invalid file → the underlying
  `InvalidRepositorySourceError` (existing indexer behavior) surfaces as a
  500 with an actionable message; no ephemeral snapshot is left in the
  store.
- Git command failure during `captureStagedTree` (e.g. not a git repo,
  detached-HEAD edge cases with no index) → 404 `no_staged_changes` if the
  repo has no git metadata at all, 500 with redacted message for any other
  git-command failure.
- Interrupted request (client disconnects mid-pagination) → server holds
  no per-client diff state between page requests beyond the opaque cursor
  (which encodes offset, not a server-side session) — a repeated identical
  request always recomputes deterministically, matching WS's
  reconnect-refetch philosophy (ARCHITECTURE.md AD-010).

## 18. Security and privacy

- Root-confined: `base`/`head` accept only snapshot ids or the literal
  strings `working_tree`/`staged`/`active` — no arbitrary git ref strings,
  no path traversal surface.
- No absolute paths ever appear in error responses (matches `ApiError`
  contract, ARCHITECTURE.md §3).
- `captureStagedTree` reads only the repository already opened by the
  server (no new root, no new network access); `simple-git` operations are
  local-only (`git show`, `git diff --cached --name-status` equivalents),
  never network `git` operations (no fetch/pull/clone).

## 19. Accessibility

- Raw diff list is a genuine list (ordered/unordered semantic HTML in the
  React tree), keyboard-navigable (arrow/tab through change rows),
  screen-reader text per row states change kind, relation, and
  before/after provenance in words (not color-only).
- Badge overlay is supplemented by the same list view as a non-canvas
  alternative — every badge has a corresponding list row, satisfying the
  frozen "accessible list/table alternative for visible graph content"
  non-negotiable.
- Reduced motion: no animated badge entrance; badges appear instantly.

## 20. Documentation updates

None beyond `IMPLEMENTATION_STATUS.md`, which the builder updates per
standard practice when this blueprint ships (adds a Week 9 review-mode
entry). No edits to `INDEX.md`/`BACKLOG.md`/`ARCHITECTURE.md` by this
blueprint itself (per task instructions); any contract delta found during
build is called out in §21 for a separate follow-up pass to reconcile.

## 21. Builder final report

Require: summary; files changed; contracts implemented (`ReviewDiff`,
`ReviewEdgeDiffRow`, `SnapshotRefInfo`, `captureStagedTree`); tests added
(names + count); validation command output summary; fixture-04
raw-diff semantic-equivalence evidence; screenshot of the raw diff UI +
badge overlay; commit SHA; known limitations; follow-on risks (especially
anything discovered that contradicts ARCHITECTURE.md §9, which this
blueprint must report rather than silently patch); `ASSUMPTION:` lines.

## 22. Independent review result

Pending Wave 3 adversarial review.

## IF SOMETHING IS UNCLEAR

Smallest safe assumption + `ASSUMPTION:` line. If ambiguity touches
`diffSnapshotEdges`'s frozen SQL, fixture 04's expected artifacts, or any
other frozen fixture/schema, stop and report blocked rather than guessing.

## TADORI NON-NEGOTIABLES

Frozen v2.1; TS/JS only; ATLAS separate; exactly six MCP tools; stable 2D
default; deterministic positions; every visible relation keeps evidence,
origin, confidence, resolution; unresolved stays visibly unresolved;
`tadori serve .` is the normal command; localhost default; no cloud
dependency; never weaken golden fixtures; no seventh tool; no runtime
tracing.
