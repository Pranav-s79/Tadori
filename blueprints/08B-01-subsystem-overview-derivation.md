---
graph_blueprint_version: 1
node_id: 08B-01
state: review
phase: 8B
risk: medium
complexity: M
predecessors: [08-02]
successors: [08B-02]
execution_card: blueprints/execution/08B-01.md
dossier: blueprints/08B-01-subsystem-overview-derivation.md
read_policy: execution-card-first
local_full_gate_budget: 1
independent_validation_budget: 1
architecture_review: on-demand-only
---

> **GRAPH EXECUTION MODE:** Read the execution card first. This long file is an evidence dossier, not mandatory context. Open only the sections linked by the card. Planning-time existence claims and line numbers are historical hints; live repository semantics win. Use one full local gate and one independent validation pass.

# BLUEPRINT 08B-01: Subsystem & overview derivation

## 1. Header

- ID / Title / Phase: 08B-01 — Subsystem & overview derivation — Phase 8B
  (Guided Explore mode)
- Status: review
- Primary builder: Claude Sonnet — deterministic rule-based text/data
  derivation over an existing read API; no UI, no ML, no architectural
  latitude beyond the rules fixed in this document.
- Reviewer roles: Spec Guardian (honesty/evidence rules, frozen-enum
  conformance), Test Adversary (byte-identical fixture assertions,
  ambiguous/empty-state coverage), Implementation Reviewer (endpoint
  contract, performance on the LOD data path).
- Complexity: M (one focused builder session)
- Depends on: 08-02 (`apps/viz` scaffold + package map — provides the
  package-level graph data path this reuses; not required to be UI-complete,
  only for `GET /api/v1/nodes?level=package` to exist per ARCHITECTURE §3
  row 4)
- Unlocks: 08B-02 (tour engine consumes `Subsystem`/entry-point data as tour
  targets), 08B-03 (walkthrough tours rank against `Subsystem.fanIn`)
- Estimated sessions: 1
- Related frozen-spec sections: ARCHITECTURE.md §8 (tour data model —
  `OverviewSentence`, `Subsystem`, `RepoOverview` types); §3 row 16
  (`GET /api/v1/overview`); ASSUMPTIONS.md A-105 (deterministic, offline,
  reproducible, evidence-backed; LLM narration deferred).

## 2. Objective

`GET /api/v1/overview` returns a `RepoOverview` — a plain-language repository
summary and a ranked list of major subsystems — built **only** from graph
facts already in the store (package nodes, fan-in, entry points, routes, ADR
documents). Every emitted sentence carries `Evidence[]`; a sentence with no
qualifying evidence is never emitted. Two runs against the same snapshot
produce byte-identical JSON.

## 3. Why this matters

- User value: a first-look, honest orientation to an unfamiliar repository
  before any tour starts — replaces "stare at a hairball" with a short,
  sourced narrative (R-01 §5: Graphify's unverified placeholder-then-
  regenerate community labels are exactly what this blueprint must not
  become).
- System value: `Subsystem[]` is the shared vocabulary 08B-02/08B-03 tours
  key their steps against (package name, fan-in, entry points) — this
  blueprint is the single source of derivation logic so tours never
  re-derive subsystem identity differently.
- Downstream: 08B-02 tour ordering, 08B-03 dependency-tour ranking, and any
  future overview-panel UI in `apps/viz` all read this one endpoint.

## 4. Current repository evidence

**Verified current:**

- `packages/mcp/src/service.ts:66-355` — `GraphService` class. Fields
  `snapshot`, `repoId`, `graph: StoredSnapshotGraph`, `nodesByKey`,
  `outEdges`/`inEdges` adjacency maps built in the constructor
  (`service.ts:80-118`). Method `fanIn(entityKey): number` (`service.ts:155-
  156`) reads a precomputed `fanInByKey` map built by counting `inEdges` at
  construction time (`service.ts:112-114`) — O(1) per lookup, already
  computed for every node in the snapshot.
- `packages/core/src/enums.ts:4-18` — `NODE_KINDS` frozen 13-value enum:
  `package`, `file`, `function`, `method`, `class`, `interface`, `type`,
  `route`, `test`, `adr`, `doc_section`, `external_dep`, `unresolved`.
- `packages/core/src/enums.ts:23-35` — `RELATIONS` frozen 11-value enum
  includes `imports`, `routes_to`, `documents`, `contains`, `exports`.
