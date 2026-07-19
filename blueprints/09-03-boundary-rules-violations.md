---
graph_blueprint_version: 1
node_id: 09-03
state: review
phase: 9
risk: high
complexity: M
predecessors: [09-01]
successors: []
execution_card: blueprints/execution/09-03.md
dossier: blueprints/09-03-boundary-rules-violations.md
read_policy: execution-card-first
local_full_gate_budget: 1
independent_validation_budget: 1
architecture_review: required-on-contract-delta
---

> **GRAPH EXECUTION MODE:** Read the execution card first. This long file is an evidence dossier, not mandatory context. Open only the sections linked by the card. Planning-time existence claims and line numbers are historical hints; live repository semantics win. Use one full local gate and one independent validation pass.

# BLUEPRINT 09-03: Boundary rules & violations

## 1. Header

- ID / Title / Phase: 09-03 — Boundary rules & violations — Phase 9
- Status: review
- Primary builder: Claude Sonnet — a bounded schema + deterministic
  server-side computation + UI badge task with an exact fixture oracle
  already seeded (both fixture 01 and 02 already declare one violation
  each); no novel architecture.
- Reviewer roles: Spec Guardian (frozen migration-002 `boundary_entities`/
  `snapshot_boundaries` schema fidelity, fixture oracle fidelity),
  Security Reviewer (`tadori.rules.json` parse safety), API Contract
  Reviewer (violation wire shape).
- Complexity: M
- Depends on / Unlocks: Depends on 09-01 (the diff/inspection surface
  violation badges render inside). Unlocks nothing further in the current
  BACKLOG dependency graph (no row lists 09-03 as a prerequisite), but
  12-04 (documentation & demo) benefits from a working example.
- Estimated sessions: 1
- Related frozen-spec sections: `docs/Specs/Tadori-v2.1-Corrections.md`
  migration 2 (`boundary_entities`, `snapshot_boundaries`,
  `boundary_evidence` — frozen, verbatim in `packages/store/src/
  migrations.ts:195-284`); fixture 01/02 `expectedBoundaryViolations`
  (one seeded violation each); `schemas/expected-graph.schema.json`
  `$defs.boundaryViolation`.

## 2. Objective

A repository-root `tadori.rules.json` declares boundary rules between
packages/paths (allow/forbid dependency statements); the server computes
violations deterministically over the active snapshot's import/call edges,
evidence-backed per violation; the UI renders violation badges and static
warning glyphs on affected nodes; and the harness's already-seeded
fixture-01/02 boundary violations (currently validated only implicitly via
`expectedBoundaryViolations` presence, never asserted as detected
violations) are asserted by a new, executed check.

## 3. Why this matters

- User value: "did this change cross a layer boundary it shouldn't have"
  is a standing Phase-9 review question; without this, a developer must
  manually reason about package/path conventions on every diff.
- System value: activates a frozen migration-002 table
  (`boundary_entities`/`snapshot_boundaries`/`boundary_evidence`) that has
  existed since Week 1-2 but has **zero production reader/writer** today
  (verified: grep of `packages/*/src` for `boundary_entities`,
  `snapshot_boundaries` outside `migrations.ts` and its own test returns
  nothing) — mirrors the exact "frozen table, no writer yet" situation
  ARCHITECTURE.md C-1 already documented for `layout_positions`.
- Downstream: fixture 01 and 02 already carry one seeded
  `expectedBoundaryViolations` entry each — this blueprint is the first
  code that actually detects them, converting a schema-shape-only fixture
  field into an asserted, executed harness check.

## 4. Current repository evidence

Verified current (2026-07-17):

