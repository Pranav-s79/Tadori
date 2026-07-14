# Tadori Implementation Status

Last updated: 2026-07-13 (Weeks 1–2 complete)

## Current milestone

**Weeks 1–2 — Store + core extraction** (frozen v2.1 gates §14). All applicable
completion gates pass; see "Validation results" below.

## Completed capabilities

- pnpm monorepo (`packages/core`, `packages/store`, `packages/indexer`,
  `packages/harness`) with strict TypeScript, ESLint (flat config,
  `no-explicit-any` as error), and Vitest.
- `@tadori/core`: frozen enums (node kinds, relations, origins, confidences,
  resolutions, repository-state kinds, evidence kinds), Zod schemas for graph
  payloads, canonical pipe-delimited identities with backslash-then-pipe
  escaping, UTF-8 SHA-256 entity keys, collision-index rehashing.
- `@tadori/store`: the five frozen migrations verbatim (WAL, foreign keys,
  synchronous NORMAL), ordered migration runner with duplicate protection,
  transaction-safe snapshot insertion over stable entities + membership rows,
  collision-safe entity upserts, dangling-endpoint validation (§10) with
  reject-and-rollback, active-snapshot serving that never serves an invalid
  snapshot, three-way edge diff (§11), snapshot pruning (pinned refusal), and
  the corrected foreign-key-safe orphan GC (§13) followed by
  `PRAGMA foreign_key_check`.
- `@tadori/indexer`: TypeScript `LanguageService` driver (no Tree-sitter),
  tsconfig discovery, allowJs-gated JavaScript support, repository scan with
  built-in + `.gitignore`/`.tadoriignore` exclusions, indexed-vs-support file
  classification (`.d.ts` shims and config JSON resolve without becoming graph
  nodes), normalized repository-relative paths, nearest-`package.json` package
  detection, package/file/function/method/class/interface/type nodes,
  function-valued class properties as methods, overload collapsing to one
  logical node, ambient-declaration exclusion, variable exclusion (nodes and
  exports), direct/aliased/type-only imports, `external_dep` nodes
  (`npm:<specifier>`) for bare imports, direct exports, re-exports, barrels,
  star re-export support, spans + one-based line evidence, signatures,
  body hashes, analyzer version, deterministic sorted output, workspace hash,
  and commit/working-tree snapshot creation into the store.
- `@tadori/harness`: JSON-schema validation (Ajv 2020-12) of every expected
  graph, fixture-manifest driven comparison that indexes each fixture into a
  clean temporary SQLite database, entity-key node/edge comparison, exact
  origin/confidence/resolution comparison, evidence checks, `indexedFiles`
  contract enforcement, explicit milestone relation filter, deferred-relation
  and deferred-node-kind reporting, unexpected-emission failure (the analyzer
  must not emit deferred relations), excluded-candidate (variable) checks, and
  a strata guard that fails if a declared relation is neither tested nor
  explicitly deferred. CLIs: `fixtures:validate` (TS port of
  `validate_fixtures.py`), `fixtures:index`, `fixtures:typecheck`.

## Validation results (all executed and observed on this machine)

| Check | Result |
|---|---|
| `pnpm install` | clean |
| `pnpm typecheck` (strict, `noUncheckedIndexedAccess`) | pass |
| `pnpm lint` | pass |
| `pnpm test` | 75/75 tests, 9 files, all pass |
| `python validate_fixtures.py` | pass |
| `pnpm fixtures:validate` | pass |
| `pnpm fixtures:typecheck` (all 5 fixture repos, `tsc --noEmit`) | pass |
| `pnpm fixtures:index` (all 5 snapshots) | PASS for all; 0 missing/unexpected/mismatched nodes and edges |
| Migrations on empty DB + `PRAGMA foreign_key_check` | zero rows |
| Dangling endpoint memberships (every snapshot) | zero |
| Commit + working-tree snapshots coexist | verified (store + indexer tests) |
| Canonical SHA-256 identities vs. fixture values | exact match (core tests) |
| Deterministic repeated indexing | verified (identical keys, hashes, workspace hash) |

## Fixture relations currently supported (compared against golden truth)

- `contains` (package→file, file→symbol, class→method, interface→method)
- `imports` (file→file, file→external_dep; aliased, type-only, re-export imports)
- `exports` (direct, re-export, barrel; excluded for variables)

