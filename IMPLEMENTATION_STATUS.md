# Tadori Implementation Status

# Current State (always overwritten)

Current node: backend completion audit against the active multi-language
transition contract.
Status: backend-first implementation is in progress. Publication and remote CI
are intentionally held until a meaningful backend boundary; frontend work is
blocked until the backend completion gate below is satisfied.

Active contract: `docs/Specs/Tadori-Multilanguage-Transition.md`. Superseded
v2.1 documents are not product, schema, or language-scope authorities. Legacy
TypeScript/JavaScript fixtures remain regression coverage only.

Implemented: the multi-language registry and extraction stack; explicit
language/capability/derivation provenance; evidence-backed cross-language
relations; deterministic mixed-language fixtures; snapshot, diff, API, MCP,
layout, and local serving paths; an installable package and confined purge
workflow; and the accessible stable 2D Atlas. Its archaeological-circuit visual
language is graph-derived and intentionally remains short of fictional
functional districts until the API supplies evidenced region attribution.

The Atlas uses graph facts for every mark: package foundations, file slabs,
function pillars, method stelae, class colonnades, interface gateways, type
seals, route gatehouses, documentation tablets, test scaffolds,
external-dependency outposts, unresolved termini, and provenance circuit-core
traces. Search, shared filters, inspection, story,
changes, boundaries, agent-review, and accessible-table surfaces are composed
in one responsive shell. Server-owned LOD budgets keep package/file views at
500 nodes, symbol views at 1,000 nodes, edges at 1,000, and labels at 200 while
reporting every bounded omission. Package aggregates preserve full provenance
breakdowns instead of promoting a representative edge.

Multi-language projection audit (2026-07-26): package ownership now uses
nearest containment, so nested language packages retain their legitimate
file and symbol members. File-level LOD follows canonical graph ownership when
manifest package names are absent, and the Atlas loads every server-projected
relation instead of hard-coding imports. The checked-in no-`package.json`
mixed oracle expands 40 root files plus its Protocol Buffer package file with
zero ambiguous owners. Registered repository configuration and non-TypeScript
project manifests produce repository-derived file nodes, while legacy
TypeScript/JavaScript configuration remains support-only for exact fixture
compatibility. Registry IDs are test-locked to the active capability matrix.

Project-region substrate update (2026-07-29): extractor-discovered projects are
now a first-class, language-neutral snapshot membership rather than transient
indexer output. `GraphProject` validation confines normalized roots/manifests,
requires deterministic IDs and sorted unique languages, and defaults legacy
serialized snapshots to an empty project set. Additive migration 008 persists
immutable project memberships; load, repeated-insert verification, incremental
composition, regional merge, and project diff paths all carry them without
changing legacy node/edge identities. Existing snapshots remain readable, while
an unchanged pre-project snapshot is never silently rewritten and instead
requires an explicit purge/re-index. Non-TypeScript manifest roots materialize
canonical package ownership with nearest-root containment, and package-family
LOD preserves repository-package expansion across nested project packages.

`GET /api/v1/regions` now exposes a deterministic projection over discovered
project roots and canonical package containment. Every region includes bounded
evidence, member package keys, entity/kind and cross-region relation counts,
languages, capabilities, derivations, and explicit ambiguous/unowned accounting.
Project and package names are factual labels only: the API keeps role text null
and `derived_from_graph` until documentation supplies an evidenced
responsibility, and `/api/v1/overview` intentionally remains unavailable. The
Atlas consumes the same projection for a bounded relief layer and accessible
region summaries; loading, error, and no-region states remain explicit.

Project-region validation evidence (2026-07-29): `pnpm skills:check`, strict
typecheck, ESLint, and `git diff --check` pass. The root test command passes 71
non-CLI files / 430 tests, 13 serialized CLI files / 64 passed with 3
platform-specific skips, and 46 Atlas files / 371 tests. Python and TypeScript
fixture validation pass; exact indexing matches all five legacy graphs and both
diff/boundary oracles with zero dangling endpoints and zero
`PRAGMA foreign_key_check` rows; all five fixture repositories typecheck. The
mixed-language oracle, capability registry, repeated indexing, regional/full
parity, and byte-stable TS/JS adapter tests pass. The generated package contains
11 audited files, installs and serves successfully on Windows Node 24, and its
API/layout/purge smoke passes. Real Chrome E2E passes Atlas expansion, live
derived endpoints, Story, Changes, Table, inspection, mobile/media states, zero
axe violations, zero browser errors, and zero external resources. CI is wired
to repeat the installed GUI smoke in Firefox on the canonical Ubuntu/Node 22
leg; that exact-SHA remote result is not yet claimed.

Project-region CI correction (2026-07-29): initial PR #53 run `30514433954`
passed typecheck, lint, the full test suite, fixtures, artifact creation, and
installed-package smoke before Ubuntu Node 24/26 reached the layout benchmark.
That benchmark supplied a valid legacy snapshot payload without `projects`;
`insertSnapshotGraph` validated it with a schema that defaults the field to
`[]`, but then discarded the normalized result and iterated the original input.
The store boundary now accepts `SnapshotGraphInput` and operates exclusively on
the parsed `SnapshotGraph`. A regression covers both first insert and immutable
reuse with omitted project memberships. Focused store tests pass 18/18 and the
complete Node 24 layout benchmark passes every timing and byte-identical reuse
budget locally. Replacement run `30515370717` confirmed that correction across
the test, fixture, package, and Node 24/26 layout gates before exposing the
separate clean-checkout evidence defect below.