- `packages/core/src/graph.ts:47-65` — `GraphNode` shape: `kind`,
  `qualifiedName`, `displayName`, `canonicalIdentity`, `entityKey`, `file`
  (normalized path or null for package/external nodes), `exported`,
  `lineStart`/`lineEnd`, `evidence: Evidence[]`.
- `packages/core/src/graph.ts:16-29` — `Evidence` shape: `file`, `kind`
  (`EvidenceKind`), `lineStart`, `lineEnd`, optional `columnStart/End`,
  `commitSha`, `excerptHash`.
- Fixture ground truth (`packages/fixtures/01-core-symbols/expected/
  graph.json`, `.../02-express-routes/...`, `.../03-next-routes/...`,
  read directly for this blueprint):
  - Fixture 01: 1 `package` node (`pkg:root`, `qualifiedName:
    "@tadori-fixtures/core-symbols"` pattern — verified 02/03 use
    `@tadori-fixtures/<name>`), 0 `route` nodes, 3 `test` nodes, 1 `adr`
    node, 3 `documents` edges. **Single-package repo** — the monorepo
    clustering case never fires.
  - Fixture 02: 1 `package` node, 2 `route` nodes (`qualifiedName` pattern
    `route:<METHOD> <path>@<file>`, e.g. `route:GET /users/:id@src/
    routes/users.ts`), 2 `routes_to` edges — one `origin:"compiler"/
    confidence:"certain"/resolution:"resolved"`, one
    `origin:"heuristic"/confidence:"likely"/resolution:"partial"`
    (`expected/graph.json`, route `admin.post-computed`). 2 `test` nodes,
    1 `adr` node, 3 `documents` edges.
  - Fixture 03: 1 `package` node, 5 `route` nodes, 5 `routes_to` edges, 2
    `test` nodes, 1 `adr` node, 3 `documents` edges.
  - **All three golden fixtures are single-package repositories.** No
    fixture currently exercises multi-package clustering — this blueprint's
    unit tests must synthesize a small multi-package fixture in-repo (§13)
    since the golden fixtures cannot exercise that branch without being
    modified (forbidden).
- ARCHITECTURE.md §8 (verbatim types, restated in §10 below) already fixes
  `OverviewSentence`, `Subsystem`, `RepoOverview` — this blueprint does not
  invent the wire shape, only the derivation rules that populate it.
- ARCHITECTURE.md §3 row 16: `GET /api/v1/overview` owner is 08B-01, response
  is "deterministic subsystem overview (Section 8)" — no request params
  listed, confirming a single, whole-snapshot response.
- ARCHITECTURE.md §3 `ApiContext` (lines 157-171) — every endpoint response
  is wrapped with `context: ApiContext` (repository, snapshotId,
  snapshotKind, freshness, staleReason, refreshPending) so overview responses
  are freshness-honest like every other endpoint.

**Files to read first:** `packages/mcp/src/service.ts` (`GraphService`
fields/methods), `packages/core/src/enums.ts`, `packages/core/src/graph.ts`,
`blueprints/ARCHITECTURE.md` §2 (server/store seam), §3 (HTTP contract), §8
(tour types), `packages/fixtures/0{1,2,3}-*/expected/graph.json`.

**Gotchas:** `GraphService` has no built-in "package clustering" concept —
today `packages/<name>` boundaries exist only as the `packageName` field on
`GraphFile` (`graph.ts:38`) and the single `package` kind node per package
root; there is no existing "import density between packages" computation
anywhere in the codebase — §8 below defines it from scratch, using only
already-loaded adjacency data (no new store query, no new migration).
`route` node `qualifiedName` for computed paths is literally the string
`<computed:adminPath>` (see fixture 02) — the overview must never claim a
concrete path exists when the source says otherwise.

## 5. Scope

1. A pure derivation function (`deriveRepoOverview`) operating on an
   already-loaded `GraphService`-shaped read view (nodes, edges, fan-in) —
   no I/O, no randomness, no clock reads.
2. Package clustering rule (multi-package repos): edge-density grouping
   formula (§8).
3. Entry-point identification rule: route handlers, bin/CLI entries,
   exported package-root symbols ranked by fan-in (§8).
4. Subsystem naming rule: derived only from package name + dominant path
   segment — never invented prose (§8).
5. Sentence templates with exact slot-filling strings (§8).
6. Confidence/coverage caveat sentences, emitted when derivation input is
   thin (§8, §17).
