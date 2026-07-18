# BLUEPRINT 08-02: apps/viz scaffold + package map

## 1. Header

- ID / Title / Phase: 08-02 — `apps/viz` scaffold + package map — Phase 8
- Status: review
- Primary builder: Claude Sonnet — new workspace app, well-bounded scope
  (package-level rendering only), every contract pre-resolved by
  ARCHITECTURE.md §1/§3/§4/§10 (AD-002, AD-005, AD-009, AD-010).
- Reviewer roles: Spec Guardian (frozen-visual-constraint compliance), Test
  Adversary (offline-bundle/CSP assertion, empty/stale state coverage),
  Implementation Reviewer (package-boundary import discipline).
- Complexity: L (one focused builder session; see §1 note below on the size
  ceiling)
- Depends on: 08-01 (`layout_positions` writer/reader must exist so
  `/api/v1/layout` — owned by 07-01 — has something to serve; this
  blueprint is a pure HTTP/WS client and never imports 08-01's code
  directly), 07-01 (`packages/server` — this blueprint's app is served by
  and talks only to that server's `/api/v1/*` routes and `/api/v1/ws`).
- Unlocks: 08-03 (file-level zoom extends this scaffold's expand
  interaction), 08-04 (symbol-level zoom, same extension point), 08-05/08-06
  (search and panels mount into this app's shell), 08-09 (observation
  overlays render atop this app's canvas).
- Estimated sessions: 1 (see note: if the builder finds mid-session that
  offline-bundle packaging, the legend component, and the empty/stale-state
  wiring together exceed one session, split along that seam — offline
  scaffold + package map + legend first, empty/stale-state polish second —
  rather than shipping a partially-honest state surface. This blueprint
  documents both halves as one file plan so the split, if needed, is a
  session boundary, not a scope cut.)
- Related frozen-spec sections: ARCHITECTURE.md §1 (package topology, AD-009
  viz-is-HTTP/WS-only), §3 (HTTP API envelope, `ApiContext`), §4 (WS
  contract, reconnect-then-refetch), §10 (viz data-loading contract,
  provenance edge legend, offline bundle rule); BACKLOG.md row 08-02;
  R-01 §5 translation table (hairball avoidance, unbounded-label gap).

## 2. Objective

`apps/viz` exists as a new workspace member: a React+Vite+Sigma.js
single-page app that, when served by `packages/server`'s static-asset
integration, renders the active snapshot's package-level graph as convex
hulls with labels and a data-driven provenance edge legend, using only
`fetch`/`WebSocket` against `/api/v1/*` — no `@tadori/*` import, no CDN
script, no external font/asset fetch at runtime.

## 3. Why this matters

- User value: this is the first visible surface of Tadori's visualization
  promise — a stable, honest, non-overwhelming first view of a repository,
  directly countering the Graphify failure mode of "one flat view renders
  everything" (R-01 §2).
- System value: establishes the one HTTP/WS seam every later 08-xx
  blueprint (search, panels, zoom, overlays) builds on; getting the
  state-ownership boundary (React owns view state, server owns data/layout)
  wrong here compounds into every later blueprint.
- Downstream: 08-10's performance budgets (cold-start < 5s) are measured
  against this scaffold's data-loading pattern; 08-11's accessibility gate
  audits this app's DOM/keyboard surface.

## 4. Current repository evidence

**Verified current (2026-07-17):**

- `ls packages/` = `core, fixtures, harness, indexer, mcp, store` — **no
  `apps/` directory exists anywhere in the repository.** `apps/viz` is a
  wholly new workspace member.
- `pnpm-workspace.yaml` (verbatim today):
  ```yaml
  packages:
    - "packages/core"
    - "packages/store"
    - "packages/indexer"
    - "packages/harness"
    - "packages/mcp"
  ```
  No `apps/*` glob exists. ARCHITECTURE.md §1 proposes adding it (owner
  07-01 per that doc's note, but since 07-01 does not itself create
  `apps/viz`'s files, this blueprint is the one that actually needs the
  glob present to build; if 07-01 has not yet added it when this blueprint
  executes, this blueprint adds the one line `- "apps/viz"` itself as a
  minimal, additive workspace-config change — not a re-architecture).
- `tsconfig.json` (root) `include`/`exclude`: currently lists the five
  Node packages; `packages/fixtures` is deliberately excluded
  (EVIDENCE-BASELINE.md §2). `apps/viz` needs a **separate** `tsconfig.json`
  (DOM lib, JSX, Vite) and must be **excluded** from the root Node
  tsconfig, mirroring the existing `packages/fixtures` exclusion pattern —
  this is not a new precedent, it is reuse of an existing one.
- No `react`, `sigma`, `graphology` (browser-side), or `vite` dependency
  exists anywhere in the repo today (grep across every `package.json`
  confirmed empty) — this blueprint is the first to add them, all four
  already on the frozen allowlist (ASSUMPTIONS.md A-003).
- `packages/mcp/src/contracts.ts:49-88` — `toolNodeSchema`/`toolEdgeSchema`
  (frozen node/edge wire shapes) are the shapes ARCHITECTURE.md §3 says the
  server's `/api/v1/nodes`/`/api/v1/edges` responses reuse verbatim (AD-008).
  This blueprint's TypeScript types for fetched nodes/edges are **hand
  ports** of these shapes (viz cannot import `@tadori/mcp` — AD-009 — so the
  wire-shape fields are re-declared as a local type in `apps/viz`, kept in
  sync by convention/review, the same "one wire format" discipline
  ARCHITECTURE.md names for the two existing consumers).
- `packages/core/src/enums.ts:20-32` — frozen `Origin` (`compiler, heuristic,
  git, doc, human, llm`), `Confidence` (`certain, likely, inferred`),
  `Resolution` (`resolved, partial, unresolved`) enums are exactly the three
  fields the provenance edge legend (§10 of ARCHITECTURE.md) encodes. These
  values are hand-ported as literal string unions in `apps/viz` for the same
  reason as above (no cross-boundary import).
- ARCHITECTURE.md §3 endpoint table rows 1, 4, 5, 14, 15 are this
  blueprint's exact data sources: `/api/v1/snapshot`, `/api/v1/nodes?level=
  package`, `/api/v1/edges?relation=imports`, `/api/v1/refresh`,
  `/api/v1/layout?level=package`. These endpoints are **owned by 07-01**,
  not built by this blueprint — this blueprint's implementation proceeds
  against a documented contract and, if 07-01's actual server is not yet
  runnable when this blueprint is built, uses a local contract-shaped mock
  server for its own tests (named in §13) while still integrating against
  the real server for the manual/browser verification step.
- ARCHITECTURE.md §4 WS contract: `ServerEvent` union
  (`snapshot_replaced`/`refresh_pending`/`refresh_settled`/`watcher_error`/
  `observation`) and the explicit reconnect rule: "client reconnects with
  exponential backoff (cap 5s)... re-fetches `/api/v1/snapshot` +
  `/api/v1/refresh`... WS is a change signal, not the state of record."
  This is a load-bearing contract this blueprint must implement exactly,
  not approximate.
- R-01 §5 translation table row: "Unbounded labels, no truncation rule...
  Gap to raise when drafting 08-02: explicit max-length/overflow rule for
  label rendering." This blueprint is where that gap is closed (§8 below
  sets the concrete numbers, since ARCHITECTURE.md does not).

**PROPOSED (this blueprint):** every file under `apps/viz/` in §9; the
`pnpm-workspace.yaml` one-line addition if not already present.

Files to read first: `blueprints/ARCHITECTURE.md` §1/§3/§4/§10 (already
read in full above), `packages/mcp/src/contracts.ts:36-88` (wire shapes to
port), `packages/core/src/enums.ts` (enum values to port).

Gotchas: Sigma.js requires a `graphology.Graph` instance as its data model
— `apps/viz` therefore takes a **browser-side** dependency on `graphology`
(distinct from 08-01's **Node-side** `@tadori/store` dependency on the same
library; they are the same npm package used in two different runtime
contexts, not a violation of AD-009, since `apps/viz` never imports
`@tadori/store` itself, only the `graphology` npm package directly).

## 5. Scope

1. New workspace member `apps/viz` (React 18 + Vite + TypeScript), building
   to a static bundle with zero external runtime fetches.
2. A typed HTTP client module (`fetch`-based) for the endpoints in §4 above,
   returning the hand-ported local types.
3. A typed WS client module implementing the exact reconnect/refetch
   contract from ARCHITECTURE.md §4.
4. Package-level Sigma.js canvas: one node per `kind==='package'` entity,
   positioned from `/api/v1/layout?level=package`, edges from
   `/api/v1/edges?relation=imports` aggregated between packages, rendered
   inside convex hulls (one hull per package, computed client-side from
   member node positions — see §8 for what "member node positions" means at
   this package-only stage) with a label per hull.
5. Provenance edge legend component: solid/dashed/dotted line styles plus
   muted rendering for `doc`/`git`-origin edges, driven entirely by each
   edge's `origin`/`confidence`/`resolution` fields (data-driven, not a
   static image).
6. App-level state model: React state for view state only (current level —
   fixed to `"package"` in this blueprint since 08-03/08-04 add the other
   two — selection, legend visibility); server-fetched data and layout held
   in a data-fetching layer, never duplicated into a second source of
   truth.
7. Honest empty/loading/stale UI states, driven by `/api/v1/snapshot`'s
   `context.freshness`/`stale`/`staleReason` and `/api/v1/refresh`'s
   `phase`.
8. Static-asset integration point: documents (this blueprint, not 07-01)
   the exact contract 07-01 must satisfy to serve the built bundle (`vite
   build` output directory, expected mount path), so the two blueprints do
   not silently diverge on where files land.

## 6. Non-goals

- No file-level or symbol-level rendering (08-03, 08-04).
- No search UI (08-05).
- No inspection/evidence side panels (08-06).
- No observation overlays (08-09).
- No 2.5D/3D mode (Phase 10) — this blueprint ships the 2D default only;
  a `--mode` selector's *existence* is 07-02's CLI concern, not this app's.
- No server-side code — `packages/server`'s routes, static-file serving
  middleware, and WS push logic are 07-01's file plan, not this one's. This
  blueprint documents the *contract* 07-01 must meet (§8 last bullet) but
  writes zero files under `packages/server`.
- No full-graph hairball rendering at any zoom level, ever (frozen
  non-negotiable) — enforced here by the package-level cap (§16) and the
  hard rule that this blueprint never requests `level=file` or
  `level=symbol` data.
- No city-metaphor visual treatment (frozen non-negotiable) — hulls and
  labels are abstract 2D shapes, not buildings/skylines.

## 7. Dependencies and prerequisites

- **08-01**: `layout_positions` populated for `abstraction_level='package'`
  must be readable via 07-01's `/api/v1/layout?level=package` for this
  blueprint's canvas to show real positions (contract: `{ positions:
  {entityKey, x, y, z, pinned}[]; layoutVersion: number }`, ARCHITECTURE.md
  §3 row 15).
- **07-01**: every endpoint in §4 must exist with the exact response shapes
  in ARCHITECTURE.md §3 (`ApiContext`, `Page<T>`, `ApiError`) and the WS
  contract in §4. If 07-01 is incomplete when this blueprint starts, the
  builder uses a documented local mock (§13) to make progress and flags the
  real-server integration step as blocked until 07-01 lands, per §22.

## 8. Architectural decisions

- **`apps/viz` is HTTP/WS-only; zero `@tadori/*` imports, zero `fs`, zero
  `better-sqlite3` (AD-009, restated and enforced here).** Enforcement
  mechanism, not just a promise: `apps/viz/eslint.config.js` (an app-local
  ESLint config, not a change to the root one) adds a
  `no-restricted-imports` rule blocking any import path matching
  `^@tadori/` or `^(fs|better-sqlite3)$`. Rejected: relying on code review
  alone — a lint rule is a smaller diff than a recurring review burden and
  fails fast in CI.
- **Offline bundle: no CDN, no external `<script src>`/`<link>`, no
  external font/webfont fetch, no analytics/telemetry beacon.** Enforced by
  (a) Vite's default bundling behavior (all imported JS/CSS is inlined into
  the build output by default — no explicit action needed beyond *not*
  adding a CDN `<script>` tag to `index.html`), and (b) a test-plan
  assertion (§13) that statically greps the built `dist/index.html` and
  `dist/assets/*.js` for `http://`/`https://` URL literals pointing at any
  host other than `127.0.0.1`/`localhost` — this is the "CSP-style
  assertion" the task calls for: a build-output content check standing in
  for a real Content-Security-Policy header (no CSP header exists yet
  because no server is authoring response headers in this blueprint's
  scope; enforcing it as a build-output invariant is the correct fit for a
  static-bundle-only blueprint, and 07-01 may later add an actual CSP
  header as defense-in-depth — out of this blueprint's scope). Rejected: a
  runtime CSP `<meta>` tag with no matching enforcement test — meta-tag CSP
  is only advisory unless paired with a real check; the grep-based build
  assertion is the cheaper, equally effective control for a bundle with no
  external resources by construction.
- **State ownership split (restates AD-005/§10 verbatim, made concrete).**
  Server owns: graph data (nodes/edges), layout positions, snapshot/refresh
  state. React owns exactly: `selectedEntityKey: string | null`,
  `legendVisible: boolean`, and (added by 08-03/08-04 later, not here)
  expanded-package/file ids. No React state ever holds a node's `x`/`y` —
  positions are read straight from the `/api/v1/layout` fetch result into
  Sigma's graph model and never copied into a React `useState`. Rationale:
  this is the exact mechanism that gives "reloading the page re-fetches
  identical data + identical layout -> identical picture" (ARCHITECTURE.md
  §10) — any React-owned copy of position data would be a second source of
  truth that could drift.
- **Data-fetching layer: a small hand-written hook set
  (`useSnapshot`, `usePackageGraph`, `useRefreshStatus`), no React Query /
  SWR / Redux.** Rationale (ladder step 6/7): the fetch surface here is five
  endpoints, one WS channel, and no cache invalidation complexity beyond
  "on `snapshot_replaced` or `refresh_settled`, refetch" — a dependency
  whose entire value proposition is cache/retry/dedup logic this app does
  not need yet is not justified against the allowlist (`react, sigma,
  graphology, vite` only — no data-fetching library is on it, and adding
  one is exactly the kind of addition §1 says must be "justified in-blueprint
  and reviewed before addition"; this blueprint declines to add one).
  Rejected: TanStack Query — real value only appears with many
  overlapping/paginated queries and background refetch policies, which
  08-05's search (paginated) may eventually want, but is not justified for
  this blueprint's five fixed-shape endpoints; revisit in 08-05 if its
  search pagination proves the hand-written hooks insufficient.
- **Sigma.js + graphology as the render/data-model pair (per allowlist).**
  Sigma renders a `graphology.Graph` instance via WebGL. This blueprint
  builds the `Graph` instance directly from fetched nodes/edges (one
  `addNode`/`addEdge` call per item, positions from the layout fetch) —
  no adapter package, no additional dependency beyond the two already
  allowlisted.
- **Convex hulls computed client-side from member positions, using a small
  hand-written monotone-chain algorithm (~40 lines), not a geometry
  library.** Rationale (ladder step 6): convex hull of a 2D point set is a
  textbook ~40-line algorithm with no edge cases worth a dependency;
  `d3-polygon`/`convex-hull` npm packages exist but are not on the
  allowlist and the problem size (tens of points per package, not
  millions) does not justify vetting and adding one. At the package-only
  zoom level (this blueprint), "member positions" for a package's hull are
  approximated from that package's **file-level** positions if
  `abstraction_level='file'` rows already exist for it (optional
  enhancement, only if 08-01's writer has already materialized them for
  the active snapshot) — otherwise (the common case at this blueprint's
  stage, since file-level materialization is triggered lazily by 08-03's
  expand action) the hull degenerates to a small fixed-radius circle
  drawn around the single package node's own position, explicitly labeled
  as a placeholder shape, not a fabricated hull from data that doesn't
  exist yet. This is documented here as an explicit, named simplification:
  `ponytail: package hulls degrade to a fixed-radius circle until
  file-level positions exist for that package; true multi-point hulls
  activate automatically once 08-03 has run once for that package (no
  code change needed — the hull function already branches on point count
  >= 3).`
- **Provenance edge legend: data-driven component, single source of the
  origin->style mapping.** One pure function,
  `edgeVisualStyle(origin, confidence, resolution): { dash: number[] |
  null; muted: boolean }`, exported from `apps/viz/src/legend.ts` and used
  by **both** the canvas renderer and the legend UI component — this is the
  mechanism that guarantees "the legend is data-driven and visible in every
  mode" (ARCHITECTURE.md §10): there is exactly one function computing
  style from data, never two independently-maintained mappings. Concrete
  mapping (fixed, frozen per the task's restated constraint): `origin ===
  "compiler"` -> solid; `confidence === "likely"` -> dashed;
  `confidence === "inferred"` or `resolution !== "resolved"` -> dotted;
  `origin === "doc" || origin === "git"` -> `muted: true` regardless of the
  line style computed above (muted is an independent visual channel, not a
  fourth line style, matching ARCHITECTURE.md §10's exact wording: "doc-
  sourced and git-sourced edges rendered muted regardless of line style").
- **Label budget (closing the R-01 gap explicitly).** Package label text is
  truncated to **24 characters** with a trailing ellipsis beyond that
  (matches typical npm package name lengths with headroom; chosen here
  since neither ARCHITECTURE.md nor BACKLOG.md sets a number — this
  blueprint is the first to need one and fixes it as policy for 08-03/08-04
  to inherit, not re-derive). Full untruncated name is always available via
  the node's title/tooltip and the (08-06-owned) inspection panel — this
  blueprint's canvas-level label is a summary, never the only place the
  full name exists. Package node count per level is capped by 07-01's
  documented `limit<=500` (ARCHITECTURE.md §3 row 4); this blueprint never
  requests more than the level's first page without explicit pagination UI
  (deferred; package counts in realistic repos stay far under 500, and if
  they do not, "beyond-budget" omission indicators are 08-04's explicit
  concern — this blueprint at package level simply loads page 1 and, if
  `nextCursor` is non-null, shows a plain count-based "N more packages not
  shown" honest indicator rather than silently truncating without saying
  so).
- **WS reconnect: exponential backoff capped at 5s, full re-fetch on
  reconnect (restates ARCHITECTURE.md §4 verbatim as an implementation
  requirement).** Concrete backoff sequence: `500ms, 1000ms, 2000ms, 4000ms,
  5000ms, 5000ms, ...` (doubling, capped, matches "exponential backoff (cap
  5s)"). On every successful (re)connection, the client calls
  `refetchSnapshot()` and `refetchRefreshStatus()` unconditionally (not
  conditionally on "did we miss anything" — ARCHITECTURE.md is explicit
  that "missed events are recovered by the re-fetch," i.e. the client never
  tries to reason about what it missed).
- **Failure/stale-state honesty (frozen non-negotiable, made concrete
  here).** Three distinct UI states, each with its own visible text, never
  collapsed into a spinner-only or silently-stale view: (1) **loading** —
  no `/api/v1/snapshot` response yet; (2) **stale** —
  `context.stale === true`, text includes the literal `staleReason` value
  (e.g. "content_changed") rather than a generic "data may be out of date";
  (3) **refresh in progress** — `/api/v1/refresh` `phase === "refreshing"`,
  shown as a non-blocking banner (the last-known-good graph stays visible
  and interactive per "invalid snapshots never served" — a refresh in
  progress does not mean the currently-displayed data is invalid, only that
  newer data is being prepared).

## 9. Exact file plan

- `pnpm-workspace.yaml` — modify (additive line `- "apps/viz"`), only if
  07-01 has not already added it (check before editing; do not duplicate).
- `apps/viz/package.json` — create. Dependencies: `react`, `react-dom`,
  `sigma`, `graphology`; devDependencies: `vite`, `@vitejs/plugin-react`,
  `typescript`, `@types/react`, `@types/react-dom`, `eslint` (reuses root
  eslint version via workspace hoisting), `vitest`, `@testing-library/react`
  (test-only, justified: component-level assertions on the empty/stale
  state text in §13 need DOM rendering, and Vitest is already a repo
  dependency — `@testing-library/react` is the standard minimal-diff pairing,
  not a new testing philosophy).
- `apps/viz/tsconfig.json` — create. `lib: ["ES2022", "DOM"]`, `jsx:
  "react-jsx"`, separate from root `tsconfig.base.json` (does not extend
  it — the base config is Node-oriented with no `DOM` lib; a fresh
  browser-oriented config avoids leaking Node types into browser code).
- `apps/viz/vite.config.ts` — create. `@vitejs/plugin-react`; `build.outDir:
  "dist"`; no `base` override beyond default (server mounts at `/`, per
  ARCHITECTURE.md §3 "Static viz bundle served at `/`").
- `apps/viz/index.html` — create. Vite entry HTML; no external `<script
  src="http...">`, no external font `<link>`.
- `apps/viz/eslint.config.js` — create. Extends the pattern of the root
  flat config with the added `no-restricted-imports` rule from §8.
- `apps/viz/src/main.tsx` — create. React root mount.
- `apps/viz/src/App.tsx` — create. Top-level shell: loading/stale/refresh
  banners + canvas mount point + legend toggle.
- `apps/viz/src/api/types.ts` — create. Hand-ported local types:
  `ApiNode`, `ApiEdge`, `ApiContext`, `LayoutPosition`, `RefreshStatus`,
  mirroring `contracts.ts`'s `toolNodeSchema`/`toolEdgeSchema` field-for-field
  and ARCHITECTURE.md §3's `ApiContext`/`Page<T>`.
- `apps/viz/src/api/client.ts` — create. `fetchSnapshot()`,
  `fetchPackageNodes()`, `fetchPackageEdges()`, `fetchLayout(level)`,
  `fetchRefreshStatus()` — thin `fetch` wrappers, typed, throwing a typed
  `ApiClientError` on non-2xx (carrying the server's `ApiError.code`).
- `apps/viz/src/api/ws.ts` — create. `connectWs(onEvent, onReconnect)` —
  implements the exact backoff/reconnect/refetch-trigger contract from §8.
- `apps/viz/src/hooks/useSnapshot.ts`,
  `apps/viz/src/hooks/usePackageGraph.ts`,
  `apps/viz/src/hooks/useRefreshStatus.ts` — create. Hand-written data
  hooks per §8 (no data-fetching library).
- `apps/viz/src/graph/buildGraphologyGraph.ts` — create. Pure function:
  `(nodes, edges, positions) => graphology.Graph` instance builder.
- `apps/viz/src/graph/convexHull.ts` — create. Monotone-chain hull
  algorithm + the circle-degeneration fallback from §8.
- `apps/viz/src/graph/PackageMapCanvas.tsx` — create. Sigma mount + render
  loop; label truncation (24 chars) applied here.
- `apps/viz/src/legend.ts` — create. `edgeVisualStyle` pure function (§8).
- `apps/viz/src/legend/ProvenanceLegend.tsx` — create. Legend UI component
  consuming `edgeVisualStyle`.
- `apps/viz/src/states/EmptyLoadingStale.tsx` — create. The three named
  states from §8, each with distinct visible text.
- `apps/viz/test/legend.test.ts` — create.
- `apps/viz/test/convexHull.test.ts` — create.
- `apps/viz/test/ws-reconnect.test.ts` — create.
- `apps/viz/test/states.test.tsx` — create.
- `apps/viz/test/mockServer.ts` — create. Contract-shaped local mock (no
  network) implementing the five endpoint shapes for this blueprint's own
  tests, so tests do not require a running `packages/server`.
- `root tsconfig.json` — modify (additive `exclude` entry for
  `apps/viz`, mirroring the existing `packages/fixtures` exclusion) — only
  if not already present.
- `IMPLEMENTATION_STATUS.md` — modify: dated entry for the new workspace
  member and its four new runtime dependencies.

## 10. Exact contracts

```ts
// apps/viz/src/api/types.ts — hand-ported, kept in sync by review with
// packages/mcp/src/contracts.ts's toolNodeSchema/toolEdgeSchema and
// ARCHITECTURE.md §3's ApiContext.

export type NodeKind = "package" | "file" | "function" | "method" | "class"
  | "interface" | "type" | "route" | "test" | "adr" | "doc_section"
  | "external_dep" | "unresolved";
export type Origin = "compiler" | "heuristic" | "git" | "doc" | "human" | "llm";
export type Confidence = "certain" | "likely" | "inferred";
export type Resolution = "resolved" | "partial" | "unresolved";

export interface ApiNode {
  entityKey: string;
  kind: NodeKind;
  qualifiedName: string;
  displayName: string;
  file: string | null;
  exported: boolean;
  fanIn: number;
}
export interface ApiEdge {
  entityKey: string;
  srcEntityKey: string;
  relation: string;
  dstEntityKey: string;
  origin: Origin;
  confidence: Confidence;
  resolution: Resolution;
}
export interface ApiContext {
  repository: string;
  snapshotId: number;
  snapshotKind: "commit" | "working_tree" | "staged" | "patch";
  freshness: "fresh" | "stale" | "unknown";
  stale: boolean;
  staleReason: string | null;
  refreshPending: boolean;
}
export interface LayoutPositionDto {
  entityKey: string;
  x: number; y: number; z: number; pinned: boolean;
}
export interface RefreshStatus {
  phase: "idle" | "dirty" | "refreshing" | "failed" | "stopped";
  generation: number;
  dirtyPaths: string[];
  snapshotId: number | null;
  lastError: string | null;
}

// apps/viz/src/legend.ts
export function edgeVisualStyle(
  origin: Origin, confidence: Confidence, resolution: Resolution
): { dash: number[] | null; muted: boolean };
// dash: null = solid, [4,2] = dashed (confidence "likely"),
// [1,2] = dotted (confidence "inferred" OR resolution !== "resolved")
// muted: true iff origin is "doc" or "git", independent of dash.

// apps/viz/src/api/ws.ts
export type WsCloseReason = "clean" | "error" | "server_restart";
export function connectWs(
  url: string,
  onServerEvent: (evt: ServerEvent) => void,
  onReconnected: () => void
): { close(): void };
```

Static-asset integration contract (for 07-01, documented here so both
blueprints agree): `vite build` emits to `apps/viz/dist/`; 07-01's Fastify
server serves this directory's contents at `/` via `@fastify/static`
(or equivalent), with `index.html` as the fallback for any non-`/api/v1/*`
path (standard SPA-serving convention). This blueprint does not implement
that server-side wiring; it only commits to producing `dist/` in this
shape.

## 11. Ordered implementation procedure

1. `pnpm-workspace.yaml` + root `tsconfig.json`: add the `apps/viz` glob and
   exclusion if not already present (check first). Expected: `pnpm install`
   recognizes the new (empty) workspace member without error.
2. `apps/viz/package.json`, `tsconfig.json`, `vite.config.ts`,
   `eslint.config.js`, `index.html`: scaffold. `pnpm install`. Expected:
   `pnpm --filter apps/viz exec vite build` produces an empty-shell
   `dist/` with no errors (before any real component exists, a minimal
   `main.tsx` rendering "Tadori" is enough to prove the toolchain works).
3. `apps/viz/src/api/types.ts`, `apps/viz/test/mockServer.ts`: write the
   hand-ported types and the local mock server module used by every
   subsequent test. Expected: types compile; mock server module exports
   callable fixtures returning contract-shaped JSON.
4. `apps/viz/src/api/client.ts`, `apps/viz/src/api/ws.ts`: implement against
   the mock. `apps/viz/test/ws-reconnect.test.ts`: write failing tests for
   the backoff sequence and the refetch-on-reconnect behavior (fake
   WebSocket, fake timers). Expected: tests fail, then pass once `ws.ts`
   implements the exact backoff table from §8.
5. `apps/viz/src/legend.ts`, `apps/viz/test/legend.test.ts`: implement
   `edgeVisualStyle` against a table of every `(origin, confidence,
   resolution)` combination relevant to the frozen enums; assert exact
   `{dash, muted}` per the mapping in §10. Expected: all combinations pass.
6. `apps/viz/src/graph/convexHull.ts`, `apps/viz/test/convexHull.test.ts`:
   implement the monotone-chain hull + circle fallback for <3 points;
   test with a known point set with a known expected hull, plus 1-point and
   2-point degenerate cases. Expected: hull matches expected output; <3
   points return the labeled circle-fallback shape.
7. `apps/viz/src/graph/buildGraphologyGraph.ts`: implement the pure
   node/edge -> `graphology.Graph` builder. Expected: unit test (folded into
   `PackageMapCanvas` integration test, step 9) confirms node/edge counts
   match input.
8. `apps/viz/src/hooks/useSnapshot.ts`, `usePackageGraph.ts`,
   `useRefreshStatus.ts`: implement against the mock client from step 4.
   Expected: hooks return loading -> data transitions correctly in a
   React Testing Library render.
9. `apps/viz/src/graph/PackageMapCanvas.tsx`: implement Sigma mount,
   feeding it the graphology graph built from hook data plus fetched
   layout positions; apply 24-char label truncation. Expected: renders
   without throwing against mock fixture data (headless/jsdom-safe test —
   Sigma's WebGL renderer is smoke-tested for mount/unmount only, not pixel
   output, since jsdom has no real WebGL context; a `canvas`-mocking shim
   or `sigma`'s documented headless-test approach is used here).
10. `apps/viz/src/legend/ProvenanceLegend.tsx`,
    `apps/viz/src/states/EmptyLoadingStale.tsx`,
    `apps/viz/test/states.test.tsx`: implement the three named states with
    distinct visible text; test asserts each state's exact visible string
    appears (loading text, stale text including the `staleReason` value,
    refreshing banner text) and that the last-known-good graph stays
    rendered during "refreshing." Expected: all three states pass.
11. `apps/viz/src/App.tsx`, `apps/viz/src/main.tsx`: wire the shell
    together. Expected: `pnpm --filter apps/viz test` full suite green;
    `pnpm --filter apps/viz exec vite build` succeeds.
12. Offline-bundle assertion script (test-plan item, §13): grep
    `apps/viz/dist/**/*.{html,js}` for external-host URL literals; assert
    none found except `127.0.0.1`/`localhost`. Expected: passes on the
    real build output.
13. Root `IMPLEMENTATION_STATUS.md`: dated entry. Run full validation gate
    (§15). Commit:
    `feat(viz): scaffold apps/viz with offline Sigma.js package map`.

## 12. Data and lifecycle flows

**Cold load:** mount -> `useSnapshot` fetches `/api/v1/snapshot` -> loading
state shown -> on success, `usePackageGraph` fetches `/api/v1/nodes?
level=package`, `/api/v1/edges?relation=imports`, `/api/v1/layout?
level=package` in parallel -> `buildGraphologyGraph` constructs the Sigma
data model -> `PackageMapCanvas` mounts Sigma -> WS connects, subscribes to
`["refresh"]`.

**Refresh in progress (non-blocking):** WS delivers `refresh_pending` ->
`useRefreshStatus` state updates -> banner shows "refreshing," last graph
stays interactive -> WS delivers `refresh_settled` with a new `snapshotId`
-> `snapshot_replaced` triggers `useSnapshot`/`usePackageGraph` refetch ->
canvas rebuilt from the new (still byte-identical-for-unchanged-nodes,
per 08-01) layout.

**WS disconnect:** socket closes -> exponential backoff reconnect attempts
(500ms..5000ms cap) -> on reconnect, unconditional refetch of `/api/v1/
snapshot` + `/api/v1/refresh` -> UI reconciles to whatever the refetch
shows, independent of what was missed while disconnected.

**Server unreachable at cold load:** `fetchSnapshot()` rejects -> loading
state persists with a retry affordance (not a silent infinite spinner —
the loading state's text distinguishes "waiting for first response" from
"request failed, retrying"), matching the honesty requirement in §8.

**Stale snapshot:** `context.stale === true` -> stale banner shows the
literal `staleReason` -> graph still renders (invalid snapshots are never
served by the server per the frozen contract, so "stale" here always means
"valid but outdated," never "corrupt").

## 13. Test plan

- `apps/viz/test/legend.test.ts` — every `(origin, confidence, resolution)`
  combination relevant to the frozen enums maps to the exact `{dash,
  muted}` documented in §10; specifically asserts `doc`/`git` origin ->
  `muted: true` regardless of confidence/resolution.
- `apps/viz/test/convexHull.test.ts` — known point set -> known hull
  vertices; 0/1/2-point inputs -> labeled circle fallback, never a thrown
  error.
- `apps/viz/test/ws-reconnect.test.ts` — simulated disconnect -> asserts
  backoff delays follow `500,1000,2000,4000,5000,5000` (fake timers);
  asserts `onReconnected` (which triggers the unconditional refetch) fires
  exactly once per successful reconnect, never on failed attempts.
- `apps/viz/test/states.test.tsx` — renders `EmptyLoadingStale` in each of
  the three states against mock data; asserts the loading state's text,
  the stale state's text (containing the literal `staleReason` value
  passed in), and the refreshing banner's text are all present and
  distinct from one another (no shared generic string across states).
- `apps/viz/test/mockServer.ts` — not itself a test file; the shared
  contract-shaped fixture module every other test imports, so there is
  exactly one source of "what the server contract looks like" inside this
  package's own test suite (avoids drift between test files).
- Offline-bundle / CSP-style assertion (integration, run against the real
  `vite build` output, not the mock): a script or test that reads every
  file under `apps/viz/dist/` and asserts no `http://`/`https://` literal
  points at a host other than `127.0.0.1`/`localhost`, and no `<script
  src=` or `<link href=` in `dist/index.html` references an absolute
  external URL.
- Package-map render smoke test: `PackageMapCanvas` mounts against mock
  fixture data (a handful of package nodes/edges/positions) without
  throwing, and unmounts cleanly (no leaked Sigma renderer instance —
  asserted via Sigma's own `kill()` call being invoked on unmount).
- Import-boundary lint check: `pnpm --filter apps/viz exec eslint .`
  confirms the `no-restricted-imports` rule is active by including one
  temporary/removed violating fixture during development (not shipped) —
  the acceptance criterion is that the rule exists and fires, verified
  once during the builder session and left in the config permanently.
- Existing repository-wide suite unaffected: `pnpm test` (Node packages)
  and `pnpm --filter apps/viz test` (browser package) are two separate
  invocations — neither's tests import the other.

## 14. Acceptance criteria

- [ ] `apps/viz` exists as a workspace member; `pnpm install` at the repo
      root succeeds with it present.
- [ ] `pnpm --filter apps/viz exec vite build` exits 0 and produces
      `apps/viz/dist/index.html` plus bundled JS/CSS assets.
- [ ] Offline-bundle assertion (grep over `dist/`) finds zero external-host
      URL literals.
- [ ] `pnpm --filter apps/viz exec eslint .` exits 0, and the
      `no-restricted-imports` rule for `@tadori/*`/`fs`/`better-sqlite3`
      is present in `apps/viz/eslint.config.js`.
- [ ] `pnpm --filter apps/viz test` passes: legend table, convex-hull cases,
      WS reconnect backoff/refetch, three named empty/loading/stale states,
      package-map mount/unmount smoke test.
- [ ] No file under `apps/viz/src` imports any `@tadori/*` package (grep
      confirms zero matches).
- [ ] Root `pnpm typecheck`/`pnpm test` (Node packages) remain green and
      unaffected (separate tsconfig means `apps/viz` is excluded from the
      root Node typecheck, per §9).
- [ ] Package labels are truncated at exactly 24 characters with an
      ellipsis when longer; verified by a unit test with a synthetic
      long package name.
- [ ] The provenance legend UI and the canvas edge renderer both call the
      same `edgeVisualStyle` function (verified by code inspection during
      review — no duplicated mapping logic).

## 15. Validation commands

pnpm install; pnpm skills:check; pnpm typecheck; pnpm lint; pnpm test;
pnpm --filter apps/viz exec tsc --noEmit; pnpm --filter apps/viz exec
eslint .; pnpm --filter apps/viz test; pnpm --filter apps/viz exec vite
build; python validate_fixtures.py; pnpm fixtures:validate; git diff
--check; git status --short

## 16. Performance budgets

- Package-map first paint (mock-data smoke test proxy for the real
  benchmark, since this blueprint has no live 07-01 server to measure
  against end-to-end): rendering 500 package nodes (the documented
  per-level cap, ARCHITECTURE.md §3 row 4) via `PackageMapCanvas` in a
  headless test environment must complete mount-to-rendered in **< 2 s**
  on the 250k-LOC benchmark-class machine — named benchmark script
  `apps/viz/bench/package-map-mount.bench.ts` (proposed; generates 500
  synthetic package nodes/edges/positions, times `buildGraphologyGraph` +
  Sigma mount, throws if `>= 2000`). This is a **component-level** proxy
  for the full "first paint < 2s on the 250k-LOC benchmark DB" budget that
  08-10 owns as the true end-to-end (server round-trip included) gate —
  this blueprint's script isolates the client-side portion so a regression
  here is caught before 08-10's integration-level measurement.
- Expansion interaction (package hover/select highlight) latency: not
  applicable to package-only rendering yet (no expand action exists until
  08-03) — this blueprint has no interaction budget of its own beyond
  render/mount timing above; 08-03 owns the first expand-latency budget.
- WS reconnect backoff must never exceed the documented 5000ms cap
  (asserted directly by the reconnect test in §13, not a separate
  benchmark).

## 17. Failure and recovery behavior

- Server unreachable at cold load: loading state persists with a "retrying"
  variant of the loading text (not indistinguishable from "waiting for
  first response" — see §12); no crash, no blank white screen.
- Malformed/unexpected JSON from an endpoint: `client.ts` wraps
  `JSON.parse`/schema-shape checks; a shape mismatch throws a typed
  `ApiClientError`, caught by the owning hook and surfaced as an error
  state (not silently rendered as an empty graph, which would be
  indistinguishable from "this repository truly has zero packages").
- WS message with an unrecognized `type` field: ignored (forward-compatible
  — a future server version may add event types this blueprint's client
  does not yet know; ignoring unknown types is safer than throwing).
- Interrupted `vite build` (e.g. disk full): standard Vite/Node failure
  exit code; no partial/corrupt `dist/` is treated as valid by 07-01's
  static-serving contract (07-01's own failure handling, out of this
  blueprint's scope, but this blueprint's build must fail loudly, exit
  non-zero, on any build error rather than emitting a partial bundle
  silently — default Vite behavior already satisfies this).
- Browser without WebSocket support (essentially none in-scope per A-004's
  browser matrix): out of scope; not handled specially.

## 18. Security and privacy

- Localhost-only consumption: this app assumes and never overrides the
  server's `127.0.0.1` binding; no hardcoded remote host ever appears in
  client code (enforced by the offline-bundle grep assertion, §13).
- No credentials, tokens, or cookies are read/sent by this app (no auth
  surface exists in the frozen local-only contract).
- No `dangerouslySetInnerHTML` or raw HTML injection from server-provided
  strings (node/edge display names are rendered as React text nodes,
  which auto-escape); this matters because `qualifiedName`/`displayName`
  values originate from arbitrary repository source code the user does not
  control the safety of.
- No path or file-system access from the browser bundle at all (AD-009);
  source-slice reading (07-01's `/api/v1/source`) is not called by this
  blueprint (owned by 08-06).

## 19. Accessibility

- This blueprint's own surface (loading/stale/refresh banners, legend
  toggle) must be keyboard-reachable (`tab`-focusable toggle button, no
  mouse-only interaction) and use semantic HTML (`<button>`, not a `<div
  onClick>`) for the legend toggle — minimum viable a11y for the pieces
  this blueprint ships, not the full audit.
- The Sigma canvas itself is **not** accessibility-complete in this
  blueprint (a `<canvas>`/WebGL surface has no native accessible
  structure) — the full accessible list/table alternative for graph
  content is explicitly owned by 08-11, per the task's framing ("owned by
  08-11 but data contracts prepared here"). This blueprint's contribution
  to that contract: `ApiNode`/`ApiEdge` (§10) are the exact typed shapes
  08-11's list/table alternative will consume — no additional
  accessibility-specific data shape is invented here.
- Full WCAG AA / screen-reader / focus-order audit is out of scope (08-11).

## 20. Documentation updates

`IMPLEMENTATION_STATUS.md` — dated entry for the new `apps/viz` workspace
member, its four new runtime dependencies (`react`, `react-dom`, `sigma`,
`graphology`) plus dev dependency `vite`, and the offline-bundle assertion
approach. No other existing documentation file is modified by this
blueprint.

## 21. Builder final report

Require: summary; files changed (full `apps/viz` tree); contracts
implemented (hand-ported types, `edgeVisualStyle`, WS reconnect contract);
tests added (names + count per §13 category); validation command output
summary; offline-bundle assertion result (files scanned, matches found —
must be zero); benchmark result (package-map mount time at 500-node
synthetic scale) against §16; commit SHA; known limitations (explicitly
including the package-hull circle-degeneration `ponytail:` note from §8);
follow-on risks (e.g. real end-to-end measurement against a live 07-01
server still pending); `ASSUMPTION:` lines for the label-truncation length
and any mock-vs-real-server integration gap.

## 22. Independent review result

Pending Wave 2 adversarial review.

## IF SOMETHING IS UNCLEAR

Make the smallest safe assumption, record `ASSUMPTION: ...` in the report,
continue without expanding scope. If 07-01's actual endpoints diverge from
the documented shapes in ARCHITECTURE.md §3 when real integration is
attempted, stop and report blocked — reconciling a live contract mismatch
is a cross-blueprint architecture question, not a builder judgment call. If
the L-sized scope proves genuinely too large for one session, split at the
seam named in §1 (offline scaffold + map + legend, then empty/stale-state
polish) rather than shipping a dishonest "done" on a partial state surface.

## TADORI NON-NEGOTIABLES

Frozen v2.1; TS/JS only; ATLAS separate; exactly six MCP tools; stable 2D
default (Sigma.js/WebGL); 2.5D optional; 3D experimental only; no city
metaphor; no default hairball; no generic admin dashboard or permanent dual
sidebars; progressive disclosure package → file → task-region symbols;
deterministic positions; every visible relation keeps evidence, origin,
confidence, resolution; unresolved stays visibly unresolved; static test
linkage is not runtime coverage; agent observation honesty; design rationale
only from ADRs/docs/instructions/explicit human input; hooks remain an
evidence receiver, never an orchestrator/runtime; invalid snapshots never
served; `tadori serve .` is the normal command; localhost default; no cloud
dependency; Graphify is ignored reference only — never import/copy/ship;
never weaken golden fixtures; no seventh tool; no runtime tracing.
