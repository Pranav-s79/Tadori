# Tadori

## What Tadori is

Tadori builds one provenance-typed graph for mixed-language repositories —
projects, files, symbols, interfaces, routes, tests, and documents, where every edge
carries its origin, confidence, resolution, and file:line evidence. Agents
consume the graph through a frozen six-tool MCP context interface; a local
visual supervision layer (`tadori serve .`) serves that graph over a
`127.0.0.1`-only HTTP/WebSocket surface to a 2D visualization app. Tadori is
local-first: indexing, serving, and visualization run entirely on your machine,
with no cloud dependency and no external runtime fetch.

Production packaging and local deployment are documented in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Status

The active contract is the multi-language transition specification. TypeScript
and JavaScript retain compiler-backed semantic extraction; Python, C, C++, Go,
Rust, and Java use pinned WASM structural parsers; Proto, Terraform, YAML,
Dockerfile, Markdown, JSON, shell/Make, TOML, and CMake use deterministic
repository/interface extraction. Unknown safe text remains visible at repository level.

- All five golden fixtures compare exactly — zero missing, unexpected, or
  mismatched nodes and edges.
- Phase 7 `tadori serve .` local server (graph/layout/search/source/inspection
  HTTP APIs + WebSocket refresh) is merged and validated.
- Phase 8 visualization (`apps/viz`): deterministic server-owned layout, guided
  package→file→symbol zoom, shared search/filter state, camera focus,
  inspection/evidence panels, and an accessible table peer.
- Phase 9 review surfaces: `GET /api/v1/review/diff` compares two snapshots, or
  the live working tree / git index against the active snapshot
  (`kind=snapshot|working_tree|staged`), with pagination, omission accounting,
  honest errors, and stable-coordinate on-map diff and boundary overlays.

The legacy TS/JS fixtures remain compatibility coverage, not a product-scope limit.
See `docs/MULTILANGUAGE_CAPABILITIES.json` for precise per-feature support.

## Quick start

### Supported Node.js

Tadori supports the maintained LTS lines: **Node 24 (prioritized)**, **Node 26**,
and **Node 22** (`engines.node` is `>=22`). Node 25 and other non-LTS /
out-of-maintenance releases are not supported. `better-sqlite3` (>=12) ships
prebuilt binaries for all three on Windows, Linux, and macOS, so a normal
install never source-builds native dependencies. Local dev pins Node 24.18.0
via `.npmrc` (pnpm) and `.nvmrc`; run `nvm use` to match. CI runs the full gate
on Ubuntu × {Node 22, 24, 26} and Windows × Node 22.

> **Known limitation — Windows + Node ≥ 24:** the repository file watcher uses
> recursive `fs.watch`, and Node 24/26 on Windows currently abort inside libuv
> (`Assertion failed: !_wcsnicmp, src\win\fs-event.c:72`) — an upstream
> Node/libuv regression, not a Tadori or `better-sqlite3` issue (the native
> binding loads on every combination). On Windows, use **Node 22** until the
> upstream fix ships. Node 24/26 are fully supported on Linux and macOS.

```bash
pnpm install
```

Installs workspace dependencies.

```bash
pnpm test
```

Runs the full Vitest suite.

```bash
pnpm tadori diff .
```

Captures and publishes a working-tree snapshot of this repository, then
reports the graph diff against the previous head.

```bash
pnpm tadori serve .
```

Indexes the repository and starts the local `127.0.0.1`-only server (graph,
layout, search, source, inspection, and review-diff APIs plus a WebSocket
refresh channel) that the `apps/viz` visualization consumes.

```bash
pnpm tadori purge .
```

Removes only the repository's local `.tadori` index after confinement checks;
source files are never removed.

```bash
pnpm mcp:stdio --db .tadori/tadori.sqlite --repo .
```

Starts the six-tool MCP server over stdio against an existing snapshot
database (created by `pnpm tadori diff .` above). This is a long-running
server: it serves MCP protocol on stdout and shuts down cleanly when stdin
closes or on Ctrl+C.

## Architecture

Workspace packages:

| Package | Purpose |
|---|---|
| `packages/core` | Frozen enums, Zod graph schemas, canonical pipe-delimited identities, SHA-256 entity keys |
| `packages/store` | SQLite store: frozen migrations, transactional snapshots, integrity validation, three-way diff, pruning, orphan GC |
| `packages/indexer` | Language registry and adapters: TS/JS semantics, pinned WASM structural parsing, repository/interface extraction, incremental refresh |
| `packages/harness` | Golden-fixture validation, indexing comparison, and fixture typecheck CLIs |
| `packages/mcp` | The frozen six-tool MCP interface: snapshot queries, FTS5 search, explainable ranking, budgeting, stdio transport |
| `packages/server` | `127.0.0.1`-only HTTP/WebSocket product surface: graph, layout, search, source, inspection, and review-diff APIs |
| `packages/cli` | `tadori` CLI: `diff` (snapshot + edge diff), `serve` (local server), and `purge` (confined local-index deletion) |
| `apps/viz` | Local 2D visualization app consuming the server over HTTP/WS (no `@tadori/*` import; offline bundle) |

`packages/fixtures/` is the golden-fixture corpus — it is a fixture data
directory, not a workspace package (absent from `pnpm-workspace.yaml`); see
`packages/fixtures/README.md`.

`packages/bench` contains deterministic mixed-language and external-validation manifests.

## Active contracts

- Exactly six MCP tools: `repo_overview`, `find_symbol`, `symbol_context`,
  `find_tests`, `impact`, `path`. No seventh tool.
- Legacy golden fixtures remain byte-stable compatibility checks.
- The sole governing specification is
  `docs/Specs/Tadori-Multilanguage-Transition.md`; superseded contracts are not
  product, schema, or scope authorities.

## Roadmap

Remaining work is tracked in `BACKLOG.md` (phase backlog) and
`blueprints/INDEX.md` (per-item build blueprints).

## Development

![CI](https://github.com/Pranav-s79/Tadori/actions/workflows/ci.yml/badge.svg)

| Command | Purpose |
|---|---|
| `pnpm typecheck` | Strict TypeScript across the workspace |
| `pnpm lint` | ESLint (flat config, `no-explicit-any` as error) |
| `pnpm test` | Full Vitest suite |
| `pnpm fixtures:validate` | Validate fixture schemas, hashes, and evidence anchors |
| `pnpm fixtures:index` | Index all five fixtures and compare against expected graphs |
| `pnpm fixtures:typecheck` | `tsc --noEmit` over the five fixture repositories |
| `python validate_fixtures.py` | Python reference validator for the fixture artifact |
| `pnpm skills:sync` | Sync canonical agent skills into `.claude/` and `.agents/` |
| `pnpm skills:check` | Verify synced skills are byte-identical to canonical |
| `pnpm benchmark:incremental` | Incremental-indexing latency and memory gates |
| `pnpm tadori diff .` | Snapshot the working tree and diff against the previous head |
| `pnpm tadori serve .` | Build/refresh the index and open the localhost visualization |
| `pnpm tadori purge .` | Remove only the confined local `.tadori` index |
| `pnpm package:artifact` | Build the offline visualization and installable package artifact |
| `pnpm mcp:stdio --db .tadori/tadori.sqlite --repo .` | Six-tool MCP server over stdio |
