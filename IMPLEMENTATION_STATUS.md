# Tadori Implementation Status

# Current State (always overwritten)

Current node: 08-07D — /docs grouping + `documents` edges (server+viz): IMPLEMENTED on branch bp/08-07d-docs-grouping, pending CI/merge. 08-07C /routes path-source MERGED (#39=6daf6f3). 08-07B (#38). 08-07A (#37). 08-07 (#36). 09-04 (#35).
Branch: bp/08-07d-docs-grouping (off main 6daf6f3)
Latest commit: 6daf6f3 main (PR #39 merged — 08-07C /routes path-source, CI green both OSes; note: #39 first failed on story.test.ts reading the OLD /routes shape — an HTTP-consumer I missed — root-caused + fixed before merge, not merged red). 08-07B (#38). 08-07A (#37). 08-07 (#36). 09-04 (#35). 09-03 (#33/#34). 09-02.
Open PR: 08-07D to be opened after push.
08-07D done (branch): THIRD derived-engine slice — GET /api/v1/docs now carries each doc's `documents` edges (what it grounds) and ?for= actually FILTERS. New @tadori/server deriveDocEntries (packages/server/src/docs.ts): a doc/ADR node is the SOURCE of its `documents` edge (verified fixture 01: adr:math -documents-> file:src/math.ts, origin=doc), so its outgoing `documents` edges are what it grounds. DocsDto enriched ADDITIVELY: docs entry gains `documents: ToolEdge[]` — {node,body} unchanged so inspectApi.fetchLinkedDoc (reads docs[0].{node,body}) still works; the ?for= filter fix makes fetchLinkedDoc actually scope to the inspected entity (was a latent no-op that returned all docs). viz DocumentsPanel splits grounded (shows citation count) vs ungrounded (explicit section, never dropped). No schema/migration change (documents from existing edges; DocsDto is HTTP DTO). derived.test +2 (documents-array + ?for= filtering), viz 274/274, tsc/eslint 0. LESSON APPLIED: exhaustively enumerated ALL /docs HTTP consumers (DocumentsPanel, inspectApi, derived.test) before changing shape — the #39 miss taught that HTTP-DTO consumers ≠ type importers. SQLite endpoint tests on CI.
08-07C done (branch): SECOND derived-engine slice — GET /api/v1/routes now carries each route's PATH-SOURCE ORIGIN, replacing the viz "unavailable from this endpoint" placeholder with the real direct-vs-derived label. New @tadori/server deriveRouteRows (packages/server/src/routeRows.ts) reads the route node's OUTGOING routes_to edge origin (VERIFIED against fixture 02/03: route node is the edge SOURCE → dst handler; express literal routes have origin=compiler). RoutesDto enriched: routes → RouteRow[]{node, pathSourceOrigin: Origin|null} (null when no routes_to edge, rendered explicitly). viz RouteTable renders pathSourceLabel(origin) (the exhaustive helper already shipped in routeLabels.ts) or "no route-registration edge". No schema/migration change (origin from existing edge; RoutesDto is an HTTP DTO). derived.test +2 (shape + express fixture compiler-origin), viz explore 14/14, viz 273/273, tsc/eslint 0. SQLite endpoint tests run on CI.
08-07B done (branch): FIRST server rich-derived engine slice — GET /api/v1/tests now returns per-test LINKAGE. New @tadori/server `deriveTestLinks`/`testLinkageFor` (packages/server/src/tests.ts) maps a tests-edge origin → linkage kind (compiler=statically_linked, heuristic=naming_associated, git=historically_associated, doc/human/llm=evidence_associated — same mapping as the frozen MCP find_tests tool, reused not re-invented). TestsDto enriched: {target, tests: TestLink[]{node,linkage,edge}, observed:false, note}. With ?for=<entity> → target's linked tests + linkage; without → whole-snapshot listing with linkage:null (no target ⇒ no claim); unresolved for → honest empty. viz LikelyTests renders the linkage badge (honest wording, no coverage claim asserted). No schema/migration change (linkage derived from existing edge origin; TestsDto is an HTTP DTO, not the frozen MCP schema). derived.test 3 new + testLinkageFor unit; viz 271/271. SQLite-backed endpoint tests run on CI (local better-sqlite3 unbuilt).
08-07A done (branch): viz StoryView (`apps/viz/src/features/story/`) consumes GET /api/v1/story/route/:entityKey (existing story.ts backend), opened from a route row's "Story" button in RouteTable. Renders the STATIC behavior story: ordered steps with honest labels (statically-resolved/test-backed/documented/inferred/ambiguous/unresolved) + provenance + evidence (reuses 08-06 EvidenceList), explicit unresolved walls (dynamic dispatch, no invented destination), and statically-linked tests ("Static linkage only, never runtime coverage"). Non-negotiable static-analysis-only banner always shown; runtimeObserved:false never presented as executed. Honest server refusals surfaced distinctly (400 not_a_route / 409 ambiguous / 404 unknown_entity). Reads DTO only, no graph mutation. viz 271/271 (+12), tsc/eslint/vite build 0, confined to apps/viz.
09-04 done (MERGED #35): git co-change → `changed_with` file→file edges, origin git/confidence inferred, ADDITIVE pass (`computeCoChangeEdges` in @tadori/indexer), gated by IndexOptions.extractCoChange (default OFF, on only at live serve). Fixtures never emit it → frozen golden diffs intact. `changed_with` un-deferred: DEFERRED_RELATIONS now []. No schema/migration/store change. CI green both OSes.
08-07 done (branch): viz Explore panel — Path/Routes/Tests/Docs as mutually-exclusive ARIA tabs (`apps/viz/src/features/explore/`), each row pivots into the existing inspection panel via openInspectionPanel. Built against the LIVE server shapes, NOT the blueprint's richer §10 contracts: /path returns the narrow {nodes,edges,found} single-BFS shape (honest found/no_path/unresolved/error states, no faked multi-path/nearestApproach); /routes,/tests,/docs are the server's honest stubs. LikelyTests renders the frozen "Likely relevant tests" heading + "not observed inspected" caption verbatim; no runtime-coverage claim (asserted). RouteTable shows best-effort method + explicit "unavailable from this endpoint" path-source (server /routes carries no routes_to origin yet). Follow-ups (documented, deferred): rich pathOutputSchema+parity test, per-test linkage kinds, route edge-origin, docs grouping — all need the server engine the blueprint calls "the engine 08-07 lands"; delivered the viz surfaces first. viz 259/259 (+12), tsc/eslint/vite build 0, confined to apps/viz.
LOCAL ENV NOTE: better-sqlite3 native binary is unbuilt locally (Node 25 vs pinned 22, no VS toolchain) — SQLite-backed suites run on CI only. Pre-existing, not a code defect.
09-03 viz merged (PR #34): BoundaryBadgeOverlay places a warning glyph per violation at the file's level=file layout coord; unplaced violations listed honestly; malformed-rules → alert; wired beside DiffBadgeOverlay. viz 247/247 (+14), tsc/eslint/vite build 0, confined to apps/viz.
09-03 backend done (merged): tadori.rules.json {boundaries:[{id,from,deny[],severity?}]} parsed at serve; computeBoundaryViolations over import/call edges, deduped one-per-file-pair (imports wins over calls), evidence verbatim; seeded fixture-01/02 violations EXECUTED (core-symbols 1/1, express-routes 1/1) via compareFixtureBoundaries. Served at GET /api/v1/boundaries.
09-03 viz done (PR #34): the app fetches violations, reuses the level=file layout to place glyphs (no new layout), and pays for the file graph only when a violation exists. `tadori serve .` on any repo with a tadori.rules.json now shows boundary violations end-to-end — this is the iterative-refinement checkpoint.
Next frontier: after 08-07D merges — the last derived-engine slice is /path full pathOutputSchema (status enum / multi-path / nearestApproach / ambiguity) + the in-process-vs-HTTP parity test the 08-07 blueprint specifies (biggest remaining piece — the /path route currently does a single narrow BFS). Done so far: per-test linkage (08-07B), route path-source origin (08-07C), docs grouping + documents edges (08-07D). Also open: 08-11 (browser a11y / Chromium full-flow, names the path/story displays). changed_with edges surface through GET /api/v1/edges as ordinary edges (no dedicated overlay yet).
Known blocker: none
09-02 documented divergence (verified 2026-07-21): fixture-04's coalesced-diff.json was authored against a BODY-ONLY bodyHash, but the frozen indexer hashes DECLARATION TEXT incl. the method name — so the formatValue→renderValue method rename changes its bodyHash and honestly falls to raw (0 Stage-B pairs, 5 edge pairs, not the authored 1/8). Same failure mode as the fixture's own recursive-rename note, generalized. Fixture files UNTOUCHED; forcing a match would violate "unresolved stays visibly unresolved". compareFixtureDiff asserts the real pipeline (2 Stage-A pairs). Coalescing lives in @tadori/store (shared by server route + harness, no harness→server dep; server re-exports).

## 09-01 — review-diff working_tree/staged wiring (backend slice, 2026-07-21)

- `GET /api/v1/review/diff?kind=working_tree|staged` now returns a real diff of
  the live disk / git-index against the served ACTIVE snapshot, replacing the
  honest 501 placeholders. Snapshot↔snapshot behavior unchanged; `snapshot`
  remains the default.
- New `packages/server/src/liveComparison.ts`: captures the live tree (working
  tree directly, or `captureStagedTree`'s materialized git index for staged),
  indexes it into an ISOLATED temporary SQLite DB (never the served DB, so the
  active snapshot is never rotated and the working tree / git index are never
  mutated), then diffs it in memory against `loadSnapshotGraph(servedDb,
  activeId)` — the in-memory expression of the frozen §11 three-way edge
  set-difference plus node add/remove, keyed on stable entity keys. Temp DB +
  staged temp dir always disposed in `finally`.
- Fix: `captureStagedTree` now materializes into a child dir named after the
  real repo so the derived package identity matches the served snapshot (repos
  without a root package.json name previously produced a spurious top-level
  package add/remove in the staged diff).
- Honest errors: git-unavailable → 501 `git_unavailable`; non-repo → 400
  `not_a_git_repository`; staged/live capture failure → 400 `*_capture_failed`;
  unexpected errors re-thrown (500), never mislabeled.
- Tests: new `packages/server/test/reviewLive.test.ts` (9 real-git + real-SQLite
  integration cases: working_tree add/remove/unchanged, staged
  add/delete/partial-staging, working-tree-only change does NOT leak into
  staged, non-git 400, no temp-dir leak + working tree/index unchanged after
  comparison). `review.test.ts` 501 assertions updated to the wired behavior.
  Server+indexer 159/159 green; `pnpm typecheck` + scoped `eslint` clean.

---

# History (append only)

Last updated: 2026-07-20 (08-04 blueprint authored + merged PR #15; 08-05
search & filters delivered PR #16, viz 145/145, rebased on main after #14/#15
merged; 08-03 file expansion merged PR #14; 08-02 scaffold PR #13)

## 08-05 — search & filters (delivered PR #16, 2026-07-20)

- New `apps/viz/src/features/search/`: single search box → `GET /api/v1/search`,
  250 ms debounce + monotonic generation guard (stale responses never overwrite
  newer). Multi-select kind/relation/origin/confidence/resolution filters as a
  pure render overlay (`applyFiltersToGraph` returns a new object; a toggle
  issues zero fetches). `limit<=100`/`offset<=1_000_000` clamped; result order
  is server order verbatim. Keyboard-first listbox + aria-live status; distinct
  idle/loading/ok/empty/ambiguous-adjacent/error copy.
- Deviations (ASSUMPTIONs in code): search rows carry no fanIn/freshness/stale
  (omitted, not fabricated); camera-focus + inspection-open are injected
  callbacks (08-02/08-06 not yet wired); axe check deferred to 08-11.
- Validation: viz 145/145 (+40 new), `tsc`/`eslint`/`vite build` exit 0,
  offline-bundle assertion passes. Rebased onto main after #14/#15 merged.

## 08-04 — task-region symbol expansion (blueprint ready, merged PR #15, 2026-07-20)

- Blueprint authored for the third/final zoom level (file → exported symbols).
  Verified the server already serves `level=symbol` (graph.ts `LEVELS`), so it is
  a reuse of 08-03's expand/collapse machinery, not new backend work. Scope:
  exported-only by default with an honest omitted-count; no fourth level.

## Current milestone

**Phase 8 — Guided 2D visualization** (frozen v2.1 Phase F). Phase 7 local
serving is validated through 07-03 and merged. 08-01 supplies the deterministic
server-owned layout and persistence boundary required before the visualization
app can be built. Weeks 1–7 remain complete and frozen; Phase 0 CI remains
live on Linux and Windows.

## 08-05 — search & filters (validated, 2026-07-20)

- New `apps/viz/src/features/search/` feature: single search box wired to
  `GET /api/v1/search`, debounced (250 ms) with a monotonic generation guard so
  stale/out-of-order responses never overwrite newer results; multi-select
  filter groups over the frozen kind/relation/origin/confidence/resolution
  vocabularies; keyboard-first result listbox (roving tabindex, Arrow/Home/End/
  Enter/Space, per-row accessible name = kind + qualified name); aria-live
  status region with distinct idle/loading/ok/empty/ambiguous-adjacent/error
  copy. HTTP-only; no `@tadori/*` import.
- Filters are a pure render overlay: `applyFiltersToGraph` returns a new object
  and never mutates fetched data; a filter toggle issues zero `/search`/`/nodes`
  /`/edges` fetches (asserted by fetch-mock call count). Client clamps
  `limit<=100` and `offset<=1_000_000`; result order is server order verbatim
  (never re-sorted). Multi-kind narrowing is client-side (server `kind` param is
  singular) preserving order.
- ASSUMPTION: search rows (store `FtsMatchRow`) carry no `fanIn`/`freshness`/
  `stale`; those §10 badge fields are omitted for search results (recorded in
  `searchApi.ts`). ASSUMPTION: 08-02 camera-focus + 08-06 panel-open APIs do not
  exist yet — `selectResult` calls injected `focusEntity`/`openInspectionPanel`
  callbacks (no-op until 08-06 wires them). ASSUMPTION: no axe-core dep present,
  so the §13 axe pre-check is deferred to 08-11's a11y sweep.
- Focused evidence: `pnpm --filter @tadori/viz test` 130/130 (5 new suites:
  filterState, searchApi, useSearchStore, ResultList, SearchPanel — 40 new
  tests). `tsc --noEmit`, `eslint .`, `vite build` all exit 0; offline-bundle
  assertion still passes. Also repaired two pre-existing `noUncheckedIndexedAccess`
  tsc gaps in `test/offline-bundle.test.ts` to keep the app's `tsc` gate green.

## 08-03 — Semantic zoom: file expansion (validated, 2026-07-20)

- Clicking or keyboard-activating (`Enter`/`Space`) a package hull expands it in
  place to its file-level nodes at deterministic `layout?level=file` positions.
  Expansion mutates the existing graphology graph additively
  (`addNode`/`addEdge`), never rebuilding — every other package's node `x`/`y`
  and the expanded package's own anchor stay `Object.is`-unchanged; collapse
  (`dropNode`/`dropEdge`) restores the exact prior node count and positions.
- `computeAggregatedEdges` collapses cross-package edges into one summary per
  `(srcPackage, dstPackage, relation)` with a provenance breakdown; two
  relations across the same pair stay distinct; intra-expanded-package edges are
  excluded from aggregation (rendered individually).
- `usePackageExpansion` caches each package's fetched file data in a ref, so
  collapse→re-expand in the same session issues zero additional fetches
  (test-asserted via fetch call count).
- File labels truncate at exactly 20 chars via the shared `truncate(text,
  maxLen)` helper (package labels reuse it at 24 — no duplicated logic).
- Focused evidence: `pnpm --filter @tadori/viz test` 105/105 (adds
  `expansion.test.ts` aggregation + diff + truncate, `usePackageExpansion.test.ts`
  ref-cache, `expand-collapse-canvas.test.tsx` byte-stability + keyboard).
  `eslint .`, `tsc --noEmit`, `vite build` all exit 0; offline-bundle assertion
  still passes on the fresh build.
- Confined to `apps/viz`: no `packages/*` changed, so root `pnpm typecheck`
  (exit 0) and `pnpm test` (315/315) remain unaffected.

## 08-02 — `apps/viz` scaffold + package map (validated, 2026-07-20)

- New workspace member `apps/viz`: React 19 + Vite 8 + Sigma.js 3 single-page
  app rendering the active snapshot's package-level graph as convex hulls with
  labels and a data-driven provenance edge legend. Talks to `packages/server`
  only over `fetch`/`WebSocket` against `/api/v1/*` — no `@tadori/*` import, no
  CDN script, no external font/asset fetch at runtime.
- Import boundary enforced by `apps/viz/eslint.config.js` `no-restricted-imports`
  (`@tadori/*`, `fs`, `better-sqlite3`); grep confirms zero `@tadori/*` imports
  under `apps/viz/src`.
- Legend UI and canvas edge renderer both call the single `edgeVisualStyle`
  from `src/legend.ts` (no duplicated mapping). Package labels truncate at
  exactly 24 chars + ellipsis (`truncateLabel`, unit-tested).
- Offline-bundle assertion (`test/offline-bundle.test.ts`) runs against the real
  `vite build` output: `index.html` has no absolute external script/link ref,
  and no `dist/` file references an external host (only loopback + the
  non-fetch library literals `www.w3.org`, `react.dev` are allowed). Verified to
  fail on an injected CDN URL; skips cleanly when `dist/` is absent.
- Focused evidence: `pnpm --filter @tadori/viz test` 90/90 (legend table,
  convex-hull cases, WS reconnect backoff 500/1000/2000/4000/5000-cap + refetch,
  three named empty/loading/stale states, package-map mount/unmount smoke,
  offline-bundle). `vite build` exits 0 → `dist/index.html` + bundled JS.
  `eslint .` clean.
- Root Node suite unaffected: `pnpm typecheck` exit 0 (root tsconfig scopes to
  `packages/*`, excludes `apps/viz`), `pnpm test` 315/315. `pnpm skills:check`
  verified 4 canonical skills.

## 08-01 — deterministic layout engine + persistence (validated, 2026-07-19)

- Added strict deterministic graphology/ForceAtlas2 layout contracts for
  package/file/symbol topology, semantic multiedges, fixed anchors, seeded
  initial positions, and a versioned 25-unit centroid-bounded delta path.
- Added snapshot-aware ordered reads, immediate atomic replace/append writes,
  explicit integrity failures, exact current-membership validation, historical
  row preservation, stable pin/anchor handling, and byte-identical reuse.
- `/api/v1/layout` captures one coherent current graph, materializes on first
  serve, supports the three frozen levels/base view, and sanitizes failures.
- Focused evidence: 33/33 layout/store/server tests; adversarial review drove
  fixes for dangling snapshots, corrupt stored coordinates, ignored inserts,
  ambiguous file ownership, centroid-bound origin, and an initially over-broad
  full-graph cache-hit reload.
- Full gate 2026-07-19 (all green): skills:sync/check, typecheck, lint,
  test (46 files, 293/293), `python validate_fixtures.py`, fixtures:validate,
  fixtures:index, fixtures:typecheck, `git diff --check`. Independent validator
  PASS on all 10 completion-cut invariants; zero blocker/high findings.
- Layout benchmark on Node 22.14.0, win32-x64, Intel Core Ultra 9 288V
  (one warm-up, five samples): package-500 p95 243.6 ms; symbol-1000 p95
  1446.5 ms; ordered-read p95 1.5 ms; first materialization p95 341.4 ms;
  byte-identical reuse p95 28.2 ms. Every enforced budget passed
  (respectively 3000/50/3000/100 ms).

## 07-03 — Serve hardening (validated, 2026-07-18; merged `f0181c3`, PR #11, CI green both OSes)

- Hardened 07-02's `serve.ts` lifecycle in place (no re-architecture, reused
  the existing `RunServeDeps` seam — no new interface). Port algorithm
  (§8/§10): default (`--port` omitted) → `listen({port:0})` OS-assigned, no
  conflict possible; explicit `--port N` occupied → hard-fail exit 4 with the
  exact message `"Port ${N} is already in use. Choose a different port with
  --port, or omit --port to let the OS pick one."`. An explicit occupied port
  is probed (`net.createServer`) BEFORE `createServerApp`, so no server routes
  or refresh worker start on the conflict path (spy asserts `createServerApp`
  never called); the `app.listen` call also carries its own EADDRINUSE catch as
  a TOCTOU backstop.
- Browser-launch failure: the non-fatal call site already existed; message
  pinned to `"Could not open a browser automatically. Open ${url} manually."`.
- Worker-crash (`watcher_error`): no new CLI wiring needed — `GraphState`'s
  poll loop already emits `watcher_error` off `refresh.state()`'s
  null→non-null `lastError` transition, and `isSnapshotStale()` already flips
  `context.stale` true when `fatalError !== null`. The CLI's `onError`
  remains an operator-facing stderr log. Verified end-to-end: worker
  `terminate()` → HTTP still serves last snapshot (stale:true) → WS client
  gets `watcher_error` → subsequent SIGINT exits 0 (idempotent `refresh.stop()`).
- `--snapshot` two-case validation pinned to §10: nonexistent id →
  `"Snapshot #${id} does not exist."`; present-but-dangling →
  `"Snapshot #${id} failed validation: ${n} dangling endpoint(s)."` (exit 3).
- Independent review found the validated ID was not threaded into
  `createServerApp`; the server reopened the newest working-tree head. The
  correction adds an exact-snapshot `GraphService` seam, validates repository
  ownership/active status/foreign keys, and prevents refresh rotation while a
  pinned session is running. A regression test builds requested snapshot 1,
  active snapshot 2, refreshes to snapshot 3, and proves snapshot 1 remains
  served throughout.
- Teardown now attempts server/GraphState, refresh worker, incremental indexer,
  and database cleanup independently. A simulated `app.close()` rejection
  proves worker/DB cleanup still occurs, the raw listening socket is closed,
  and `runServe` resolves with exit 1 instead of hanging.
- Empty-repo and non-TS-repo both produce the identical `resolveRepoRoot`
  message (documented honest equivalence, not a gap).
- Orphan supervision (OS-level `tasklist`/PID assertions, grace 2000 ms):
  SIGTERM / SIGINT / SIGKILL of a directly-spawned `tadori serve` process all
  leave zero processes at its PID. On this Windows machine the `tasklist`
  probe SUCCEEDED, so all three OS-listing assertions RAN (not skipped).
  Graceful exit-0 + teardown order is exercised via the in-process
  `AbortSignal` path (the same `teardown()` the real SIGINT/SIGTERM handlers
  call), because Windows `child.kill('SIGINT'/'SIGTERM')` hard-terminates a
  spawned child (verified: the handler never runs).
- Tests: 5 new files (`port-fallback`, `browser-launch-failure`,
  `orphan-supervision`, `snapshot-reindex-hardening`, `repo-error-messages`)
  + `fixtures/testMarkerWorker.ts`; existing `exit-codes.test.ts` EADDRINUSE
  assertion updated to the new exact message (message-text change only).
  Corrected full suite: 50 files, 283/283.
- Fresh correction full gate 2026-07-18 (all exit 0): skills:check,
  typecheck, lint, test,
  `python validate_fixtures.py`, fixtures:validate/index/typecheck (5/5
  golden fixtures PASS), benchmark:incremental, `pnpm tadori diff .`,
  `git diff --check`.

## 07-02 — `packages/cli` `tadori serve .` (validated, 2026-07-18; merged `7865548`, PR #10, CI green both OSes)

- New workspace package `@tadori/cli`: `tadori serve <path>` implementing
  all nine frozen `docs/CLI_CONTRACT.md` steps in order and the five
  frozen flags (`--port`, `--no-open`, `--reindex`, `--mode`,
  `--snapshot`). `--mode 2.5d|3d-experiment` parses then exits 1 citing
  10-01/10-02 before any server/indexer work; invalid `--snapshot` fails
  closed with exit 3 (never served); occupied `--port` exits 4 (automated
  EADDRINUSE test); unsupported repo exits 2 with distinct
  not-exist/unsupported messages. Localhost-only bind inherited from
  `createServerApp`; truthful status page (no dashboard wording; explicit
  "not yet built"). Teardown `app.close()` → `refresh.stop()` →
  `db.close()` with idempotency guard, SIGINT/SIGTERM + injectable
  AbortSignal.
- `scripts/tadori.mts`: existing `diff` flow wrapped verbatim; additive
  `serve` dispatcher; `packages/mcp/src/cli.ts` byte-identical.
- Tests: 5 files, 32/32; full suite 45 files, 261/261. Manual smoke
  `pnpm tadori serve . --port 0 --no-open` printed truthful startup facts;
  status page + `/api/v1/snapshot` 200.
- Full gate 2026-07-18 (all exit 0): install, skills:sync/check,
  typecheck, lint, test, `python validate_fixtures.py`,
  fixtures:validate/index/typecheck, benchmark:incremental,
  `pnpm tadori diff .`, `git diff --check`.
- Independent validation (cold-start Testing Agent): PASS; one Medium
  (untested EADDRINUSE path) + one Low (missing vitest alias) closed in a
  single correction pass.

## 07-01 — `packages/server` graph API (validated, 2026-07-18; merged `5dee45b`, PR #9, CI green both OSes)

- New workspace package `@tadori/server` (`fastify@5.10.0`,
  `@fastify/websocket@11.3.0`): `createServerApp(options)` factory,
  `GraphState` snapshot rotation (rotated `GraphService` drives
  `snapshot_replaced` with the new snapshot identity; failed rotation is
  retryable and records a truthful error; `watcher_error` emits on the
  null→non-null transition), and the full blueprint §10 route table —
  snapshot/pin, nodes/edges/evidence, source (repo-root-confined, 403
  `outside_repository`), search, path, refresh, observations (ambiguous
  symbol → 409; per-item truthful rejection reasons), derived displays
  (tests/routes/docs/overview/tour/progress), review diff, layout, `/ws`
  change-signal channel. Localhost-only bind enforced by test.
- Tests: 15 files, 51 tests, 51/51 green; full suite 40 files, 229/229.
- Full gate 2026-07-18 (all exit 0): install, skills:sync, skills:check,
  typecheck, lint, test, `python validate_fixtures.py`,
  fixtures:validate/index/typecheck, benchmark:incremental,
  `git diff --check`.
- Performance (§16 proxy floor): 25k-LOC synthetic corpus = 1/10 of the
  benchmark corpus, budget scaled by measured ratio, median/p95 logged at
  runtime by `performance.test.ts`.
- Independent validation (cold-start Testing Agent): PASS — all 8
  prior review-correction points verified with file:line evidence.
  Deferred non-blocking findings recorded in blueprint §22 (untested
  mid-rotation throw path and `watcher_error` emission; WS at-least-one
  frame assertions; vitest alias-map inconsistency).
- Wiring: `pnpm-workspace.yaml`, `tsconfig.json`, `tsconfig.base.json`,
  `pnpm-lock.yaml` (fastify/pino ecosystem additions only).

## 00-02 — CI pipeline, Linux + Windows (complete, 2026-07-17; runs 2026-07-18Z)

- Added `.github/workflows/ci.yml`: one `ci` workflow, matrix
  `ubuntu-latest` + `windows-latest`, triggered on push (`main`, `Sprint*`)
  and pull_request (base `main`), concurrency-cancelled per ref, 30-minute
  timeout, `permissions: contents: read`, no secrets.
- Steps run the frozen local gate in order through pnpm under the `.npmrc`
  Node 22.14.0 pin: frozen-lockfile install, skills:check, typecheck, lint,
  test, `python validate_fixtures.py`, fixtures:validate/index/typecheck,
  `pnpm tadori diff .` (added per blueprint 00-02 §8 coordination note now
  that 00-01A landed first), `git diff --check`, and the exact tree-mutation
  guard (`git add -A` + `git diff --cached --exit-code`).
- README Development section carries the CI badge.
- Run evidence (PR #7, squash-merged as `7876837` by the repository owner
  2026-07-18T03:17:38Z):
  - First run (commit `9b789a5`), both OSes red with two REAL findings —
    windows: `validate_fixtures.py` exit 1, runner Python lacked
    `jsonschema` (fixed `cb50d03`, workflow pip-install step); ubuntu:
    `watcher.test.ts` fed a hardcoded backslash path that only normalizes
    on Windows (fixed `a6f6a52`, test now uses platform-native separators —
    production watcher unchanged; on POSIX a backslash is a legal filename
    character). Run: actions/runs/29627577053. This organic red run is the
    recorded gates-bite evidence.
  - Green run (commit `a6f6a52`): actions/runs/29628448665 — ubuntu job
    88037408805 (1 m 23 s), windows job 88037408807 (2 m 41 s). Verbatim
    vitest parity on the same commit: ubuntu `Tests  178 passed (178)`,
    windows `Tests  178 passed (178)`, local `Tests  178 passed (178)`.
  - First `main` push run after merge: actions/runs/29628564682, green.
- Documented deviation from blueprint §14: the synthetic deliberate-failure
  probe (`fc074a1`, a `no-explicit-any` lint violation) was pushed but never
  received a run — the owner merged/closed PR #7 before the synchronize
  event was processed, so the probe was discarded unmerged and its branch
  deleted. The "a broken commit fails CI" criterion is satisfied in
  substance by the organic first-run failure above (two distinct gates
  failing on two OSes); a literal synthetic probe can be repeated on any
  future PR if desired.

## 00-01 — Repository sync & README correction (complete, 2026-07-17)

- The blueprint's three hygiene commits (`7891a99` gitignore, `1f97ee1`
  planning vault, `a4ab158` README replacement + byte-identical fixture-guide
  relocation) reached `main` via merge PR #4 (`a79a29e`); the 00-01A scanner
  fix followed via squash PR #5 (`06d951f`). Under the re-scoped owner
  decision (option a), `main` advances only via owner-authorized PRs — the
  original fast-forward push steps are void and were completed in PR form.
- README command verification executed 2026-07-17 on this machine (tree =
  `06d951f`): `pnpm install` clean; `pnpm test` 178/178 (25 files);
  `pnpm tadori diff .` exit 0 with diff summary;
  `echo "" | pnpm mcp:stdio --db .tadori/tadori.sqlite --repo .` exit 0 with
  clean EOF shutdown. Every command documented in the README now runs as
  written — the previously false `tadori diff` claim is true after 00-01A.
- README status counts refreshed (170/24 → 178/25 post-00-01A); all five
  branches confirmed on origin; `origin/autonomous-roadmap` untouched;
  `git tag` empty.
- Commit-SHA reconciliation: PR #5 was squash-merged, so the 00-01A
  implementation commit `8be4741` is superseded on `main` by squash commit
  `06d951f` (PR #5); records below cite both.

## 00-01A — allowJs scanner contract & regression (complete, 2026-07-17)

- Fixed the allowJs scanner defect (blueprint
  `blueprints/00-01A-allowjs-scanner-contract.md`, implementation commit
  `8be4741`, on `main` as squash commit `06d951f` via PR #5):
  `scanRepository` now resolves the repository's effective root
  compiler options once per scan via the additive
  `resolveRootCompilerOptions` export in `packages/indexer/src/project.ts`
  (`extends`-resolved, live disk, `capturedTexts` omitted entirely) and
  classifies `.js/.jsx/.mjs/.cjs` files as indexed only when
  `allowJs === true || checkJs === true`. Gated-off JS files remain
  captured, hashed support files, so the indexed+support union, workspace
  hashes, and freshness behavior are unchanged.
- Regression matrix `packages/indexer/test/scan-allowjs.test.ts` (8 tests
  per blueprint §13): include-glob bug shape, allowJs on with JS function
  extraction, `.jsx/.mjs/.cjs` parity, `extends`-chain resolution (doubles
  as the capturedTexts empty-Map failure detector), `checkJs` parity, no
  tsconfig, `.d.ts` invariance, and incremental refresh of an edited
  gated-off support JS file (asserts a new snapshot publishes).
- Independent adversarial review: PASS — 0 blockers, 0 high; accepted LOW
  residuals: scan-vs-capture tsconfig TOCTOU affects error quality only
  (capture is already non-atomic); an `extends` base inside `node_modules`
  flipping allowJs is invisible to incremental config-change detection until
  a captured config/support change forces reconstruction (pre-existing
  workspace-hash design boundary); the scanner discards the
  `parseTsconfig().fileNames` enumeration (shared-parser parity mandated by
  blueprint §8).

### 00-01A full validation (executed 2026-07-17)

| Check | Result |
|---|---|
| `pnpm install` | clean |
| `pnpm skills:sync` / `pnpm skills:check` | pass; 4 canonical skills |
| `pnpm typecheck` / `pnpm lint` | pass |
| `pnpm test` | **178/178 tests, 25 files** (170 existing + 8 new) |
| `python validate_fixtures.py` / `pnpm fixtures:validate` | pass |
| `pnpm fixtures:index` | all comparisons pass |
| `pnpm fixtures:typecheck` | pass ×5 |
| `pnpm benchmark:incremental` | pass; single-file p95 737.9 ms < 2000 ms |
| `pnpm tadori diff .` (Tadori repo root) | **exit 0, diff summary printed** (previously crashed on `eslint.config.js`) |
| `echo "" \| pnpm mcp:stdio --db .tadori/tadori.sqlite --repo .` | exit 0, clean EOF shutdown |
| `git diff --check` | pass |

## Week 6 — Incremental indexing and hardening (complete, 2026-07-15)

- Added a native repository watcher with normalized deterministic batches,
  debounce plus maximum-wait bounds, ignored-path filtering, startup/error
  rescans, platform fallback, and clean lifecycle handling.
- Added immutable repository-generation capture: scan membership, file hashes,
  file bytes, and configuration/package inputs are captured together and
  rechecked before publication. Late or mixed-generation writes supersede the
  pass instead of publishing a graph assembled from different filesystem
  moments.
- Added a persistent versioned TypeScript language service and regional graph
  refresh. Body-only changes, dependency changes, test/route/ADR edits, and
  barrel edits use deterministic invalidation and merge; structural identity,
  file membership, configuration, analyzer-version, restart-baseline, or
  validation uncertainty fails closed to a full rebuild.
- Added generation-CAS publication, immediate stale overlays, no-op and A→B→A
  reuse, cancellation at publication boundaries, syntax-error rollback and
  recovery, endpoint/evidence validation, and crash-safe restart reconciliation.
  TypeScript semantic diagnostics remain graph diagnostics; syntactically
  invalid source is never activated. A synchronous compiler extraction already
  in progress cannot be preempted mid-call, but a superseded/cancelled
  generation cannot activate afterward.
- Added `tadori diff .`, which records the command-start working-tree head as
  its base (falling back to the active commit when no working-tree head exists),
  reconciles and atomically publishes one captured disk generation, then
  compares those two immutable snapshots. Production stdio runs the compiler,
  watcher, and writer connection in an isolated worker: MCP reads stay
  responsive and expose `refresh_pending`; in-flight tasks retain their
  snapshot while new sessions adopt the replacement head.
- Added adversarial coverage for import/body/barrel/route/test/ADR regions,
  add/move/delete/rename fallback, invalid syntax, no-op and A→B→A cycles,
  supersession/cancellation, restart mismatch, unreported late writes, native
  saves, held WAL readers, MCP session pinning, and legacy migration databases.

### Migration 006 defect report

Migrations 001–005 are preserved verbatim. Their unique
`(repo_id, kind, workspace_hash)` snapshot identity and newest-ID head selection
cannot represent activation order: after A→B→A, reusing A is correct, but B has
the newer snapshot ID and remains served; inserting A again violates the unique
constraint. Additive migration 006 introduces append-only
`snapshot_activations` with monotonic activation IDs and repository/kind
integrity triggers. This is the smallest correction that preserves historical
snapshot identity, existing memberships, and the frozen first five migrations.
Legacy pre-006 databases remain readable and are upgraded by the normal ordered
migration runner. Tests cover A→B→A, stale-writer ABA prevention, relationship
integrity, exact-membership reuse checks, and migration-005 compatibility.

### Week 6 performance evidence

Benchmark corpus: 250,330 LOC in 291 files, 12 incremental iterations, Node
22.14.0 on Windows x64.

| Scenario | Observed | Gate |
|---|---:|---:|
| cold full index | 2071.685 ms | informational |
| single-file refresh p95 | 1257.685 ms | < 2000 ms |
| dependency-region refresh (40 files) | 450.145 ms | regional |
| 250-export barrel refresh | 496.337 ms | regional |
| package/config full fallback | 1147.954 ms | < 10000 ms |
| heap growth | 202,683,256 bytes | < 512 MiB |
| database growth | 9,535,488 bytes / 16 snapshots | < 2 MiB per added snapshot |

The latency gates pass. Current scaling ceilings are synchronous TypeScript
compiler work (cancellation is checked between passes/publication boundaries),
root-level tsconfig discovery, and intentionally conservative full fallback for
structural identity or configuration uncertainty.

### Week 6 full validation (executed 2026-07-15)

| Check | Result |
|---|---|
| `pnpm install` | clean; lockfile already current |
| `pnpm skills:sync` / `pnpm skills:check` | pass; 4 canonical skills synchronized and verified |
| `pnpm typecheck` | pass |
| `pnpm lint` | pass |
| `pnpm test` | **170/170 tests, 24 files, all pass** |
| `python validate_fixtures.py` | pass |
| `pnpm fixtures:validate` | pass |
| `pnpm fixtures:index` | all 5 snapshots pass; zero dangling endpoints and zero foreign-key violations |
| `pnpm fixtures:typecheck` | all 5 fixture repositories pass `tsc --noEmit` |
| `pnpm benchmark:incremental` | pass; both frozen latency gates and memory/database bounds pass |
| concurrent MCP refresh probe | `refresh_pending` read served while isolated compiler refresh remained active |
| `git diff --check` | pass |

## Week 5 — Context selection and budgeting (complete, 2026-07-14)

- Added one explicit ranking policy in `packages/mcp/src/ranking.ts` with the
  frozen weights: BM25 3.0, graph proximity 2.5, log fan-in 1.0, 90-day churn
  1.0, linked test 1.5, linked decision 1.0, and same package 0.5. Proximity is
  exactly `1 / (1 + graph_distance)`; deterministic ties use confidence and
  entity identity.
- Task-text BM25, churn, linked decisions, and declared boundaries are not
  available from the current snapshot/session contract. They contribute zero
  and are labeled unavailable instead of being guessed. Missing package
  metadata is also tri-state unavailable rather than scored as false.
- Hard requirements are discovered against the anchor independently of the
  caller's presentation relation filter: direct callers/callees, exact
  signature-referenced type/interface definitions, certain linked tests, and
  (when later available) declared-boundary neighbors. Compiler/certain/resolved
  direct calls receive the protected priority tier; heuristic direct edges stay
  hard but retain their lower confidence and priority.
- `symbol_context` now returns compact per-candidate score explanations,
  policy/version/weight metadata, unavailable signals, hard requirements,
  critical-context counts, selected representation, and an exact serialized
  token estimate. Confidence is derived from anchor/predecessor path evidence,
  never from unrelated incident edges.
- Budget reduction follows body → signature → name before ranked nodes are
  removed. Both resolved and ambiguous calls enforce the whole serialized
  response budget, select the largest fitting deterministic prefix by binary
  search, retain named next omissions when space permits, and never return a
  non-progressing cursor.
- Pagination is stable over ranked offsets. Depth-2 pages carry connector nodes
  and required path edges without reporting returned connectors as omitted;
  terminal connector-only remainders correctly close with no cursor. Relation,
  test, and document groupings use entity-key references so evidence-bearing
  entities are serialized once.
- Every truncated response includes named and/or aggregate omission accounting
  for nodes and edges, reasons, continuation, and whether hard-required context
  remains. Duplicate relation filters are rejected before traversal.
- Added adversarial coverage for 1,024-token and exact-boundary budgets,
  long-signature ambiguity, deterministic repeats, more than 100 hard
  neighbors, compiler-certain versus inferred ordering, relation-independent
  hard tests and signature types, unrelated incident edges, unresolved
  provenance, connector reconciliation, terminal connector pages, duplicate
  filters, and no-silent-omission accounting.

### Week 5 validation (executed 2026-07-14)

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | clean; lockfile already current |
| `pnpm skills:sync` / `pnpm skills:check` | pass; 4 canonical skills synchronized and verified in both agent trees |
| `pnpm typecheck` / `pnpm lint` | pass |
| `pnpm test` | **132/132** tests, 17 files |
| `python validate_fixtures.py` / `pnpm fixtures:validate` | pass |
| `pnpm fixtures:index` | **PASS ×5**; exact expected graphs, zero dangling endpoints and foreign-key rows |
| `pnpm fixtures:typecheck` | pass ×5 |
| Focused spec-guardian and adversarial runtime reviews | clean after fixes; no remaining blocker/high/medium finding |

## Week 3 — Semantic extraction (complete, 2026-07-14)

Implemented in `@tadori/indexer` (`extract.ts` passes 3–7 plus the pure
helpers in `semantics.ts`):

- **references** — compiler-resolved type-annotation references
  (`TypeReferenceNode`) and `new X()` class uses, attributed to the innermost
  enclosing registered symbol via span containment (constructor parameter
  properties attribute to the class, since constructors are not nodes).
  Import/export specifiers, call callees, heritage names, and top-level code
  never emit references. Duplicate stable edges merge evidence (e.g. return
  type + new-expression in one factory function).
- **calls** — checker-resolved callees (identifier and property-access,
  alias-safe through barrels and `import { x as y }`), overload groups
  collapsing to the one logical node, recursive self-calls, and interface
  dispatch resolving to the interface method only (never invented concrete
  implementations). Constructor invocations emit references, not calls.
  Calls with no enclosing symbol (top-level) are not emitted.
- **heuristic calls** — a property call the checker cannot resolve (e.g. an
  `any` receiver) with exactly one repo-wide function/method name candidate
  emits `heuristic/likely/partial`; ambiguous names emit a diagnostic and no
  edge (verified by unit test and fixture 04 before-graph).
- **unresolved dynamic dispatch** — `obj[k]()` produces a deterministic
  synthetic `unresolved` node (`<path>::<unresolved obj[k]>`, parens and
  type assertions stripped from the label) plus a
  `heuristic/inferred/unresolved` calls edge; no concrete destination is
  invented.
- **implements / extends** — heritage clauses on classes and interfaces,
  alias-safe, with evidence at the heritage type expression. Interface
  multi-extends covered by unit test (no fixture declares extends).
- **Express routes** — `router.<verb>(path, handler)` where the receiver's
  type is declared by the `express` module (d.ts shim or node_modules).
  Literal paths → `compiler/certain/resolved` routes_to; computed paths →
  `<computed:expr>` label with `heuristic/likely/partial`. `app.use` mounts
  are not routes. Unresolvable handlers keep the route node but emit a
  diagnostic instead of a fabricated edge.
- **Next.js routes** — file-convention detection: `app/**/route.ts` exported
  HTTP-verb functions, `app/**/page.tsx` default exports (`PAGE <path>`),
  `pages/api/**` default exports (`ANY <path>`), `pages/**.tsx` pages;
  `_`-prefixed pages excluded; `/index` collapses to `/`.
- **tests** — `test("title", cb)` / `it(...)` top-level calls become test
  nodes (`<path>::<title>`); calls inside the callback emit
  `compiler/certain/resolved` tests edges, bare accesses emit
  `compiler/likely/resolved`; targets are function/method nodes only. Test
  spans are excluded from the calls/references passes. Static linkage is
  never presented as runtime coverage.
- **ADR / documents** — markdown files whose first H1 carries `ADR-<n>`
  become adr nodes (`<path>::ADR-<n>`); backtick path terms resolving to
  indexed files emit `doc/certain/resolved`; unique symbol terms emit
  `doc/likely/resolved`; ambiguous terms, missing paths, and generic HTTP
  verb names are excluded with diagnostics.
- **Harness** — Week 3 relations and node kinds (route, test, adr,
  unresolved) moved from deferred to supported; `changed_with` and
  `doc_section` remain explicitly deferred (Week 9 / later). The strata
  guard, unexpected-emission failure, and evidence policy are unchanged.
- **Metrics** — one summary diagnostic per snapshot reports resolved,
  heuristic, dynamic-unresolved, and non-graph callee counts (Week 3 gate:
  unresolved call rate reported).

### Week 3 validation (executed 2026-07-14)

| Check | Result |
|---|---|
| `pnpm typecheck` / `pnpm lint` | pass |
| `pnpm test` | **85/85** tests, 10 files |
| `pnpm fixtures:index` | **PASS ×5** — core-symbols 32/72, express-routes 33/79, next-routes 30/68, diff before 17/36, diff after 17/37 (full expected counts) |
| `python validate_fixtures.py` / `pnpm fixtures:validate` | pass |
| `pnpm fixtures:typecheck` | pass ×5 |
| Dangling endpoints / foreign_key_check | zero on every snapshot |
| Synthetic 150k LOC (1,500 files, 19,501 nodes, 50,997 edges incl. semantic relations) | **9.8 s** total, 0 dangling, 0 FK rows |
| Deterministic repeated indexing incl. Week 3 kinds | verified (unit test) |

### Week 3 documented interpretations (evidence-backed, fixtures authoritative)

1. **Doc links: one edge per markdown line.** Fixture 01 line 7 mentions both
   `` `Runner` `` and `` `Strategy` `` (both unique) but expects only the
   Runner edge; the first resolving backtick term anchors its line. HTTP verb
   names (fixture 03's unique `GET`) are additionally excluded as generic.
2. **Tests-edge confidence.** A call inside a test body is `compiler/certain`
   (fixture 01 `factorial(4)`); a bare property access is `compiler/likely`
   (fixture 02 `void controller.getUser`). Targets are function/method nodes
   only — classes instantiated as setup (`new UserController(...)`) are not
   linked, matching fixture 02's expected set.
3. **Heuristic call trigger.** Only when the checker resolves *no* symbol for
   a property callee (fixture 04's `resolver: any`) and exactly one
   function/method shares the name; a checker-resolved non-graph callee
   (express shim `res.json`) is skipped silently rather than guessed.
4. **Next dynamic segments** (`[id]`) stay verbatim in route URL paths; no
   fixture fixes a translation.
5. **`test.each` / `describe` blocks** are not test nodes in v1 (fixtures use
   bare `test()`/`it()` only); nested and property-access test callees are
   later work.

### Week 3 adversarial review outcome (2026-07-14)

A read-only review subagent hunted for false positives on real-world code the
fixtures cannot exercise. Fixed before commit (each with a regression test):

- **Decorator fabrication (blocker):** `@Log() doWork(){}` emitted
  `doWork -calls[compiler/certain]-> Log` because the method span includes
  its decorators. The calls/references pass now prunes `Decorator` subtrees.
- **Test-body over-linking:** bare identifier mentions (`void other;`) inside
  test callbacks emitted `tests` edges to imported-but-unexercised functions.
  Removed; only calls (certain) and property accesses (likely) link.
- **Heuristic arity gate:** the unique-name heuristic call now also requires
  call-site arity to fit some declaration of the candidate.

Kept, documented: default-parameter initializer calls
(`run(x = makeDefault())`) remain attributed to the enclosing function —
the call genuinely executes in that function's activation. `describe`-nested
tests remain a documented coverage gap (honest under-reporting).

Reviewer environment note: invoking vitest under the machine-global Node 25
hits a better-sqlite3 ABI mismatch and skips DB-backed suites; always run
through `pnpm test`, which uses the `.npmrc`-pinned Node 22.

## Weeks 1–2 milestone (complete)

All applicable completion gates pass; see "Validation results" below.

## Dual-agent configuration (Phase A — complete, 2026-07-14)

- Canonical skills in `agent-skills/` sync byte-identically into
  `.claude/skills` and `.agents/skills` (`pnpm skills:sync` / `skills:check`).
- Added the missing `.agents/README.md` (Codex counterpart of
  `.claude/README.md`) and `docs/CLI_CONTRACT.md` (frozen `tadori serve .`
  contract: resolve repo → load config → reuse/refresh valid snapshot →
  validate → local API on 127.0.0.1 → visualization → open browser → print
  facts → clean Ctrl+C; frozen flags; 2d default). No CLI implementation yet.
- Added frontmatter validation (`scripts/skill-frontmatter.mjs`): sync refuses
  to run and check fails when a canonical SKILL.md has missing/unterminated
  frontmatter, a wrong `name:`, or an empty `description:` (verified by
  breaking a skill and observing exit 1 from both commands).
- Fixed a stale-copy defect: sync overwrote `.tadori-generated.json` *before*
  the removal pass read it, so a skill dropped from the canonical list was
  never cleaned up (dead code). Sync now snapshots the previous manifest first;
  verified a manifest-listed `tadori-retired` directory is removed while an
  unrelated `third-party-example` skill is preserved.
- Gates executed 2026-07-14: sync passes; check passes; second sync produces
  no git diff (idempotent); unrelated skills preserved; stale generated copies
  removed; malformed frontmatter fails; project skills tracked by git while
  `.claude/settings.local.json`/credentials/cache/sessions stay ignored.

## Repository environment (2026-07-14)

- The repository moved machines and now lives at `C:\SideProjects\Tadori`
  (previously `D:\Electrical\Side_Projects\Tadori`, then briefly nested at
  `C:\SideProjects\Tadori\Tadori`). The nested checkout was flattened into the
  outer folder; the outer folder's pre-existing `.claude/settings.json` /
  `.claude/settings.local.json` (Claude Code plugin state) were preserved and
  merged with the repo-tracked `.claude/README.md` + skills. Git history and
  `origin` remote are intact.
- The machine's global Node is 25.x with no C++ toolchain, which cannot build
  `better-sqlite3`. `.npmrc` pins `use-node-version=22.14.0` so pnpm runs
  everything under Node 22 LTS, where better-sqlite3 prebuilt binaries exist.
- The machine's global `core.autocrlf=true` checked fixtures out with CRLF,
  breaking every frozen file-node `bodyHash` (SHA-256 over exact LF bytes) —
  observed as 12/13/11/6/6 node field mismatches across the five snapshots.
  `.gitattributes` now forces `* text=auto eol=lf`, and the working tree was
  byte-normalized back to LF. Fixture *expectations were not touched*; only
  checkout behavior was fixed.

## Completed capabilities

- pnpm monorepo (`packages/core`, `packages/store`, `packages/indexer`,
  `packages/harness`, `packages/mcp`) with strict TypeScript, ESLint (flat config,
  `no-explicit-any` as error), and Vitest.
- `@tadori/core`: frozen enums (node kinds, relations, origins, confidences,
  resolutions, repository-state kinds, evidence kinds), Zod schemas for graph
  payloads, canonical pipe-delimited identities with backslash-then-pipe
  escaping, UTF-8 SHA-256 entity keys, collision-index rehashing.
- `@tadori/store`: the first five frozen migrations verbatim (WAL, foreign
  keys, synchronous NORMAL), plus evidence-backed additive migration 006 for
  immutable activation ordering; ordered migration runner with duplicate protection,
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
- `@tadori/mcp`: the frozen six-tool interface (`repo_overview`,
  `find_symbol`, `symbol_context`, `find_tests`, `impact`, `path`) registered
  through the official MCP SDK with strict Zod input/output contracts and no
  seventh tool. The snapshot query service selects one valid active snapshot
  consistently, preserves ambiguity, confines source reads by real path,
  suppresses stale bodies, hashes indexed plus compiler/package support files,
  and exposes item-level evidence/provenance/freshness. FTS5 search is
  snapshot-scoped, exact-boosted, paginated, repairable, and pruned with its
  snapshot. Context and impact results are bounded with entity and aggregate
  omission manifests; impact maps unified-diff hunks by source span, carries
  page connectors, linked tests, beyond-depth package counts, and unresolved
  targets. Test linkage distinguishes compiler, heuristic, git, and other
  evidence without claiming runtime coverage. Retrieval and observation events
  validate snapshot membership and write atomically; active MCP tasks prevent
  snapshot pruning. The stdio transport emits protocol only on stdout, survives
  malformed lines, restarts cleanly, and closes tasks on normal EOF/shutdown.
  Week 5 adds the frozen explainable linear ranking, anchor-specific hard
  includes, confidence/evidence-aware ordering, representation degradation,
  exact whole-response budgets, stable context cursors/connectors, and complete
  named/aggregate omission accounting without changing the six-tool surface.

## Validation results (all executed and observed on this machine)

| Check | Result |
|---|---|
| `pnpm install` | clean |
| `pnpm typecheck` (strict, `noUncheckedIndexedAccess`) | pass |
| `pnpm lint` | pass |
| `pnpm test` | 170/170 tests, 24 files, all pass |
| `python validate_fixtures.py` | pass |
| `pnpm fixtures:validate` | pass |
| `pnpm fixtures:typecheck` (all 5 fixture repos, `tsc --noEmit`) | pass |
| `pnpm fixtures:index` (all 5 snapshots) | PASS for all; 0 missing/unexpected/mismatched nodes and edges |
| Migrations on empty DB + `PRAGMA foreign_key_check` | zero rows |
| Dangling endpoint memberships (every snapshot) | zero |
| Commit + working-tree snapshots coexist | verified (store + indexer tests) |
| Canonical SHA-256 identities vs. fixture values | exact match (core tests) |
| Deterministic repeated indexing | verified (identical keys, hashes, workspace hash) |
| MCP contract | exactly 6 tools; strict valid/invalid calls; structured output; logging; stale/budget/omission coverage |
| MCP stdio | protocol-only stdout; isolated concurrent refresh; malformed-line recovery; two clean restarts; clean EOF shutdown |

## Fixture relations currently supported (compared against golden truth)

- `contains`, `imports`, `exports` (Weeks 1–2 scope, unchanged)
- `references`, `calls`, `implements`, `extends`, `tests`, `routes_to`,
  `documents` plus node kinds `route`, `test`, `adr`, `unresolved` (Week 3)

Compared per snapshot (full expected sets): core-symbols 32 nodes/72 edges,
express-routes 33/79, next-routes 30/68, diff-coalescing before 17/36,
after 17/37.

## Relations intentionally deferred (reported by the harness, never dropped)

- Relation: `changed_with` (Week 9 review mode).
- Node kind: `doc_section` (no fixture covers it yet).
- Checks: non-variable excluded candidates.
- (Un-deferred 09-02) The raw/coalesced diff artifacts of fixture 04 are now an
  EXECUTED harness check (`compareFixtureDiff`, wired into `pnpm fixtures:index`),
  not merely schema-shape validation. See the 09-02 section for the documented
  bodyHash divergence (the frozen indexer hashes declaration text incl. the
  method name, so a method rename honestly falls to raw — the fixture files are
  untouched).
- (Un-deferred 09-03) The seeded boundary violations of fixtures 01/02 are now an
  EXECUTED harness check (`compareFixtureBoundaries`, wired into
  `pnpm fixtures:index`): each `tadori.rules.json` fixture is indexed, violations
  computed by the real store algorithm, and asserted set-equal to its
  `expectedBoundaryViolations` (core-symbols 1/1, express-routes 1/1). Served at
  `GET /api/v1/boundaries`.

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
5. **MCP schema and logging boundary.** The frozen documents define tool names,
   arguments, semantics, and common response requirements, but not a complete
   property-by-property JSON response schema. The strict response objects in
   `@tadori/mcp` are therefore versioned implementation contracts, not claimed
   as additional frozen specification. A retrieval event is written for every
   schema-valid tool invocation, including not-found/ambiguous results. A
   request rejected by MCP input validation never reaches a tool handler and is
   not recorded as a returned retrieval result; protocol tests enforce this
   distinction. `symbol_context` rejects budgets below 1,024 estimated tokens
   because its required repository/snapshot/evidence envelope cannot honestly
   fit below that floor.

## Discovered defects

- None outstanding.
- Fixed 2026-07-17 — allowJs scanner classification (blueprint 00-01A,
  commit `8be4741`): the scanner indexed JavaScript-family files even when
  the effective tsconfig enabled neither `allowJs` nor `checkJs`, while the
  TypeScript program correctly excluded them; extraction diagnostics then
  crashed (`Could not find source file: eslint.config.js`), breaking
  `pnpm tadori diff .` on Tadori's own repository (discovered 2026-07-17).
  See the dated 00-01A section above for the fix, regression matrix, and
  accepted low-severity residuals.
- (Historical, Weeks 1–2 implementation: ambient `declare function`
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
- A forcibly terminated process cannot finalize its active task. Normal MCP
  client EOF and handled Ctrl+C/SIGTERM paths finalize it; uncatchable process
  termination can leave an `active` task with partial observation coverage for
  later recovery/lease work.
- (Resolved 2026-07-14) The repository is now a git repository (`main`, with
  `origin`); the "inspect the current Git diff" validation step runs normally.

## Week 5 — Context selection and budgeting (implementation complete, 2026-07-14)

- Added a versioned, explainable linear ranking policy with the frozen weights;
  BM25 task text, churn, linked decisions, and declared boundaries are marked
  unavailable rather than fabricated, and same-package metadata is tri-state.
- Enforced anchor-specific hard requirements for direct callers/callees,
  certain linked tests, and type/interface definitions appearing in the anchor
  signature. Compiler-certain direct facts outrank heuristic hard facts, and
  unrelated incident edges cannot create hard labels or confidence.
- Added deterministic tie-breaking, confidence-aware path ordering, explicit
  raw component explanations, body/signature/name degradation, bounded page
  selection, advancing cursors, connector preservation, and terminal-page
  handling without duplicate omission records.
- Normalized relation/test/document references in context responses, rejected
  duplicate relation filters, preserved stale/evidence/provenance labels, and
  kept omission counts reconciled across detailed and aggregate manifests.
- Added focused ranking/context tests for exact weights, hard priority,
  confidence and unresolved edges, signature-only hard includes, unrelated
  edges, tiny and exact budgets, long ambiguity, high degree, connector pages,
  terminal pages, duplicate filters, and pagination continuity.

### Week 5 focused validation (executed 2026-07-14)

| Check | Result |
|---|---|
| `pnpm typecheck` | pass |
| focused ESLint (`@tadori/mcp` changed files) | pass |
| focused MCP/ranking tests | **21/21** pass |
| adversarial MCP matrix (review subagent) | clean: 39 tests across 6 files |
| `git diff --check` | pass |

The historical Week 5 focused gate was followed by the complete repository gate
recorded in the Week 6 validation section above.

## Current roadmap phase

Phase 7 local serving is built through 07-03 and locally validated; PR CI is
the remaining publication gate. The next implementation dependency root is
08-01 (layout engine + persistence), but its review draft must first close the
server-materialization ownership, empty-layout persistence, edge-input, and
benchmark-contract gaps. The current graph, snapshot, evidence, identity,
ranking, MCP, server, and CLI contracts are covered by 283 repository tests and
the exact five-fixture harness.

## Repository hygiene (2026-07-17)

- Root README replaced with a product overview; the golden-fixture guide moved
  byte-identically to `packages/fixtures/README.md`.
- Planning vault committed: `BACKLOG.md` and `blueprints/` (remaining-roadmap
  backlog and per-item blueprints; item 00-01 re-scoped 2026-07-17 after
  `origin/main` adopted GitHub PR-merge topology via PR #1/#2).
- All four sprint branches pushed (`Sprint7-core-visualization` created on
  origin); local `main` fast-forwarded to `origin/main` (`6e89fc1`). `main`
  advances only via owner-merged PRs; no tags or releases.