Compared per snapshot: core-symbols 27 nodes/54 edges, express-routes 27/56,
next-routes 22/42, diff-coalescing before 17/30, after 17/30.

## Relations intentionally deferred (reported by the harness, never dropped)

- Relations: `references`, `calls`, `implements`, `extends`, `tests`,
  `routes_to`, `documents`, `changed_with`.
- Node kinds: `route`, `test`, `adr`, `doc_section`, `unresolved` (and the
  `contains` edges that target them).
- Checks: seeded boundary violations, non-variable excluded candidates,
  raw/coalesced diff artifacts of fixture 04 (Week 9).

## Performance observations

- Fixture snapshots index+store in 0.3–0.8 s each (cold LanguageService).
- Synthetic 150k LOC repository (1,500 files, 16,501 nodes, 32,999 edges):
  **9.0 s** total (4.4 s extraction, 4.6 s SQLite insertion) on the target
  machine — under the frozen 60 s Weeks 1–2 gate, with zero dangling
  endpoints and zero foreign-key violations.

## Specification deviations / documented interpretations

1. **Symbol-level `bodyHash` recipe.** No frozen document specifies the byte
   recipe behind the fixtures' symbol body hashes; brute-force reconstruction
   (raw text, line spans, whitespace-stripped/collapsed variants, signature
   forms) failed except for one interface-method case. File-node body hashes
   are SHA-256 of the raw file bytes and match the fixtures exactly (verified
   and enforced). Symbol body hashes therefore use a documented
   analyzer-defined recipe (SHA-256 of whitespace-collapsed declaration text —
   stable across moves, changed by self-reference renames, matching the §12
   Stage A/B semantics). The harness requires symbol body hashes to be present
   where expected but compares equality only for file nodes.
2. **Evidence line comparison.** Fixture evidence anchors follow a
   first-occurrence-in-file authoring convention for `exports` and
   file→symbol `contains` edges (e.g. fixture 01 anchors
   `file contains DoubleStrategy.run` at `strategy.ts:2`, which is the
   *interface's* `run` line, and `exports format` at `math.ts:1`, factorial's
   line). Declaration-precise evidence cannot reproduce those lines without
   emitting factually wrong anchors. The harness therefore (a) validates every
   expected anchor against the fixture source (parity with
   `validate_fixtures.py`), (b) requires actual evidence in the same file with
   in-bounds one-based ranges, and (c) requires the actual range to cover the
   anchor line for `imports`, package containment, and class/interface member
   containment, where anchors are structural. Indexer unit tests assert exact
   declaration-precise one-based lines.
3. **Collision-index serialization.** The corrections document says a collision
   index is "appended and the key rehashed" without fixing a format; this
   implementation appends it as an extra pipe-delimited field
   (`<canonical>|<n>`) before rehashing.
4. **`getUser`/`app` style exported variables** produce diagnostics rather than
   nodes/edges, per the fixture contract ("variable declarations are not
   nodes"); the exclusions are reported in harness output, never silent.

## Discovered defects

- None outstanding. (During implementation: ambient `declare function`
  statements initially produced function nodes; fixed by excluding
  `ModifierFlags.Ambient`. `ts.ExportSpecifier.name` is `ModuleExportName` in
  TS 5.9; fixed the barrel-resolution signature.)

## Known limitations (in-scope simplifications, not defects)

- Ignore-file support covers directory names, `*.ext` suffixes, and exact
  paths only; full gitignore grammar is later work.
- Only root-level `tsconfig.json` discovery; nested-workspace tsconfigs are a
  later milestone (fixtures are single-project).
- Only top-level declarations become symbol nodes (matches the fixture
  contract; nested function extraction is not required by any fixture).
- The repository is not a git repository, so the "inspect the current Git
  diff" step of the validation loop was performed by re-reading changed files;
  recommend `git init` + an initial commit before Week 3.

## Immediate next task (Week 3 — do not start without instruction)

Implement resolved `calls` edges with enclosing-symbol attribution via span
containment (compiler/certain/resolved), plus the synthetic `unresolved` call
target nodes (`<path>::<unresolved expr>`) for dynamic `obj[k]()` dispatch —
fixture 01's `handlers[key]()` and fixture 02's `controller[action]()` — then
widen the harness milestone filter to include `calls`/`references` and the
`unresolved` node kind.
