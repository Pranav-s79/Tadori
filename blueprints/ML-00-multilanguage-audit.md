# ML-00 — Multi-language transition: ground-truth audit (Phase 0)

> Corrective milestone gate. Audited against `main` at
> `1f01bf08b2ca3a57e93a5445230fd7950fc29450`. This milestone explicitly
> supersedes the v2.1 TS/JS-only scope while preserving the frozen graph,
> identity, evidence, snapshot, diff, MCP-count, and visualization contracts.

## Summary

Tadori's back half is already mostly language-neutral. The acceptance,
scanning, project discovery, compiler services, extraction, and several
framework-derived features are not. The transition therefore replaces the
front of the pipeline with registered extractors; it does not create a second
graph, store, snapshot model, API, diff engine, or visualization model.

Legend: **N** neutral already; **N+** neutral with an additive extension;
**A** TS/JS-specific but adapter-contained; **L** TS/JS detail leaked into a
shared contract; **U** unsafe for mixed repositories; **M** identity/snapshot
migration-sensitive.

| # | Area | Exact implementation evidence | Class |
|---|---|---|---|
| 1–2 | Root acceptance and error | `packages/cli/src/repoResolve.ts::resolveRepoRoot` requires root `package.json` or `tsconfig.json` and names TS/JS in the error | U |
| 3 | Scanner | `packages/indexer/src/scan.ts::scanRepository` walks deterministically, but consults TS compiler options before walking and drops unrecognized code | N/A/U |
| 4–5 | Extensions and language ID | `scan.ts::TS_EXTENSIONS`, `JS_EXTENSIONS`, `classify`, and the closed `ScannedFile.language` union | L/U |
| 6 | Projects/workspaces | `packages/indexer/src/project.ts::findTsconfig`, `createProjectServices`, `IncrementalProjectServices` discover one root TS project | A/U |
| 7 | Packages | `scan.ts::detectPackageName` and `extract.ts::packageNameFor` know only `package.json.name`; `extractGraph` emits one root package | A/L/M |
| 8–12 | Compiler, symbols, imports, calls, heritage | `packages/indexer/src/project.ts`, `extract.ts::extractGraph`, and `semantics.ts` directly use the TypeScript API | A |
| 9 safety | Syntax failure | `indexRepository.ts::rejectSyntacticallyInvalidRepository` aborts the whole repository on any TS/JS syntax error | U |
| 13 | Body hashes | `extract.ts::bodyHashOfText` is neutral text normalization, but declaration boundaries are adapter-specific | N+/A/M |
| 14 | Entity keys | `packages/core/src/identity.ts` keys nodes by `(kind, qualifiedName)` and edges by endpoint keys/relation | N/M |
| 15 | Evidence/provenance | `packages/core/src/graph.ts::evidenceSchema` is neutral and one-based; nodes/edges lack extractor, capability, derivation, diagnostics, and unresolved reason | N+/L |
| 16 | Routes | `semantics.ts::EXPRESS_ROUTE_METHODS`, `isExpressReceiver`, `nextRouteRole` and route passes in `extract.ts` | A |
| 17 | Tests | `extract.ts` recognizes TS `test`/`it` callbacks and checker-backed references | A |
| 18 | Docs | `findAdrHeading`, `backtickTerms`, `isPathTerm` are deterministic, but links resolve against the TS-built registry | A/N+ |
| 19 | Paths | `packages/mcp/src/tools.ts::TadoriTools.path` traverses graph relations generically | N |
| 20 | BehaviorStory | `packages/server/src/story.ts::deriveRouteStory` is graph-generic once evidenced route/call/reference edges exist | N+ |
| 21 | Diff/rename | `packages/store/src/diff.ts` is neutral; coalescing uses kind/name/body hash/analyzer version | N/M |
| 22 | Boundaries | `packages/store/src/boundaries.ts::computeBoundaryViolations` is path/relation based | N |
| 23 | Visualization | `apps/viz` consumes generic kinds/relations, but has no language/capability/extractor fields or filters | N+/L |
| 24–25 | HTTP/MCP DTOs | `server/src/routes/graph.ts`, `mcp/src/contracts.ts`, and `mcp/src/tools.ts` omit node language and per-item extraction provenance | N+/L |
| 26 | CLI | `repoResolve.ts` repeats the unsafe TS/JS-only gate for serve/purge | U |
| 27 | Fixtures | `fixture-manifest.json`, `packages/fixtures/01..04`, and frozen expected schemas are TS-only authoritative contracts | A/M |
| 28 | Bench | `packages/bench` data models are neutral; `scripts/benchmark-incremental.mts` generates TS only | N/A |
| 29 | Claims | `README.md` and `docs/CLI_CONTRACT.md` accurately describe the old TS/JS limitation | A |