- **Frozen migration 2** (`packages/store/src/migrations.ts:195-284`,
  copied verbatim from the frozen corrections doc per the file's own
  header comment) already creates:
  - `boundary_entities(id, repo_id, boundary_key, name, created_at)` —
    `UNIQUE(repo_id, boundary_key)`, `UNIQUE(repo_id, name)`.
  - `snapshot_boundaries(snapshot_id, boundary_id, rule_kind CHECK IN
    ('allow','deny','layer','ownership'), rule_json CHECK
    (json_valid(rule_json)), confidence CHECK IN ('certain','likely'),
    source_file_id)` — `PRIMARY KEY(snapshot_id, boundary_id)`.
  - `boundary_evidence(snapshot_id, boundary_id, evidence_id)`.
  - `decision_links` has a `boundary_id` column and a partial unique index
    `idx_decision_link_boundary` (`migrations.ts:543`) for linking
    explicit decisions to boundaries.
  - **This blueprint does not add a migration.** Exactly as
    ARCHITECTURE.md's C-1 correction did for layout, this table already
    exists and is unused; this blueprint adds a **writer** (parses
    `tadori.rules.json`, inserts rows) and a **reader/computer**
    (violation detection over edges), no schema change.
- Fixture oracle, already present and frozen:
  - `packages/fixtures/01-core-symbols/expected/graph.json` line 27:
    `"Seeded public-to-internal boundary violation"` (nasty-case list);
    `expectedBoundaryViolations` (read at line 1742+): `ruleId:
    "public-must-not-import-internal"`, `src:
    "file:src/public/report.ts"`, `edgeRelation: "imports"`, `dst:
    "file:src/internal/secret.ts"`, `severity: "error"`, one evidence
    anchor.
  - `packages/fixtures/02-express-routes/expected/graph.json` line 7:
    "...and a controller-to-infrastructure boundary violation."
    `expectedBoundaryViolations` (line 1853+): `ruleId:
    "controllers-must-not-import-infra"`, `src:
    "file:src/controllers/user-controller.ts"`, `edgeRelation:
    "imports"`, `dst: "file:src/infra/db.ts"`, `severity: "error"`,
    one evidence anchor (`src/controllers/user-controller.ts:2`,
    `contains: "../infra/db.js"`).
  - **Both are `imports` edges between files, both `severity: "error"`,
    exactly one violation per fixture** — this blueprint's acceptance
    oracle is precisely these two entries; it must detect exactly these
    two violations and no others when run against fixtures 01/02.
- `schemas/expected-graph.schema.json` `$defs.boundaryViolation`
  (lines 310-345+) requires `ruleId`, `src`, `edgeRelation`, `dst`,
  `severity` (`"warning"|"error"`), `evidence` — this blueprint's
  server-computed violation shape must be a strict superset of this (it
  already is the schema fixtures were written against).
- Harness deferral (verbatim, `packages/harness/src/compare.ts:432`):
  `deferredChecks` always includes `` `boundary violations
  (${expected.expectedBoundaryViolations.length} expected) - boundary
  enforcement is a later milestone` `` — this line currently fires
  unconditionally (both fixtures report "1 expected") because there is no
  boundary-rule engine to run. **This is the exact harness deferral this
  blueprint un-defers.** Per `IMPLEMENTATION_STATUS.md`: "Checks: seeded
  boundary violations, non-variable excluded candidates, raw/coalesced
  diff artifacts of fixture 04 (Week 9)" — the "seeded boundary violations"
  clause is this blueprint's un-defer target (the diff-artifact clause
  belongs to 09-02).
- No `tadori.rules.json` schema exists anywhere in the repo today (grep
  for `rules.json`, `tadori.rules` across the repo returns only
  ARCHITECTURE.md/BACKLOG.md/CLI_CONTRACT.md prose references and the two
  fixture graph files' unrelated `boundary_entities` DDL — no actual rules
  file or parser exists).
- `docs/CLI_CONTRACT.md` step 2 ("load configuration") already names
  `tadori.rules.json` as a config file the CLI reads alongside
  `.gitignore`/`.tadoriignore` (frozen contract, `CLI_CONTRACT.md`) —
  this blueprint defines the file's schema and consumption; 07-02 (CLI)
  is the actual reader/loader integration point, but this blueprint must
  produce the schema and a standalone parse/validate function 07-02 can
  call without waiting on 07-02 to exist.

