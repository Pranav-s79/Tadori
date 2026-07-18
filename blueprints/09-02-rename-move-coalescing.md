# BLUEPRINT 09-02: Rename/move coalescing views

## 1. Header

- ID / Title / Phase: 09-02 — Rename/move coalescing views — Phase 9
- Status: review
- Primary builder: Claude Sonnet — a well-bounded presentation-layer
  transform over an already-frozen raw diff (09-01), with an exact fixture
  oracle to match; no novel architecture.
- Reviewer roles: Spec Guardian (fixture 04 coalesced oracle fidelity,
  frozen-corrections coalescing rules), Test Adversary (Stage A/B
  matching edge cases, the recursive-self-reference fallback), API
  Contract Reviewer (`coalesce=coalesced` wire shape).
- Complexity: M
- Depends on / Unlocks: Depends on 09-01 (the raw `ReviewDiff` this
  blueprint's `coalesce=coalesced` mode wraps; 09-01 stubs this mode as
  501). Unlocks 12-04 (documentation & demo depends on 09-02 per
  `blueprints/INDEX.md` row 12-04).
- Estimated sessions: 1
- Related frozen-spec sections: ARCHITECTURE.md §9 (raw is source of
  truth; coalesced is a derived presentation view referencing raw rows;
  fixture 04 is the acceptance oracle); `docs/Specs/
  Tadori-v2.1-Corrections.md` coalescing rules (body-hash-stable moves,
  signature matches); `.claude/skills/tadori-indexer/SKILL.md` recursive
  self-reference note (quoted verbatim in §8).

## 2. Objective

`GET /api/v1/review/diff?coalesce=coalesced` returns a `CoalescedChange[]`
view computed from the same raw `ReviewDiff` edges (09-01), applying
Stage A (identity-basis match) then Stage B (body-hash/signature match)
exactly as the frozen corrections doc and fixture 04's
`expected/coalesced-diff.json` define them; every coalesced row references
the raw rows it collapses so a user can expand back to raw, and every
ambiguous or non-matching case falls back to raw display with a stated
reason — never a silently invented certain match.

## 3. Why this matters

- User value: a raw diff over a rename/move-heavy commit is unreadable
  (dozens of added+removed rows for one moved file); coalescing turns that
  into "moved: `src/legacy/helper.ts` → `src/helpers/helper.ts`" the way a
  developer actually reads a code review.
