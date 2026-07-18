# R-01: Graphify UX Observations (Phase 8 Visualization Research)

STATUS: Research only. No code read or copied. Graphify is a separate,
personal Claude Code skill
(`C:\Users\prana\.claude\skills\graphify\SKILL.md`) — frozen Tadori rule:
"Graphify is ignored reference material only — never import/copy/ship its
code." This document extracts UX observations only, for what Tadori's
Phase 8 visualization blueprints should avoid or steal conceptually (never
code, never verbatim strings).

Only file under the skill directory: `SKILL.md` (43KB) — no `references/`
or `templates/` subdirectory exists to inspect.

---

## 1. What Graphify is

Graphify is a `/graphify` slash command that turns "any input (code, docs,
papers, images) → knowledge graph → clustered communities → HTML + JSON +
audit report" (SKILL.md:3). Built around an "Andrej Karpathy /raw folder
workflow": drop heterogeneous files in, get a navigable graph with
community detection, an "honest audit trail" (every edge tagged
EXTRACTED/INFERRED/AMBIGUOUS), and "cross-document surprise" (SKILL.md:
39-50). It targets a different problem than Tadori: a personal,
multi-corpus (code+docs+papers+images) knowledge tool, not a single-repo
code-comprehension surface.

---

## 2. UX failure modes Tadori must avoid

Grounded in the skill's own instructions; consequences for Tadori are
labeled INFERRED since SKILL.md never discusses Tadori.

- **Hard node cap instead of hairball mitigation.** HTML viz is refused
  above 5,000 nodes, redirecting to Obsidian (SKILL.md:436-441, 1144:
  "Never run HTML viz on a graph with more than 5,000 nodes"). No
  level-of-detail or layout collapse below that cap — one flat view
  renders everything. INFERRED: prevents a crash, not a hairball; real
  repos are unreadable well under 5,000 nodes in one flat view.
- **No deterministic/seeded layout guarantee.** Export functions
  (SKILL.md:296-523) and `--cluster-only` reruns (SKILL.md:722-765) never
  mention a fixed seed or stable-position guarantee, only `graph.json`
  content stability. INFERRED: a force-directed layout would visually
  reshuffle on rerun.
- **Single-level, non-progressive view.** One static artifact per run
  (Graph view, `graph.canvas`, `graph.html`, SKILL.md:406-441), no
  described drill-down (package → file → symbol) or expand/collapse.
  INFERRED: no purpose-built semantic zoom, just native Obsidian pan/zoom.
- **Community labels are manual, single-pass, unverified.** Step 5 has
  Claude "look at its node labels and write a 2-5 word plain-language name"
  by hand (SKILL.md:346-348), no automated labeling function, no
  confidence signal on the label (distinct from edge-level
  EXTRACTED/INFERRED/AMBIGUOUS, which doesn't apply to labels).
- **Placeholder-then-regenerate labeling.** Step 4 assigns literal
  `'Community ' + str(cid)` placeholders and generates questions against
  them before Step 5 replaces labels and regenerates (SKILL.md:318-320,
  371-374). INFERRED: mid-pipeline consumers see meaningless "Community 0"
  text; no atomic single-pass labeling.
- **Unbounded labels.** No truncation/overflow rule anywhere in export
  steps (SKILL.md:296-523). INFERRED: long names or verbose AMBIGUOUS
  descriptions can overflow labels with no wrapping rule.
- **Analysis findings live in a separate report, not the visual.**
  `god_nodes`/`surprising_connections` are computed (SKILL.md:316-317) and
  pasted into chat as text (SKILL.md:626-631), not highlighted or
  navigable inside `graph.html`/Obsidian. INFERRED: forces manual
  cross-referencing by node name.
- **No accessibility statements.** SKILL.md never mentions keyboard nav,
  screen readers, or WCAG for `graph.html`/Obsidian — silence, not a
  claim, but notable since Tadori's 08-11 requires accessibility
  validation.

---

## 3. Concepts worth stealing conceptually (never code)

- **Honest audit trail via edge confidence tags.** EXTRACTED/INFERRED/
  AMBIGUOUS on every edge, "Never invent an edge. If unsure, use AMBIGUOUS"
  (SKILL.md:1140, 188-190, 43). Tadori already has a provenance edge legend
  (`BACKLOG.md:35`) — transferable idea is the *policy discipline* of a
  hard confidence taxonomy with a "never invent, downgrade instead of
  omit" rule, not the specific states.
- **Plain-language audit report as a first-class artifact.**
  `GRAPH_REPORT.md` is "honest" and "plain-language" (SKILL.md:9, 322-380),
  generated alongside `graph.json` from the same facts — a human narrative
  kept in sync with the visual by regeneration, not hand authorship.
- **Dual machine/human output pairing.** One pipeline produces
  `graph.json`, `graph.html`, and `GRAPH_REPORT.md` together (SKILL.md:9,
  296-341) — one fact source feeding a queryable file and a human artifact
  so they can't drift.
- **Cost/token transparency as a trust signal.** Step 9 always prints
  input/output token counts, run and cumulative (SKILL.md:565-601, 1142:
  "Always show token cost in the report"). INFERRED: candidly surfacing
  pipeline cost builds trust in automated analysis.
- **Guided-explore framing after the artifact is built.** Step 9 offers to
  "trace" the single most interesting suggested question: "The graph is
  the map. Your job after the pipeline is to be the guide." (SKILL.md:
  633-639). This posture is conceptually close to Tadori's already-scoped
  08B Guided Explore tours (`blueprints/INDEX.md`, Phase 8B) — validation
  of that direction, not a source to copy.