## Contract and migration decisions

- Keep the frozen node kinds, relations, origins, confidence, resolution,
  canonical hashing, one-based evidence, and six MCP tools.
- Add a central deterministic language registry. It owns language IDs,
  extensions/filenames/shebangs, precedence, parser/extractor versions,
  capability, manifests, generated conventions, and optional query bundles.
- Add per-node/per-edge language, extractor ID/version, capability, derivation,
  and optional unresolved reason. Existing snapshots read these as nullable
  legacy metadata; new extraction must populate them.
- Use `origin=compiler` only for compiler/type-checker facts. Parser-derived
  structural edges retain a frozen origin such as `heuristic` and are
  distinguished by the additive derivation field.
- Preserve every TS/JS `(kind, qualifiedName)` recipe, so current entity keys
  remain byte-for-byte stable. New-language symbol qualified names are
  language-prefixed (for example `python:api/main.py.Service.run`) to prevent
  cross-language collisions without altering the canonical key algorithm.
- Preserve existing root package identity for TS/JS parity. Additional detected
  projects use language- and root-qualified package identities.
- Add only a nullable/defaulted migration for per-item extraction metadata.
  No destructive schema change is justified.
- Refuse rename/move coalescing across incompatible extractor versions. The
  current review route incorrectly supplies the head analyzer version for both
  base and head, which can false-coalesce an extractor migration.

## Capability boundaries

Structural extraction can support files, projects/modules, declarations,
syntax imports/includes, syntactic inheritance, locally clear calls,
convention-backed tests/routes/docs, body hashes, paths, boundaries, raw diffs,
and compatible-version rename presentation. Compiler semantics remain required
for alias/re-export resolution, type-driven and cross-module calls, overload
identity, declaration-definition unification, and compiler-certain test links.
Unsupported relations must remain absent or explicitly unresolved.

## Systems retained unchanged

Canonical storage, SQLite repositories and snapshots, stable entities,
evidence, raw diffs, graph traversal, boundary evaluation, BehaviorStory,
Git co-change, agent overlays, retention/GC, purge confinement, HTTP/MCP parity,
and the graph-driven visualization remain Tadori-native. The existing
TypeScript `LanguageService` pipeline becomes the semantic TS/JS adapter.

## Validation and packaging gaps

The frozen fixtures compare exact TS node/edge keys and metadata and must remain
byte-identical. New coverage belongs in an additive mixed-language oracle.
Current CI covers Ubuntu Node 22/24/26 and Windows Node 22 only; root CI omits
the visualization build/tests. There is no installable packed product yet:
workspace packages point at TypeScript source, use `workspace:*`, and expose no
`bin`. The server root still renders a status page rather than the existing
visualization. These are milestone deliverables, not facts to conceal.

## Dependency order

1. Audit, capability matrix, upstream/license/reuse record.
2. Language-neutral extraction/provenance contract.
3. Registry, scanner, mixed-repository acceptance.
4. TS/JS adapter parity and cross-version diff guard.
5. Pinned WASM parser runtime and failure isolation.
6. Deterministic internal mixed-language oracle.
7. Python, C/C++, then Go/Rust/Java structural adapters.
8. Deterministic non-code/interface adapters needed for evidenced boundaries.
9. Packed artifact, visualization/API smoke, and pinned external validation.