- System value: this is the first consumer of the harness's currently
  **deferred** fixture-04 coalesced-diff check
  (`IMPLEMENTATION_STATUS.md`: "Checks: seeded boundary violations,
  non-variable excluded candidates, raw/coalesced diff artifacts of
  fixture 04 (Week 9)") — un-deferring it here is the concrete Week 9
  deliverable that check was always waiting for.
- Downstream: 12-04 (documentation & demo) depends on this blueprint per
  `blueprints/INDEX.md` row 12-04's dependency list.

## 4. Current repository evidence

Verified current (2026-07-17):

- Fixture 04's oracle files are the two branches of
  `schemas/expected-diff.schema.json`'s top-level `oneOf`
  (`expected-diff.schema.json:164-190`): the **raw branch**
  (`addedNodes`/`removedNodes`/`changedNodeMemberships`/`addedEdges`/
  `removedEdges`/`changedEdgeMemberships`, consumed by 09-01) and the
  **coalesced branch** (`nodePairs`/`edgePairs`/`ambiguousNodeGroups`/
  `residualAddedNodes`/`residualRemovedNodes`/`changedNodeMemberships`/
  `residualAddedEdges`/`residualRemovedEdges`/`changedEdgeMemberships`/
  `notes`/`semanticAssertions` — required together,
  `expected-diff.schema.json:175-189`). This blueprint's
  `CoalescedChange[]` must be able to express every field of the
  coalesced branch.
- `packages/fixtures/04-diff-coalescing/expected/coalesced-diff.json`
  (read in full) contains exactly three `nodePairs`: two Stage-A matches
  (`file:src/legacy/helper.ts` → `file:src/helpers/helper.ts`, basis
  `["kind","unqualifiedName","bodyHash","analyzerVersion"]`, and
  `fn:helper.normalize.old` → `fn:helper.normalize.new`, same basis) and
  one Stage-B match (`method:formatter.formatValue` →
  `method:formatter.renderValue`, basis
  `["kind","bodyHash","analyzerVersion","uniqueCandidate"]`). Eight
  `edgePairs` reference these node pairs by before/after edge id. `class`
  is always the literal `"moved_or_renamed_likely"` and `label` is always
  the literal `"Moved or renamed — likely"` (both `const` in the schema,
  `$defs.nodePair`/`$defs.edgePair`, lines 468-487/513-517) — **coalescing
  never claims certainty**, it is always presented as a likely inference,
  matching the frozen "unresolved stays visibly unresolved" spirit applied
  to inferred structural moves.
- `changedNodeMemberships`/`changedEdgeMemberships` (body-hash or
  provenance changes on entities that did **not** move) pass through
  unchanged in both raw and coalesced branches — coalescing only affects
  add/remove pairs, never in-place changes.
- `residualAddedEdges`/`residualRemovedEdges` in the fixture (read in
  full) are the edges that remain genuinely added/removed **after**
  coalescing removes the edges absorbed into `edgePairs` — e.g.
  `fn:task.processTask -calls-> method:notifier.Notifier.send` (genuinely
  new) stays in `residualAddedEdges`, while
  `fn:task.processTask -calls-> method:formatter.formatValue/renderValue`
  is absorbed into an `edgePair` and does **not** appear in either
  residual list. `ambiguousNodeGroups: []` in this fixture — no ambiguous
  case is seeded, so this blueprint's ambiguity-handling code path is
  exercised only by new tests this blueprint writes, not by the fixture
  oracle (§13).
- The fixture's `notes` array (verbatim,
  `coalesced-diff.json:332-335`):
  ```
  "Raw graph identities remain unchanged; coalescing is presentation-time only.",
  "Recursive functions whose bodies contain self-references will not
  Stage-B match after rename because the body text and body hash change
  with the name; raw added/removed diff is the accepted fallback."
  ```
  This is the exact, load-bearing statement that the recursive-self-
  reference case is **not a bug to fix** — it is documented, intentional
  behavior this blueprint must preserve and surface, never disguise as a
  match.
- `.claude/skills/tadori-indexer/SKILL.md` (identical content mirrored at
  `.agents/skills/tadori-indexer/SKILL.md` and the canonical
  `agent-skills/tadori-indexer/SKILL.md`) states verbatim (lines 18-20):
  "Recursive self-referencing symbols may fail Stage-B rename matching
  because a body hash changes with the name; the raw-diff fallback is
  intentional. Preserve this behavior rather than disguising it as a
  certain match." This blueprint's Stage B matcher must reproduce exactly
  this failure mode (a renamed recursive function whose body contains its
  own old name in a self-call will not body-hash-match after rename) and
  must not attempt a workaround (e.g. name-normalizing the body before
  hashing) that would make it match — doing so would contradict this
  documented, reviewed decision.