Project-region clean-checkout correction (2026-07-30 UTC): project discovery
correctly retains legacy TypeScript/JavaScript `package.json` manifests as
support-only inputs, but project-root containment had used those non-member
manifest paths as edge evidence. Fresh CI checkouts therefore failed closed at
`tadori diff .` when the store enforced evidence membership; a reused local
snapshot had masked the defect. Project-root nodes and containment now prefer a
manifest only when it is a snapshot member, otherwise choose the
lexicographically first indexed file owned by that project root, and emit no
fabricated evidence when a manifest-only project has no snapshot member. A
monorepo regression persists a nested support-only package manifest through the
real indexer/store boundary and asserts every node/edge evidence path belongs to
the snapshot. The focused indexer suite passes, and `tadori diff .` succeeds
against a fresh isolated database. The next exact-SHA matrix is the merge gate.

Backend completion audit (2026-07-30 UTC): the canonical registry and capability
matrix contain every language family required by the active contract. The
bundled structural baseline is Python, C, C++, Go, Rust, and Java; interface and
repository coverage includes Protocol Buffers, JSON, YAML, Markdown,
Dockerfile, Terraform/HCL, TOML, Make/CMake, and shell; TypeScript/JavaScript
semantic extraction remains regression-compatible. Unsupported semantic facts
remain absent or explicitly unresolved, and safe unbundled text remains visible
at repository level. The audit found three backend completion gaps: extraction
diagnostics are not persisted or served; the capability matrix is not exposed
through a typed backend contract with full registry-drift checks; and the pinned
external-repository manifest has no executable invariant runner. Diagnostic
persistence and the runtime capability contract are closed below; the pinned
external invariant runner remains before frontend handoff.

Extractor-coalescing correction (2026-07-30 UTC): Stage A and Stage B rename/
move matching now require extractor ID and extractor version in addition to the
snapshot analyzer version. Legacy nodes can match only other legacy nodes;
attributed nodes from a different extractor or extractor version remain honest
raw additions/removals. This prevents an extractor upgrade from masquerading as
a source rename or move, as required by the active contract. The complete local
gate passes: skill check, strict typecheck, lint, 71 non-CLI files / 433 tests,
13 CLI files / 64 passed with 3 platform skips, 46 Atlas files / 371 tests,
Python and TypeScript fixture validation, five exact fixture indexes with zero
dangling endpoints and zero foreign-key-check rows, exact diff/boundary oracles,
and all five fixture typechecks.

Snapshot-diagnostic backend (2026-07-30 UTC): extraction diagnostics are now
validated, deterministic, immutable snapshot membership rather than transient
console-only output. Additive migration 009 persists diagnostic code, severity,
message, optional snapshot-member file and line range, language, and exact
extractor identity/version. Legacy snapshots read as an empty diagnostic set;
immutable reuse rejects mismatched diagnostic membership and requires explicit
re-indexing. Full indexing carries diagnostics into `SnapshotGraph`; regional
refresh replaces invalidated-file diagnostics while retaining unaffected and
stable repository diagnostics. Extraction-run-only call-resolution metrics stay
transient so a regional run cannot be mislabeled as a whole-snapshot result.

`GET /api/v1/analysis` exposes observed per-snapshot languages, file counts,
generated-file counts, contributing extractors/capabilities, severity totals,
and bounded cursor-addressable diagnostics. The existing MCP `repo_overview`
adds the same observed language/extractor inventory plus a bounded 20-diagnostic
sample with explicit omission accounting; no seventh tool or universal semantic
claim was introduced. Parser failures therefore remain scoped while becoming
available to users, agents, and the future frontend after reload. Focused core,
store, incremental/full parity, API, and MCP tests pass. The complete local gate
passes: skill check, strict typecheck, lint, 72 non-CLI files / 438 tests, 13 CLI
files / 64 passed with 3 platform skips, 46 Atlas files / 371 tests, Python and
TypeScript fixture validation, five exact fixture indexes with zero dangling
endpoints and zero foreign-key-check rows, exact diff/boundary oracles, and all
five fixture typechecks. The generated package builds and its installed-package
API/layout/purge smoke passes on Windows Node 24. The first package-smoke attempt
was blocked only by sandbox access to the user npm cache; the identical approved
rerun passed.

Runtime capability contract (2026-07-30 UTC): the checked-in
`docs/MULTILANGUAGE_CAPABILITIES.json` is now parsed at process startup by a
strict shared schema that requires the exact ordered support vocabulary, every
declared feature key, unique language IDs, stable extractor identities, and no
unknown fields. Runtime initialization fails loudly if any language ID,
extractor ID/version, or primary semantic/structural/repository capability
drifts from the canonical registry. This retains the documentation JSON as the
single product-claim source while making it a typed backend contract bundled in
the installed CLI.

`GET /api/v1/capabilities` serves the validated matrix verbatim, and
`GET /api/v1/multilanguage-capabilities.schema.json` serves the referenced
JSON Schema at the matrix's relative `$schema` location. MCP `repo_overview`
now reports declared support independently from extractors actually observed in
the active snapshot. The contract lists all required semantic, structural,
interface/repository, configuration, and safe unknown-text language classes;
unsupported and experimental features remain explicit. Focused schema,
registry, MCP, and server route tests pass. The complete local gate passes:
skill check, strict typecheck, lint, 73 non-CLI files / 440 tests, 13 CLI files /
64 passed with 3 platform skips, 46 Atlas files / 371 tests, both fixture-schema
validators, five exact fixture indexes with zero dangling endpoints and zero
foreign-key-check rows, exact diff/boundary oracles, and all five fixture
typechecks. The installed Windows Node 24 package smoke confirms the bundled
matrix, its served schema, observed analysis, structural Python provenance,
layout, shutdown, and confined purge paths.

Repository-boundary and lifecycle hardening (2026-07-30 UTC): repository
scanning now uses link-aware metadata and never reads or traverses symbolic
links, Windows junctions, linked ignore files, or linked package manifests.
Skipped-link evidence participates in the deterministic workspace manifest, so
adding or removing an omitted link invalidates incremental and MCP freshness
without reading its target. This keeps source, support inputs, package identity,
and refresh state confined to the selected repository. Cross-platform
regressions cover external file links, linked metadata, external directory
links, link cycles, deterministic repeat scans, persistence, and refresh;
platform-denied link creation is reported as an explicit skip.

