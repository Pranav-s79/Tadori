# Tadori Frontend Product Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Tadori's frontend into a coherent codebase-understanding and interview-preparation workspace by fixing scroll containment, the missing component stylesheets, and the information hierarchy — without rewriting components, renderers, or API contracts.

**Architecture:** Additive CSS plus small presentational edits inside existing feature components. Three mechanisms only: (1) a stylesheet layer for feature components that currently have zero rules, (2) shell corrections for scroll containment and mode-aware chrome, (3) one typed frontend adapter that resolves story-step display names through the already-used `/api/v1/nodes/:key`. No new component tree, no new endpoints, no renderer changes, no state-management changes.

**Tech Stack:** React 19, TypeScript 5.5 (strict), Vite 8, Vitest 4 + @testing-library/react, plain CSS with custom properties, Sigma 3 / graphology for the Atlas.

## Global Constraints

- Node is pinned to 24.18.0 via `.npmrc` `use-node-version`. **Always run through `pnpm`**, never bare `node`/`npx` — the machine-global Node 25 fails every better-sqlite3 load with a misleading `NODE_MODULE_VERSION` ABI error.
- Work only in the worktree `C:\SideProjects\Tadori\.claude\worktrees\design+frontend-product` on branch `design/frontend-product`.
- All source changes confined to `apps/viz/src/**`. The single exception is `scripts/verify-viz-e2e.mts:159` in Task 8, and only that assertion.
- Do not modify: watcher, CI workflows, GitHub Actions, KF-001 instrumentation, indexer, graph extraction semantics, MCP contracts, release packaging, benchmark corpora. Do not change API contracts.
- Import extensions in `apps/viz` are `.ts` / `.tsx` (not `.js`) — match the surrounding files.
- Minimum tokenized supporting text size is `--tadori-text-xs` (12px). Never introduce a smaller size.
- All colour comes from `tokens.css` custom properties. No raw hex in `index.css` except inside an existing `@media (forced-colors: active)` block where a system colour keyword is required.
- Every text colour pair must reach 4.5:1. Verified existing values: `--tadori-ink-muted` `#4f4d47` is 5.46:1 on `--tadori-ground`; `--tadori-verdigris-text` `#2f5142` is 5.72:1; `--tadori-copper-text` `#7a4820` is 4.89:1.
- Nothing may depend on hue alone. Capability uses texture plus text, provenance uses stroke plus text, epistemic basis uses shape plus text.
- No external fetches: no CDN fonts, no remote images, no external textures.
- Motion tokens stay zero under `prefers-reduced-motion`. Add no idle animation.
- **Frozen DOM hooks** — never rename or remove:
  - ids: `#workspace-mode-panel`, `#explore-panel-path`, `#explore-panel-routes`, `#explore-panel-tests`, `#explore-panel-docs`
  - classes: `.atlas-brand`, `.atlas-context-bar`, `.navigation-toggle`, `.package-map-canvas`, `.package-plate-overlay`, `.spatial-workspace`, `.story-view`, `.mode-empty-state`, `.inspect-connections`, `.inspect-edge`, `.review-diff`, `.review-diff-list`, `.explore-routes-story`, `.explore-tests-caption`, `.explore-docs`, `.a11y-graph`
  - aria: `[role="tablist"][aria-label="Repository views"]`
  - text: a `<span>` inside `.atlas-context-bar` whose text starts with `Showing ` must remain in Atlas and Table modes.
- Honesty rules are frozen: observed stays observed, inferred stays labelled inferred, unresolved evidence never becomes a working link, `runtimeObserved: false` banners stay, `/api/v1/overview` unavailability stays stated. Never fabricate production data.
- **Memorability rule.** Every entity is introduced by the same three-part identity block in the same order everywhere it appears — kind, name, `path:line`. Numbers that matter are set large and few, never buried mid-sentence. Section headings stay stable across entity types so position becomes a recall cue. Repeated boilerplate clauses are deleted.

### Commands

| Purpose | Command |
|---|---|
| Component tests | `pnpm --filter @tadori/viz test` |
| Single test file | `pnpm --filter @tadori/viz test -- src/path/File.test.tsx` |
| Strict typecheck | `pnpm --filter @tadori/viz typecheck` |
| Lint | `pnpm lint` |
| Production build | `pnpm --filter @tadori/viz build` |
| Whitespace check | `git diff --check` |
| Live app | `pnpm tadori serve <repo> --no-open --port 7317` |
| Repository E2E | `pnpm verify:viz:e2e` |

The live fixture is a copy of `packages/fixtures/02-express-routes/repo` placed outside the worktree so indexing never dirties it.

---

### Task 1: Repair reading-surface scroll containment and link contrast

Closes findings 1 and 18. First, because two of six modes currently hide most of their content, which makes every later visual judgement unreliable.

**Files:**
- Modify: `apps/viz/src/index.css:388` (`.mode-panel`)
- Modify: `apps/viz/src/index.css:944-950` (`.overview-panel, .interview-panel`)
- Modify: `apps/viz/src/index.css:965-969` (`.overview-claim-link`)
- Modify: `apps/viz/src/design/tokens.css:28-31` (interaction tokens)
- Test: `apps/viz/src/design/design.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: CSS custom property `--tadori-link: #2c5578` on `:root`, consumed by Tasks 2 and 3.

- [ ] **Step 1: Write the failing test**

Add these helpers to the top of `apps/viz/src/design/design.test.tsx` if absent:

```tsx
import { readFileSync } from "node:fs";

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 0xff)
    + 0.7152 * channel((n >> 8) & 0xff)
    + 0.0722 * channel(n & 0xff);
}

function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
```

Then append:

```tsx
describe("reading surfaces", () => {
  it("declares a link colour that reaches AA on the ground surface", () => {
    const tokens = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
    const link = /--tadori-link:\s*(#[0-9a-f]{6})/i.exec(tokens);
    const ground = /--tadori-ground:\s*(#[0-9a-f]{6})/i.exec(tokens);
    expect(link).not.toBeNull();
    expect(ground).not.toBeNull();
    expect(contrastRatio(link![1], ground![1])).toBeGreaterThanOrEqual(4.5);
  });

  it("lets the document modes scroll instead of clipping them", () => {
    const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.mode-panel-overview,\s*\n?\.mode-panel-interview\s*\{[^}]*overflow-y:\s*auto/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tadori/viz test -- src/design/design.test.tsx`
Expected: FAIL — `expected null not to be null` for `--tadori-link`, and no `.mode-panel-overview` rule exists.

- [ ] **Step 3: Add the link token**

In `apps/viz/src/design/tokens.css`, inside `:root`, replace:

```css
  /* Interaction and state. These are not capability colors. */
  --tadori-focus: #315f8c;
  --tadori-change: #a43f27;
  --tadori-danger: #8f2f25;
```

with:

```css
  /* Interaction and state. These are not capability colors. */
  --tadori-focus: #315f8c;
  /* Focus at #315f8c measures 4.31:1 on --tadori-ground and Lighthouse failed
     it on the Overview entity links. The focus ring is a 2px outline, where the
     3:1 non-text threshold applies; link text is text, so it needs a darker
     value of its own. #2c5578 measures 5.30:1. */
  --tadori-link: #2c5578;
  --tadori-change: #a43f27;
  --tadori-danger: #8f2f25;
```