- Harness un-defer target: `packages/harness/src/compare.ts:432` currently
  emits `deferredChecks: ["boundary violations (...) - boundary
  enforcement is a later milestone", "excluded candidates other than
  variables (...)", ..., "deferred node kinds for this milestone: ..."]`
  — **the fixture-04 raw/coalesced diff artifacts are not in this list at
  all today**; they are validated only by
  `validateFixtures.ts:75-92` (schema-shape validation against
  `expected-diff.schema.json`), which already runs unconditionally in
  `pnpm fixtures:validate`. **What "un-defer" means here, precisely**: the
  IMPLEMENTATION_STATUS.md prose line ("raw/coalesced diff artifacts of
  fixture 04 (Week 9)") is a **documentation-level deferral note**, not a
  `DEFERRED_RELATIONS`/`DEFERRED_NODE_KINDS`/`compare.ts` code-level
  deferral — there is no boolean flag in the harness gating these two
  files' validation off. The concrete harness change this blueprint makes
  (§9) is: (a) add a **new** harness check —
  `compareFixtureDiff(repoRoot)` in `packages/harness/src/compareDiff.ts`
  — that runs the actual coalescing algorithm against fixture 04's before/
  after stored snapshots and asserts semantic equivalence to both
  `raw-diff.json` (09-01's job, already covered) and
  `coalesced-diff.json` (this blueprint's job); (b) update
  `IMPLEMENTATION_STATUS.md`'s "Relations intentionally deferred" section
  to move the "raw/coalesced diff artifacts of fixture 04 (Week 9)" line
  out of the deferred-checks list into the "Fixture relations currently
  supported" narrative, since it is now an executed, asserted check, not
  merely a schema-shape validation.
- No coalescing code exists anywhere in the repo today (grep for
  `nodePair`, `edgePair`, `Stage A`, `Stage B`, `bodyHashOfText` outside
  `extract.ts`/fixtures returns nothing in `packages/*/src`).
  `bodyHashOfText(declarationText)` (`packages/indexer/src/extract.ts:79`)
  is the existing body-hash primitive nodes already carry as `bodyHash` —
  this blueprint's Stage A/B matchers compare **already-computed**
  `bodyHash` values on `ToolNode`/`GraphNode`, they do not recompute
  hashes.

Files to read first: `packages/fixtures/04-diff-coalescing/expected/
coalesced-diff.json` and `raw-diff.json` (both in full), `schemas/
expected-diff.schema.json` `$defs.nodePair`/`$defs.edgePair`,
`.claude/skills/tadori-indexer/SKILL.md`, `packages/harness/src/
compare.ts` (deferral mechanics), `blueprints/09-01-review-diff-api-ui.md`
(the raw `ReviewDiff` contract this wraps).

Gotchas: `nodePairs`/`edgePairs` `beforeNodeId`/`afterNodeId` in the
fixture are the fixture's internal `id` strings (e.g.
`"file:src/legacy/helper.ts"`), not `entityKey` — this blueprint's
`CoalescedChange.rawRowIndexes` (ARCHITECTURE.md §9) references raw
`ReviewDiff.edges` array positions, a different addressing scheme; do not
conflate the two when writing the fixture-comparison test.

## 5. Scope

1. Stage A matcher: identity-basis match over add/remove node pairs —
   basis `["kind", "unqualifiedName", "bodyHash", "analyzerVersion"]`
   (exact fixture basis) — a removed node and an added node pair when all
   four fields are equal and the pairing is unique (exactly one candidate
   on each side).
2. Stage B matcher: applied to add/remove node pairs Stage A did not
   resolve — basis `["kind", "bodyHash", "analyzerVersion",
   "uniqueCandidate"]` — pairs a removed and added node when body hash and
   kind match and exactly one candidate remains after Stage A removed its
   matches (the `uniqueCandidate` basis element records that the match
   depended on there being only one remaining candidate, not an
   independent signature check — matching the fixture's actual basis
   array, not an invented stronger signal).
3. Edge coalescing: any raw added+removed edge pair whose endpoints are
   both covered by a node pair (or are otherwise identical) collapses into
   an `edgePair`/`CoalescedChange{kind:"rename"|"move"}` referencing the
   absorbing node pair's raw row indexes.
4. Residual computation: raw added/removed edges not absorbed by any node
   or edge pair remain as ordinary raw rows in the coalesced response
   (`CoalescedChange` is additive on top of, not a replacement for, the
   raw `edges` array — ARCHITECTURE.md §9's `ReviewDiff.coalesced?` is
   optional and additive to `.edges`).
5. Ambiguity handling: when Stage A/B find more than one equally valid
   candidate pairing, no pair is emitted for that group — the nodes stay
   raw add/remove rows and an `ambiguousNodeGroups` entry records the
   candidate set and the reason (mirrors the fixture schema field, exercised
   by new tests since fixture 04 seeds none).
6. Recursive-self-reference preservation: no special-casing that would
   make a renamed recursive function match Stage B when its body hash
   changed due to the rename — this is validated by a dedicated new test,
   not by relaxing the matcher.
7. UI: coalesced view toggle (raw ↔ coalesced) in `ReviewDiffView`
   (09-01); each coalesced row expandable to show its underlying raw
   rows; ambiguous/fallback rows visually distinct with a stated reason
   string, never presented as equal-confidence to a resolved pair.
8. Harness: new `compareFixtureDiff` check (see §4) wired into
   `pnpm fixtures:index` (or a new `fixtures:diff` script — see §9)
   exercising both 09-01's raw and this blueprint's coalesced output
   against fixture 04's stored before/after snapshots.

## 6. Non-goals

- Extending Stage A/B to cover cross-package moves with partial
  signature changes, generic renames of classes/interfaces beyond the
  fixture's method/function/file cases, or any heuristic beyond the exact
  two bases documented in the fixture — out of scope; if a real-world
  rename doesn't match either basis, it stays raw (working as designed,
  not a gap to close here).
- Editing `packages/fixtures/04-diff-coalescing/expected/*.json` or
  `schemas/expected-diff.schema.json` — these are frozen; if the
  coalescing algorithm cannot reproduce the oracle exactly, that is a
  blocked/stop condition (§ IF SOMETHING IS UNCLEAR), never a fixture edit.
- `changed_with` co-change coalescing — no such concept exists; 09-04's
  relation is orthogonal to move/rename coalescing.
- Boundary-violation coalescing/suppression — 09-03 is independent;
  violations are computed over the (raw or coalesced) edge set, not
  coalesced themselves.

## 7. Dependencies and prerequisites

- 09-01 must have shipped: the raw `ReviewDiff` contract
  (`ReviewEdgeDiffRow`, `SnapshotRefInfo`, pagination) this blueprint reads
  as input, plus the `coalesce=coalesced` 501 stub this blueprint replaces
  with a real implementation.

## 8. Architectural decisions

- **Coalescing is a pure, additive presentation transform; raw rows are
  never deleted from the wire response.** `ReviewDiff.coalesced` (optional
  field, ARCHITECTURE.md §9) sits alongside the unchanged `edges` array;
  every `CoalescedChange.rawRowIndexes` points into that same `edges`
  array. Rejected: coalescing rewrites/removes raw rows before sending —
  rejected because it would make raw-mode and coalesced-mode responses
  structurally different documents instead of two views over one dataset,
  breaking the "raw is source of truth" non-negotiable and the "expand
  back to raw" requirement.
- **Stage A before Stage B, exactly as the fixture demonstrates, and
  Stage B only considers what Stage A left unresolved.** Rejected: running
  both stages independently and reconciling conflicts after — rejected
  because it can produce two competing pairings for one node (Stage A and
  Stage B both claiming a match), which the fixture's sequential-basis
  design never has to resolve; sequential staging is simpler and matches
  the frozen documentation's stage naming (Stage A / Stage B are ordinal,
  not parallel, in every fixture reference).