7. `TS` types matching ARCHITECTURE §8 verbatim (already fixed — restated,
   not altered).
8. `GET /api/v1/overview` endpoint (server package; this blueprint defines
   the handler contract, not the whole `packages/server` scaffold, which is
   07-01's scope — this blueprint's file plan adds one route file assuming
   07-01's Fastify app shell exists by the time this is implemented, per the
   INDEX.md dependency graph, 08B-01 depends on 08-02 which depends on 08-01
   which depends on 07-01).
9. Unit tests against a fixed fixture repo asserting byte-identical output
   across two derivation runs and against a checked-in expected JSON.
10. Ambiguous/empty-state text (monorepo-of-one, zero routes, zero entry
    points, zero ADRs).

## 6. Non-goals

- No LLM call, no natural-language generation model, no template-free prose
  (A-105 non-negotiable).
- No new store migration, no new SQL query beyond what `GraphService`
  already exposes (`fanIn`, adjacency maps, node/edge lists) — clustering and
  entry-point ranking are computed in-memory over the already-loaded
  snapshot graph.
- No UI rendering of the overview (that is a future `apps/viz` panel, not
  numbered in BACKLOG.md yet — out of scope here; this blueprint ships the
  data contract and endpoint only).
- No tour derivation (08B-02/08B-03 own tour steps; this blueprint's output
  is an *input* to those, not a tour itself).
- No design-rationale invention: subsystem "role" text is either sourced
  from an ADR/doc node reachable via a `documents` edge, or is the literal
  fixed string `"No documented design decision found."` — never inferred
  from naming conventions or code shape.
- No caching layer, no incremental recomputation — overview is recomputed
  per request from the in-memory `GraphService` view (already snapshot-
  cached upstream by 07-01's session lifecycle; recomputation here is cheap,
  see §16).

## 7. Dependencies and prerequisites

- 08-02 (`apps/viz` scaffold + package map): needs `GET /api/v1/nodes?
  level=package` and `GET /api/v1/edges?relation=imports` to be real
  endpoints per ARCHITECTURE §3 rows 4-5 — 08B-01 reuses the same
  `GraphService` read view, not a new one, so those endpoints must exist as
  code (07-01), even if 08-02's UI is incomplete.
- Transitively requires 07-01 (`packages/server` graph API) and 08-01
  (layout engine) only insofar as the dependency chain in `INDEX.md` routes
  through them; this blueprint's own code depends on nothing from 08-01
  (layout) directly — it never reads `layout_positions`.

## 8. Architectural decisions

**AD-08B01-1 — Package clustering by import-density, formula fixed.** For
repos with more than one `package` node, packages are grouped into
subsystems using directed import-edge density between package pairs:

```
density(A, B) = |imports edges between any file in A and any file in B|
                 / (|files in A| + |files in B|)
```

Two packages A, B are merged into one subsystem **iff**
`density(A, B) >= 0.5` (fixed threshold — half an import edge per combined
file, chosen because it is the smallest threshold that cannot fire on a
single shared incidental import between two 20-file packages, `1/40 =
0.025`, while still firing on two packages that import each other in most of
their files). Merging uses union-find over package nodes; the resulting
groups are the subsystems. **Single-package repos never enter this branch**
— one package is one subsystem, no clustering computation runs (avoids a
divide-by-zero and matches every current golden fixture, §4).