In the `@media (forced-colors: active)` block of the same file, add `--tadori-link: LinkText;` beside the existing `--tadori-copper: LinkText;` line.

- [ ] **Step 4: Make the document modes scroll**

In `apps/viz/src/index.css`, replace:

```css
.mode-panel, .story-workspace, .changes-workspace { min-width: 0; min-height: 0; }
.mode-panel { position: relative; overflow: hidden; }
```

with:

```css
.mode-panel, .story-workspace, .changes-workspace { min-width: 0; min-height: 0; }

/* The spatial modes fill the stage exactly and manage their own overlays, so
   they must not scroll. The document modes are long-form reading surfaces and
   must. Previously every mode was `overflow: hidden` while Overview and
   Interview sized themselves to their content, so 1381px of the 2063px
   Overview was unreachable by wheel or scrollbar at 1440x900. */
.mode-panel { position: relative; overflow: hidden; }
.mode-panel-overview,
.mode-panel-interview { overflow-y: auto; overscroll-behavior: contain; }
```

- [ ] **Step 5: Stop the reading panels sizing to their content**

Replace:

```css
.overview-panel, .interview-panel {
  overflow-y: auto;
  padding: var(--tadori-space-6);
  display: grid;
  gap: var(--tadori-space-6);
  align-content: start;
}
```

with:

```css
/* Reading surfaces, not dashboards. The scroll now belongs to the mode panel;
   these size to their content inside it. Measure is capped and the section
   rules are capped with it, so headings never trail across an empty band. */
.overview-panel, .interview-panel {
  padding: var(--tadori-space-6);
  display: grid;
  gap: var(--tadori-space-6);
  align-content: start;
  max-width: 78ch;
}
```

- [ ] **Step 6: Point the link colours at the new token**

Replace `color: var(--tadori-focus);` with `color: var(--tadori-link);` in both `.overview-claim-link` and `.interview-evidence-link`, and add `text-align: left;` to `.overview-claim-link`.

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @tadori/viz test -- src/design/design.test.tsx`
Expected: PASS, both new cases green.

- [ ] **Step 8: Verify in the live app**

Build, serve the fixture, and confirm at 1440x900 that Overview scrolls with the wheel from "Understanding this repository" to the "Snapshot" section, and Interview scrolls to its last question group.

- [ ] **Step 9: Full gate and commit**

```bash
pnpm --filter @tadori/viz test
pnpm --filter @tadori/viz typecheck
pnpm lint
pnpm --filter @tadori/viz build
git diff --check
git add apps/viz/src/index.css apps/viz/src/design/tokens.css apps/viz/src/design/design.test.tsx
git commit -m "design: repair reading-surface scroll and measure"
```

---

### Task 2: Give search results a readable row structure

Closes finding 2, including the WCAG 2.5.3 label-in-name failure.

**Files:**
- Modify: `apps/viz/src/features/search/ResultList.tsx:19-30` (`rowLabel`) and `:121-125` (badge)
- Modify: `apps/viz/src/index.css` (append a search-results block)
- Test: `apps/viz/src/features/search/ResultList.test.tsx` (create)

**Interfaces:**
- Consumes: `--tadori-link` from Task 1.
- Produces: the class contract `.search-result-row > .search-result-kind | .search-result-name | .search-result-loc | .search-result-badge`.

- [ ] **Step 1: Write the failing test**

Create `apps/viz/src/features/search/ResultList.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResultList } from "./ResultList.tsx";
import type { SearchResultRow } from "./searchApi.ts";

const row = {
  entityKey: "abc",
  kind: "class",
  qualifiedName: "src/services/user-service.ts.UserService",
  file: "src/services/user-service.ts",
  lineStart: 1,
  exactMatch: true
} as unknown as SearchResultRow;

