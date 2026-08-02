# Tadori frontend product design — 2026-08-02

Branch: `design/frontend-product`. Scope: `apps/viz/src/**`.

## Problem

Tadori's frontend has correct semantics and wrong hierarchy. A live walkthrough
(`tadori serve` on `packages/fixtures/02-express-routes`, desktop 1440/1280/1100)
scored 97 on Lighthouse accessibility — roles, live regions, roving tabindex,
forced-colors and reduced-motion are all genuinely implemented — while the
landing surface silently hid two-thirds of itself and the search results
rendered as one unreadable concatenated string.

The defects are almost entirely CSS and information hierarchy. That is what this
work fixes. It is not a rewrite: no new endpoints, no renderer changes, no state
management changes, no new component tree.

## Product goal

The user moves from "I do not understand this repository" to "I can explain its
architecture, execution flow, important components, evidence, tradeoffs, risks,
and likely interview questions."

Two consequences that drive every decision below:

1. **Memorability is a requirement, not a nicety.** The interface is used to
   prepare for interviews and project deep dives, where the user must recall
   details later, under pressure, without the screen in front of them. Facts
   must land in stable, repeated positions with stark typographic contrast, so
   that recall is spatial as well as verbal. Prose that restates the same clause
   on every row actively destroys this.
2. **Epistemic status must stay legible.** Observed, documented, inferred and
   unknown are the product's core claim. They must remain distinguishable — but
   a badge that appears on every single item distinguishes nothing.

## Confirmed decisions

- **Metaphor**: retire it from product text; keep it in the Atlas map. The
  brand tagline, "Survey tools", "N sites · N paths", and Table mode's
  "Archaeological form" / "Material" columns become plain technical language.
  `atlasVisuals.ts`, `AtlasNodeProgram.ts`, `ProvenanceEdgeProgram.ts` and the
  stone/copper token palette are untouched.
- **Filters**: collapse the ~40 checkboxes behind a `Filters · N` disclosure
  directly under the search input. No filter group is removed.
- **Story labels**: resolve each step's `entityKey` through the existing
  `/api/v1/nodes/:key` endpoint (already used by the Inspector) via a typed
  frontend adapter. No API contract change.

## Findings this spec must close

Ranked; numbers referenced by the slice table.

**Unreachable or unreadable**

1. `.mode-panel { overflow: hidden }` (`index.css:388`) with unconstrained
   `.overview-panel`/`.interview-panel` height (`index.css:944-950`): at
   1440×900, 1381px of 2063px Overview content and 429px of 1111px Interview
   content cannot be reached by wheel or scrollbar.
2. `.search-result-list/-row/-kind/-name/-loc/-badge` have zero CSS rules, so
   spans concatenate: `classsrc/services/user-service.ts.UserServicesrc/services/user-service.ts:1exact`.
   Also a WCAG 2.5.3 label-in-name failure (Lighthouse).
3. `inspect-node`, `inspect-entity-header`, `inspect-meta`,
   `inspect-interpretation`, `inspect-readings`, `inspect-connections`,
   `inspect-rationale`, `evidence-list`, `source-view`, `route-table` have zero
   CSS. The 9-fact header renders as a browser-default `<dl>` at ~500px.
4. Story steps display 64-character hex entity keys; `/story/route/:key` carries
   no display name. Step ordinals render doubled (`1. 1.`).
5. The Routes table (the only entry to Story mode) overflows its 288px panel;
   the `Story` button column is off-screen.

**Hierarchy and navigation**

6. A ~700px filter wall sits between the search input and its results, which
   begin at y=905 in a 900px viewport.
7. Plan/Relief toggle, breadcrumb, LOD level and node counts render in Overview
   and Interview where they are meaningless, and truncate to ellipsis when the
   Inspector opens.
8. Header spends its width on brand plus tagline, then truncates the repository
   identity and snapshot mid-token.
9. Atlas has no zoom/fit/reset controls, no affordance that the single landing
   node expands, and no camera fit after expansion.

**Epistemic presentation**

10. `OBSERVED` renders on every claim.
11. Overview appends "— changing this affects every dependent" verbatim to every
    most-depended-upon row, including 1-fan-in entries.
12. The region claim renders as a link labelled `.`.
13. Interview copy renders `thing(s)` and literal backticks.
14. Changes surfaces the raw API code `bad_snapshot_ref`.
15. Story's empty state names a location without linking to it.

**Decoration displacing content**

16. Table mode leads with "Archaeological form" and "Material", wrapping rows to
    ~180px and pushing Capability, Derivation and Provenance behind a horizontal
    scrollbar.
17. The provenance legend renders when zero edges are drawn.

**Responsive and accessibility**

18. `.overview-claim-link` `#315f8c` on `#d8cfbc` = 4.31:1, below AA 4.5:1.
19. At ≤1280px the Inspector overlays the context bar without a scrim; at 1100px
    the map is ~380px and half-covered.