Files to read first: `packages/store/src/migrations.ts:195-284`
(migration 2, full boundary DDL), `packages/fixtures/01-core-symbols/
expected/graph.json` (`expectedBoundaryViolations` block),
`packages/fixtures/02-express-routes/expected/graph.json` (same),
`schemas/expected-graph.schema.json` `$defs.boundaryViolation`,
`packages/harness/src/compare.ts` (deferral mechanics, lines 425-438),
`docs/CLI_CONTRACT.md` step 2.

Gotchas: `snapshot_boundaries.confidence` is constrained to
`('certain','likely')` only — no `'inferred'` — a narrower enum than the
graph-wide `Confidence` type (`certain|likely|inferred`); this blueprint's
violation-confidence field must respect the narrower boundary-specific
enum, not the general one. `rule_json` must be valid JSON
(`CHECK(json_valid(rule_json))`) but its internal shape is not otherwise
constrained by the migration — this blueprint defines that internal shape
(§10).

## 5. Scope

1. `tadori.rules.json` JSON Schema: `version` field, boundary
   declarations (named boundaries mapped to package/path globs), rule
   statements (`allow`/`deny` between named boundaries), optional
   `layer`/`ownership` rule kinds mirroring the frozen `rule_kind` enum.
2. Config loader: parse + schema-validate `tadori.rules.json` from the
   repository root; absent file → feature quietly absent (no violation
   computation attempted, no warning printed); malformed file → one
   actionable error message naming the file and the schema violation,
   never a silent partial application.
3. Boundary row materialization: on snapshot creation/refresh, insert
   `boundary_entities`/`snapshot_boundaries`/`boundary_evidence` rows from
   the parsed rules (new store writer function, additive, reuses the
   existing frozen migration-002 tables — no schema change).
4. Violation computation: deterministic, server-side, over the active
   snapshot's `imports`/`calls` edges (evidence-backed) — a `deny` rule
   between boundary A and boundary B fires when an edge crosses from a
   file/package matched by A's glob to one matched by B's glob; every
   violation carries the offending edge's own evidence (reused, not
   re-derived).
5. Violation wire endpoint/field: violations surface as part of the
   review-diff/inspection surfaces (09-01) as badges, not a new top-level
   endpoint requiring its own blueprint-scale route design — see §8 for
   the exact placement decision.
6. UI: violation badges on affected nodes (list + on-map, same frozen-
   layout non-movement discipline as 09-01) plus static warning glyphs
   (encoding maps to named properties — `severity: "error"` vs
   `"warning"` map to two distinct, named glyph/color tokens, never bare
   color).
7. Harness: new executed check asserting the violation engine detects
   exactly fixture 01's and fixture 02's one seeded violation each,
   un-deferring the `compare.ts:432` deferral line for those two
   fixtures.

## 6. Non-goals

- CLI integration of the rules loader into `tadori serve .`'s startup
  sequence — that is 07-02's job; this blueprint delivers the schema and
  a standalone loader/validator function 07-02 calls, not the CLI wiring
  itself.
- Auto-fixing or blocking violations (Tadori never edits repositories,
  per the frozen non-negotiable) — violations are surfaced, never
  enforced as a build gate.
- Violation coalescing/deduplication across renamed files — that composes
  with 09-02 if ever needed, out of scope here.
- Any rule kind beyond `allow`/`deny`/`layer`/`ownership` (the frozen
  `rule_kind` CHECK enum) — no fifth kind is invented.
- Editing fixture 01/02's `expectedBoundaryViolations` or
  `expected-graph.schema.json` — frozen; this blueprint's engine must
  reproduce them exactly, never the reverse.

## 7. Dependencies and prerequisites

- 09-01 must have shipped: the diff/inspection UI shell violation badges
  render inside (§8 placement decision).

## 8. Architectural decisions

