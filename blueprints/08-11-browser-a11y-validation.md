# BLUEPRINT 08-11: Browser & accessibility validation

## 1. Header

- ID / Title / Phase: 08-11 — Browser & accessibility validation — Phase 8
  (Guided 2D visualization)
- Status: review
- Primary builder: Claude Sonnet — test-infrastructure and gate-definition
  work over already-built UI surfaces (08-02 through 08-07); the only
  judgment calls are tool selection (justified below) and the exact flow/
  rule-set enumeration, both fully specified.
- Reviewer roles: Spec Guardian (dependency-allowlist justification,
  frozen-contract adherence), Accessibility Reviewer (rule-set completeness,
  zero-violation gate correctness), Implementation Reviewer (flow coverage,
  cross-browser scope correctness against A-004).
- Complexity: M (one focused builder session)
- Depends on: 08-05 (search & filters), 08-06 (inspection & evidence
  panels), 08-07 (path/route/test/doc displays) — all three are the surfaces
  this blueprint's test suites exercise; it cannot be meaningfully built
  before they exist.
- Unlocks: 12-04 (documentation & demo depends on 08-11 per BACKLOG.md);
  09-01+ (review-mode UI reuses this blueprint's test patterns/harness).
- Estimated sessions: 1
- Related frozen-spec sections: A-004 (OS/browser test matrix: Chromium
  full, Firefox critical-flow smoke, Safari basic smoke when macOS
  available — ASSUMPTIONS.md); BACKLOG.md locked decisions ("A11y: keyboard
  access for search/panels/tours/filters/inspection, WCAG AA non-canvas UI,
  accessible list/table alternative for visible graph content"); A-003
  (runtime dependency allowlist — devDependencies for testing are a
  separate, justified-in-blueprint addition, not a runtime dep).

## 2. Objective

A reproducible, gated test suite proves: (a) the full serve→inspect user
flow works end-to-end in Chromium, (b) critical flows also work in Firefox,
(c) every 08-05/06/07 surface is fully keyboard-operable, (d) all non-canvas
UI has zero WCAG AA violations under an automated checker, (e) the graph's
visible content has a complete accessible list/table alternative, and (f)
reduced-motion and visible-focus behavior are verified — with macOS Safari
explicitly deferred to the 12-05 pilot smoke, not silently skipped.

## 3. Why this matters

- User value: a visualization tool that only works for sighted mouse users
  in one browser fails a meaningful fraction of real developers (keyboard
  users, screen-reader users, Firefox users) and fails the project's own
  locked accessibility decisions.
- System value: this is the single gate that proves 08-02 through 08-07
  actually compose into a working product end-to-end, not just pass their
  individual unit/component suites in isolation.
- Downstream: 12-04 (documentation & demo) depends on 08-11 per BACKLOG.md
  — a demo script cannot be written against unverified flows; 09.x review-
  mode UI will reuse this blueprint's Playwright/axe-core harness rather
  than inventing a second one.

## 4. Current repository evidence

Verified current (2026-07-17):

- **No browser test tooling exists yet.** `package.json` scripts (evidence
  pack §2): `skills:sync`, `skills:check`, `typecheck`, `lint`, `test`,
  `mcp:stdio`, `fixtures:validate`, `fixtures:index`, `fixtures:typecheck`,
  `benchmark:incremental`, `tadori`. No `test:e2e`, no `test:a11y`, no
  Playwright/Vitest-browser/axe dependency anywhere in the workspace.
  `pnpm-workspace.yaml` lists five packages (`core`, `store`, `indexer`,
  `harness`, `mcp`); `apps/viz` does not exist yet (INDEX.md row 08-02
  `pending`).
- **Dependency allowlist** (ASSUMPTIONS.md A-003, BACKLOG.md locked
  decisions): runtime deps allowed = react, sigma, graphology, fastify,
  simple-git (+ R3F behind experiment flag) + Vite tooling; "anything else
  is justified in-blueprint and reviewed before addition." This blueprint's
  tooling additions (Playwright, axe-core) are **devDependencies**, not
  runtime deps — they never ship in the `apps/viz` production bundle or the
  packaged `tadori` bin (ARCHITECTURE.md §11 packaging: only prebuilt
  static assets ship). The justification for each is in §8.
- **A-004** (ASSUMPTIONS.md, confirmed 2026-07-17): "Windows is the primary
  dev/test OS; Linux in CI; macOS full pilot smoke before RC. Chromium
  full; Firefox critical-flow smoke; Safari basic smoke when macOS
  available." This blueprint implements the Chromium-full and
  Firefox-smoke tiers; **Safari is explicitly out of scope here** and
  deferred to 12-05 ("Pilot package & RC" — BACKLOG.md Phase 12 table),
  which is the macOS-available point in the roadmap. This blueprint states
  that deferral explicitly rather than silently omitting Safari coverage.
- **Surfaces this blueprint tests** (from 08-05/06/07's own blueprints,
  written earlier in this same drafting pass): 08-05's `SearchPanel`/
  `ResultList` (search, filters, keyboard nav, ARIA roles, axe scoped
  pre-check); 08-06's `InspectionPanel`/`NodeView`/`EdgeView`/
  `EvidenceList`/`SourceView` (single-panel invariant, deep links, stale-
  suppression, keyboard, axe scoped pre-check); 08-07's `ExploreTabs`/
  `PathFinder`/`RouteTable`/`LikelyTests`/`DocumentsPanel` (path parity,
  route/test/doc displays, keyboard, axe scoped pre-check). Each of those
  three blueprints' own §15 explicitly defers its browser/keyboard/a11y
  *gate* enforcement to this blueprint ("post-08-11 gates ... referenced,
  not defined, here") while running a scoped axe pre-check in its own
  component-test suite — this blueprint is the aggregating, blocking gate,
  not a duplicate of that pre-check.
- **CLI serve flow** (docs/CLI_CONTRACT.md, evidence pack §9): `tadori
  serve .` resolves repo → loads config → reuses/refreshes snapshot →
  validates → starts API on `127.0.0.1` → starts 2D viz → opens browser →
  prints startup facts → Ctrl+C teardown. This is the entry point the
  Chromium full-flow suite drives from (`serve` step in the flow
  enumeration, §5).
- **Fixture repositories available as test targets**: `packages/fixtures/
  01-core-symbols`, `02-express-routes`, `03-next-routes`,
  `04-diff-coalescing` (evidence pack §6) — pure-TypeScript, golden,
  already-validated repositories with known node/edge counts. This
  blueprint's Chromium suite serves one of these (01-core-symbols, the
  simplest, or 02-express-routes when the flow specifically needs route
  data for the "path display" step) rather than a synthetic or the Tadori
  repo itself (avoiding entanglement with the still-open 00-01A defect
  discussion and keeping the served corpus small and deterministic).
- Files to read first: `blueprints/08-05-search-and-filters.md` (§15/§19,
  what this blueprint must gate), `blueprints/08-06-inspection-evidence-
  panels.md` (§15/§19), `blueprints/08-07-path-route-test-doc-displays.md`
  (§15/§19, and its named "path display" flow step), `docs/CLI_CONTRACT.md`
  (serve flow this suite drives), `ASSUMPTIONS.md` A-003/A-004,
  `fixture-manifest.json` (fixture repo paths/sizes).
- **What does not exist yet**: `apps/viz`, `packages/server`,
  `packages/cli` (all `pending`). This blueprint's test suite targets the
  built artifacts of 08-02 through 08-07 plus 07-01/07-02; it cannot
  execute meaningfully until those exist, but its **contracts and gate
  definitions** (exact commands, exact flows, exact rule sets) are fully
  specifiable now, which is this blueprint's actual deliverable.
- Gotchas: Playwright's own browser binaries are not npm dependencies in
  the ordinary sense — `pnpm exec playwright install` downloads browser
  binaries separately; CI (00-02, Linux+Windows) must run this install
  step, and this blueprint's own validation commands (§15) must state that
  explicitly so the gate is reproducible, not "works on my machine because
  I already installed Chromium once."

## 5. Scope

- **Test runner selection and justification** (Playwright, as a
  devDependency) — see §8.
- **Chromium full-flow suite**: one Playwright project targeting Chromium,
  driving the exact flow: serve → package map (loads, package nodes
  visible) → expand file (package→file zoom, per 08-03) → expand symbols
  (file→symbol zoom, per 08-04) → search (08-05: query, filter, select a
  result) → inspect (08-06: panel opens, evidence/source/ADR sections
  render) → path display (08-07: a path query returns and renders) → deep
  link (08-06: a `vscode://` link is present and well-formed for a
  root-confined evidence anchor — the suite asserts the `href` value, since
  a headless browser cannot actually launch VS Code).
- **Firefox critical-flow smoke subset**: one Playwright project targeting
  Firefox, driving a named subset of the above flow (see §8 for exactly
  which steps and why).
- **Keyboard-only traversal test**: a dedicated test (or tagged variant of
  the Chromium suite) that drives every 08-05/06/07 surface using only
  keyboard events (`Tab`, `Shift+Tab`, arrow keys, `Enter`, `Space`,
  `Escape`) — no mouse/pointer events at all — asserting the documented
  focus orders from each blueprint's own §19 are actually realized in the
  built UI.
- **WCAG AA automated check** (axe-core, as a devDependency) over
  non-canvas UI, with a named rule-set and a zero-violation gate — see §8.
- **Accessible list/table alternative data-completeness contract and its
  tests** — defined and verified here (08-05's `ResultList`, 08-06's
  evidence-anchor lists, 08-07's `RouteTable`/`LikelyTests`/
  `DocumentsPanel` are the concrete surfaces; this blueprint adds the
  cross-cutting completeness assertion tying them to the canvas graph's
  actual node/edge set).
- **Reduced-motion assertion**: a test that sets
  `prefers-reduced-motion: reduce` (Playwright's `page.emulateMedia`) and
  asserts camera-focus/zoom transitions (08-05's `selectResult`, 08-07's
  "show in graph") occur without animation (instant position change).
- **Visible-focus assertion**: a test that tabs through each of the three
  surfaces and asserts a visible focus indicator (via computed style
  check — outline/box-shadow non-`none` on the focused element) is present
  at every stop, not just logically-focused-but-invisible.
- **macOS Safari deferral statement** — explicit, in §7/§8, not silent.

## 6. Non-goals

- No Safari test implementation — deferred to 12-05, stated not built here.
- No visual-regression/screenshot-diffing suite (out of scope; this
  blueprint is functional/a11y correctness, not pixel parity).
- No load/stress testing of the server under many concurrent browser
  sessions (that is a 11.x benchmark concern, not this blueprint's).
- No testing of 08-08/08-09 (hooks/observation overlays), 08B.x (Guided
  Explore), or 09.x (review mode) surfaces — those are not yet built and
  are out of this blueprint's dependency set; their own future blueprints
  own their browser/a11y gates (likely by extending this blueprint's
  harness, not duplicating it).
- No performance benchmarking beyond the specific latency assertions
  already owned by 08-05/08-06/08-07/08-10 (this blueprint verifies
  functional and accessibility correctness, not the performance budgets
  themselves — those are asserted in their owning blueprints).
- No mobile/touch-input testing (out of scope for a localhost desktop
  developer tool; not mentioned anywhere in the frozen spec or backlog).

## 7. Dependencies and prerequisites

- 08-05, 08-06, 08-07 must be built (not just blueprinted) — this
  blueprint's suites exercise actual running UI, not mocks.
- 07-01, 07-02 (server + CLI `tadori serve .`) must be built, since the
  Chromium full-flow suite's first step is literally driving `tadori serve
  .` against a fixture repository.
- 00-02 (CI pipeline) should incorporate this blueprint's commands (§15)
  once both exist — this blueprint does not modify `00-02`'s file, but its
  validation commands are written to be CI-addable without further
  translation.
- **macOS Safari is explicitly deferred to 12-05** ("Pilot package & RC")
  per A-004's "Safari basic smoke when macOS available" — this blueprint
  does not block on macOS hardware being available; it states the
  deferral and moves on, matching the task instruction to "state it."

## 8. Architectural decisions

- **Playwright, as a devDependency, justified against the allowlist.**
  Rationale: A-003 requires new deps to be "justified in-blueprint and
  reviewed before addition." Playwright is chosen over the allowlist's own
  Vite tooling because: (1) it is the only realistic option that drives
  **three real browser engines** (Chromium, Firefox, WebKit) from one API
  — needed for the Chromium-full + Firefox-smoke split this blueprint must
  implement, and for the WebKit path 12-05 will need later without a
  second tool; (2) it ships official, versioned browser binaries
  (`playwright install`), removing "which Chromium is on this CI runner"
  nondeterminism; (3) it is a devDependency only — zero runtime/bundle
  impact, satisfying A-003's actual concern (runtime dependency bloat),
  which is about what ships in the product, not what tests it. Rejected:
  Cypress (Chromium/Firefox only, no WebKit — would need a second tool for
  12-05's Safari smoke, worse than Playwright's single-tool coverage of
  all three engines); Selenium/WebDriver (older API, slower, no built-in
  auto-waiting, would need more custom retry logic for the async
  graph-render assertions this suite makes); a hand-rolled Puppeteer
  script (Chromium-only, would still need a second tool for Firefox
  smoke, defeating the point of choosing one runner for both tiers).
- **axe-core, as a devDependency, with `@axe-core/playwright`, WCAG 2.1 AA
  rule tags, zero-violation gate.** Rule set:
  `["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]` (axe-core's standard tag
  set covering WCAG 2.1 Level A and AA — matches the locked decision's
  "WCAG AA" requirement; 2.1 rather than 2.2 because axe-core's 2.2 tag
  coverage was less mature at authoring time and 2.1 AA is the documented
  target, not 2.2 — if a later blueprint wants 2.2 rules added, that is an
  additive rule-tag change to this same harness, not a new tool).
  Zero-violation gate: any `violations` array entry (axe's own severity-
  agnostic "this fails a rule" result, not just `critical`/`serious`) fails
  the check — no severity-based carve-out, because a locked decision says
  "WCAG AA non-canvas UI" without a severity qualifier. Scope: **non-canvas
  UI only** — the axe scan explicitly excludes the Sigma `<canvas>` element
  itself (canvas content is inherently opaque to DOM-based a11y tooling;
  its accessible-equivalent is the list/table alternative, checked
  separately per the completeness contract below, not via axe against
  pixels it cannot inspect). Rejected: Lighthouse's accessibility category
  alone — it is axe-core under the hood for a11y checks but bundled with
  performance/SEO scoring this blueprint does not need, and its
  Playwright integration is less direct than `@axe-core/playwright`.
  Rejected: manual-only a11y review — not reproducible/gateable, violates
  "zero-violation gate" being a CI-enforceable binary condition.
- **Accessible list/table alternative: data-completeness contract defined
  as a set-equality assertion, not a visual-parity assertion.** The
  contract: for the currently-loaded graph level (package/file/symbol),
  every node and edge the canvas actually renders **must** also appear
  in at least one of 08-05's `ResultList` (via an exhaustive, unfiltered
  search or an explicit "browse all" mode), 08-07's `RouteTable` (for
  route-kind nodes), or a to-be-confirmed general node/edge list surface
  — with the same provenance fields (kind, origin/confidence/resolution
  for edges, freshness/stale) visible in the list form as in the canvas
  legend encoding. This is tested as a **set-equality** check (entityKey
  sets match between "canvas-rendered node/edge set, as read from Sigma's
  own graph model" and "entityKey set exhibited by summing the relevant
  list-view surfaces"), not a pixel/visual check. **Gap discovered while
  drafting this blueprint**: none of 08-02/03/04/05/06/07 (as blueprinted)
  defines one single "browse all nodes and edges" list view — 08-05's
  `ResultList` only shows *search results* (a filtered subset unless the
  query is empty-then-all, which 08-05 defines as `status: "idle"`,
  i.e. **no results shown for an empty query**). This is a real gap, not a
  contradiction to silently paper over: **this blueprint's own scope must
  therefore include specifying the minimal fix** — 08-05's `ResultList` is
  amended-by-reference here (not by editing 08-05's file, which is a
  sibling blueprint drafted in the same pass and not to be re-opened
  without instruction) to note that the completeness contract requires an
  explicit "browse all" affordance somewhere in the already-scoped
  surfaces; the simplest compliant option, recorded here as this
  blueprint's own architectural decision for its **test-suite** authority
  only, is that the completeness test drives 08-05's search with a
  wildcard/empty-becomes-all query executed through the browse affordance
  the eventual 08-05 builder session adds (a one-line UI affordance: an
  explicit "browse all" toggle that bypasses the idle-on-empty-query rule
  for this specific list-all use case) — flagged here as a **cross-
  blueprint contradiction for the next planning/review pass to reconcile**,
  not resolved by silently rewriting 08-05. If the 08-05 builder session
  has already shipped without such an affordance by the time 08-11 is
  built, this blueprint's completeness test is written against whatever
  concrete "list everything at this level" capability actually exists
  (RouteTable for routes at minimum, always testable) and the gap for
  non-route kinds is reported as a known limitation in this blueprint's
  §21, not silently marked passing.
- **Reduced-motion and visible-focus are dedicated assertions, not folded
  into the functional flow tests.** Rationale: motion/focus-visibility bugs
  are easy to silently regress in a flow test that only checks "did the
  right panel eventually open," since Playwright's auto-waiting would mask
  a missing instant-jump-on-reduced-motion regression (it would just wait
  for the animation to finish and still pass). Separate, explicit
  assertions on transition duration (near-zero under reduced motion) and
  computed focus-indicator style catch what a purely functional test
  would miss.
- **CI integration is additive to 00-02, not redefined here.** This
  blueprint's exact command set (§15) is written so 00-02 (CI pipeline,
  Phase 0, already `review` status) can add them verbatim to its job
  matrix; this blueprint does not edit `00-02`'s file (out of scope per
  the task's file-edit restriction) but names the commands precisely so
  that integration is a copy-paste, not a redesign.

## 9. Exact file plan

All paths proposed. Test infrastructure lives at the repo root (parallel to
existing `vitest.config.ts`) since it spans `apps/viz` + `packages/server`
+ `packages/cli`, not inside any one package.

- `package.json` — modify (additive only): add `devDependencies`
  `@playwright/test`, `@axe-core/playwright`; add scripts `test:e2e`
  (`playwright test --project=chromium`), `test:e2e:firefox`
  (`playwright test --project=firefox`), `test:e2e:install`
  (`playwright install --with-deps chromium firefox`), `test:a11y`
  (`playwright test --project=a11y`), `test:e2e:all` (runs both browser
  projects + the a11y project).
- `playwright.config.ts` — create. Defines `chromium`, `firefox`, and
  `a11y` (Chromium-based, since axe assertions don't need multi-engine
  coverage — one representative engine is sufficient for a11y rule
  checking) projects; `webServer` config that runs `tadori serve
  packages/fixtures/01-core-symbols --no-open --port <fixed test port>`
  before tests and tears it down after (Playwright's built-in
  `webServer` lifecycle, matching the CLI's own documented Ctrl+C teardown
  contract).
- `e2e/full-flow.chromium.spec.ts` — create. The 8-step Chromium full-flow
  suite (§5).
- `e2e/critical-flow.firefox.spec.ts` — create. The named Firefox subset
  (§8/§11).
- `e2e/keyboard-traversal.spec.ts` — create. Keyboard-only traversal over
  08-05/06/07 (runs under the `chromium` project; keyboard behavior is not
  expected to be browser-engine-specific enough to warrant a Firefox
  duplicate, per the scoping in §8).
- `e2e/a11y.spec.ts` — create. axe-core scans of each 08-05/06/07 surface
  in each of its representative states; runs under the `a11y` project.
- `e2e/list-completeness.spec.ts` — create. The accessible list/table
  data-completeness set-equality test (§8), including the documented
  known-limitation fallback if the "browse all" gap is unresolved at
  build time.
- `e2e/reduced-motion.spec.ts` — create. `prefers-reduced-motion` +
  transition-duration assertions.
- `e2e/visible-focus.spec.ts` — create. Computed-style focus-indicator
  assertions across the tab order of each surface.
- `e2e/fixtures/serveFixtureRepo.ts` — create. Shared helper: resolves the
  chosen fixture repo path, picks a free port, returns the base URL
  `webServer` will serve (used by all spec files needing to navigate to a
  known starting URL).
- `.gitignore` — modify (additive): add `test-results/`,
  `playwright-report/` (Playwright's own output directories — build
  artifacts, not product state, same treatment as the existing Graphify
  gitignore entries).

## 10. Exact contracts

```ts
// playwright.config.ts (shape, not full file)
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,                 // deterministic suite; a flaky pass is a bug, not retried away
  webServer: {
    command: "pnpm tadori serve packages/fixtures/01-core-symbols --no-open --port 4173",
    url: "http://127.0.0.1:4173/api/v1/snapshot",
    reuseExistingServer: false,
    timeout: 30_000
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] },
      testMatch: [
        "full-flow.chromium.spec.ts",
        "keyboard-traversal.spec.ts",
        "list-completeness.spec.ts",
        "reduced-motion.spec.ts",
        "visible-focus.spec.ts"
      ] },
    { name: "firefox", use: { ...devices["Desktop Firefox"] },
      testMatch: ["critical-flow.firefox.spec.ts"] },
    { name: "a11y", use: { ...devices["Desktop Chrome"] },
      testMatch: ["a11y.spec.ts"] }
  ]
});

// e2e/fixtures/serveFixtureRepo.ts
export interface FixtureServer { baseUrl: string; port: number; }
export function fixtureBaseUrl(): string;  // reads the fixed test port; single source of truth for spec files
```

Flow-step assertions (Chromium full-flow, `full-flow.chromium.spec.ts`,
named per the task instruction's exact enumeration):

1. **serve** — `webServer` up, `GET /api/v1/snapshot` returns 200 with a
   valid `context` before any spec runs (Playwright's own `url` health
   check in `webServer` config gates this).
2. **package map** — navigate to `/`, assert package-level nodes render
   (Sigma canvas present, and — via the list-completeness surface, not
   pixel inspection — the expected package count from
   `fixture-manifest.json` is reachable).
3. **expand file** — click/activate a package, assert file-level nodes
   appear (08-03's zoom), assert no global camera jump for unrelated
   nodes (per 08-03's "no global movement" contract).
4. **expand symbols** — expand a file, assert symbol-level nodes appear
   (08-04's zoom).
5. **search** — type a known symbol name from fixture 01 into 08-05's
   search box, assert a result row appears, select it, assert the graph
   focuses/zooms.
6. **inspect** — assert 08-06's `InspectionPanel` opens for the selected
   entity, evidence list is non-empty, source view renders body text (the
   fixture's live files match its own snapshot by construction, so no
   stale-suppression should trigger here), ADR section renders (either an
   ADR body or the exact fallback string).
7. **path display** — using 08-07's `PathFinder`, query a path between two
   known-connected fixture symbols, assert `status: "ok"` and a rendered
   path.
8. **deep link** — in the inspection panel's evidence list, assert a
   `vscode://file/...` link element exists with an `href` matching the
   expected encoded, root-confined shape for that evidence anchor's file
   (string assertion on `href`, no attempt to actually launch VS Code from
   a headless browser).

## 11. Ordered implementation procedure

1. `package.json` + `playwright.config.ts`: add devDependencies and
   scripts; write the config with the three projects and `webServer`
   lifecycle pointed at fixture 01. Run `pnpm test:e2e:install` once
   (developer-machine/CI setup step, not a per-run cost). Sanity-check:
   `pnpm exec playwright test --list` enumerates the expected spec files
   with no config errors.
2. `e2e/fixtures/serveFixtureRepo.ts`: shared port/URL helper.
3. `e2e/full-flow.chromium.spec.ts`: implement the 8 numbered steps from
   §10 as one ordered test (or 8 dependent steps within one `test.describe`
   using Playwright's step API for clear reporting) against fixture
   01-core-symbols. Verify each step's assertion fails if that step's
   underlying feature is stubbed out (write the test to be meaningfully
   red against a deliberately broken build during authoring, then confirm
   green against the real build — do not just write assertions that always
   pass).
4. `e2e/critical-flow.firefox.spec.ts`: implement the named Firefox
   subset — **serve → package map → search → inspect** (the four steps
   most likely to expose engine-specific rendering/event-handling
   differences: initial load, Sigma/WebGL canvas rendering, text-input/
   debounce behavior, and DOM panel rendering); explicitly excludes
   **expand file/expand symbols/path display/deep link** from the Firefox
   tier (rationale recorded in §8: those steps are lower marginal risk of
   being Firefox-specific since they exercise the same fetch/render code
   paths already proven cross-browser-safe by the search/inspect steps,
   and A-004 only requires "critical-flow smoke," not full-flow
   duplication).
5. `e2e/keyboard-traversal.spec.ts`: for each of 08-05/06/07's documented
   focus orders (their own §19), drive `Tab`/`Shift+Tab`/arrow keys/
   `Enter`/`Space`/`Escape` only (assert no `page.mouse.click` or
   `page.click` call anywhere in this file — a lint-style self-check, or
   simply a code-review-verifiable file-content property) and assert the
   same end states the mouse-driven flow test reaches (e.g. keyboard-only
   search-then-select-then-inspect reaches the same panel-open state as
   step 5-6 of the full-flow suite).
6. `e2e/a11y.spec.ts`: for each of `SearchPanel` (idle/loading/ok/empty/
   ambiguous_adjacent states), `InspectionPanel` (node view, edge view,
   stale-source state), `ExploreTabs` (all four tab states), run
   `AxeBuilder` with the documented tag set, assert `violations` array is
   empty; on failure, print the full violation list (rule id, target
   selector, help URL) so failures are actionable, not just "a11y test
   failed."
7. `e2e/list-completeness.spec.ts`: implement the set-equality check per
   §8; if the "browse all" affordance gap is unresolved, implement the
   route-only completeness check (always available via `RouteTable`) and
   emit a clearly-labeled `test.skip` (not a silent pass) for the general
   node/edge completeness check, with a comment pointing at this
   blueprint's §8 gap note.
8. `e2e/reduced-motion.spec.ts` + `e2e/visible-focus.spec.ts`: implement
   per §5's descriptions.
9. Full gate run (§15), including a deliberate CI dry-run note (this
   blueprint cannot itself modify 00-02, but the builder session should
   confirm the exact commands run clean locally in a way 00-02 can adopt
   verbatim).
10. Update `IMPLEMENTATION_STATUS.md`, reporting the known-limitation
    status of the list-completeness gap if unresolved (§21).

## 12. Data and lifecycle flows

**Suite startup:** Playwright's `webServer` runs `pnpm tadori serve
packages/fixtures/01-core-symbols --no-open --port 4173`; Playwright polls
`GET http://127.0.0.1:4173/api/v1/snapshot` until 200 before running any
test file, per the CLI's own documented startup-facts step.

**Per-test:** each spec file gets a fresh browser context (Playwright
default) but **shares the one running server** across the whole run
(matching how a real user would use one long-running `tadori serve`
session, not restart it per interaction) — tests must therefore not
mutate server state in a way that breaks a later test (this product is
inspect-only, so no test ever issues a write request; ordering
independence is additionally verified by running the suite with
Playwright's `--workers=1` for the full-flow spec specifically, since its
8 steps are intentionally sequential/dependent, while other spec files may
run with default parallelism since they are independent of each other's
state).

**Suite shutdown:** Playwright's `webServer` sends the server process a
termination signal after the last test in the run completes; the CLI's own
documented Ctrl+C teardown order (stop HTTP/WS → close WS clients → stop
refresh worker → close server → close DB → exit 0) is exercised by this
teardown, incidentally validating 07-02/07-03's teardown contract as a side
effect (not this blueprint's primary purpose, but a real coverage benefit
worth noting).

**Failure:** any spec failure produces Playwright's HTML report
(`playwright-report/`, gitignored) with trace/screenshot/video on failure
(`use: { trace: "on-first-retry", screenshot: "only-on-failure" }` in
config) so a CI failure is debuggable without local reproduction being the
only path.

## 13. Test plan

This blueprint's own deliverable **is** a test suite, so §13 documents
what each spec file asserts rather than "tests of this blueprint's code"
in the usual sense (there is very little non-test code here beyond config
and the shared fixture helper).

- `full-flow.chromium.spec.ts`: 8 sequential assertions per §10's numbered
  list; each step's failure is independently attributable (named test
  steps).
- `critical-flow.firefox.spec.ts`: 4 sequential assertions (serve, package
  map, search, inspect) — a subset of the Chromium spec's logic, not a
  copy-paste duplicate (shared assertion helpers factored into
  `e2e/fixtures/` where the two specs' checks are identical, e.g. "package
  nodes rendered").
- `keyboard-traversal.spec.ts`: per-surface keyboard-only reachability
  assertions for 08-05/06/07, cross-checked against each blueprint's own
  §19 focus-order documentation (a comment block per test naming which
  blueprint section it verifies).
- `a11y.spec.ts`: zero-violation assertions per surface per state,
  enumerated explicitly (not a single "scan the whole page once" — each
  named UI state gets its own scan so a regression in one state doesn't
  hide behind a passing scan of a different state).
- `list-completeness.spec.ts`: set-equality assertion(s) per §8, with the
  documented fallback/skip behavior if the cross-blueprint gap is
  unresolved.
- `reduced-motion.spec.ts`: transition-duration-near-zero assertion under
  `prefers-reduced-motion: reduce` for 08-05's result-selection
  focus/zoom and 08-07's "show in graph" pivot.
- `visible-focus.spec.ts`: computed-style (`outline`/`box-shadow` not
  `none`/transparent) assertion at every tab stop across 08-05/06/07's
  documented focus orders.

Regression: none pre-existing (wholly new test surface); no fixture data
files are modified (fixture 01-core-symbols is read-only input, served,
never written to — the product is inspect-only end-to-end, including in
its own test suite).

## 14. Acceptance criteria

- [ ] `pnpm test:e2e` (Chromium full-flow) passes all 8 named steps
      against fixture 01-core-symbols.
- [ ] `pnpm test:e2e:firefox` passes all 4 named critical-flow steps.
- [ ] `pnpm run test:e2e -- e2e/keyboard-traversal.spec.ts` (or the
      equivalent invocation) completes 08-05/06/07's documented flows using
      zero mouse/pointer events (verified by the file containing no
      `.click(`/`.hover(`/`.dragTo(` calls — grep-checkable).
- [ ] `pnpm test:a11y` reports zero axe-core violations
      (`wcag2a`/`wcag2aa`/`wcag21a`/`wcag21aa` tags) across every named
      surface/state in §11 step 6.
- [ ] `list-completeness.spec.ts` passes for the route-kind completeness
      check unconditionally; the general node/edge completeness check
      either passes or is an explicitly labeled, non-silent `test.skip`
      with a comment naming the unresolved cross-blueprint gap.
- [ ] Reduced-motion assertion passes: measured transition duration under
      `prefers-reduced-motion: reduce` is below a documented near-zero
      threshold (e.g. < 50 ms) for both tested transitions.
- [ ] Visible-focus assertion passes: every tab stop across 08-05/06/07's
      documented focus orders has a non-`none`/non-transparent computed
      focus indicator.
- [ ] macOS Safari has zero test files claiming coverage in this blueprint
      — its absence is stated in §7, not silently implied by omission.
- [ ] Full existing repository gate remains green (§15).

## 15. Validation commands

Existing repository gate (preserved verbatim, all still applicable and
unaffected by this blueprint's additions): `pnpm skills:check`;
`pnpm typecheck`; `pnpm lint`; `pnpm test`; `python validate_fixtures.py`;
`pnpm fixtures:validate`; `pnpm fixtures:index`; `pnpm fixtures:typecheck`;
`pnpm benchmark:incremental`; `git diff --check`; `git status --short`.

**This blueprint's own commands (the new gate this blueprint defines, and
which 08-05/06/07 reference as their post-08-11 gate):**
- `pnpm test:e2e:install` — one-time/CI-setup browser binary install
  (`playwright install --with-deps chromium firefox`).
- `pnpm test:e2e` — Chromium full-flow suite (also runs
  `keyboard-traversal.spec.ts`, `list-completeness.spec.ts`,
  `reduced-motion.spec.ts`, `visible-focus.spec.ts` — all under the
  `chromium` project per §10's config).
- `pnpm test:e2e:firefox` — Firefox critical-flow smoke subset.
- `pnpm test:a11y` — axe-core WCAG AA sweep (`a11y` project).
- `pnpm test:e2e:all` — convenience command running all three projects in
  one invocation, for local pre-push verification.

## 16. Performance budgets

This blueprint verifies functional/a11y correctness, not the performance
budgets themselves (those belong to 08-05 §16, 08-06 §16, 08-07 §16,
08-10). The one budget specific to this blueprint's own operation:

- Full Chromium suite (`pnpm test:e2e`) completes in **< 2 minutes** wall
  time on CI hardware, so it remains a practical pre-merge gate rather than
  a suite developers skip locally.
- Firefox smoke subset completes in **< 45 seconds** (proportionally
  smaller given its 4-step scope).
- a11y sweep completes in **< 30 seconds** (axe scans are typically
  sub-second per page; the budget accounts for the handful of named
  states scanned).

## 17. Failure and recovery behavior

- `webServer` fails to start (e.g. port collision, fixture repo unreadable):
  Playwright fails fast with its own startup-timeout error before any test
  runs — this is treated as a suite-infrastructure failure, not a test
  failure, and must be visibly distinct in CI output (Playwright's default
  behavior already does this; no custom handling needed beyond confirming
  it during authoring).
- A single flow step fails mid-sequence (e.g. step 5 "search" fails):
  the test reports exactly which named step failed (Playwright's
  `test.step` naming); later steps in that same spec file are not run
  (fail-fast within one sequential spec), but other independent spec files
  still run (Playwright's default per-file isolation).
- axe-core reports violations: the full violation list is printed (rule,
  selector, help URL) — never just a boolean "failed," so a developer can
  fix the specific rule without re-running a debugger.
- Reduced-motion/visible-focus assertions fail: printed with the actual
  measured value (duration in ms, or the actual computed `outline`/
  `box-shadow` value) against the expected threshold, not just pass/fail.

## 18. Security and privacy

- All tests target `127.0.0.1` only, matching the product's own
  localhost-only binding — no new network surface introduced.
- Playwright browser binaries are downloaded once (`playwright install`)
  from Microsoft's official CDN during setup, not at product runtime — this
  is a developer/CI-machine concern, not a product security surface (the
  binaries never ship in the packaged `tadori` bin, per §8's devDependency
  rationale).
- No credentials, tokens, or PII are used or generated by this test suite;
  fixture repositories are already-public, synthetic, golden test data.

## 19. Accessibility

This blueprint **is** the accessibility gate for 08-05/06/07 — its own
authored test files have no independent accessibility surface of their own
(they are test code, not product UI). The one relevant note: the axe-core
rule-set choice and zero-violation gate (§8) are themselves the concrete
mechanism by which the frozen "WCAG AA non-canvas UI" locked decision is
enforced, not merely aspired to — this is the section where that
enforcement is defined precisely enough to be checked by a machine, per
the template's own instruction that acceptance criteria must be binary and
verifiable.

## 20. Documentation updates

`IMPLEMENTATION_STATUS.md` — dated entry once built, recording: which
flows pass in which browsers, the axe rule-set and zero-violation result,
the list-completeness gap's resolution status (fixed vs. documented known
limitation), and the explicit macOS Safari deferral-to-12-05 statement.
No other existing documentation file requires edits; `00-02`'s CI pipeline
file is not edited by this blueprint but is the natural next integration
point (noted for the next planning pass, not performed here).

## 21. Builder final report

Require: summary; files changed; contracts implemented (confirm the three
Playwright projects and 6 spec files match §9/§10); tests added (names +
count, explicitly listing pass/fail per named flow step); validation
command output summary for all five new commands in §15; screenshots or
Playwright trace excerpts for at least one state per surface; commit SHA;
known limitations (the list-completeness gap's exact status is mandatory
to report, not optional); follow-on risks; `ASSUMPTION:` lines (expected:
which fixture repo was actually used if 01-core-symbols proved
insufficient for the "path display" step, in which case 02-express-routes
substitution must be recorded).

## 22. Independent review result

Pending Wave 2 adversarial review.

## IF SOMETHING IS UNCLEAR

Smallest safe assumption + `ASSUMPTION:` line. If an assumption would let
a browser/a11y check silently pass without actually verifying the thing it
claims to verify (e.g. a `test.skip` that isn't clearly labeled, or an
axe scan that never actually ran against the real rendered DOM), stop and
report blocked — a false-green gate is worse than an honestly-reported
gap.

## TADORI NON-NEGOTIABLES

Frozen v2.1; TS/JS only; ATLAS separate; exactly six MCP tools (this
suite drives HTTP/browser only, never MCP); stable 2D default; no seventh
tool; every visible relation keeps evidence/origin/confidence/resolution
(verified indirectly via the flows this suite drives); accessible list/
table alternative for visible graph content (this blueprint's own central
completeness contract); localhost only; Graphify ignored reference only;
never weaken golden fixtures (fixture repos are read-only test inputs
here, never modified).
