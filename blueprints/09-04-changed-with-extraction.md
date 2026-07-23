---
graph_blueprint_version: 1
node_id: 09-04
state: review
phase: 9
risk: medium
complexity: M
predecessors: [09-01]
successors: []
execution_card: blueprints/execution/09-04.md
dossier: blueprints/09-04-changed-with-extraction.md
read_policy: execution-card-first
local_full_gate_budget: 1
independent_validation_budget: 1
architecture_review: required-on-contract-delta
---

> **GRAPH EXECUTION MODE:** Read the execution card first. This long file is an evidence dossier. Planning-time line numbers are historical hints; live repository semantics win.

# BLUEPRINT 09-04: `changed_with` extraction

## 1. Header

- ID / Title / Phase: 09-04 — `changed_with` extraction — Phase 9
- Status: review
- Complexity: M
- Depends on / Unlocks: Depends on 09-01 (served snapshot + graph API). Un-defers the last deferred relation.

## 2. Graph rewrite

Before: `changed_with` is in `DEFERRED_RELATIONS`; the analyzer emits no such edge; the harness treats any `changed_with` emission as a hard failure. After: a repository indexed for live serving (`tadori serve .`) additionally carries `changed_with` **file→file** edges (origin `git`, confidence `inferred`), derived from git commit co-change. `changed_with` moves to `SUPPORTED_RELATIONS`. The frozen fixture edge diff is unchanged because fixture extraction never runs the co-change pass.

## 3. Contract neighborhood

VERIFIED LIVE:
- `Relation` enum, `graph.json` schema, and migration-002 `edge_entities` CHECK already list `changed_with` — no schema/migration change needed. (`packages/core/src/enums.ts:34`, `schemas/expected-graph.schema.json:146`, `packages/store/src/migrations.ts:145,398`.)
- `origin` allows `git`; `confidence` allows `inferred`; `resolution` allows `resolved`. (migration-002 CHECK constraints.)
- Edges are `srcEntityKey -relation-> dstEntityKey` with `canonicalIdentity = edge|<src>|<relation>|<dst>` and `entityKey = sha256(canonicalIdentity)`. (`packages/core/src/identity.ts:32`.)
- File nodes: `kind:"file"`, `.file = normalizedPath`, `.entityKey`. (`packages/indexer/src/extract.ts:315`.)
- `indexRepository` builds `SnapshotGraph.edges = extracted.edges` synchronously; no git access inside `extractGraph`. (`packages/indexer/src/indexRepository.ts:140-149`.)
- `indexRepositoryIntoStore` callers: `serve.ts:261` (`kind:"working_tree"`, real repo — co-change wanted) vs harness `compare*.ts` (`kind:"commit"`, fixtures — co-change forbidden). The incremental watcher path (`serve.ts:256`) is the default serve path.
- No-shell git idiom to reuse: `execFile("git", args, {cwd, shell:false, windowsHide:true})`, ENOENT → `GitUnavailableError`. (`packages/indexer/src/captureStagedTree.ts:58`.)
- Harness forbids deferred-relation emission (`compare.ts:401-407`) and lists `changed_with` in `deferredChecks` (`compare.ts:434`); `fixtures.test.ts:93` asserts that string. Un-defer must update these together.

Frozen invariants preserved:
- Fixture golden edge diffs (fixtures never receive the co-change pass).
- Deterministic edge ordering (edges sorted by canonicalIdentity).
- Truthful provenance: co-change is `origin:"git"`, never presented as compiler-resolved.

Rejected adjacent edges:
- No new relation kind, no schema/migration change, no viz change (edges surface through the existing `GET /api/v1/edges` path as ordinary edges; a dedicated overlay is out of scope for 09-04).
- No symbol-level co-change; file→file only (the churn signal is per-file).

## 4. Artifact ownership

| Artifact | Action | Reason | Integration edge |
|---|---|---|---|
| `packages/indexer/src/coChange.ts` | create | git-log co-change → `changed_with` edges | exported via `index.ts` barrel; called by `indexRepository` |
| `packages/indexer/src/coChange.test.ts` | create | focused proof of pairing + threshold + fail-closed | — |
| `packages/indexer/src/indexRepository.ts` | modify | gate co-change pass behind `IndexOptions.extractCoChange` (default off) | appends to `extracted.edges` before build |
| `packages/indexer/src/index.ts` | modify | export new module | barrel |
| `packages/cli/src/serve.ts` | modify | pass `extractCoChange:true` on the full-reindex path | one-hop wiring |
| `packages/indexer/src/incremental.ts` | modify | pass `extractCoChange:true` on the initial full index | one-hop wiring |
| `packages/harness/src/milestone.ts` | modify | move `changed_with` DEFERRED→SUPPORTED | — |
| `packages/harness/src/compare.ts` | modify | drop `changed_with` from `deferredChecks` copy | — |
| `packages/harness/test/fixtures.test.ts` | modify | update the un-defer assertion | — |

## 5. Co-change algorithm

`git log --no-merges --name-only --format=%H -n <maxCommits> -- .` from the repo root.

Parse into per-commit changed-file sets (normalized to posix paths). For each commit, every unordered pair of changed files that BOTH have a file node in the current graph is a co-change occurrence; accumulate a count per unordered pair. Emit a `changed_with` edge for each pair whose count ≥ `minSharedCommits` (default 2 — a single shared commit is noise). Emit the edge once per unordered pair using deterministic endpoint order (lexicographic by entityKey) so `A→B` and `B→A` never both appear; determinism comes from the sorted pair + canonicalIdentity sort already in place.

Evidence: one synthetic evidence anchor naming the co-change — using the shape `evidenceSchema` actually requires (verify against the schema before emitting; do not invent a `kind`).

Ceilings (ponytail):
- `maxCommits` window default 200; `minSharedCommits` default 2. Fixed heuristic, tune later. `ponytail: fixed co-change window/threshold; expose as serve flags if noisy on real repos.`
- O(commit × pairs^2) over the window. Fine for a 200-commit window; guard emission to files present in the graph so unrelated churn (deleted files, non-TS) drops out.

Fail-closed: git missing, not a repo, empty history, or any git error → return `[]`. Live serving must never crash because co-change could not be computed.

## 6. Proof cut

- `coChange.test.ts`: pairing across commits, threshold filter, files-not-in-graph dropped, deterministic endpoint order, fail-closed on git error. (Uses parsed-log fixtures, not a live repo, so it is hermetic.)
- Harness `fixtures.test.ts` green with the un-defer edit (fixtures still emit zero `changed_with`).
- One local gate: indexer + harness vitest + core typecheck.