Additive migration 010 gives every snapshot an analyzer version in storage and
keys immutable reuse by `(repository, kind, workspace hash, analyzer version)`.
Migration preserves readable legacy rows, infers a version only when legacy
membership is unambiguous, and leaves mixed legacy attribution detectable.
Unchanged source therefore publishes a distinct snapshot after an analyzer
upgrade, including an empty or entirely ignored repository; an analyzer change
can no longer remain indefinitely hidden behind a no-op refresh. The current
analyzer identity is `tadori-indexer/0.2.1` plus the exact TypeScript version.

The legacy TypeScript adapter's root package-to-file containment is now
attributed to the repository layer with `repository-derived` provenance and the
contained file's actual language. It no longer converts Java, Python, Protocol
Buffer, or other mixed-language membership into a compiler claim. Snapshot
extractor inventory is rebuilt from retained nodes, edges, diagnostics, files,
and projects; declarations provide capability metadata but cannot keep a stale
extractor alive. Capability aggregation retains the strongest actual
contribution independently of iteration order.

Documentation and refresh boundaries are now language-honest. Markdown links
to non-TS/JS paths or declarations remain explicitly unresolved with
`markdown-link-is-documentation-not-integration-evidence`; unresolved identities
are Markdown-namespaced and use canonical `tadori-interface-files@1`
repository/convention attribution. Structural and interface declarations such
as Go functions and Protocol Buffer messages participate in ambiguity checks,
while Markdown headings do not. Names alone never create a cross-language edge.
In mixed-language repositories, relevant TS/JS edits force complete boundary
reconciliation, including creation of the first boundary.

Live git co-change evidence is no longer lost during either complete or regional
refresh. `changed_with` edges are deterministically recomputed from the final
file-node set and carry source-language plus `tadori-git-co-change@1`
repository-derived provenance; the canonical inventory records that producer.
Real-Git regressions cover both full mixed-language refresh and a regional edit
to the deterministic source/evidence endpoint. Focused acceptance is green:
strict typecheck and lint, `git diff --check`, 44/44 final indexer regressions,
legacy adapter parity, deterministic fixtures, store endpoint/foreign-key
integrity, and supported-platform link cases. The complete repository gate is
still required before publication.

Opus backend review result (2026-07-30 UTC): queue items 1-3 executed against
the working tree. Item 1 passes — `assertCapture` is a real trust boundary
consumed by the external validation runner, `manifestHashes` carries omission
evidence into refresh identity with a captured/omitted collision guard, and no
store invariant was weakened. Item 3 passes — `/api/v1/analysis` validates its
cursor and limit, fails closed with `bad_diagnostic_page`, and reports honest
`total`, `omittedCount`, `nextCursor`, and whole-set severity totals;
`/api/v1/capabilities` and its served schema are the validated constants
verbatim.

Item 2 found and closed one blocker-class defect. The coalescing legacy sentinel
was the literal pair `("legacy", "legacy")`, but `extractorId` is only
`z.string().min(1)`, so an extractor registered as `legacy` was a schema-valid
forgery of the sentinel and would have Stage-A and Stage-B matched genuinely
pre-provenance nodes — silently reopening exactly the attribution boundary the
guard exists to close. The sentinel is now the empty pair, which the canonical
schema forbids for any real extractor, making the collision unrepresentable
rather than merely unlikely. Two regressions cover the Stage A and Stage B
forgery paths and were verified to fail against the previous sentinel. The
complete local gate is green at this tree: strict typecheck, lint, the root test
command, 37 store/server files / 211 tests, 13 CLI files / 67 tests, and 46
Atlas files / 371 tests. Frontend handoff is therefore unblocked.

Frontend handoff begun (2026-07-30 UTC): PR #53 was retargeted from the dead
`agent/archaeological-atlas` base to `main` and rebased, dropping the ten
commits already squashed into `main` as `b641c1c`. CI had not run on the branch
at all while its base pointed at that branch, so every earlier local-gate claim
was remotely unverified.

Two environment-dependent defects then surfaced that no local gate could see.
First, the external validation runner audited its own repository for
command-bearing Git configuration; hosted CI writes `includeIf.gitdir:*.path`
into every checkout, so it failed on all five runners and the throw escaped the
suite instead of recording a failed invariant. The validator is now baselined
before the run and only newly introduced keys are a violation, while external
checkouts keep the strict absolute rule under a new regression. Second, the
installed-GUI smoke pressed one ArrowRight and required the node count to grow,
which assumed `graph.nodes().sort()[0]` is descendable; the frozen contract is
"Enter descends OR inspects", so the gate depended on path ordering and rode on
the mixed oracle's single expandable node. It now walks the nodes, requires that
some node descends, and names the observed counts on failure. Both were verified
by reproducing the exact condition locally before pushing.

Two frontend slices are delivered. `GET /api/v1/analysis` now has a UI: observed
languages and bounded extraction diagnostics render in a navigation section with
a top-bar severity status, where unavailable, still-loading, and genuinely-zero
are three distinct sentences so an absent response never reads as clean.
Workspace mode, spatial projection, active lenses, open story, and inspected
entity are now carried in the query string, so a reload reopens the same reading
and a link carries it; unknown values degrade to defaults because a shared link
is untrusted input, and a `select=` key is re-resolved against the served graph
rather than fabricating a selection. A dead `mode === "story"` comparison inside
the Table branch was removed; it had silently starved the keyboard and
assistive-technology peer of story emphasis.

Closed (2026-07-31), previously recorded here as open: `apps/viz` had no
`typecheck` script and CI never type-checked it, which is how eleven errors
accumulated there. Commit `148db8a` cleared them, added the script, and wired
`pnpm --filter @tadori/viz typecheck` into `.github/workflows/ci.yml`. Verified
at this tree: 101 files are checked under `strict` with
`noUncheckedIndexedAccess`, covering `src`, `test`, and `vite.config.ts`, and it
passes. The frontend is type-checked in CI.