- **The recursive-self-reference Stage-B miss is preserved by construction,
  not by a special-case guard.** Because Stage B keys on `bodyHash`
  (already computed by the frozen extraction pipeline, which hashes the
  declaration's actual text including any self-referencing calls by name),
  a rename that changes a recursive function's own name necessarily
  changes its body hash — the miss falls out of the existing hash
  definition with no new code needed to preserve it. The **wrong** design
  (rejected) would be normalizing identifiers before hashing to make
  renames position-invariant — rejected explicitly per the skill note:
  doing so would "disguise" the miss "as a certain match," which the
  skill instruction forbids outright.
- **Ambiguous groups block pairing entirely, they do not pick the "best"
  candidate.** Rejected: scoring multiple candidates and picking the
  highest-confidence pair — rejected because that reintroduces a
  probabilistic judgment fixture 04's binary basis-match design
  deliberately avoids; an ambiguous group is reported as ambiguous (raw
  fallback + reason), consistent with "ambiguous raw fallback" from the
  BACKLOG review constraints.
- **Harness un-defer is a new assertion, not a flag flip.** As established
  in §4, there is no `DEFERRED_*` boolean gating fixture 04's diff
  artifacts in `compare.ts`/`milestone.ts` today — those constants govern
  node-kind/relation strata, not diff-artifact validation. The correct
  "un-defer" here is adding the missing **executed** check
  (`compareFixtureDiff`) that was implied but not yet built, and updating
  `IMPLEMENTATION_STATUS.md`'s deferred-checks prose to reflect that it now
  runs. Rejected: inventing a new `DEFERRED_DIFF_CHECKS` array purely to
  have something to "flip" — rejected as ceremony with no test-value; the
  actual gap is a missing assertion, not a missing flag.

## 9. Exact file plan

- `packages/harness/src/compareDiff.ts` — create. Exports
  `compareFixtureDiff(repoRoot): FixtureDiffComparison` — indexes fixture
  04's `before`/`after` source roots into a temp store (reusing the same
  temp-DB pattern as `compareFixtureSnapshot` in `compare.ts:104-147`),
  runs `diffSnapshotEdges` (raw) then this blueprint's coalescing function,
  and asserts semantic equivalence against `raw-diff.json` and
  `coalesced-diff.json`.