- **Incremental re-extraction with an explicit diff summary.** `--update`
  re-extracts only changed files and prints a graph diff (SKILL.md:
  643-719). Relevant to Tadori's own incremental indexing work
  ("feat(indexer): complete Week 6 incremental indexing").

---

## 4. Hard boundary

- Frozen rule: Graphify is ignored reference material only — never import,
  copy, or ship its code, strings, or generated artifacts into the Tadori
  product.
- Graphify's build outputs are gitignored in this repo as build-side,
  non-product artifacts:
  ```
  # Graphify: build-time memory-compaction tool, not part of the Tadori product.
  # Outputs are sanctioned local artifacts, not stray files — do not treat as product state.
  graphify-out/
  .graphify_*
  ```
  (`c:\SideProjects\Tadori\.gitignore:13-16`). Confirms Graphify is
  user-level tooling incidental to this repo, never a dependency or shipped
  asset.
- No Graphify source was copied into this document (no source exists under
  the skill directory besides `SKILL.md`); all quotations here are short
  and attributed for citation only.

---

## 5. Translation table: Graphify behavior → Tadori Phase 8 requirement

| Graphify behavior (cited) | Tadori Phase 8 requirement it motivates |
|---|---|
| No hairball mitigation below the 5,000-node cutoff; one flat view (SKILL.md:436-441) | 08-02 package map as mandatory first level (convex hulls, not raw all-symbol view) + 08B-03's "anti-hairball guarantee" (`BACKLOG.md:108`) |
| Single static export, no drill-down (SKILL.md:296-441) | 08-03 (package→file) and 08-04 (file→symbols) as separate deterministic zoom levels (`BACKLOG.md:92-93`) |
| No layout-seed/reproducibility guarantee across reruns (SKILL.md:722-765) | 08-01 "seeded frozen layout" + 08-10 "positions byte-identical across reloads" (`BACKLOG.md:35,99`) |
| Manual, unverified, placeholder-then-regenerate community labels (SKILL.md:318-320, 346-348) | 08B-01 "deterministic plain-language overview... every sentence evidence-backed" — not a one-shot free-text guess (`BACKLOG.md:106`) |
| God nodes/surprises in a separate report, not the visual (SKILL.md:316-317, 626-631) | 08-06 evidence panels + 08-09 observation overlays — findings surfaced inside the graph view (`BACKLOG.md:96,98`) |
| No accessibility statements in SKILL.md | 08-11 "Browser & accessibility validation" as its own required gate |
| Unbounded labels, no truncation rule (SKILL.md:296-523) | Gap to raise when drafting 08-02: explicit max-length/overflow rule for label rendering. INFERRED priority, not yet a numbered item. |
| EXTRACTED/INFERRED/AMBIGUOUS confidence discipline as policy (SKILL.md:188-190, 1140) | Reinforces Tadori's provenance edge legend (`BACKLOG.md:35`) — keep the "never invent, mark uncertain" rule strict in 08-02's legend design |
| "Guided" post-pipeline exploration framing (SKILL.md:633-639) | Validates already-scoped 08B-02 tour engine / 08B-03 walkthrough tours — confirms, does not originate, that scope (`BACKLOG.md:107-108`) |

---

## Fact-Forcing Gate (if triggered)

- Importers: none — new markdown research document, no code importers.
- Affected API: none — no source files, schemas, or fixtures touched.
- Data files: none — no data files created, read, or modified.
- User instruction: produce R-01 Graphify UX observations research file for
  Tadori Phase 8 visualization blueprints (read-only inspection of the
  user's separate Graphify skill, UX observations only, no code
  import/copy/ship).