Frontend journey coherent (2026-07-31): one defect class accounted for every
broken step in the reading journey — the UI derived entity facts from the
*rendered* graph rather than the snapshot. The rendered graph is level-of-detail
bounded to a single repository node at the landing view, so anything asked of it
answered "none". Six instances, all closed and each verified live against
`packages/fixtures/02-express-routes/repo`:

1. Overview entry points said "No route node was extracted from this
   repository" for a repository registering two routes.
2. The inspector withheld "Trace execution flow" from every route.
3. Interview produced a "this repository" interview with an entity selected,
   and claimed no tests existed beside two test files.
4. `select=` deep links dropped silently, so a shared link degraded to a
   generic interview.
5. `focusEntity` returned silently, so clicking an Overview entry point or a
   search result moved nothing and explained nothing.
6. Overview coupling answered UNKNOWN to "what is technically important or
   fragile?".

The shared correction is to ask the snapshot — `/api/v1/routes`,
`/api/v1/nodes/:key`, `/api/v1/tests`, `/api/v1/nodes?level=symbol` — and to
keep loading and unavailable distinct from a genuine zero at every one. Where
the snapshot genuinely cannot answer, the UI now says so: an unresolvable
`select=` key renders an explicit unavailable state, and a focus request the map
cannot honour explains that the entity is not shown at this level rather than
doing nothing.

Verified journey: launch `pnpm tadori serve <repo> --port <p> --no-open` →
Overview (purpose UNKNOWN, languages, entry points, regions, coupling, analysis
limits, snapshot) → click an entry point → Inspector (kind, language,
capability, derivation, location, evidence with editor deep link, source,
design rationale, connections) → Trace execution flow → Story across
`user-controller.ts` → `infra/db.ts` → `user-service.ts` with per-step
provenance → Interview on that entity, 7 questions across 6 groups → search
`UserController`, 3 results, click restores Atlas + inspector without losing
context. Atlas suite 55 files / 425 tests serial, strict typecheck, root lint,
and production build all pass.

Inspector interpretation layer (2026-07-31): the Inspector showed extracted
facts and left the reader to interpret them — "Fan-in: 0" tells a newcomer
nothing, which is the gap between holding the data and understanding the
codebase. It now renders at most one deterministic sentence per structural
metric, derived only from counts and relations shown beside it.