Rejected: Louvain/community-detection (non-deterministic without a fixed
seed and iteration order across library versions — violates A-105's
byte-identical requirement; also this is a code-comprehension tool, not
Graphify's graph-clustering use case, R-01 §2 "unverified, single-pass
community labels" is exactly the failure mode being avoided). Rejected: a
percentage-of-imports threshold instead of an absolute per-file-pair
density — rejected because it double-penalizes large packages
disproportionately (a 500-file package importing one function from a
5-file package would need 250 edges to hit 50% of the small package's
share; the density formula above is symmetric and file-count-normalized).

**AD-08B01-2 — Entry-point identification, three sources, fixed priority.**
An entity is an **entry point** if it matches one of, in this priority
order (a node satisfying an earlier rule is not re-tested against later
rules):

1. **Route handler**: any `route` node (kind `"route"`) with an outgoing
   `routes_to` edge — the edge's `dst` node is the entry point, tagged
   `"route_handler"`.
2. **Bin/CLI entry**: any exported `function` node whose containing file's
   normalized path matches `^bin/` or `^src/cli` (case-sensitive, forward-
   slash only per `normalizePath`) or whose `qualifiedName` contains
   `.main` as a final path segment — tagged `"bin_entry"`. (No fixture
   currently has a `bin/` file; this rule is exercised by a synthetic unit
   fixture, §13.)
3. **Exported package-root symbol by fan-in**: for each package, the
   top-3 (by fan-in, ties broken by `entityKey` ascending for determinism)
   `exported: true` nodes of kind `function`, `class`, or `interface` whose
   `file` is not already covered by rule 1 or 2 — tagged
   `"exported_root"`. If fewer than 3 exported nodes exist, all are taken;
   if zero, the package contributes no rule-3 entry points (not an error).

Rejected: "every exported symbol is an entry point" — rejected because it
produces an unbounded, low-signal list defeating the "guided" framing (R-01
§2, one-flat-view failure mode); rejected: heuristic naming match
(`*Controller`, `*Handler`) — rejected because it invents semantics from
naming convention, violating the "design rationale only from ADRs/docs"
non-negotiable (this rule is about *identification*, not *rationale*, but
the same discipline against naming-based guessing applies for consistency
and is restated in AD-08B01-3).

**AD-08B01-3 — Subsystem naming, package name + dominant path segment,
never invented semantics.** A subsystem's `role` field (the human-readable
name shown in the overview) is derived as:

```
role = packageName (single-package subsystem), or
role = "<packageName-A> + <packageName-B> [+ ...]" joined by " + ",
       package names sorted lexicographically (multi-package subsystem)
```

This is the **only** naming source. No "dominant path segment" prose
synthesis is invented beyond this — the earlier draft intent to derive
semantic names like "authentication layer" from path segments is
**explicitly rejected here** because it requires guessing intent from a
folder name (e.g., a folder named `auth` does not prove the subsystem's
purpose is authentication — it could be an unrelated abbreviation). The
`role` field is therefore always literally the package name(s); a richer
human label is exactly the class of claim gated by AD-08B01-4's design-
rationale rule and only appears in `summary` sentences when a `documents`
edge backs it.

**AD-08B01-4 — Design rationale only from ADR/doc nodes; fixed empty-state
string.** Any sentence that would describe *why* a subsystem exists, what
it is *for*, or what design decision shaped it must cite a `documents` edge
from an `adr` or `doc_section` node onto a node inside that subsystem. If no
such edge exists for a subsystem, the overview emits the sentence
**exactly**:

```
"No documented design decision found."
```

as that subsystem's rationale sentence, carrying no `Evidence[]` (empty
array — there is nothing to cite for an absence). This sentence is not
optional/omittable — every subsystem gets exactly one rationale sentence,
either ADR-backed or this fixed string, so the UI never has to distinguish
"we didn't check" from "there's nothing there."

**AD-08B01-5 — Confidence/coverage caveats are separate sentences, not
inline hedging.** Rather than qualifying every sentence with "probably" /
"likely" language (which would make evidence-backed `certain` facts read
identically to heuristic guesses), coverage caveats are emitted as their
own `OverviewSentence` entries appended after the subsystem list, one per
condition that fired (§17 lists the exact conditions and text). This keeps
every per-subsystem sentence a plain factual statement backed by its own
evidence, and isolates "here is what's uncertain" to a clearly separated
section.

## 9. Exact file plan

- `packages/mcp/src/overview.ts` — **create**. Exports
  `deriveRepoOverview(service: GraphService): RepoOverview` (pure function,
  §10) plus the internal helpers `clusterPackages`, `identifyEntryPoints`,
  `deriveSubsystemRole`, `findDesignRationale`, `buildSummarySentences`, all
  exported for direct unit testing (not part of the `@tadori/mcp` public
  barrel — internal cross-file imports only, consistent with `ranking.ts`
  which is also `packages/mcp/src/` internal-only per the existing barrel
  list in EVIDENCE-BASELINE.md §3).
- `packages/mcp/src/index.ts` — **modify**. Add
  `export { deriveRepoOverview } from "./overview.js";` to the barrel (one
  line, additive) so `packages/server` can import it as
  `@tadori/mcp`'s other reused symbols are imported (AD-002 pattern from
  ARCHITECTURE §2).
- `packages/mcp/test/overview.test.ts` — **create**. Unit tests over the
  three golden fixtures plus one synthetic multi-package fixture (§13).