- `packages/harness/src/index.ts` — modify (additive export of
  `compareFixtureDiff`, `FixtureDiffComparison`).
- `packages/harness/src/cli-index.ts` — modify: after the existing
  per-fixture-snapshot loop, additionally call `compareFixtureDiff` for
  the `diff-coalescing` fixture and fail the CLI (exit 1) on mismatch —
  this is the concrete "un-defer" wiring into `pnpm fixtures:index`.
- `packages/harness/test/diff-comparison.test.ts` — create. Exercises
  `compareFixtureDiff` directly.
- `packages/server/src/coalescing.ts` — create. Pure functions:
  `stageAMatch(removedNodes, addedNodes): {pairs, remainingRemoved,
  remainingAdded}`, `stageBMatch(remainingRemoved, remainingAdded):
  {pairs, ambiguousGroups, residualRemoved, residualAdded}`,
  `coalesceEdges(rawEdges, nodePairs): {edgePairs, residualAdded,
  residualRemoved}`, `buildCoalescedChanges(nodePairs, edgePairs,
  rawEdges): CoalescedChange[]`.
- `packages/server/src/routes/reviewDiff.ts` — modify: replace the 501
  stub for `coalesce=coalesced` with a real call into
  `packages/server/src/coalescing.ts`, populating
  `ReviewDiff.coalesced`/`.presentation`.
- `packages/server/test/coalescing.test.ts` — create. Unit tests for the
  four pure functions, including the recursive-self-reference case (§13).
- `apps/viz/src/views/ReviewDiffView.tsx` — modify: add a raw/coalesced
  toggle; render `CoalescedChange` rows with an expand-to-raw affordance.
- `IMPLEMENTATION_STATUS.md` — modify: move the fixture-04 diff-artifact
  line from "deferred checks" to "currently supported/executed" (§4/§8).

## 10. Exact contracts