The honesty rules are enforced in code and locked by tests. Fan-in zero reads as
"no incoming relation was extracted in this snapshot", never as a runtime claim,
because dynamic dispatch is not extracted. Responsibility is `Observed` only
where structure states it mechanically — a route's registered path — and
`Unknown` for a class, with a test asserting the entity name never leaks into
the claim. Risks name the signal ("5 extracted dependents increase the potential
change surface") and a test rejects the words fragile, unsafe, poorly and slow.
Tradeoffs and original rationale remain `Documented` when an ADR resolves and
`Unknown` otherwise; graph shape never manufactures rationale. Where the graph
supports no reading the layer stays silent rather than restating a legible
number.

Accessibility correction (2026-07-31): axe reported a serious color-contrast
violation across the Overview questions and every claim badge. Measured on
`--tadori-ground`, muted ink was 3.75:1 and verdigris 4.13:1, both under AA's
4.5:1 — failing on the product's core reading surfaces. `--tadori-ink-muted` is
now #4f4d47 (5.46:1); the material hues keep their values because they colour
marks on the map, and text-safe variants were added for badge labels
(verdigris-text #2f5142 at 5.72:1, copper-text #7a4820 at 4.89:1).

CI classification (2026-07-31): all five red legs at `56c82f1` shared one cause
— an unused binding failing `pnpm lint` — introduced when coupling moved off the
rendered node set. Not KF-001, which never executed because lint precedes the
smoke. `main` was then red on a sixth, separate defect: a boundary badge
projecting ~15px below a 916-tall viewport in `verify:viz:e2e`. Full matrix on
branch `fix/kf-001-ubuntu` in `CI-FAILURE-MATRIX.md`. That sixth defect is
closed (see the CI stability entry below).

Both browser gates additionally assumed Atlas was the landing mode and drove a
canvas that Overview now leaves hidden; Playwright reported the canvas as hidden
outright. They enter Atlas first, and their stale four-tab assertions match the
six-tab contract. `verify:viz:e2e` exits 0 locally and `package:smoke` passes
under chromium and firefox (4 -> 5 nodes).

Open, not investigated (2026-07-31) — Atlas suite is not parallel-stable:
`pnpm vitest run` (default file parallelism) produced different results across
runs at the same tree, while `--no-file-parallelism` and per-file isolation
passed every time.

- Parallel run A: 3 files / 4 tests failed; identities not captured.
- Parallel run B: failures reported in `test/App.accessibility.test.tsx` (3),
  `test/InspectorContinuations.test.tsx` (2),
  `src/features/a11y/AccessibleGraphTable.test.tsx` (1),
  `src/features/analysis/AnalysisPanel.test.tsx` (1),
  `src/features/explore/explore.test.tsx` (1),
  `src/features/interview/InterviewPanel.test.tsx` (1).
- The `InspectorContinuations` and `InterviewPanel` failures in run B were
  genuine stale-mock defects and are fixed. The `AccessibleGraphTable`,
  `AnalysisPanel`, and `explore` failures are the unexplained ones: they passed
  in isolation and serially with no code change between runs.
- Parallel run C, after those fixes: 54 files / 420 tests passed. The
  instability is therefore intermittent, not deterministic, and a single green
  parallel run is not evidence it is resolved.

No shared port or server is involved — these are jsdom component suites. The
untested hypotheses are shared global DOM state, `matchMedia`/`history` stubs
leaking across files, timer or `waitFor` sensitivity under CPU contention, and
module-mock registry interaction. Deliberately not investigated during the
deep-link slice. Until diagnosed, treat `--no-file-parallelism` as the
authoritative local run and do not read a green parallel run as proof.

Not reproduced (2026-08-02): a deliberate matrix of ten consecutive parallel
runs at `acb207e` — six at default file parallelism and four at
`--maxWorkers=16` to force contention — passed 56 files / 434 tests every time,
including all three unexplained suites. No test was changed on that evidence: a
hypothesis without a reproduction is a guess, and the run-C caution above
applies equally here. The instability remains open and unexplained rather than
fixed; ten green runs are not proof of absence for an intermittent failure.

CI stability (2026-08-02 UTC, merged `469ea8a`, PR #59): three reliability
defects closed, one commit each, with `main` green 6/6 on the merge run
`30763456272`.

The macOS `verify` leg failed run `30737550419` at
`packages/indexer/test/watcher.test.ts` with `native watcher did not report the
save`. The watcher is not at fault; the test assumed `waitForIdle()` meant the
OS watcher was armed. It does not — `flushNow()` clears the debounce timer and
delivers synchronously, measured at 1.23ms, so the save was issued roughly 1ms
after `fs.watch()` returned. Linux (`inotify_add_watch`) and Windows
(`ReadDirectoryChangesW`) arm inside that call while macOS FSEvents arms
asynchronously on libuv's own thread, which is the entire macOS-only,
intermittent signature. The test now waits until the watcher actually reports a
probe write, so it no longer depends on the window being short, and logs the
measured arming delay on every run. `onError` is wired and asserted empty: it
was unset, so an event dropped by path normalization would have been swallowed
and been indistinguishable from one the OS never sent. Nothing was skipped,
slept on, or retried. Honest limit: the first green run measured arming at 28ms
on darwin, level with linux and win32 and at the probe's 25ms resolution floor,
so it did not itself exhibit a slow window; two consecutive green macOS legs are
not proof an intermittent failure is eliminated.

`verify:viz:e2e` asserted the plate projection while the camera was still
animating. The 500ms stillness requirement established in PR #56 is kept — two
samples accepted the plateau between the 350ms expand and 180ms focus
animations, which is how CI read y=928 twice — but the measurement moved inside
the page. Counting still samples in the predicate was unsafe because
`browser.waitFor` evaluates its predicate once more after the loop, and on the
timeout path that extra call re-scores the final value as another still sample,
which can carry the counter over the threshold and return an in-flight position
instead of throwing. The predicate is now pure and the viewport assertion is
unchanged.

`apps/viz` carried a standalone ESLint config that no gate ran, and both configs
scoped rules so as to exclude some of their own files: root matched `**/*.ts`,
so `.tsx` silently lost the `^_` pattern, and the app-local config matched
`src/**`, so its own `test/**` lost it. The frontend import boundary now lives
in the root config scoped to `apps/viz/src/**`, so CI enforces it for the first
time — `eslint --print-config apps/viz/src/App.tsx` previously reported
`no-restricted-imports: undefined`. Two gaps stay open and unaddressed:
`scripts/**` is absent from `tsconfig.json`'s `include`, so `verify-viz-e2e.mts`
is never type-checked, and `apps/viz` runs vitest 4.1.10 while the root runs
2.1.9.

PR #59 also reproduced the silent-gate failure PR #56 was written to fix, by a
different route: a conflicting PR gets no checks at all, because GitHub builds
`pull_request` runs from a merge ref that cannot exist while conflicts do.

Orientation slice (2026-07-31): Overview is now the landing workspace and
Interview sits beside it in the tab order and URL state, so a reader meets the
repository before the graph. `GET /api/v1/overview` still reports
`available: false`, so Overview is assembled from `analysis`, `regions`,
`capabilities` and the served graph rather than served whole. Every statement
carries an explicit basis — observed, documented, inferred or unknown — rendered
as text and a `data-basis` attribute, never colour alone. Repository purpose
reads `unknown` because nothing served establishes it, and an absent route set
states that no registered entry point was found rather than that none exists.
Interview generates questions only from entities, counts, languages and
diagnostics this snapshot actually contains, marks interpretive questions
`inferred`, and offers an inspection button only for evidence the served graph
can resolve; file paths and language ids render as text instead of a selection
that resolves to nothing. Atlas suite passes 52 files / 405 tests; repository
lint, strict typecheck, and `git diff --check` pass.

KF-001 RESOLVED 2026-08-02 (`docs/KNOWN_FAILURES.md`): Playwright's Firefox gets
no WebGL context in true headless mode on Linux, so Sigma's constructor threw,
the app took its correct `onRendererError` path to Table mode, and the hidden
Atlas subtree left the canvas unfocusable — which is why no keydown ever
arrived. Measured in the pinned Playwright image: an X display is necessary and
sufficient (`xvfb-run` -> llvmpipe; without it `getContext("webgl")` is null
whatever the prefs), so the `browser` job's Firefox leg now runs under
`xvfb-run`. The `firefoxUserPrefs` were inert and their comment said otherwise;
it now states what was measured. Nothing weakened: run `30736433285` is green on
all six jobs with `Installed GUI smoke passed in firefox (4 -> 5 nodes)`. The
readiness diagnostics in `51b0b15` produced this on their first CI run, after
four speculative fixes; the "40+ canvases, zero errors" reasoning that had
discarded the WebGL hypothesis was wrong because Sigma builds its canvas layers
before it throws and the app catches the throw itself. Green twice running
(`30736433285`, `30736820331`), which was the workflow's own stated criterion, so
`browser` is a blocking job again and its `continue-on-error` is gone.

Claude Opus backend review queue and frontend handoff contract:

1. Review the project-evidence correction in
   `packages/indexer/src/indexRepository.ts` and its nested-workspace regression.
   Confirm every evidence path is a snapshot member and no store invariant was
   weakened.
2. Review the extractor-version coalescing guard in
   `packages/store/src/coalescing.ts`. Attempt Stage A and Stage B collisions
   across extractor IDs, extractor versions, and legacy/attributed nodes; require
   raw add/remove output for every cross-boundary case.
3. After the remaining tranches land, review persisted diagnostic immutability,
   invalidated-file replacement behavior, bounded API/MCP pagination and
   omission accounting, capability-schema drift locks, and the pinned
   external-repository invariant runner. Confirm the capability endpoint and its
   served schema remain byte-equivalent to the checked-in contract, then confirm
   parser failures remain visible after store reload and reject any semantic
   claim not backed by evidence or an explicit unresolved diagnostic.
4. Do not begin frontend implementation until this file records a passing full
   local backend gate and the Opus review has no blocker/high finding. At handoff,
   consume only the documented capability/analysis endpoints; do not infer
   language parity, runtime behavior, ownership, or responsibility in the UI.

Release-hardening update (2026-07-26): the fresh and stale shells now place the
workspace in an explicit flexible grid row; responsive navigation starts closed,
owns Escape/focus restoration, and reopens automatically as persistent desktop
navigation at the breakpoint; and inspection/story evidence receives the served
absolute repository root while retaining the existing client-side confinement
check. Boundary and change badges now use Sigma graph-to-viewport projection and
republish after camera, resize, and expansion changes; entities absent from the
rendered graph remain explicitly listed. The persistent canvas publishes a
deterministically deduplicated canonical graph to Table mode, preserving
expansion and selection across mode changes, and exposes inspection plus the
documented keyboard pan/focus, descend/inspect, ascend/collapse, zoom, and reset
contract with reduced-motion camera updates. The persistent Sigma canvas uses
its supported invalid-container guard during transient zero-size responsive
layouts, retaining expansion and camera state without crashing. Renderer
initialization failures are caught at the map boundary, switch to the canonical
Table view, and announce the fallback instead of unmounting the shell. Node
connection pivots register the already-served edge DTO
inside the inspection panel, so edge provenance is available immediately and
remains available when one-level back navigation returns to that edge. Expanded
packages now receive labeled, repository-derived 2D
boundaries computed only from known file membership and its projected convex
hull; collapsed package foundations remain the canonical structures. Story
transport publishes its active evidenced step to the map, maps raw entity keys
through served package representatives, dims unrelated marks, and applies copper
emphasis only to the evidenced predecessor path. Unresolved transitions remain
visible at their known source with an explicitly unknown destination. Stable 2D
coordinates remain the default and no functional regions or runtime behavior are
inferred.

Performance evidence (2026-07-26): the final Atlas bundle revalidated a
150,230-LOC real-browser cold start in 4,173.06 ms and had zero
package/file/symbol position-identity mismatches. A prior memory run used
3,919,728 bytes of JavaScript heap. The 250,330-LOC
incremental benchmark passed: 945.86 ms single-file p95, 815.11 ms package
invalidation, 176,632,456 bytes heap growth, and approximately 758,579 bytes
per snapshot.

Validation evidence (2026-07-27): the real Chrome gate exercises painted
offline Atlas canvases, keyboard package expansion, live Path/Routes/Tests/Docs,
Story, Changes, Table parity, node-edge inspection pivots, 320px navigation,
reduced motion, forced colors, and axe WCAG/best-practice rules with zero
violations and zero browser errors. Project skill checks, type checking, lint,
fixture validation/index/typecheck gates, package artifact creation, and npm
pack audit all pass. The non-Atlas suites pass 82 files / 485 tests and the
Atlas suite passes 42 files / 355 tests. The gate waits for the served snapshot to
settle, preserves expanded package/file state across graph refresh, uses
Sigma-normalized camera coordinates, and verifies projected package boundaries
remain inside the viewport. A local `tadori serve . --no-open` smoke
produced a fresh snapshot with 5,735 nodes and 14,503 edges; package-level
node and layout scopes agreed, with no missing edge endpoints. The in-app
browser could not start because the session omitted required `sandboxPolicy`
metadata, so the checked-in Playwright-Core harness uses an installed Chrome,
Edge, or Chromium executable and runs in the canonical Ubuntu/Node 22 CI job.

Deployment hardening (2026-07-26): compatible overrides resolve the reported
`fast-uri`, `find-my-way`, and `@hono/node-server` advisories to patched
versions; `pnpm audit --prod` reports zero known vulnerabilities. The workspace
and generated package share one `diff` implementation, so the installed binary
exposes `diff`, `serve`, and `purge`. The generated package includes a concise
README plus factual repository/homepage/issue metadata while remaining
explicitly `UNLICENSED`. `pnpm package:smoke` packs and installs the real
tarball in a temporary prefix and locally passed command, embedded-asset, API,
Python structural-provenance, layout, shutdown, and confined-purge checks. CI is
configured to repeat build, manifest audit, installation, and smoke on Ubuntu
Node 22/24/26, Windows Node 22, and macOS Node 22; production advisory calls run
once on the canonical Ubuntu/Node 22 leg. The root gate runs the 69 non-CLI
files first, then the 13 process-owning CLI files through exactly one fork
worker with file parallelism disabled, so
worker, listener, and loopback-server lifecycle tests do not compete with the
rest of the repository suite on constrained hosted runners. Captured project
filesystem containment and directory enumeration canonicalize both operands
before comparison and reconstruct native paths under the served root, avoiding
case-insensitive macOS roots being misclassified as outside the capture.
The root test command builds the Atlas before CLI lifecycle coverage, so a fresh
checkout has the same embedded visualization prerequisite as the populated
development workspace. GitHub run `30309212825` exposed this clean-checkout gap:
typecheck and lint passed on all five runners, but every live-server CLI test
failed before printing its URL because `apps/viz/dist/index.html` did not yet
exist. The build-first ordering is the bounded correction. Replacement run
`30314081634` passed the complete five-job matrix on Ubuntu Node 22/24/26,
Windows Node 22, and macOS Node 22, including installed-package smoke.
The installed CLI executable guard canonicalizes both the module URL and argv
path before deciding whether to dispatch. This preserves direct execution when
macOS exposes npm's temporary prefix through the equivalent `/var` and
`/private/var` aliases; lexical aliases and POSIX symlinks are regression-tested.

The capability truth source is `docs/MULTILANGUAGE_CAPABILITIES.json`;
unsupported semantic facts remain absent or explicitly unresolved. Public npm
release remains intentionally unauthorized while the generated package is
`UNLICENSED`; private local tarball installation is supported.

Prior merged delivery record: 08-11 accessible non-canvas graph table, plus
11-01/02/03 benchmark models, 12-01 local-data lifecycle, 09-05 agent-change
overlays, and the 08-04 package→file→symbol zoom foundation. The following
notes are retained as implementation evidence; their former branch/PR state is
superseded by the current Atlas work above.
08-11 a11y slice done (branch): AccessibleGraphTable — the WCAG-AA NON-CANVAS alternative to the Sigma graph that 08-11 names ("accessible list/table alternative for visible graph content"). Renders the SAME usePackageGraph nodes/edges as a real semantic <table> (caption, <th scope=col> headers, <th scope=row> per node) so the graph is fully reachable by screen readers + keyboard alone — every node's kind/name/file/fan-in + an outgoing-relation text summary ("calls → 3, imports → 1"), no info available only visually. Rows link into the existing inspection panel. Mounted in App.tsx beside the canvas (gated on data). VERIFIED END-TO-END LOCALLY (viz is local-runnable): AccessibleGraphTable.test 5/5 (semantic table roles, edge summary, none-state, inspect link, empty), viz 289/289 (+5), tsc/eslint/vite build 0, confined to apps/viz. DEFERRED (needs Playwright + SQLite serve, infeasible locally): the Chromium full-flow / Firefox smoke E2E suites — the browser-driver half of 08-11.
11-03 done (MERGED #48): the bench COMPETITOR-PROFILE MODEL (code half of 11-03; install recipes/protocol docs + corpora are content, separate). Added to @tadori/bench: benchProfileSchema (Zod .strict) — {id, kind, installSteps[], invocation, isolation, status, statusReason?}. Closed PROFILE_KINDS enum (plain_claude_code/codebase_memory_mcp/codegraph/tadori_mcp/tadori_visual). "FAILURES DOCUMENTED NOT GUESSED" (BACKLOG 11-03) enforced by schema refinement: a non-available profile (install_failed/unavailable) MUST carry a documented statusReason — an install failure is recorded verbatim, never inferred, never silently treated as available. `isolation` field documents how each profile is kept from contaminating others. parseProfile(untrusted)→validated (throws on missing reason / unknown kind); availableProfiles() filters runnable subset. VERIFIED END-TO-END LOCALLY (pure TS): profile.test 6/6 + task 8 + harness 13 = 27/27, root tsc 0, eslint 0. Bench harness now has the full structured model: metrics+recorder+seeds (11-01), tasks+traps (11-02), profiles (11-03).
11-02 done (MERGED #47): the bench TASK-SET MODEL (the code half of 11-02; the actual 3×50-150k-LOC corpora are content-authoring, separate). Added to @tadori/bench: benchTaskSchema (Zod .strict) — {id, prompt, corpus, successCommand, isSeededTrap, trapKind?}. successCommand is the HELD-OUT check that DEFINES success (run after the change, exit 0 = pass) — the agent never scores itself. Closed TRAP_KINDS enum (boundary_violation/unsupported_claim/missing_dependency_edit/wrong_symbol_same_name/hidden_dynamic_dispatch/stale_doc_drift). Refinement invariant: trapKind present IFF isSeededTrap. benchTaskSetSchema enforces unique task ids + non-empty. parseTaskSet(untrusted)→validated (throws on any violation, malformed set never enters the bench); seededTraps(set) filters the trap subset. VERIFIED END-TO-END LOCALLY (pure TS): task.test 8/8 + bench.test 13/13 = 21/21, root tsc 0 (incl. @ts-expect-error on invalid trapKind), eslint 0. NOTE this branch was originally cut for 11-01; that context in prior status line is superseded.
11-01 done (MERGED #46): NEW @tadori/bench package — the benchmark harness CORE (11-02 later adds corpora/tasks). benchRunMetricsSchema (Zod .strict): success/regressions/filesInspected/boundaryViolations/unsupportedClaims/tokens(nullable "where observable")/wallTimeMs — all observed non-negative measurements, nothing inferred; finalize() validates so no malformed metric enters a result. SeededRandom (FNV-1a→mulberry32) = deterministic reproducible seeds (same seed ⇒ same sequence). RunRecorder(taskId, seed) captures raw log VERBATIM + seeded .random. summarizeRuns → BenchSuiteSummary: sums + successRate; tokensTotal poisoned to null if ANY run unobserved (honest, no partial-sum undercount); empty set → zeroed, no NaN. Package wired: pnpm-workspace + root tsconfig include + vitest alias; `.js` NodeNext import extensions (NOT viz's `.ts` — caught locally by tsc). VERIFIED END-TO-END LOCALLY (pure TS, no SQLite): bench.test 13/13, root tsc 0, eslint 0. 12-01 SUBSTANTIALLY COMPLETE (purge+confinement s1, retention s2, ignore-rules already enforced at scan time in scanRepository).
12-01 slice 2 done (branch): agent-event RETENTION primitive — pruneAgentEventsOlderThan(db, cutoffIso) in @tadori/store gc.ts (barrel-exported). Deletes agent_events where created_at < cutoff AND the owning task is NOT active (status <> 'active') — the live session's observations are never pruned regardless of age. agent_event_targets cascade (ON DELETE CASCADE); freed node/file entities are reclaimable by the existing collectOrphanEntities. Parameterized SQL, one immediate transaction, validates foreign_key_check=0 after (reuses gc.ts's own FK-safety pattern). retention.test 4/4: old finished-task event pruned + targets cascade + FK clean; ACTIVE task events NEVER pruned even when ancient; recent events kept; mixed set prunes only old-finished. Store-level primitive (CLI verb deferred to slice 3 with ignore/redaction). root tsc/eslint 0. SQLite-backed test runs on CI.
12-01 slice 1 done (branch): `tadori purge <repo>` — the data-lifecycle "delete my local index" command, deleting the repo's `<root>/.tadori/` directory. FIRST slice of 12-01 (privacy & data lifecycle: redaction/ignore/retention/purge/confinement); remaining slices deferred to their own PRs. Security core = confinedRealPath(target, root): resolves BOTH paths via realpathSync BEFORE comparing, so a `.tadori` symlinked outside the repo is refused (symlink-escape defense) — deletes only a real descendant of the repo root, never the repo itself or source. Idempotent (no .tadori → exit 0 "nothing to purge"); confinement violation → exit 5, nothing deleted; statSync dir-check before rmSync (defense in depth). runPurge(argv, deps) DI-testable; exit codes mirror serve.ts. Wired as a `purge` subcommand in cli.ts main. VERIFIED END-TO-END LOCALLY (no SQLite dep): purge.test 8/8 incl. SECURITY symlink-escape (outside sentinel survives) + manual `tsx cli.ts purge` on a real temp repo (deletes .tadori, idempotent 2nd run, unknown-cmd usage). root tsc/eslint 0. SQLite-backed CLI tests (serve-lifecycle) on CI.
09-05 done (branch): correlates this task's agent observations (plan_mentioned/file_read_observed/modified) with the files the review-diff ACTUALLY changed → honest per-file indicators (modifiedButNotRetrieved=blind edit, plannedNotModified, modifiedNotPlanned). New read-only GET /api/v1/review/observations-overlay → ReviewObservationsOverlayDto{taskPresent, files[]}. Backend built to SWE/security standards (blueprint 09-05 §4): (1) TASK SCOPING is the trust boundary — computeReviewObservationsOverlay filters by graphState.currentTaskId() (SERVER-owned, never a client param) so cross-task/cross-repo observations are unreachable — SECURITY TEST forges a foreign-task event and asserts it never leaks; (2) parameterized SQL only; (3) least-data — only file paths + typed booleans cross the boundary, agent_events.payload_json (PII/secret surface) NEVER read/returned; (4) GET/idempotent, fails closed (no git/no task → empty overlay, no 5xx); (5) deterministic (sorted by path). Reuses computeLiveComparison for changed files (single source of truth with /review/diff), no new migration (all tables exist), read-only. viz ObservationOverlayBadges renders only risk-flagged files with honest wording, error→alert, no-observations→null. reviewObservations.test (unit correlation + integration + SECURITY scoping + fail-closed); viz 284/284 (+4); root+viz tsc/eslint/build 0. SQLite server tests on CI.
08-04 done (branch): the THIRD and final zoom level — clicking an expanded FILE node reveals that file's exported symbols. EXTENDS 08-03's package→file expansion machinery one level deeper (file→symbol), no fork: new useFileExpansion hook (same ref-cached lazy-fetch state machine as usePackageExpansion, keyed by file node id, symbol-level fetchers) + applySymbolExpansion/applySymbolCollapse/symbolNodeId in expansion.ts (same additive addNode/dropNode contract → untouched nodes byte-stable, collapse restores exactly). Server already supports /nodes|edges|layout?level=symbol&file=<path> (frozen); added client fetchSymbolNodes/Edges/Layout(file). PackageMapCanvas.activate now branches: file node (kind==="file") → symbol expand/collapse via its .file path; package node → file expand/collapse (unchanged). Symbols namespaced `fileKey::entityKey` so the same symbol under two files never collides. expansion.test 4/4 (positions, byte-stability, collapse-restore, namespacing); viz 280/280, tsc/eslint/vite build 0, confined to apps/viz.
08-07E done (branch): FINAL derived-engine slice — GET /api/v1/path now returns the FULL path-tool output (status ok/not_found/ambiguous/no_path/search_limit, up-to-k paths, nearestApproach, ambiguity candidates), replacing the narrow single-BFS {nodes,edges,found}. STRUCTURAL PARITY: the route calls the exact MCP path tool via a new GraphStateManager.tools() accessor (returns `new TadoriTools(service, eventLog)` bound to the current service+eventLog) — same code the agent sees, so they cannot diverge. PARITY TEST added: path.test asserts the HTTP body deep-equals an in-process TadoriTools.path() call (modulo wall-clock context). Behavior change: an unresolvable endpoint is now status:not_found @200 (was 404); 404 only when from/to query params are absent. viz PathFinder rewritten to render each status distinctly + the nearestApproach hint (gated on paths.length===0, labelled "not a path"). Removed dead PathResultDto. No new schema (pathOutputSchema is the frozen MCP contract, reused verbatim). path.test rewritten (5 incl parity), viz explore 17/17, viz 276/276, tsc/eslint 0. All /path HTTP consumers enumerated + updated (path.test, viz fetchPath/PathFinder) — #39 lesson applied. SQLite endpoint+parity tests on CI.
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
Next frontier: after 11-01 merges — 11-02 (seeded-trap repos + task sets: 3 TS corpora, 24-30 tasks incl. traps; plugs into the 11-01 harness core) is the direct successor; also open: 08-11 (browser a11y / Chromium full-flow — needs a Playwright harness). Done: semantic-zoom (08-04), derived-engine (08-07B/C/D/E), agent-change overlays (09-05), 12-01 privacy&data-lifecycle (purge+confinement s1, retention s2, ignore-at-scan pre-existing), bench harness core (11-01). changed_with edges surface through GET /api/v1/edges as ordinary edges (no dedicated overlay yet).
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

**Phase 8 — Guided 2D visualization.** Phase 7 local
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