- `packages/server/src/routes/overview.ts` — **create** (assumes
  `packages/server` scaffold exists per 07-01; this file is additive to
  that scaffold, one Fastify route registration). Exports
  `registerOverviewRoute(app: FastifyInstance, service: GraphService):
  void`. Wraps `deriveRepoOverview` with the shared `ApiContext` envelope
  (ARCHITECTURE §3 lines 157-171) — this blueprint defines this file's
  contents; it does not redefine `packages/server`'s bootstrap, which
  belongs to 07-01.
- `packages/server/test/overview.route.test.ts` — **create**. HTTP-level
  test asserting `GET /api/v1/overview` returns `200` with a `context` field
  and the exact `RepoOverview` shape against fixture 02 (has routes, ADR,
  and tests — most feature-complete of the three).

## 10. Exact contracts

TS types below are **restated verbatim from ARCHITECTURE.md §8** — this
blueprint does not alter them, only implements the derivation that
populates them:

```ts
interface OverviewSentence {
  text: string;
  evidence: Evidence[];               // every sentence backed; [] only for the fixed no-rationale string
}

interface Subsystem {
  packageName: string;                // AD-08B01-3: literal package name(s), " + "-joined if merged
  role: string | null;                 // AD-08B01-4: ADR/doc-sourced description, or null (see below)
  roleStatus: "derived_from_graph";   // frozen literal; no other value emitted by this blueprint
  fanIn: number;                       // sum of GraphService.fanIn() over the subsystem's package node(s)
  entryPoints: string[];               // entityKeys, ordered per AD-08B01-2 priority then fan-in desc then entityKey asc
}

interface RepoOverview {
  context: ApiContext;                 // ARCHITECTURE §3 envelope; server-attached, not part of deriveRepoOverview's return
  summary: OverviewSentence[];
  subsystems: Subsystem[];
}
```

**Clarification (not a type change):** `Subsystem.role` is `null` only when
`deriveSubsystemRole` cannot even produce the literal package-name string
(never — package name always exists for a `package` node per `graphNodeSchema`
requiring `qualifiedName: z.string().min(1)`); in practice `role` is always
non-null and equals the AD-08B01-3 output. The AD-08B01-4 rationale sentence
is a separate `OverviewSentence`, not stored on `Subsystem.role` — this
resolves an apparent ambiguity between "role" (identity/name, always
present) and "rationale" (why it exists, may be the fixed no-decision
string) so implementers do not conflate the two.

**Sentence templates (exact strings, slots in `{brackets}`):**

```
S1 (repo size):     "This repository contains {packageCount} package{s} across {fileCount} files."
S2 (subsystem list, one per subsystem): "{packageName} has {fanIn} incoming reference{s} from the rest of the repository."
S3 (entry points, one per subsystem with >=1 entry point): "{packageName} exposes {entryPointCount} entry point{s}: {entryPointDisplayNames, comma-joined, max 5 then \"and {n} more\"}."
S4 (rationale, one per subsystem): "{packageName}: {adrSentenceOrFixedString}"
   where adrSentenceOrFixedString = "documented in {adrDisplayName} ({file}:{lineStart})" when a documents edge exists,
         else the fixed string "No documented design decision found."
S5 (routes, whole-repo, only if >=1 route node exists): "The repository defines {routeCount} route{s}."
S6 (zero routes, whole-repo, only if 0 route nodes exist): "No HTTP routes were found in this snapshot."
```

`{s}` = `""` if the preceding count is `1`, else `"s"` (deterministic
pluralization, no i18n). Every `{...}` slot is filled from already-loaded
graph data; no slot is ever filled by free text.

**Server endpoint:**

```ts
// GET /api/v1/overview
// No query parameters (whole-snapshot response, per ARCHITECTURE §3 row 16).
// 200 -> RepoOverview
// 404 -> ApiError { error: "no_active_snapshot", code: "NO_ACTIVE_SNAPSHOT" }  (mirrors row 1's /snapshot 404)
```

## 11. Ordered implementation procedure

1. Write `packages/mcp/test/overview.test.ts` with failing assertions for
   fixtures 01/02/03 expected `RepoOverview` shapes (single-package —
   exercises AD-08B01-2/3/4 but not clustering) and one synthetic two-package
   in-memory fixture (exercises AD-08B01-1 clustering both merge and
   no-merge branches). Run `pnpm test` — new tests fail (module does not
   exist yet).