```ts
// packages/server/src/coalescing.ts
export interface NodePairCandidate {
  removed: ToolNode;
  added: ToolNode;
  basis: string[];        // e.g. ["kind","unqualifiedName","bodyHash","analyzerVersion"]
  stage: "A" | "B";
}

export interface AmbiguousNodeGroup {
  candidates: ToolNode[];   // both removed and added candidates in the group
  reason: string;           // e.g. "2 removed nodes share bodyHash <hash>; cannot disambiguate"
}

export function stageAMatch(
  removedNodes: readonly ToolNode[],
  addedNodes: readonly ToolNode[]
): { pairs: NodePairCandidate[]; remainingRemoved: ToolNode[]; remainingAdded: ToolNode[] };

export function stageBMatch(
  remainingRemoved: readonly ToolNode[],
  remainingAdded: readonly ToolNode[]
): {
  pairs: NodePairCandidate[];
  ambiguousGroups: AmbiguousNodeGroup[];
  residualRemoved: ToolNode[];
  residualAdded: ToolNode[];
};

export function coalesceEdges(
  rawEdges: readonly ReviewEdgeDiffRow[],
  nodePairs: readonly NodePairCandidate[]
): {
  edgePairs: Array<{ beforeRowIndex: number; afterRowIndex: number; relation: Relation }>;
  residualAddedRowIndexes: number[];
  residualRemovedRowIndexes: number[];
};

export function buildCoalescedChanges(
  nodePairs: readonly NodePairCandidate[],
  edgePairs: ReturnType<typeof coalesceEdges>["edgePairs"],
  rawEdges: readonly ReviewEdgeDiffRow[]
): CoalescedChange[]; // CoalescedChange per ARCHITECTURE.md §9
```

`CoalescedChange` (already declared in ARCHITECTURE.md §9, reused
verbatim):

```ts
interface CoalescedChange {
  kind: "rename" | "move" | "modify";
  fromKey: string | null;
  toKey: string | null;
  rawRowIndexes: number[];
}
```

`ReviewDiff` response when `coalesce=coalesced` (extends 09-01's shape):

```ts
interface ReviewDiff {
  // ...context/base/head/nodesAdded/nodesRemoved/edges unchanged from 09-01
  presentation: "coalesced";
  coalesced: CoalescedChange[];
  ambiguousGroups: AmbiguousNodeGroup[];   // additive: surfaces raw-fallback reasons to the UI
}
```

## 11. Ordered implementation procedure

1. `packages/server/test/coalescing.test.ts`: write failing tests for
   `stageAMatch` (exact basis match, unique-candidate requirement) and
   `stageBMatch` (body-hash-only match among Stage-A residuals, ambiguity
   when two residual candidates share a body hash) using synthetic
   `ToolNode` fixtures modeled on fixture 04's actual node shapes (file
   move + method rename). Implement `stageAMatch`/`stageBMatch`. Expected:
   green; `stageAMatch` reproduces the fixture's two Stage-A pairs on
   fixture-04-shaped input, `stageBMatch` reproduces the one Stage-B pair.
2. Add a synthetic recursive-function test case: a function `factorial`
   whose body calls itself by name, renamed to `factorialImpl` with an
   identical algorithm but a body hash that necessarily differs (self-call
   site references the new name). Assert `stageBMatch` does **not** pair
   it (falls into `residualRemoved`/`residualAdded`), and add a comment
   citing `.claude/skills/tadori-indexer/SKILL.md` lines 18-20 as the
   reason this is correct, not a bug. Expected: green, proving the miss is
   preserved.
3. Implement `coalesceEdges`/`buildCoalescedChanges`; test against
   synthetic edge sets modeled on fixture 04's eight `edgePairs`. Expected:
   green.