20. The navigation panel overflows horizontally at every width
    (`scrollWidth` 341 vs `clientWidth` 288).

## Design rules

**Memorability.** Every entity is introduced by the same three-part identity
block in the same order everywhere it appears — kind, name, `path:line`. Numbers
that matter (fan-in, dependents, diagnostics) are set large and few rather than
buried mid-sentence. Section headings are stable across entity types so position
becomes a recall cue. Repeated boilerplate clauses are deleted.

**Epistemic legibility.** `ClaimBadge` keeps its markup and `data-basis` hooks
unchanged. `observed` renders as a quiet marker; `documented`, `inferred` and
`unknown` keep their bordered/dashed/dotted chips. Nothing loses its label; the
ones that carry information stop being camouflaged.

**Honesty, unchanged.** Observed stays observed. Inferred stays labelled
inferred. Unresolved evidence never becomes a working link.
`runtimeObserved: false` banners stay. The `/api/v1/overview` unavailability
stays stated — moved from the hero position into the section it qualifies.
No production data is fabricated and no fixture is made to look live.

**Restraint.** No gradients beyond the existing ground texture, no
glassmorphism, no oversized marketing headings, no card grid per fact, no
animation that delays comprehension.

## Slices

Each slice is independently reviewable, independently committable, and leaves
the app usable.

| # | Commit | Closes |
|---|---|---|
| S1 | `design: repair reading-surface scroll and measure` | 1, 18 |
| S2 | `design: give search and inspector a visual system` | 2, 3, 5 |
| S3 | `design: make the application shell mode-aware` | 6, 7, 8, 20 |
| S4 | `design: restructure inspector for comprehension` | 3, 10 |
| S5 | `design: ground the interview workflow` | 13 |
| S6 | `design: clarify atlas navigation states` | 9, 17 |
| S7 | `design: make degraded states explicit` | 11, 12, 14, 15, 16 |
| S8 | `design: responsive and accessibility pass` | 19, 20 |

### S4 inspector section order

Summary · Responsibility · Execution role · Dependencies · Dependents ·
Design evidence · Structural interpretation · Risks · Tests · Source and
location · Interview preparation.

Sections render only when the snapshot supports them, and an absent section
states its absence rather than disappearing silently. `node.inEdges` is already
fetched and currently only counted; S4 renders it as Dependents.

Structural interpretation stays in the existing two-line form:

```
Observed: Fan-in 0
Inferred from structure: No incoming relation was extracted, so this appears to
act as an entry point rather than a shared dependency.
```

## Contracts that must not break

`scripts/verify-viz-e2e.mts` asserts against the live DOM. These hooks are
frozen for this work:

- ids: `#workspace-mode-panel`, `#explore-panel-path`, `#explore-panel-routes`,
  `#explore-panel-tests`, `#explore-panel-docs`
- classes: `.atlas-brand`, `.atlas-context-bar`, `.navigation-toggle`,
  `.package-map-canvas`, `.package-plate-overlay`, `.spatial-workspace`,
  `.story-view`, `.mode-empty-state`, `.inspect-connections`, `.inspect-edge`,
  `.review-diff`, `.review-diff-list`, `.explore-routes-story`,
  `.explore-tests-caption`, `.explore-docs`, `.a11y-graph`
- aria: `[role="tablist"][aria-label="Repository views"]`
- text: a `<span>` inside `.atlas-context-bar` whose text starts with
  `Showing ` must remain present in Atlas and Table modes

One assertion must change with the product copy it encodes:
`verify-viz-e2e.mts:159` asserts the tagline equals
`"Archaeological circuit atlas"`. S3 retires that string, so S3 updates the
assertion in the same commit. This is the only permitted edit to that file.

Out of scope and untouched: watcher, CI workflows, GitHub Actions, KF-001
instrumentation, indexer, graph extraction semantics, MCP contracts, release
packaging, benchmark corpora, API contracts.

## Validation per slice

`pnpm --filter @tadori/viz test` · strict typecheck · `pnpm lint` ·
`pnpm --filter @tadori/viz build` · live check against the Express fixture ·
normal and narrow desktop widths · keyboard focus and contrast on changed
controls · before/after screenshots · `git diff --check`.

Before merge: full repository gate, `/code-review`, `/quality-gate`,
`superpowers:verification-before-completion`, and green CI. Merge only on green.

## Known live-data limitations

- `/api/v1/overview` returns `available: false`. Overview stays assembled from
  endpoints that carry evidence, and says so.
- `/api/v1/story/route/:key` carries no display name per step. S-story resolves
  names through `/api/v1/nodes/:key`; if a key does not resolve, the step shows
  its kind and evidence path and says the name is unavailable.
- Route `method` is `unknown` in this fixture. It renders as `unknown`, not as a
  guessed verb.
- Region role text is `null` with `derived_from_graph` provenance by API design.
  Region names stay factual labels.