- **Violations render inside the existing review-diff/inspection surface;
  no new top-level `/api/v1/violations` route is introduced by this
  blueprint.** Rationale: ARCHITECTURE.md's endpoint table (§3) has no
  reserved violations route, and violations are most useful exactly where
  a developer is already looking — the changed-edge list (09-01) and the
  node inspector (08-06). Decision: violations are computed on demand by
  a new pure function `computeBoundaryViolations(db, snapshotId):
  BoundaryViolation[]` (packages/server, §9) and attached as an additive
  field on the existing `/api/v1/nodes/:entityKey` response
  (`violations: BoundaryViolation[]`) and as an additive field on
  `ReviewDiff` edges (`violatesBoundary: BoundaryViolation | null` per
  edge row) — both additive, non-breaking extensions of already-shipped
  09-01 contracts. Rejected: a new standalone `GET /api/v1/violations`
  endpoint — rejected as an unrequested seventh-ish surface when the
  BACKLOG scope explicitly asks for "violation badges + static warning
  glyphs in UI," which is naturally an annotation on existing views, not a
  new browse surface; can be added later if a dedicated violations-triage
  view is ever requested (not asked for here).
- **Config-absent means feature-quietly-absent, matching the frozen
  "no nagging" instruction verbatim.** No `tadori.rules.json` → the loader
  returns `null` → `computeBoundaryViolations` is never invoked → zero UI
  chrome for violations appears (no empty badge tray, no "no rules
  configured" banner). Rejected: showing a persistent "configure boundary
  rules" prompt — rejected because BACKLOG explicitly specifies "rules
  absent → feature quietly absent (no nagging)."
- **Malformed config produces one actionable error, surfaced where the
  config is loaded (CLI startup log / server health), not swallowed.**
  Rejected: falling back to "no rules" silently on parse failure —
  rejected because a developer who wrote a rules file with a typo deserves
  to know it didn't take effect, distinct from the "absent" case above
  which is a deliberate choice, not an error.
- **Violation computation is a pure function over already-loaded snapshot
  edges, not a new indexer extraction pass.** `computeBoundaryViolations`
  takes the same `StoredSnapshotGraph` `GraphService`/`loadSnapshotGraph`
  already produce; it re-derives nothing from source text. Rejected:
  computing violations during extraction (`extract.ts`) — rejected because
  boundary rules are a review-mode/config concern layered on top of an
  already-extracted graph, not a property of the code itself; keeping it
  out of `extract.ts` also means a rules-file edit alone (no code change)
  can recompute violations without a full reindex.
- **Boundary-glob matching reuses `normalizePath`'s existing forward-slash
  convention; globs are matched against each file's already-normalized
  path.** No new path-normalization logic is introduced (rejected:
  writing a second normalizer — `@tadori/indexer`'s `normalizePath` is
  already the single source of truth for repo-relative paths).

## 9. Exact file plan

- `schemas/tadori-rules.schema.json` — create. JSON Schema for
  `tadori.rules.json` (§10).
- `packages/server/src/boundaryRules.ts` — create. Exports
  `loadBoundaryRules(repoRoot): BoundaryRuleSet | null` (schema-validates,
  throws `BoundaryRulesConfigError` with an actionable message on
  malformed input; returns `null` when the file is absent — never
  throws for absence).
- `packages/store/src/boundaries.ts` — create. Additive store writer/
  reader: `writeBoundaryRules(db, repoId, snapshotId, ruleSet):
  void` (upserts `boundary_entities`/`snapshot_boundaries`/
  `boundary_evidence` rows — reuses frozen migration-002 tables, no
  schema change), `readBoundaryRules(db, snapshotId): StoredBoundaryRule[]`.
- `packages/store/src/index.ts` — modify (additive export of
  `writeBoundaryRules`, `readBoundaryRules`, `StoredBoundaryRule`).
- `packages/server/src/computeBoundaryViolations.ts` — create. Exports
  `computeBoundaryViolations(rules: StoredBoundaryRule[], graph:
  StoredSnapshotGraph): BoundaryViolation[]` — pure function, deterministic
  edge-by-edge scan.
- `packages/server/src/routes/nodes.ts` — modify (if it exists post
  07-01; otherwise this blueprint adds the `violations` field to
  whichever route 07-01 defined for `/api/v1/nodes/:entityKey`): attach
  `violations: BoundaryViolation[]` to the node-detail response.
- `packages/server/src/routes/reviewDiff.ts` — modify: attach
  `violatesBoundary: BoundaryViolation | null` to each `ReviewEdgeDiffRow`
  (09-01's shape), additive field.
- `packages/harness/src/compareBoundaries.ts` — create. Exports
  `compareFixtureBoundaryViolations(repoRoot): BoundaryComparison[]` — for
  fixtures 01 and 02, loads `tadori.rules.json` fixtures (new, see below),
  indexes the fixture source, runs `computeBoundaryViolations`, and
  asserts the result matches `expectedBoundaryViolations` exactly (by
  `ruleId`/`src`/`dst`/`severity`).
- `packages/fixtures/01-core-symbols/repo/tadori.rules.json` — create.
  New fixture-scoped rules file declaring the `public-must-not-import-
  internal` rule so the fixture's already-seeded violation is detectable.
  **This adds a new file inside an existing fixture directory; it does
  not edit `expected/graph.json` or any other frozen expectation file** —
  see §8's IF-UNCLEAR guidance on why this is safe (a rules file is
  config input to the engine, not a graph expectation).
- `packages/fixtures/02-express-routes/repo/tadori.rules.json` — create.
  Same, for `controllers-must-not-import-infra`.
- `packages/harness/src/index.ts` — modify (additive export).
- `packages/harness/src/cli-index.ts` — modify: run
  `compareFixtureBoundaryViolations` for fixtures 01/02 after the existing
  snapshot comparisons; fail (exit 1) on mismatch.
- `packages/harness/test/boundary-comparison.test.ts` — create.
- `packages/server/test/boundaryRules.test.ts`,
  `packages/server/test/computeBoundaryViolations.test.ts`,
  `packages/store/test/boundaries.test.ts` — create.
- `apps/viz/src/overlays/ViolationBadge.tsx` — create. Renders
  severity-mapped glyph/color tokens (not bare color) on affected nodes.
- `IMPLEMENTATION_STATUS.md` — modify: move "seeded boundary violations"
  out of the deferred-checks list into "currently supported."

## 10. Exact contracts

```jsonc
// schemas/tadori-rules.schema.json (shape tadori.rules.json must satisfy)
{
  "version": "1.0.0",
  "boundaries": [
    { "name": "public", "match": ["src/public/**"] },
    { "name": "internal", "match": ["src/internal/**"] }
  ],
  "rules": [
    {
      "ruleId": "public-must-not-import-internal",
      "kind": "deny",              // "allow" | "deny" | "layer" | "ownership"
      "from": "public",
      "to": "internal",
      "relation": "imports",       // Relation this rule governs; deny fires when this relation crosses from->to
      "severity": "error",         // "warning" | "error"
      "confidence": "certain"      // "certain" | "likely" — matches frozen snapshot_boundaries.confidence CHECK
    }
  ]
}
```

```ts
// packages/server/src/boundaryRules.ts
export interface BoundaryDeclaration { name: string; match: string[]; }
export interface BoundaryRule {
  ruleId: string;
  kind: "allow" | "deny" | "layer" | "ownership";
  from: string;                 // boundary name
  to: string;                   // boundary name
  relation: Relation;
  severity: "warning" | "error";
  confidence: "certain" | "likely";
}
export interface BoundaryRuleSet {
  version: string;
  boundaries: BoundaryDeclaration[];
  rules: BoundaryRule[];
}
export class BoundaryRulesConfigError extends Error {
  constructor(public readonly filePath: string, public readonly detail: string);
}
export function loadBoundaryRules(repoRoot: string): BoundaryRuleSet | null;
// null = file absent (feature quietly absent); throws BoundaryRulesConfigError
// on any malformed/schema-invalid file (actionable, never silent).

// packages/server/src/computeBoundaryViolations.ts
export interface BoundaryViolation {
  ruleId: string;
  srcEntityKey: string;
  edgeRelation: Relation;
  dstEntityKey: string;
  severity: "warning" | "error";
  evidence: Evidence[];         // reused verbatim from the offending edge
}
export function computeBoundaryViolations(
  rules: readonly BoundaryRule[],
  boundaries: readonly BoundaryDeclaration[],
  graph: StoredSnapshotGraph
): BoundaryViolation[];

// packages/store/src/boundaries.ts (additive @tadori/store exports)
export interface StoredBoundaryRule extends BoundaryRule {}
export function writeBoundaryRules(
  db: Database, repoId: number, snapshotId: number, ruleSet: BoundaryRuleSet
): void;
export function readBoundaryRules(db: Database, snapshotId: number): StoredBoundaryRule[];
```

Wire additions (additive to already-shipped 09-01 contracts):

```ts
// packages/server/src/reviewDiffAssembly.ts (extends 09-01's ReviewEdgeDiffRow)
interface ReviewEdgeDiffRow {
  // ...existing fields
  violatesBoundary: BoundaryViolation | null;
}
// packages/server node-detail response (extends 07-01's node route)
interface NodeDetailResponse {
  // ...existing fields
  violations: BoundaryViolation[];
}
```

## 11. Ordered implementation procedure

1. `schemas/tadori-rules.schema.json` + `packages/server/test/
   boundaryRules.test.ts`: write failing tests (valid file parses; absent
   file returns `null`; malformed JSON throws `BoundaryRulesConfigError`
   with the file path in the message; schema-invalid `kind` value throws).
   Implement `loadBoundaryRules`. Expected: green.
2. `packages/store/test/boundaries.test.ts`: write failing tests for
   `writeBoundaryRules`/`readBoundaryRules` round-tripping into the
   existing frozen migration-002 tables (assert no new migration was
   added — `MIGRATIONS.length` unchanged). Implement. Expected: green.
3. `packages/server/test/computeBoundaryViolations.test.ts`: write failing
   tests using synthetic graphs modeled on fixture 01/02's exact violation
   shape (a `public` file importing an `internal` file under a `deny`
   rule → exactly one violation with the edge's real evidence attached;
   an `allow` rule between the same boundaries → no violation; an edge
   whose relation doesn't match the rule's `relation` → no violation).
   Implement `computeBoundaryViolations`. Expected: green.
4. Create `packages/fixtures/01-core-symbols/repo/tadori.rules.json` and
   `packages/fixtures/02-express-routes/repo/tadori.rules.json` declaring
   the exact rule each fixture's `expectedBoundaryViolations` entry
   implies (boundary names/globs must actually match `src/public/**`
   `src/internal/**` for fixture 01, `src/controllers/**`/`src/infra/**`
   for fixture 02 — verify against each fixture's real source tree before
   writing the glob).
5. `packages/harness/src/compareBoundaries.ts` +
   `packages/harness/test/boundary-comparison.test.ts`: write failing
   tests asserting `compareFixtureBoundaryViolations` detects exactly the
   one seeded violation in each fixture, matching `ruleId`/`src`/`dst`/
   `severity` from `expectedBoundaryViolations`. Implement. Expected:
   green — this is the un-deferred check.
6. Wire `compareFixtureBoundaryViolations` into `cli-index.ts`; run
   `pnpm fixtures:index` and confirm the boundary check now executes and
   passes for fixtures 01/02.
7. Attach `violations`/`violatesBoundary` fields to the 07-01 node route
   and 09-01 review-diff route (additive; existing tests for those routes
   must still pass unmodified plus new assertions for the new fields).
8. `apps/viz/src/overlays/ViolationBadge.tsx`: severity-to-glyph/color
   token map (named constants, e.g. `VIOLATION_SEVERITY_STYLE.error`/
   `.warning`), rendered on affected nodes in the existing node/edge
   inspector and on-map overlay (frozen layout, no movement).
9. Update `IMPLEMENTATION_STATUS.md`.
10. Full validation gate (§15).

## 12. Data and lifecycle flows

**Config load (once per serve/CLI invocation, mirrors `.gitignore`/
`.tadoriignore` loading per `docs/CLI_CONTRACT.md` step 2):**
`loadBoundaryRules(repoRoot)` → `null` (absent, silent) or a validated
`BoundaryRuleSet` or a thrown `BoundaryRulesConfigError` (surfaced as an
actionable startup message, non-fatal to serving the rest of the graph —
the graph still serves, only violation computation is skipped until the
config is fixed).

**Materialization (on snapshot activation, additive to the existing
indexing flow):** if a valid rule set was loaded, `writeBoundaryRules`
upserts rows into `boundary_entities`/`snapshot_boundaries`/
`boundary_evidence` for the newly active snapshot.

**Violation computation (on demand, per node/diff request):**
`readBoundaryRules(db, snapshotId)` → `computeBoundaryViolations(rules,
boundaries, graph)` → attached to the relevant response. Not precomputed
and cached at index time in this blueprint (the graph is typically small
enough per ARCHITECTURE.md's stated corpus sizes that recomputation per
request is cheap — see §16); a caching layer can be added later if
profiling shows a need, not preemptively built here.

**Harness flow:** `pnpm fixtures:index` → existing snapshot comparisons →
new `compareFixtureBoundaryViolations(["01-core-symbols",
"02-express-routes"])` step → loads each fixture's new
`tadori.rules.json` → indexes fixture source → computes violations →
asserts exact match to `expectedBoundaryViolations` → CLI exits 1 on
mismatch.

## 13. Test plan

- Unit: `loadBoundaryRules` (valid/absent/malformed/schema-invalid — 4+
  cases).
- Unit: `writeBoundaryRules`/`readBoundaryRules` round-trip (no schema
  change asserted via unchanged `MIGRATIONS.length`).
- Unit: `computeBoundaryViolations` (deny-rule-fires, allow-rule-permits,
  relation-mismatch-no-violation, multiple rules/multiple violations,
  evidence-passthrough-from-source-edge — 5+ cases).
- Fixture regression (the un-deferred check): `compareFixtureBoundaryViolations`
  against fixtures 01 and 02, asserting exactly one detected violation
  each matching the frozen `expectedBoundaryViolations` entry.
- Integration: node-detail route and review-diff route both surface the
  new additive `violations`/`violatesBoundary` fields correctly.
- Regression: full existing suite (170+) and 5/5 fixtures stay green;
  confirm the two new fixture `tadori.rules.json` files do not alter
  `indexedFiles`/node/edge comparison results (rules files are config,
  not source — must not be picked up as an indexed/support file by
  `scanRepository`; verify this explicitly since `.json` files are
  already classified `indexed: false` by `classify()`, `scan.ts:319-321`,
  so this should be a no-op confirmation, not new scan logic).

## 14. Acceptance criteria

- [ ] `loadBoundaryRules` returns `null` for an absent file (zero UI
      chrome appears) and throws an actionable `BoundaryRulesConfigError`
      for a malformed one.
- [ ] `writeBoundaryRules`/`readBoundaryRules` use only the existing
      frozen migration-002 tables; `MIGRATIONS` array length is unchanged
      by this blueprint.
- [ ] `computeBoundaryViolations` run against fixture 01 detects exactly
      the `public-must-not-import-internal` violation; against fixture 02
      detects exactly the `controllers-must-not-import-infra` violation;
      zero false positives on either fixture's remaining edges.
- [ ] `compareFixtureBoundaryViolations` is wired into
      `pnpm fixtures:index` and passes for both fixtures.
- [ ] `violations`/`violatesBoundary` are additive fields on already-
      shipped 07-01/09-01 responses; existing consumers of those routes
      require no changes.
- [ ] Violation severity maps to a named, non-color-only glyph token in
      the UI.
- [ ] `IMPLEMENTATION_STATUS.md` reflects "seeded boundary violations" as
      executed, not deferred.
- [ ] Full existing suite (170+ tests) and 5/5 fixtures stay green.

## 15. Validation commands

pnpm skills:check; pnpm typecheck; pnpm lint; pnpm test;
python validate_fixtures.py; pnpm fixtures:validate; pnpm fixtures:index
(now exercises `compareFixtureBoundaryViolations`); pnpm fixtures:typecheck;
pnpm benchmark:incremental; git diff --check; git status --short

## 16. Performance budgets

- `computeBoundaryViolations` over the 150k-LOC benchmark corpus's
  ~33,000 edges completes in < 300 ms (single linear scan, glob-match
  cached per file path, no per-edge recompilation of glob patterns).
- Config load/parse: single file read + schema validation, < 10 ms,
  performed once per server/CLI startup (not per request).

## 17. Failure and recovery behavior

- Malformed `tadori.rules.json` → actionable error naming the file and
  the schema violation; the rest of the graph still serves normally
  (violation computation alone is disabled until fixed).
- A rule referencing an undeclared boundary `name` in `from`/`to` →
  treated as a config error (same `BoundaryRulesConfigError` path), not a
  silently-ignored rule.
- A glob matching zero files → not an error (a boundary can legitimately
  be empty in a partial repository state); the rule simply never fires.
- Violation computation failure for one rule (e.g. unexpected internal
  error) does not abort computation for other rules — each rule is
  evaluated independently and a failure is logged, never silently drops
  the whole violation set without a trace.

## 18. Security and privacy

- `tadori.rules.json` is read only from the repository root (same root
  confinement as every other config file per `docs/CLI_CONTRACT.md`); no
  path traversal via glob patterns (globs are matched against already-
  normalized repo-relative paths, never resolved against the filesystem
  outside the repo root).
- No new network or write surface; violation computation is read-only.

## 19. Accessibility

- Violation badges carry visible text labels (`ruleId`, severity word)
  in addition to any glyph/color, satisfying non-color-only signaling.
- Keyboard-navigable: violation badges are reachable via the same
  keyboard navigation path as the node/edge inspector rows they annotate
  (08-06's existing keyboard model, extended not reinvented).
- Screen-reader text states the rule id, severity, and the crossing
  relation in words (e.g. "Boundary violation, error severity: imports
  from public crosses into internal, rule public-must-not-import-
  internal").

## 20. Documentation updates

`IMPLEMENTATION_STATUS.md` (per §9/§11 step 9). No edits to `INDEX.md`/
`BACKLOG.md`/`ARCHITECTURE.md`/any frozen fixture expectation file. The
two new fixture-scoped `tadori.rules.json` files are new config-input
files inside existing fixture directories, not edits to any expectation
file.

## 21. Builder final report

Require: summary; files changed; contracts implemented; tests added
(names + count); confirmation `MIGRATIONS.length` is unchanged (no new
migration); `compareFixtureBoundaryViolations` evidence for both fixtures;
validation command output summary; commit SHA; known limitations;
`ASSUMPTION:` lines (especially any assumption about the exact glob
patterns needed to match each fixture's real directory layout — verify
against the actual source tree, do not guess).

## 22. Independent review result

Pending Wave 3 adversarial review.

## IF SOMETHING IS UNCLEAR

Smallest safe assumption + `ASSUMPTION:` line. If reproducing fixture
01/02's exact seeded violation requires anything beyond adding a
`tadori.rules.json` file to the fixture's `repo/` directory (i.e. if it
seems to require editing `expected/graph.json` or
`expected-graph.schema.json`), stop and report blocked — those files are
frozen.

## TADORI NON-NEGOTIABLES

Frozen v2.1; TS/JS only; never weaken golden fixtures; deterministic
output; evidence/origin/confidence/resolution honest; unresolved stays
visibly unresolved; no seventh tool; no runtime tracing; Tadori never
edits repositories; no generic admin dashboard or nagging UI chrome.