describe("ResultList", () => {
  it("keeps every visible word inside the accessible name", () => {
    render(<ResultList rows={[row]} onSelect={vi.fn()} />);
    const option = screen.getByRole("option");
    const accessibleName = option.getAttribute("aria-label") ?? "";
    const visible = (option.textContent ?? "").split(/\s+/).filter((w) => w.length > 0);
    for (const word of visible) {
      expect(accessibleName).toContain(word);
    }
  });

  it("separates the fields so they cannot run together as one string", () => {
    render(<ResultList rows={[row]} onSelect={vi.fn()} />);
    const option = screen.getByRole("option");
    expect(option.textContent).not.toContain("classsrc/");
    expect(option.querySelector(".search-result-kind")?.textContent).toBe("class");
    expect(option.querySelector(".search-result-loc")?.textContent)
      .toBe("src/services/user-service.ts:1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tadori/viz test -- src/features/search/ResultList.test.tsx`
Expected: FAIL — `aria-label` reads `class: …` with punctuation the visible text lacks, and `exact` is `aria-hidden` so it appears in the visible text but not the name.

- [ ] **Step 3: Align the accessible name with the visible text**

Replace `rowLabel` in `apps/viz/src/features/search/ResultList.tsx`:

```tsx
/** Accessible name per row: kind + qualified name (never display name alone),
 * so a screen-reader user can disambiguate two nodes with the same display
 * name (blueprint §19 screen-reader text). Every visible word is included
 * verbatim so the name satisfies WCAG 2.5.3 Label in Name — Lighthouse flagged
 * the previous punctuated variant. */
function rowLabel(row: SearchResultRow): string {
  const loc = fileLine(row);
  const parts = [row.kind, row.qualifiedName];
  if (loc !== null) {
    parts.push(loc);
  }
  if (row.exactMatch) {
    parts.push("exact");
  }
  return parts.join(" ");
}
```

Drop `aria-hidden` from the badge so its word belongs to both the visible text and the name:

```tsx
            {row.exactMatch && (
              <span className="search-result-badge">exact</span>
            )}
```

- [ ] **Step 4: Style the rows**

Append to `apps/viz/src/index.css`:

```css
/* Search results. These six spans previously carried no rules at all, so kind,
   qualified name, location and the exact-match badge rendered as one unbroken
   string ("classsrc/services/user-service.ts.UserService..."). A two-line grid
   makes the name the memorable anchor with the path in the same position on
   every result. */
.search-result-list {
  display: grid;
  gap: var(--tadori-space-1);
  margin: var(--tadori-space-3) 0 0;
  padding: 0;
  list-style: none;
}

.search-result-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--tadori-space-1) var(--tadori-space-2);
  padding: var(--tadori-space-2);
  border: 1px solid transparent;
  border-radius: var(--tadori-radius-sm);
  cursor: pointer;
}

.search-result-row:hover { border-color: var(--tadori-rule); background: var(--tadori-panel); }

.search-result-row[aria-selected="true"] {
  border-color: var(--tadori-copper);
  background: color-mix(in srgb, var(--tadori-copper) 10%, transparent);
}

.search-result-kind {
  grid-column: 1;
  align-self: center;
  padding: 0.1rem 0.35rem;
  border: 1px solid var(--tadori-rule);
  border-radius: var(--tadori-radius-sm);
  color: var(--tadori-ink-muted);
  font-size: var(--tadori-text-xs);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
}

.search-result-name {
  grid-column: 2;
  overflow-wrap: anywhere;
  color: var(--tadori-ink);
  font-weight: 650;
}

.search-result-loc {
  grid-column: 2;
  overflow-wrap: anywhere;
  color: var(--tadori-ink-muted);
  font-family: var(--tadori-font-mono);
  font-size: var(--tadori-text-xs);
}

.search-result-badge {
  grid-column: 2;
  justify-self: start;
  color: var(--tadori-verdigris-text);
  font-size: var(--tadori-text-xs);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

@media (forced-colors: active) {
  .search-result-row[aria-selected="true"] { outline: 2px solid Highlight; }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @tadori/viz test -- src/features/search/ResultList.test.tsx`
Expected: PASS, both cases green.

- [ ] **Step 6: Full gate and commit**

```bash
pnpm --filter @tadori/viz test
pnpm --filter @tadori/viz typecheck
pnpm lint
pnpm --filter @tadori/viz build
git diff --check
git add apps/viz/src/features/search apps/viz/src/index.css
git commit -m "design: make search results readable"
```

---

### Task 3: Style the inspector, evidence, source and route surfaces

Closes findings 3 and 5. These four families share one commit because they are the inspector reading column and its feeder table; splitting them would leave the column half-styled at a commit boundary.

**Files:**
- Modify: `apps/viz/src/index.css` (append an inspector block)
- Modify: `apps/viz/src/features/explore/RouteTable.tsx` (container wrapper)
- Test: `apps/viz/src/features/inspect/InspectionPanel.test.tsx` (extend)

**Interfaces:**
- Consumes: `--tadori-link` from Task 1; the kind-chip pattern from Task 2.
- Produces: `.inspect-meta` as a two-column definition grid, consumed visually by Task 5.

- [ ] **Step 1: Write the failing test**

Append to `apps/viz/src/features/inspect/InspectionPanel.test.tsx` (adding `import { readFileSync } from "node:fs";` if absent):

```tsx
it("styles the metadata list as a labelled grid rather than a default dl", () => {
  const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8");
  expect(css).toMatch(/\.inspect-meta\s*\{[^}]*display:\s*grid/);
  expect(css).toMatch(/\.inspect-meta\s+dd\s*\{[^}]*margin:\s*0/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tadori/viz test -- src/features/inspect/InspectionPanel.test.tsx`
Expected: FAIL — no `.inspect-meta` rule exists anywhere in `index.css`.

- [ ] **Step 3: Style the inspector column**

Append to `apps/viz/src/index.css`:

```css
/* Inspector reading column. None of these classes previously carried any rule,
   so the nine-fact header rendered as a browser-default definition list —
   label on one line, value indented beneath — consuming roughly 500px for nine
   short facts. A fixed label column puts every value in the same place on every
   entity, so position becomes a recall cue. */
.inspect-node, .inspect-edge { display: grid; gap: var(--tadori-space-4); }

.inspect-entity-header > h3 {
  margin: 0 0 var(--tadori-space-2);
  overflow-wrap: anywhere;
  font: 700 var(--tadori-text-lg) / 1.25 var(--tadori-font-label);
}

.inspect-meta {
  display: grid;
  grid-template-columns: minmax(7rem, auto) minmax(0, 1fr);
  gap: var(--tadori-space-1) var(--tadori-space-3);
  margin: 0;
  font-size: var(--tadori-text-xs);
}

.inspect-meta > div { display: contents; }

.inspect-meta dt {
  color: var(--tadori-ink-muted);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.inspect-meta dd {
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--tadori-ink);
  font-family: var(--tadori-font-mono);
}

.inspect-interpretation > h4,
.inspect-connections > h4,
.inspect-rationale > h4,
.evidence-list > h4,
.source-view > h4 {
  margin: 0 0 var(--tadori-space-2);
  padding-bottom: var(--tadori-space-1);
  border-bottom: 1px solid var(--tadori-rule);
  font: 700 var(--tadori-text-sm) / 1.3 var(--tadori-font-label);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.inspect-readings { display: grid; gap: var(--tadori-space-2); margin: 0; padding: 0; list-style: none; }
.inspect-readings > li { font-size: var(--tadori-text-sm); }

.inspect-connections ul,
.evidence-list ul { display: grid; gap: var(--tadori-space-1); margin: var(--tadori-space-2) 0 0; padding: 0; list-style: none; }

.inspect-connections button {
  width: 100%;
  padding: var(--tadori-space-1) var(--tadori-space-2);
  overflow-wrap: anywhere;
  border: 1px solid var(--tadori-rule);
  border-radius: var(--tadori-radius-sm);
  background: var(--tadori-panel);
  color: var(--tadori-ink);
  cursor: pointer;
  font-family: var(--tadori-font-mono);
  font-size: var(--tadori-text-xs);
  text-align: left;
}

.inspect-connections button:hover { border-color: var(--tadori-copper); }

.evidence-list a, .inspect-rationale a { color: var(--tadori-link); overflow-wrap: anywhere; }

.source-view pre {
  margin: 0;
  padding: var(--tadori-space-2);
  overflow-x: auto;
  border: 1px solid var(--tadori-rule);
  border-radius: var(--tadori-radius-sm);
  background: var(--tadori-panel);
  font-family: var(--tadori-font-mono);
  font-size: var(--tadori-text-xs);
  tab-size: 2;
}

.inspector-continuations {
  display: flex;
  flex-wrap: wrap;
  gap: var(--tadori-space-2);
  padding: var(--tadori-space-3);
  border-top: 1px solid var(--tadori-rule);
  background: var(--tadori-panel);
}

.inspector-continuations button {
  padding: 0 var(--tadori-space-3);
  border: 1px solid var(--tadori-rule);
  border-radius: var(--tadori-radius-sm);
  background: var(--tadori-panel-raised);
  color: var(--tadori-ink);
  cursor: pointer;
  font-weight: 650;
}

.inspector-continuations button:hover { border-color: var(--tadori-copper); }

/* Routes feed Story mode, and Story mode is only reachable through this table's
   action column. At the navigation panel's real width the five-column table
   pushed that column off-screen behind a horizontal scrollbar, so the entry
   point was unreachable. Below 26rem the rows stack. */
.explore-routes-wrap { container-type: inline-size; }
.explore-routes { width: 100%; border-collapse: collapse; font-size: var(--tadori-text-xs); }

.explore-routes th,
.explore-routes td {
  padding: var(--tadori-space-1) var(--tadori-space-2) var(--tadori-space-1) 0;
  border-bottom: 1px solid var(--tadori-rule);
  text-align: left;
  vertical-align: top;
}

.explore-routes button {
  padding: 0 var(--tadori-space-1);
  overflow-wrap: anywhere;
  border: 1px solid var(--tadori-rule);
  border-radius: var(--tadori-radius-sm);
  background: var(--tadori-panel);
  color: var(--tadori-ink);
  cursor: pointer;
  font-family: var(--tadori-font-mono);
  font-size: var(--tadori-text-xs);
  text-align: left;
}

.explore-routes-story { font-family: var(--tadori-font-ui); font-weight: 650; }

@container (max-width: 26rem) {
  .explore-routes thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }
  .explore-routes tr { display: grid; gap: var(--tadori-space-1); padding: var(--tadori-space-2) 0; border-bottom: 1px solid var(--tadori-rule); }
  .explore-routes td { padding: 0; border: 0; }
}
```

- [ ] **Step 4: Give the routes table a container context**

In `apps/viz/src/features/explore/RouteTable.tsx`, wrap the ready-state `<table className="explore-routes">` in `<div className="explore-routes-wrap">…</div>`. Change nothing else — no roles, no accessible names, no `.explore-routes-story` class.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @tadori/viz test -- src/features/inspect src/features/explore`
Expected: PASS. Existing explore tests stay green — the wrapper adds a div only.

- [ ] **Step 6: Verify in the live app**

Open an entity from search. Confirm the nine facts read as a two-column grid, the source slice sits in a bordered mono block, connection pivots are bordered rows rather than default grey buttons, and the Routes `Story` button is visible without horizontal scrolling.

- [ ] **Step 7: Full gate and commit**

```bash
pnpm --filter @tadori/viz test
pnpm --filter @tadori/viz typecheck
pnpm lint
pnpm --filter @tadori/viz build
git diff --check
git add apps/viz/src/index.css apps/viz/src/features/explore apps/viz/src/features/inspect
git commit -m "design: give the inspector and route surfaces a visual system"
```

---

### Task 4: Collapse the filter wall behind a disclosure

Closes findings 6 and 20.

**Files:**
- Modify: `apps/viz/src/features/search/filterState.ts` (add a counter)
- Modify: `apps/viz/src/features/search/SearchPanel.tsx`
- Modify: `apps/viz/src/index.css`
- Test: `apps/viz/src/features/search/SearchPanel.test.tsx` (create)

**Interfaces:**
- Consumes: `SearchFilters` and `defaultFilters()` from `filterState.ts`.
- Produces: `export function activeFilterCount(filters: SearchFilters): number` — the number of individually selected filter values across all groups.

- [ ] **Step 1: Write the failing test**

Create `apps/viz/src/features/search/SearchPanel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchPanel } from "./SearchPanel.tsx";
import { activeFilterCount, defaultFilters } from "./filterState.ts";

describe("activeFilterCount", () => {
  it("counts nothing when no filter is selected", () => {
    expect(activeFilterCount(defaultFilters())).toBe(0);
  });
});

describe("SearchPanel", () => {
  it("keeps the filters collapsed so results sit directly under the input", () => {
    render(
      <SearchPanel
        openInspectionPanel={vi.fn()}
        focusEntity={vi.fn()}
        filters={defaultFilters()}
        onFiltersChange={vi.fn()}
        languageOptions={["typescript"]}
      />
    );
    const disclosure = screen.getByRole("group", { name: /filters/i });
    expect(disclosure.hasAttribute("open")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tadori/viz test -- src/features/search/SearchPanel.test.tsx`
Expected: FAIL — `activeFilterCount` is not exported, and no element with an accessible name matching `filters` exists.

- [ ] **Step 3: Add the counter**

Append to `apps/viz/src/features/search/filterState.ts`:

```ts
/**
 * How many individual filter values are selected across every group. Drives the
 * disclosure summary so a collapsed filter set can never be silently active —
 * the reader must see that results are constrained without opening the panel.
 */
export function activeFilterCount(filters: SearchFilters): number {
  return Object.values(filters).reduce<number>(
    (total, group) => total + (Array.isArray(group) ? group.length : 0),
    0
  );
}
```

- [ ] **Step 4: Wrap the filter groups in a disclosure**

In `apps/viz/src/features/search/SearchPanel.tsx`, extend the import:

```tsx
import { activeFilterCount, defaultFilters, type SearchFilters } from "./filterState.ts";
```

Wrap the existing `<div className="search-filters">` — leaving every fieldset inside it untouched:

```tsx
      <details className="search-filters-disclosure" role="group" aria-label="Filters">
        <summary>
          Filters
          <span className="search-filters-count">{activeFilterCount(filters)}</span>
        </summary>
        <div className="search-filters">
          {/* existing fieldsets unchanged */}
        </div>
      </details>
```

- [ ] **Step 5: Style the disclosure and stop the horizontal overflow**

Append to `apps/viz/src/index.css`:

```css
/* The seven filter groups previously stood between the search input and its
   results, pushing the first result to y=905 in a 900px viewport: the reader
   typed and saw nothing happen. Collapsed by default, with the active count
   always visible so a constrained result set can never look unconstrained. */
.search-filters-disclosure { margin-top: var(--tadori-space-2); }

.search-filters-disclosure > summary {
  display: flex;
  align-items: center;
  gap: var(--tadori-space-2);
  padding: var(--tadori-space-1) 0;
  cursor: pointer;
  font-size: var(--tadori-text-xs);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.search-filters-count {
  min-width: 1.25rem;
  padding: 0 0.3rem;
  border: 1px solid var(--tadori-rule);
  border-radius: var(--tadori-radius-sm);
  color: var(--tadori-ink-muted);
  font-family: var(--tadori-font-mono);
  text-align: center;
}

/* The navigation panel overflowed horizontally at every width because the
   filter option rows could not wrap below their intrinsic width. */
.atlas-navigation { overflow-x: hidden; }
.search-filter-group { min-width: 0; }
.search-filter-option { min-width: 0; overflow-wrap: anywhere; }
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @tadori/viz test -- src/features/search`
Expected: PASS.

- [ ] **Step 7: Verify in the live app**

Type `UserService`. The first result must be visible without scrolling. Open the disclosure, tick two boxes, close it, and confirm the summary reads `Filters 2`.

- [ ] **Step 8: Full gate and commit**

```bash
pnpm --filter @tadori/viz test
pnpm --filter @tadori/viz typecheck
pnpm lint
pnpm --filter @tadori/viz build
git diff --check
git add apps/viz/src/features/search apps/viz/src/index.css
git commit -m "design: put search results above the filter set"
```

---

### Task 5: Restructure the inspector for comprehension

Closes findings 3 (content order) and 10.

**Files:**
- Modify: `apps/viz/src/features/inspect/NodeView.tsx:117-129`
- Modify: `apps/viz/src/index.css:937` (`.claim-badge[data-basis="observed"]`)
- Test: `apps/viz/src/features/inspect/NodeView.test.tsx` (create)

**Interfaces:**
- Consumes: `.inspect-meta` and `.inspect-connections` styling from Task 3; `NodeDetail.outEdges` and `NodeDetail.inEdges`, both already populated by `fetchNodeDetail`.
- Produces: nothing consumed later.

- [ ] **Step 1: Write the failing test**

Create `apps/viz/src/features/inspect/NodeView.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NodeView } from "./NodeView.tsx";
import * as api from "./inspectApi.ts";

const node = {
  entityKey: "abc",
  displayName: "UserService",
  qualifiedName: "src/services/user-service.ts.UserService",
  kind: "class",
  language: "typescript",
  file: "src/services/user-service.ts",
  lineStart: 1,
  lineEnd: 5,
  exported: true,
  fanIn: 2,
  stale: false,
  staleReason: null,
  freshness: "fresh",
  provenance: { capability: "semantic", derivation: "compiler-resolved" },
  evidence: [],
  evidenceOmittedCount: 0,
  outEdges: [],
  inEdges: [{
    entityKey: "e1",
    relation: "references",
    srcQualifiedName: "src/controllers/user-controller.ts.UserController",
    dstQualifiedName: "src/services/user-service.ts.UserService"
  }]
} as unknown as api.NodeDetail;

beforeEach(() => {
  vi.spyOn(api, "fetchNodeDetail").mockResolvedValue({ status: "ok", node } as never);
  vi.spyOn(api, "fetchSource").mockResolvedValue({ status: "unavailable" } as never);
  vi.spyOn(api, "fetchLinkedDoc").mockResolvedValue(null);
});

describe("NodeView", () => {
  it("lists dependents, not just their count", async () => {
    render(<NodeView entityKey="abc" repoRoot={null} onPivot={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByRole("region", { name: /dependents/i })).toBeInTheDocument();
    });
    expect(
      screen.getByText(/src\/controllers\/user-controller\.ts\.UserController/)
    ).toBeInTheDocument();
  });

  it("says plainly when no dependency was extracted", async () => {
    render(<NodeView entityKey="abc" repoRoot={null} onPivot={vi.fn()} />);
    await waitFor(() => {
      expect(
        screen.getByText("No outgoing relation was extracted for this entity.")
      ).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tadori/viz test -- src/features/inspect/NodeView.test.tsx`
Expected: FAIL — no region named "Dependents" exists; `inEdges` is only counted.

- [ ] **Step 3: Split connections into dependencies and dependents**

In `apps/viz/src/features/inspect/NodeView.tsx`, replace the single Connections section:

```tsx
      <section aria-label="Connections" className="inspect-connections">
        <h4>Connections</h4>
        <p>{`${node.outEdges.length} outgoing · ${node.inEdges.length} incoming`}</p>
        <ul>
          {node.outEdges.slice(0, 20).map((edge) => (
            <li key={edge.entityKey}>
              <button type="button" onClick={() => onPivot(edge.entityKey, "edge", edge)}>
                {`${edge.relation} → ${edge.dstQualifiedName}`}
              </button>
            </li>
          ))}
        </ul>
      </section>
```

with:

```tsx
      {/* Dependencies and dependents answer different questions — "what does
          this need" and "what breaks if I change it" — and the second is the
          one an interview asks about. It was previously only a count. */}
      <section aria-label="Dependencies" className="inspect-connections">
        <h4>Dependencies</h4>
        {node.outEdges.length === 0 ? (
          <p>No outgoing relation was extracted for this entity.</p>
        ) : (
          <>
            <p>{`${node.outEdges.length} outgoing`}</p>
            <ul>
              {node.outEdges.slice(0, 20).map((edge) => (
                <li key={edge.entityKey}>
                  <button type="button" onClick={() => onPivot(edge.entityKey, "edge", edge)}>
                    {`${edge.relation} → ${edge.dstQualifiedName}`}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-label="Dependents" className="inspect-connections">
        <h4>Dependents</h4>
        {node.inEdges.length === 0 ? (
          <p>No incoming relation was extracted for this entity.</p>
        ) : (
          <>
            <p>{`${node.inEdges.length} incoming`}</p>
            <ul>
              {node.inEdges.slice(0, 20).map((edge) => (
                <li key={edge.entityKey}>
                  <button type="button" onClick={() => onPivot(edge.entityKey, "edge", edge)}>
                    {`${edge.srcQualifiedName} → ${edge.relation}`}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
```

- [ ] **Step 4: Quiet the observed badge**

In `apps/viz/src/index.css` replace:

```css
.claim-badge[data-basis="observed"] { border-color: var(--tadori-verdigris-text); color: var(--tadori-verdigris-text); }
```

with:

```css
/* Observed is the common case; a bordered chip on every single claim made the
   rare ones — documented, inferred, unknown — impossible to spot while
   skimming. The label text and the data-basis hook are unchanged; only the
   emphasis moves to where it carries information. */
.claim-badge[data-basis="observed"] {
  padding-left: 0;
  border-color: transparent;
  color: var(--tadori-verdigris-text);
  font-weight: 500;
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @tadori/viz test -- src/features/inspect src/design`
Expected: PASS.

- [ ] **Step 6: Full gate and commit**

```bash
pnpm --filter @tadori/viz test
pnpm --filter @tadori/viz typecheck
pnpm lint
pnpm --filter @tadori/viz build
git diff --check
git add apps/viz/src/features/inspect apps/viz/src/index.css
git commit -m "design: restructure the inspector for comprehension"
```

---

### Task 6: Resolve story step names and fix the ordinals

Closes finding 4.

**Files:**
- Create: `apps/viz/src/features/story/stepNames.ts`
- Create: `apps/viz/src/features/story/stepNames.test.ts`
- Modify: `apps/viz/src/features/story/StoryView.tsx`
- Modify: `apps/viz/src/index.css`

**Interfaces:**
- Consumes: `fetchNodeDetail(entityKey: string)` from `../inspect/inspectApi.ts`.
- Produces:
  - `export interface StepName { displayName: string | null; qualifiedName: string | null }`
  - `export async function resolveStepNames(entityKeys: readonly string[]): Promise<ReadonlyMap<string, StepName>>` — resolves each distinct key once and maps an unresolvable key to `{ displayName: null, qualifiedName: null }` rather than omitting it.

- [ ] **Step 1: Write the failing test**

Create `apps/viz/src/features/story/stepNames.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import * as inspectApi from "../inspect/inspectApi.ts";
import { resolveStepNames } from "./stepNames.ts";

describe("resolveStepNames", () => {
  it("resolves each distinct key exactly once", async () => {
    const spy = vi.spyOn(inspectApi, "fetchNodeDetail").mockResolvedValue({
      status: "ok",
      node: { displayName: "getUser", qualifiedName: "a.b.getUser" }
    } as never);

    const names = await resolveStepNames(["k1", "k1", "k2"]);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(names.get("k1")?.displayName).toBe("getUser");
  });

  it("records an unresolved key instead of dropping it", async () => {
    vi.spyOn(inspectApi, "fetchNodeDetail").mockResolvedValue({ status: "not_found" } as never);

    const names = await resolveStepNames(["missing"]);

    expect(names.has("missing")).toBe(true);
    expect(names.get("missing")?.displayName).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tadori/viz test -- src/features/story/stepNames.test.ts`
Expected: FAIL — `Cannot find module './stepNames.ts'`.

- [ ] **Step 3: Write the adapter**

Create `apps/viz/src/features/story/stepNames.ts`:

```ts
import { fetchNodeDetail } from "../inspect/inspectApi.ts";

export interface StepName {
  displayName: string | null;
  qualifiedName: string | null;
}

/**
 * `GET /story/route/:key` carries each step's entityKey, kind and evidence, but
 * no display name — so steps rendered as 64-character hex digests and the mode
 * was unusable for study. The entity endpoint the inspector already uses knows
 * the names, so this resolves them client-side. No API contract changes.
 *
 * A key that does not resolve is recorded with null names rather than omitted:
 * the caller must be able to tell "not looked up yet" from "looked up and this
 * snapshot does not carry it", and say the second one out loud.
 */
export async function resolveStepNames(
  entityKeys: readonly string[]
): Promise<ReadonlyMap<string, StepName>> {
  const unique = [...new Set(entityKeys)];
  const entries = await Promise.all(
    unique.map(async (entityKey): Promise<[string, StepName]> => {
      try {
        const result = await fetchNodeDetail(entityKey);
        return result.status === "ok"
          ? [entityKey, {
              displayName: result.node.displayName,
              qualifiedName: result.node.qualifiedName
            }]
          : [entityKey, { displayName: null, qualifiedName: null }];
      } catch {
        return [entityKey, { displayName: null, qualifiedName: null }];
      }
    })
  );
  return new Map(entries);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @tadori/viz test -- src/features/story/stepNames.test.ts`
Expected: PASS, both cases green.

- [ ] **Step 5: Use the names in StoryView**

In `apps/viz/src/features/story/StoryView.tsx` add:

```tsx
import { resolveStepNames, type StepName } from "./stepNames.ts";
```

```tsx
  const [stepNames, setStepNames] = useState<ReadonlyMap<string, StepName>>(new Map());

  useEffect(() => {
    if (story === null) return;
    let cancelled = false;
    void resolveStepNames(story.steps.map((step) => step.entityKey)).then((names) => {
      if (!cancelled) setStepNames(names);
    });
    return () => { cancelled = true; };
  }, [story]);
```

Replace the step heading — currently `{step.kind}: {step.entityKey}` — with:

```tsx
                <p className="story-step-name">
                  <span className="story-step-kind">{step.kind}</span>
                  <strong>
                    {stepNames.get(step.entityKey)?.displayName
                      ?? "Name unavailable in this snapshot"}
                  </strong>
                </p>
                {(stepNames.get(step.entityKey)?.qualifiedName ?? null) !== null && (
                  <p className="story-step-qualified">
                    {stepNames.get(step.entityKey)?.qualifiedName}
                  </p>
                )}
```

Delete the manual `{index + 1}.` expression inside the `<li>` — the enclosing `<ol>` already numbers the list, and rendering both produced `1. 1.`.

- [ ] **Step 6: Style the step rows**

Append to `apps/viz/src/index.css`:

```css
.story-step-name { display: flex; align-items: baseline; gap: var(--tadori-space-2); margin: 0; }

.story-step-kind {
  padding: 0.1rem 0.35rem;
  border: 1px solid var(--tadori-rule);
  border-radius: var(--tadori-radius-sm);
  color: var(--tadori-ink-muted);
  font-size: var(--tadori-text-xs);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.story-step-qualified {
  margin: var(--tadori-space-1) 0 0;
  overflow-wrap: anywhere;
  color: var(--tadori-ink-muted);
  font-family: var(--tadori-font-mono);
  font-size: var(--tadori-text-xs);
}
```

- [ ] **Step 7: Run the tests and verify live**

Run: `pnpm --filter @tadori/viz test -- src/features/story`
Expected: PASS.

Then open Story on `GET /users/:id` and confirm the three steps read as named methods and functions with their qualified names beneath, and the ordinals read `1.` `2.` `3.`.

- [ ] **Step 8: Full gate and commit**

```bash
pnpm --filter @tadori/viz test
pnpm --filter @tadori/viz typecheck
pnpm lint
pnpm --filter @tadori/viz build
git diff --check
git add apps/viz/src/features/story apps/viz/src/index.css
git commit -m "design: name story steps instead of showing entity digests"
```

---

### Task 7: Make degraded states explicit and drop the metaphor columns

Closes findings 11, 12, 14, 15, 16, 17.

**Files:**
- Modify: `apps/viz/src/features/overview/overviewModel.ts`
- Modify: `apps/viz/src/features/a11y/AccessibleGraphTable.tsx`
- Modify: `apps/viz/src/features/review/ReviewDiffView.tsx`
- Modify: `apps/viz/src/App.tsx:374-379` (legend) and `:547-553` (story empty state)
- Test: `apps/viz/src/features/overview/overviewModel.test.ts` (extend)

**Interfaces:**
- Consumes: `renderedGraph.edges` from `PackageMapCanvas.tsx`.
- Produces: nothing consumed later.

- [ ] **Step 1: Write the failing test**

Append to `apps/viz/src/features/overview/overviewModel.test.ts`, reusing whatever fixture builder that file already defines:

```ts
it("does not repeat the same consequence clause on every dependency claim", () => {
  const sections = buildOverview(fixtureInput());
  const depended = sections.find((s) => s.id === "most-depended-upon");
  const repeated = (depended?.claims ?? [])
    .map((c) => c.value)
    .filter((v) => v.includes("changing this affects every dependent"));
  expect(repeated).toHaveLength(0);
});

it("never renders a region claim whose label is a bare dot", () => {
  const sections = buildOverview(fixtureInput());
  const regions = sections.find((s) => s.id === "major-regions");
  for (const claim of regions?.claims ?? []) {
    expect(claim.label).not.toBe(".");
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tadori/viz test -- src/features/overview/overviewModel.test.ts`
Expected: FAIL on both — the clause is appended unconditionally and the root project label is `.`.

- [ ] **Step 3: Delete the repeated clause and name the root region**

In `apps/viz/src/features/overview/overviewModel.ts`, where the most-depended-upon claim value is composed, drop the trailing clause:

```ts
      // The consequence clause was appended verbatim to every row, including
      // one-reference entries, which made the list unreadable and overclaimed
      // for weakly-depended entities. The count is the fact; the reader draws
      // the consequence.
      value: `${String(fanIn)} incoming ${fanIn === 1 ? "reference" : "references"} · ${kind}`,
```

Where the region label is composed:

```ts
      // A project root indexed as "." is a real fact, but "." as a link label
      // reads as a rendering failure. Name it for what it is.
      label: projectName === "." ? "Repository root" : projectName,
```

- [ ] **Step 4: Replace the Table metaphor columns**

In `apps/viz/src/features/a11y/AccessibleGraphTable.tsx`, replace the header cells:

```tsx
          <th scope="col">Name</th>
          <th scope="col">Kind</th>
          <th scope="col">Language</th>
          <th scope="col">Capability</th>
          <th scope="col">Derivation</th>
          <th scope="col">Outgoing provenance</th>
```

Delete the matching `archaeologicalForm` and `material` `<td>` expressions. Keep the `<caption>` and the `.a11y-graph` class unchanged — `verify-viz-e2e.mts` asserts on both.

- [ ] **Step 5: Explain the diff error**

In `apps/viz/src/features/review/ReviewDiffView.tsx`, replace the raw error rendering with:

```tsx
        <p role="alert">
          {error.code === "bad_snapshot_ref"
            ? "There is no earlier snapshot to compare against — this repository has been indexed once. Choose Working tree or Staged to see uncommitted changes instead."
            : `The diff could not be loaded (${error.code}).`}
        </p>
```

- [ ] **Step 6: Link the story empty state and gate the legend**

In `apps/viz/src/App.tsx` replace the story empty-state body with one that acts:

```tsx
                    <p>Trace a static, evidence-backed behavior path from a registered route.</p>
                    <button
                      type="button"
                      onClick={() => {
                        setNavigationOpen(true);
                        document.getElementById("explore-tab-routes")?.click();
                        document.getElementById("explore-panel-routes")?.scrollIntoView({ block: "center" });
                      }}
                    >
                      Open registered routes
                    </button>
```

Gate the legend on there being an edge to explain:

```tsx
          {lenses.provenance && (renderedGraph?.edges.length ?? 0) > 0 && (
            <div className="atlas-legend-cartouche">
              <p>Evidence paths</p>
              <ProvenanceLegend />
            </div>
          )}
```

If the Routes tab button has no `id`, add `id="explore-tab-routes"` to it in `ExploreTabs.tsx` in this same commit. Do not change its role, label, or the `#explore-panel-routes` panel id.

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @tadori/viz test`
Expected: PASS. If an existing `AccessibleGraphTable` test asserts on the removed columns, update that assertion to the replacement columns in this same commit.

- [ ] **Step 8: Full gate and commit**

```bash
pnpm --filter @tadori/viz test
pnpm --filter @tadori/viz typecheck
pnpm lint
pnpm --filter @tadori/viz build
git diff --check
git add apps/viz/src
git commit -m "design: make degraded states explicit"
```

---

### Task 8: Make the shell mode-aware and retire the metaphor copy

Closes findings 7, 8 and the copy half of 16. Last among feature slices because it touches the one permitted e2e assertion.

**Files:**
- Modify: `apps/viz/src/shell/LensButton.tsx`
- Modify: `apps/viz/src/App.tsx:386-400` (header), `:436` (nav heading), `:465-484` (context bar)
- Modify: `apps/viz/src/index.css`
- Modify: `scripts/verify-viz-e2e.mts:159` (the single permitted edit)
- Test: `apps/viz/src/shell/ModeTabs.test.tsx` (extend)

**Interfaces:**
- Consumes: `WorkspaceMode` from `ModeTabs.tsx`.
- Produces: nothing consumed later.

- [ ] **Step 1: Write the failing test**

Append to `apps/viz/src/shell/ModeTabs.test.tsx`, adding `import { LensButton } from "./LensButton.tsx";`:

```tsx
it("names every lens in visible text, not only in its accessible name", () => {
  render(<LensButton active={false} label="Boundaries" symbol="B" onClick={() => {}} />);
  expect(screen.getByText("Boundaries")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tadori/viz test -- src/shell/ModeTabs.test.tsx`
Expected: FAIL — the label exists only as `aria-label`; the visible text is the single letter `B`.

- [ ] **Step 3: Give the lens buttons visible labels**

In `apps/viz/src/shell/LensButton.tsx`, render both:

```tsx
      <span aria-hidden="true" className="lens-button-symbol">{symbol}</span>
      <span className="lens-button-label">{label}</span>
```

Append to `apps/viz/src/index.css`:

```css
/* Four unlabelled letters — B, delta, A, P — asked the reader to memorise a
   legend that was never shown. The word is the control; the symbol is a
   secondary cue that survives the narrow rail. */
.lens-button { width: auto; height: auto; padding: var(--tadori-space-1); gap: 0.1rem; }
.lens-button-symbol { font-size: var(--tadori-text-sm); }
.lens-button-label { font-family: var(--tadori-font-ui); font-size: 0.625rem; letter-spacing: 0.02em; }

.atlas-workspace { grid-template-columns: 4.5rem minmax(15rem, 19rem) minmax(0, 1fr); }
.app-shell.has-inspector .atlas-workspace { grid-template-columns: 4.5rem minmax(15rem, 19rem) minmax(0, 1fr) minmax(18rem, 23rem); }

@media (max-width: 1100px) {
  .lens-button-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }
}
```

- [ ] **Step 4: Scope the context bar to the active mode**

In `apps/viz/src/App.tsx`, gate the spatial indicators on the document modes only, so the `Showing …` span stays present in Atlas and Table:

```tsx
          <div className="atlas-context-bar">
            <span>{/* existing mode label expression unchanged */}</span>
            {mode !== "overview" && mode !== "interview" && (
              <>
                {mode !== "table" && <SpatialProjectionToggle active={spatialProjection} onChange={setSpatialProjection} />}
                <nav aria-label="Atlas location">
                  <ol>
                    {(renderedGraph?.breadcrumb ?? ["Repository"]).map((label, index, labels) => (
                      <li key={`${index}:${label}`} aria-current={index === labels.length - 1 ? "location" : undefined}>{label}</li>
                    ))}
                  </ol>
                </nav>
                <span>{`${renderedGraph?.lodLevel ?? "repository"} level`}</span>
                <span role="status" aria-live="polite" aria-atomic="true">{data === null ? "Graph unavailable" : `Showing ${visibleNodeCount} nodes and ${visibleEdgeCount} relations`}</span>
              </>
            )}
          </div>
```

- [ ] **Step 5: Give the header a readable repository identity**

Replace the brand and snapshot block:

```tsx
        <div className="atlas-brand">
          <h1>Tadori</h1>
          <small>Codebase study workspace</small>
        </div>
        <div className="atlas-snapshot" role="group" aria-label="Served snapshot">
          <strong title={snapshot?.repository ?? undefined}>
            {snapshot === null
              ? "Repository"
              : (/[^/\\]+$/.exec(snapshot.repository)?.[0] ?? snapshot.repository)}
          </strong>
          <span>{snapshot === null ? "No active snapshot" : `#${snapshot.snapshotId} · ${snapshot.snapshotKind}`}</span>
          <span className={`freshness freshness-${snapshot?.freshness ?? "unknown"}`}>
            {snapshot?.freshness ?? "unknown"}
          </span>
          <span className="atlas-diagnostics-summary" role="status" aria-live="polite">
            {diagnosticsSummary}
          </span>
        </div>
```

- [ ] **Step 6: Retire the remaining metaphor copy**

In `apps/viz/src/App.tsx` change the navigation heading text `Survey tools` to `Explore`, and the counts string `${data.nodes.length} sites · ${data.edges.length} paths` to `${data.nodes.length} entities · ${data.edges.length} relations`.

- [ ] **Step 7: Update the one e2e assertion this changes**

In `scripts/verify-viz-e2e.mts` replace line 159:

```ts
  assert.equal(initial.tagline, "Archaeological circuit atlas");
```

with:

```ts
  assert.equal(initial.tagline, "Codebase study workspace");
```

Change nothing else in that file.

- [ ] **Step 8: Run the tests**

Run: `pnpm --filter @tadori/viz test`
Expected: PASS.

- [ ] **Step 9: Full gate and commit**

```bash
pnpm --filter @tadori/viz test
pnpm --filter @tadori/viz typecheck
pnpm lint
pnpm --filter @tadori/viz build
git diff --check
git add apps/viz/src scripts/verify-viz-e2e.mts
git commit -m "design: make the application shell mode-aware"
```

---

### Task 9: Atlas navigation controls and camera fit

Closes finding 9.

**Files:**
- Modify: `apps/viz/src/graph/PackageMapCanvas.tsx`
- Modify: `apps/viz/src/index.css`
- Test: `apps/viz/src/graph/PackageMapCanvas.test.tsx` (create)

**Interfaces:**
- Consumes: the Sigma renderer ref already held inside `PackageMapCanvas`.
- Produces: nothing consumed later.

- [ ] **Step 1: Write the failing test**

Create `apps/viz/src/graph/PackageMapCanvas.test.tsx`. Build `minimalProps()` from the node/edge/position fixture already used by `buildGraphologyGraph.test.ts`:

```tsx
it("offers zoom, fit and reset controls with accessible names", () => {
  render(<PackageMapCanvas {...minimalProps()} />);
  expect(screen.getByRole("button", { name: /zoom in/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /zoom out/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /fit to content/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tadori/viz test -- src/graph/PackageMapCanvas.test.tsx`
Expected: FAIL — no such buttons exist.

- [ ] **Step 3: Add the control cluster**

Define the handlers next to the existing camera helpers, and call `fitToContent` once after each expansion so a newly expanded package does not leave the reader looking at an empty field with one outlier stretching the view:

```tsx
  const fitToContent = useCallback(() => {
    rendererRef.current?.getCamera().animatedReset({ duration: 0 });
    rendererRef.current?.refresh();
  }, []);

  const zoomIn = useCallback(() => {
    rendererRef.current?.getCamera().animatedZoom({ duration: 0 });
  }, []);

  const zoomOut = useCallback(() => {
    rendererRef.current?.getCamera().animatedUnzoom({ duration: 0 });
  }, []);
```

Render beside the canvas container:

```tsx
      <div className="atlas-controls" role="group" aria-label="Map controls">
        <button type="button" onClick={zoomIn}>
          <span aria-hidden="true">+</span>
          <span className="tadori-visually-hidden">Zoom in</span>
        </button>
        <button type="button" onClick={zoomOut}>
          <span aria-hidden="true">−</span>
          <span className="tadori-visually-hidden">Zoom out</span>
        </button>
        <button type="button" onClick={fitToContent}>
          <span aria-hidden="true">⤢</span>
          <span className="tadori-visually-hidden">Fit to content</span>
        </button>
      </div>
```

- [ ] **Step 4: Style the controls**

Append to `apps/viz/src/index.css`:

```css
/* The landing state is a single node in an otherwise empty field. Without a
   control cluster there was no affordance at all that the map could be moved
   or that the node could be descended into. */
.atlas-controls {
  position: absolute;
  z-index: 6;
  top: var(--tadori-space-3);
  left: var(--tadori-space-3);
  display: flex;
  flex-direction: column;
  border: 1px solid var(--tadori-rule);
  border-radius: var(--tadori-radius-sm);
  background: var(--tadori-panel-raised);
}

.atlas-controls button {
  width: 2rem;
  height: 2rem;
  min-height: 2rem;
  border: 0;
  border-bottom: 1px solid var(--tadori-rule);
  background: transparent;
  color: var(--tadori-ink);
  cursor: pointer;
  font-size: var(--tadori-text-md);
}

.atlas-controls button:last-child { border-bottom: 0; }
.atlas-controls button:hover { background: var(--tadori-panel); }
```

- [ ] **Step 5: Run the tests and verify live**

Run: `pnpm --filter @tadori/viz test -- src/graph`
Expected: PASS.

Then expand the repository node in the live app and confirm the camera fits the expanded set rather than leaving `adminish.test.ts` stretching the view.

- [ ] **Step 6: Full gate and commit**

```bash
pnpm --filter @tadori/viz test
pnpm --filter @tadori/viz typecheck
pnpm lint
pnpm --filter @tadori/viz build
git diff --check
git add apps/viz/src/graph apps/viz/src/index.css
git commit -m "design: give the atlas navigation controls and a camera fit"
```

---

### Task 10: Responsive and accessibility pass

Closes finding 19 and re-verifies 18 and 20 end to end.

**Files:**
- Modify: `apps/viz/src/index.css` (the `@media (max-width: 1280px)` block)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Separate the overlay inspector from the stage**

In the `@media (max-width: 1280px)` block replace the `.atlas-inspector` rule with:

```css
  /* Below 1280px the inspector overlays the stage. Previously it did so with no
     visible boundary and covered the context bar's level and count indicators
     exactly when the reader most needed them, so the map looked broken rather
     than covered. It now starts below the context bar and carries a rule and a
     shadow. */
  .atlas-inspector {
    position: absolute;
    z-index: 15;
    top: 2rem;
    right: 0;
    bottom: 0;
    width: min(23rem, calc(100% - 3rem));
    border-left: 1px solid var(--tadori-rule);
    box-shadow: -8px 0 24px rgb(72 55 30 / 22%);
  }
```

Add a narrow-desktop step that reclaims map width by collapsing the navigation panel before the map:

```css
@media (max-width: 1180px) {
  .atlas-workspace,
  .app-shell.has-inspector .atlas-workspace { grid-template-columns: 4.5rem minmax(12rem, 14rem) minmax(0, 1fr); }
}
```

- [ ] **Step 2: Verify at three widths**

Build, serve the fixture, and check 1440, 1280 and 1100:

- Overview and Interview scroll to their last section at every width.
- The context bar's indicators stay visible when the inspector is open.
- The navigation panel shows no horizontal scrollbar.
- Every changed control shows the slate focus ring on keyboard focus.

- [ ] **Step 3: Re-run the accessibility check**

Run a Lighthouse accessibility snapshot against the running app.
Expected: no `color-contrast` failure and no `label-content-name-mismatch` failure. The SEO, `robots.txt` and `llms.txt` audits are irrelevant to a localhost tool and are expected to stay red.

- [ ] **Step 4: Run the repository E2E gate**

Run: `pnpm verify:viz:e2e`
Expected: PASS, including zero axe violations, zero browser errors and zero external resources.

- [ ] **Step 5: Full gate and commit**

```bash
pnpm --filter @tadori/viz test
pnpm --filter @tadori/viz typecheck
pnpm lint
pnpm --filter @tadori/viz build
git diff --check
git add apps/viz/src/index.css
git commit -m "design: responsive and accessibility pass"
```

---

### Task 11: Repository gate, review and merge

- [ ] **Step 1: Run the full repository gate**

```bash
pnpm skills:check
pnpm typecheck
pnpm lint
pnpm test
```

Expected: all green. `pnpm test` builds the viz app, runs the non-CLI suites, runs the CLI suites serialized, then runs the viz suites.

- [ ] **Step 2: Capture after-screenshots**

Capture Overview, Atlas landing, Atlas expanded, Search results, Inspector, Interview, Story, Changes and Table at 1440x900, matching the before set. Keep them out of the repository — they are report artifacts, not documentation.

- [ ] **Step 3: Run the review gates**

Run `/code-review` on the branch diff, then `/quality-gate`, then `superpowers:verification-before-completion`. Fix any blocking finding and re-run the affected gate.

- [ ] **Step 4: Update the status document**

Add one concise entry to `IMPLEMENTATION_STATUS.md` recording the frontend design pass, the executed validation, and the fact that it proceeded ahead of the pinned external invariant runner named at line 124 as an explicit instruction.

- [ ] **Step 5: Open the PR and merge only on green**

```bash
git push -u origin design/frontend-product
gh pr create --title "Design: frontend product pass" --body-file docs/superpowers/specs/2026-08-02-frontend-product-design.md
gh pr checks --watch
```

Merge with `gh pr merge --squash` **only** when every required check reports success. Do not merge on a failing or pending check. Do not bypass branch protection.

---

## Self-review

**Spec coverage.** Findings 1 and 18 → Task 1. 2 → Task 2. 3 and 5 → Tasks 3 and 5. 6 and 20 → Task 4. 4 → Task 6. 10 → Task 5. 11, 12, 14, 15, 16, 17 → Task 7. 7, 8 → Task 8. 9 → Task 9. 19 → Task 10. Every finding has an owning task.

**Type consistency.** `resolveStepNames` / `StepName` are declared in Task 6 and used only there. `activeFilterCount` is declared in Task 4 and used only there. `fitToContent`, `zoomIn`, `zoomOut` are declared and used in Task 9. `--tadori-link` is introduced in Task 1 and consumed in Tasks 2 and 3.

**Ordering.** Task 1 precedes everything because two modes hide most of their content until it lands. Task 8 follows the feature tasks because it edits the one permitted line in the e2e script. Task 11 gates the merge on green CI.