2. Create `packages/mcp/src/overview.ts`: implement `clusterPackages`
   (union-find over the density formula, §8) — pure function over
   `{packageName, fileCount}[]` and import-edge counts already available
   from `service.graph.edges` filtered by `relation === "imports"` plus
   `service.graph.files` grouped by `packageName`. Test: clustering unit
   assertions go green.
3. Implement `identifyEntryPoints` (three-source priority rule, §8) using
   `service.graph.nodes`, `service.graph.edges` (`routes_to` lookup),
   `service.fanIn(entityKey)`. Test: entry-point assertions go green for all
   three fixtures + synthetic bin-entry fixture.
4. Implement `deriveSubsystemRole` (package-name join, §8) and
   `findDesignRationale` (walks `documents` edges from `adr`/`doc_section`
   nodes onto subsystem member nodes; returns the S4 sentence or the fixed
   string). Test: rationale assertions go green (fixture 01/02/03 each have
   exactly 1 `adr` node and 3 `documents` edges per §4 — assert the correct
   sentence text and evidence anchor).
5. Implement `buildSummarySentences` (S1/S5/S6, whole-repo counts) and
   `deriveRepoOverview` (orchestrates 2-5, sorts `subsystems` by
   `packageName` ascending for determinism, sorts `summary` as
   `[S1, ...per-subsystem S2/S3/S4 in subsystem order, S5-or-S6]`). Test:
   full `RepoOverview` byte-identical assertion against a checked-in
   expected JSON per fixture (§13), run twice in the same test to assert
   byte-identical output across repeated calls.
6. Add the barrel export in `packages/mcp/src/index.ts`.
7. Create `packages/server/src/routes/overview.ts` and its test (assumes
   07-01's Fastify app-building helper exists; if 07-01 is not yet built at
   implementation time, this step is deferred and the blueprint's builder
   reports `BLOCKED: 07-01 packages/server scaffold does not exist yet` per
   the "IF SOMETHING IS UNCLEAR" protocol — the mcp-package derivation logic
   (steps 1-6) is independently completable and valuable without it).