4. `packages/harness/src/compareDiff.ts` +
   `packages/harness/test/diff-comparison.test.ts`: index fixture 04's
   `before`/`after` into a temp store, run the real
   `diffSnapshotEdges`/coalescing pipeline, assert semantic equivalence
   (entity-key-based, not string-id-based, since fixture ids and entity
   keys differ per the §4 gotcha) against both `raw-diff.json` (cross-check
   with 09-01) and `coalesced-diff.json` (this blueprint's oracle).
   Expected: green — this is the un-deferred check.
5. Wire `compareFixtureDiff` into `packages/harness/src/cli-index.ts`;
   run `pnpm fixtures:index` and confirm it now exercises and passes the
   diff comparison alongside the existing snapshot comparisons.
6. `packages/server/src/routes/reviewDiff.ts`: replace the 501 stub with
   the real coalescing call. Integration test: `GET
   /api/v1/review/diff?coalesce=coalesced` against fixture-04-derived
   snapshots returns a `ReviewDiff` whose `coalesced` array matches the
   oracle semantically.
7. `apps/viz/src/views/ReviewDiffView.tsx`: add the raw/coalesced toggle
   and expand-to-raw UI. Manual verification against a served fixture-04
   diff.
8. Update `IMPLEMENTATION_STATUS.md` per §8's documentation decision.
9. Full validation gate (§15).

## 12. Data and lifecycle flows

**Request:** client toggles "coalesced" in `ReviewDiffView` → refetch
`GET /api/v1/review/diff?...&coalesce=coalesced` → server has already
computed the raw `ReviewDiff` (same code path as 09-01) → runs
`stageAMatch` → `stageBMatch` on the Stage-A residuals → `coalesceEdges`
over the raw edge rows using the combined node pairs → `buildCoalescedChanges`
→ response includes both the untouched raw `edges` array and the new
`coalesced`/`ambiguousGroups` arrays.

**UI expand:** user clicks a coalesced row → UI looks up
`rawRowIndexes` in the already-fetched raw `edges` array (no second
network request — raw rows are already present in the same response) →
renders the underlying raw rows inline.

**Harness validation flow:** `pnpm fixtures:index` → existing per-fixture
snapshot comparisons (unchanged) → new `compareFixtureDiff("diff-
coalescing")` step → indexes `before`/`after` fixture source into a fresh
temp DB → diffs → coalesces → compares to both oracle files → CLI exits 1
on any mismatch.

## 13. Test plan

- Unit: `stageAMatch` (unique match, no-match-when-ambiguous,
  basis-field-by-field mismatch rejects pairing).
- Unit: `stageBMatch` (body-hash-only match among residuals, ambiguity
  when 2+ residual candidates share a body hash, **recursive-self-
  reference case explicitly does not match** — named test:
  `"recursive function rename does not Stage-B match (intentional, per
  tadori-indexer skill note)"`).
- Unit: `coalesceEdges`/`buildCoalescedChanges` against synthetic edge
  sets covering: an edge absorbed by a node-pair endpoint substitution, a
  genuinely new edge (residual added), a genuinely removed edge (residual
  removed), and an in-place `resolution_or_provenance_changed` edge
  (passes through unmodified, untouched by coalescing — mirrors the
  fixture's `changedEdgeMemberships` staying present in both branches).
- Fixture regression (the un-deferred check): `compareFixtureDiff`
  against fixture 04's stored before/after snapshots, comparing to both
  `raw-diff.json` and `coalesced-diff.json` field-by-field (by entity key,
  per the §4 gotcha).
- Integration: `GET /api/v1/review/diff?coalesce=coalesced` route test.
- Regression: full existing suite stays green; 5/5 fixtures exact;
  `pnpm fixtures:validate` (schema-shape) and the new
  `pnpm fixtures:index` diff-comparison step both pass.

## 14. Acceptance criteria

- [ ] `stageAMatch`/`stageBMatch` reproduce fixture 04's exact three
      `nodePairs` (two Stage A, one Stage B) with matching `basis` arrays.
- [ ] The recursive-self-reference synthetic test proves the intentional
      Stage-B miss is preserved (function stays in raw residual, not
      paired).
- [ ] `coalesceEdges`/`buildCoalescedChanges` reproduce fixture 04's eight
      `edgePairs` and both residual-edge lists exactly (by entity key).
- [ ] `compareFixtureDiff` is wired into `pnpm fixtures:index` and passes.
- [ ] `GET /api/v1/review/diff?coalesce=coalesced` returns a real
      `CoalescedChange[]` (no longer 501) whose rows all carry valid
      `rawRowIndexes` into the raw `edges` array.
- [ ] Every coalesced row is expandable in the UI to its underlying raw
      rows with zero additional network fetch.
- [ ] `IMPLEMENTATION_STATUS.md` reflects the diff-artifact check as
      executed, not deferred.
- [ ] Full existing suite (170+ tests) and 5/5 fixtures stay green.

## 15. Validation commands

pnpm skills:check; pnpm typecheck; pnpm lint; pnpm test;
python validate_fixtures.py; pnpm fixtures:validate; pnpm fixtures:index
(now exercises `compareFixtureDiff`); pnpm fixtures:typecheck;
pnpm benchmark:incremental; git diff --check; git status --short

## 16. Performance budgets

- Stage A/B matching over a diff with up to 2000 raw edge rows (the 09-01
  page cap) completes in < 200 ms (in-memory map/set operations only, no
  additional DB round-trips beyond the already-fetched raw diff).
- `compareFixtureDiff` (harness, not a runtime path) has no latency budget
  beyond the existing `pnpm fixtures:index` command's overall wall time
  tolerance.

## 17. Failure and recovery behavior

- Malformed/missing `bodyHash` on a candidate node (should not occur post
  09-01, but defensively) → that node is excluded from Stage A/B matching
  entirely and stays a raw add/remove row — never treated as a wildcard
  match.
- Ambiguous group detection failure mode: if more than two candidates
  share a body hash, all of them enter one `AmbiguousNodeGroup`, not
  paired into partial matches.
- Coalescing computation never blocks or replaces the raw response; if the
  coalescing step throws, the route falls back to returning the raw
  `ReviewDiff` with `presentation: "raw"` and logs the coalescing failure
  server-side — coalescing is a presentation enhancement, its failure must
  never make the underlying diff unavailable.

## 18. Security and privacy

No new I/O beyond what 09-01 already performs; coalescing is a pure
in-memory transform over already-fetched node/edge data. No new
attack surface.

## 19. Accessibility

- Raw/coalesced toggle is a standard accessible control (labeled button
  or tab, keyboard-operable, `aria-pressed`/`aria-selected` state).
- Coalesced rows announce "Moved or renamed — likely" as text (matching
  the fixture's literal label), never color-only.
- Ambiguous-fallback rows carry visible, screen-reader-readable reason
  text (not merely a tooltip).

## 20. Documentation updates

`IMPLEMENTATION_STATUS.md` (per §8/§9). No edits to `INDEX.md`/
`BACKLOG.md`/`ARCHITECTURE.md`/fixture or schema files.

## 21. Builder final report

Require: summary; files changed; contracts implemented; tests added
(names + count, explicitly naming the recursive-self-reference test);
`compareFixtureDiff` wiring evidence; validation command output summary;
commit SHA; known limitations; explicit confirmation the recursive-self-
reference fallback was preserved (not "fixed"); `ASSUMPTION:` lines.

## 22. Independent review result

Pending Wave 3 adversarial review.

## IF SOMETHING IS UNCLEAR

Smallest safe assumption + `ASSUMPTION:` line. If the coalescing algorithm
cannot exactly reproduce fixture 04's `coalesced-diff.json`, stop and
report blocked — do not adjust the fixture or the schema to make it match.

## TADORI NON-NEGOTIABLES

Frozen v2.1; TS/JS only; never weaken golden fixtures; deterministic
output; evidence/origin/confidence/resolution honest; unresolved stays
visibly unresolved; no seventh tool; no runtime tracing; Graphify ignored
reference only.