8. Run full validation gate (§15). Update nothing outside this blueprint's
   file plan (INDEX.md/BACKLOG.md are explicitly out of scope for this
   drafting pass and are not touched by the eventual builder either, per
   this planning task's instructions — builder note: this line applies to
   the blueprint-drafting task only; the actual 08B-01 builder session does
   update INDEX.md/BACKLOG.md status per every other blueprint's §20).

## 12. Data and lifecycle flows

**Request flow:** `GET /api/v1/overview` → server resolves the active
`GraphService` for the repo (already open per 07-01's session lifecycle,
reused verbatim — AD-002) → `deriveRepoOverview(service)` runs synchronously
in-memory (no DB round-trip beyond what's already loaded) → server wraps
result with `context: ApiContext` (freshness computed the same way every
other endpoint computes it, per ARCHITECTURE §2 "server must surface the
actual served `snapshot.kind`") → JSON response.

**Failure flow:** no active snapshot → same `404 no_active_snapshot` as
`/api/v1/snapshot` (row 1) — the overview endpoint never fabricates a
response for a missing snapshot.

**No refresh/retry flow specific to this blueprint** — overview derivation
has no side effects and nothing to retry; a `refresh_pending` snapshot still
serves its last-valid overview (matches "invalid snapshots never served, but
stale ones may be marked stale and still shown" pattern already established
for every other read endpoint).

## 13. Test plan

**Unit (`packages/mcp/test/overview.test.ts`):**

- Fixture 01 (single package, 0 routes, 1 adr, 3 documents edges, 3 test
  nodes): assert `subsystems.length === 1`; assert `S6` zero-routes sentence
  present, `S5` absent; assert rationale sentence cites the fixture's `adr`
  node file:line; assert entry points come only from rule 3 (no routes, no
  bin files in this fixture).
- Fixture 02 (1 package, 2 routes — one `compiler/certain/resolved`, one
  `heuristic/likely/partial`): assert both `route`-node-linked handlers
  appear as rule-1 entry points; assert `S5` sentence reads "The repository
  defines 2 routes."; assert the heuristic route's handler is still listed
  as an entry point (route-tour honesty is 08B-03's concern, but entry-point
  *identification* here must not silently drop lower-confidence routes —
  confidence is preserved on the edge, not filtered here).
- Fixture 03 (1 package, 5 routes): assert `S5` reads "...defines 5
  routes."; assert exactly 5 rule-1 entry points, zero rule-3 entry points
  needed to fill (since routes already provide entries) — actually assert
  per AD-08B01-2's stated priority: a node satisfying rule 1 is excluded
  from rule-3 candidacy even if it would also qualify by fan-in.
- **Synthetic two-package fixture** (built inline in the test file, not a
  golden fixture — small `SnapshotGraph`-shaped literal): package A (10
  files) and package B (10 files) with 6 `imports` edges between them →
  `density = 6/20 = 0.3 < 0.5` → **no merge**, two subsystems. A second
  synthetic case with 12 edges → `density = 12/20 = 0.6 >= 0.5` → **merge**,
  one subsystem named `"pkgA + pkgB"` (lexicographic join).
- **Determinism assertion**: call `deriveRepoOverview` twice on the same
  loaded fixture graph in the same test; `JSON.stringify` both results;
  assert exact string equality (byte-identical requirement, A-105).
- **Zero-ADR case**: synthetic fixture with a package and no `adr`/
  `doc_section` node at all → assert rationale sentence is exactly
  `"No documented design decision found."` with `evidence: []`.
- **Zero entry points case**: synthetic fixture with a package containing
  only non-exported symbols → assert `Subsystem.entryPoints` is `[]` and no
  S3 sentence is emitted for that subsystem (S3 is conditional per its
  template header).

**HTTP (`packages/server/test/overview.route.test.ts`, depends on 07-01
scaffold):** `GET /api/v1/overview` against a server booted on fixture 02's
DB → `200`, `context.snapshotKind` present, `subsystems` matches the mcp-level
unit test's expected JSON exactly (cross-check the two layers agree). No
active snapshot → `404` with `code: "NO_ACTIVE_SNAPSHOT"`.

**Regression:** full existing suite (170+ tests) must stay green; no golden
fixture `expected/graph.json` is modified by this blueprint (read-only
consumer).

## 14. Acceptance criteria

- [ ] `deriveRepoOverview` produces byte-identical JSON across two calls on
      the same loaded snapshot (asserted by test, not by inspection).
- [ ] All three golden fixtures (01/02/03) produce a `RepoOverview` where
      every `OverviewSentence.evidence` array is non-empty **except** the
      fixed `"No documented design decision found."` sentence, which is
      always `[]`.
- [ ] Fixture 01 (0 routes) emits exactly the S6 sentence and never S5.
- [ ] Fixtures 02/03 (2 and 5 routes respectively) emit exactly the S5
      sentence with the correct count and never S6.
- [ ] The synthetic multi-package clustering tests (§13) both pass at the
      exact 0.5 density boundary as specified in AD-08B01-1.
- [ ] No sentence in any test fixture contains free text not traceable to a
      template slot filled from graph data.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` all pass with zero new
      failures.
- [ ] No golden fixture `expected/*.json` file is modified (`git diff
      packages/fixtures` empty after the builder session).
- [ ] `GET /api/v1/overview` returns `200` with the `RepoOverview` shape
      when a `packages/server` scaffold is available (deferred if 07-01 is
      not yet built at implementation time; the mcp-layer function and its
      tests are the blueprint's non-deferrable acceptance floor).

## 15. Validation commands

pnpm skills:check; pnpm typecheck; pnpm lint; pnpm test;
python validate_fixtures.py; pnpm fixtures:validate; pnpm fixtures:index;
pnpm fixtures:typecheck; git diff --check; git status --short

## 16. Performance budgets

`deriveRepoOverview` runs in-memory over already-loaded snapshot data
(`GraphService` construction cost is already paid before this endpoint is
called, per every other endpoint's session lifecycle). Clustering is
`O(packages^2)` for the density matrix (packages are expected to number in
the tens, not thousands, for any realistic monorepo) plus `O(edges)` for the
import-edge tally — bounded by the same 150k-LOC / 08-10 performance target
as every other read endpoint. Target: overview derivation completes in
`< 50ms` for a repo at the 08-10 cold-load ceiling (single-digit package
count, tens of thousands of nodes) — this is a derivation-layer budget, not
a new benchmark gate; verified informally in the unit test via a wall-clock
assertion (`< 200ms` hard ceiling in CI to avoid flaking on slow runners,
`< 50ms` is the design target stated here for the record).

## 17. Failure and recovery behavior

- **No active snapshot**: `404 no_active_snapshot`, matching `/api/v1/
  snapshot`'s existing behavior — never a fabricated empty `RepoOverview`.
- **Monorepo of one package** (all three golden fixtures today): clustering
  branch never runs; `subsystems.length === 1`; no ambiguity, no caveat
  sentence needed (a single package is not an ambiguous case, it is the
  common case).
- **Zero routes**: emit S6 fixed string, never S5; no route-derived entry
  points exist, rule 3 (exported-symbol fan-in) becomes the sole entry-point
  source.
- **Zero entry points for a subsystem**: `entryPoints: []`; S3 sentence
  omitted for that subsystem (conditional template); this is not an error
  state, just an empty list.
- **Zero ADR/doc coverage for a subsystem**: rationale sentence is the
  fixed `"No documented design decision found."` string with `evidence: []`
  — this is the exact required empty-state wording per this task's honesty
  constraints; it must appear verbatim, not paraphrased, so downstream UI
  and tests can string-match it.
- **Ambiguous route path** (e.g. fixture 02's `<computed:adminPath>`): the
  entry point is still identified (rule 1 fires on any `routes_to` edge
  regardless of confidence), but the display name used in S3 is the node's
  literal `displayName` field (which already contains the honest
  `<computed:...>` marker) — never rewritten to look like a concrete path.
- **Corrupt/malformed snapshot**: never reached by this blueprint — 07-01's
  snapshot validation (dangling-endpoint check) already guarantees
  `getActiveSnapshot` only returns validated snapshots; `deriveRepoOverview`
  assumes a valid `GraphService` and does not re-validate.

## 18. Security and privacy

No new I/O, no new file reads beyond what `GraphService` already loaded
(evidence file paths are repo-relative strings already present in the
snapshot, not re-read from disk by this blueprint). No new network calls
(no LLM, no external API — A-105). Response payload contains no absolute
filesystem paths (`Evidence.file` is already normalized/repo-relative per
`graph.ts:18` `normalizedPath` convention). Localhost-only, inherits
07-01's binding.

## 19. Accessibility

Not directly applicable (no UI in this blueprint's scope) — but the sentence
templates are designed for eventual screen-reader consumption: every
sentence is a complete, grammatical, plain-language statement (no
abbreviation-only labels, no bare numbers without units), so a future
overview-panel UI (unnumbered, not yet in BACKLOG.md) can render the
`summary` array directly as accessible text without additional processing.

## 20. Documentation updates

None beyond this blueprint file itself (per this task's instruction: do not
edit INDEX.md/BACKLOG.md or any existing file during blueprint drafting).
The eventual 08B-01 builder session updates `IMPLEMENTATION_STATUS.md` per
the standing CLAUDE.md rule, and flips `INDEX.md`/`BACKLOG.md` status —
that is the builder's responsibility at build time, not this drafting pass.

## 21. Builder final report

Require: summary; files changed; contracts implemented (confirm
`RepoOverview`/`Subsystem`/`OverviewSentence` match ARCHITECTURE §8
verbatim); tests added (names + count); byte-identical-output evidence
(paste the two-run JSON diff showing empty diff); validation results (full
gate output); commit SHA; known limitations (e.g. clustering formula
untested against a real multi-package repo, only synthetic); follow-on
risks; `ASSUMPTION:` lines for anything not resolved above.

## 22. Independent review result

Pending Wave 3 adversarial review.

## IF SOMETHING IS UNCLEAR

Make the smallest safe assumption, record `ASSUMPTION: ...` in the report,
continue without expanding scope. If the uncertainty could violate a frozen
contract (e.g. inventing a subsystem role not backed by ADR/doc evidence),
stop that item and report blocked.

## TADORI NON-NEGOTIABLES (every blueprint)

Frozen v2.1; TS/JS only; ATLAS separate; exactly six MCP tools; stable 2D
default; 2.5D optional; 3D experimental only; no city metaphor; no default
hairball; no generic admin dashboard or permanent dual sidebars; progressive
disclosure package → file → task-region symbols; deterministic positions;
every visible relation keeps evidence, origin, confidence, resolution;
unresolved stays visibly unresolved; static test linkage is not runtime
coverage; agent observation honesty ("not observed inspected"; coverage
complete_for_registered_sources | partial | unknown); design rationale only
from ADRs/docs/instructions/explicit human input, otherwise "No documented
design decision found"; hooks remain an evidence receiver, never an
orchestrator/runtime; invalid snapshots never served; `tadori serve .` is the
normal command; localhost default; no cloud dependency; Graphify is ignored
reference only — never import/copy/ship; never weaken golden fixtures; no
seventh tool; no runtime tracing.
