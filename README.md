# Tadori

## What Tadori is

Tadori builds a provenance-typed graph of a TypeScript/JavaScript repository —
packages, files, symbols, routes, tests, and ADR documents, where every edge
carries its origin, confidence, resolution, and file:line evidence. Agents
consume the graph through a frozen six-tool MCP context interface; a local
visual supervision layer (`tadori serve .`) is the next milestone. Tadori is
local-first: indexing and serving run entirely on your machine, the
forthcoming visualization binds to `127.0.0.1` only, and there is no cloud
dependency.

## Status

Weeks 1–6 of the frozen v2.1 roadmap are complete and validated:

- 170/170 tests across 24 files pass.
- All five golden fixtures compare exactly — zero missing, unexpected, or
  mismatched nodes and edges.
- Incremental refresh gates met: single-file refresh p95 1257.685 ms
  (< 2000 ms gate) on a 250,330-LOC corpus.

Next phase: local serving and 2D visualization (`tadori serve .`; contract in
`docs/CLI_CONTRACT.md`).

## Quick start

```bash
pnpm install
```

Installs workspace dependencies (`.npmrc` pins Node 22.14.0 via pnpm).

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
| `packages/indexer` | TypeScript LanguageService driver: repository scan, semantic extraction, incremental refresh, native watching |
| `packages/harness` | Golden-fixture validation, indexing comparison, and fixture typecheck CLIs |
| `packages/mcp` | The frozen six-tool MCP interface: snapshot queries, FTS5 search, explainable ranking, budgeting, stdio transport |

`packages/fixtures/` is the golden-fixture corpus — it is a fixture data
directory, not a workspace package (absent from `pnpm-workspace.yaml`); see
`packages/fixtures/README.md`.

Planned, not yet built: `packages/cli`, `packages/server`, `apps/viz`,
`packages/hooks`, `packages/bench`.

## Frozen contracts

- Exactly six MCP tools: `repo_overview`, `find_symbol`, `symbol_context`,
  `find_tests`, `impact`, `path`. No seventh tool.
- The golden fixtures are authoritative and are never weakened.
- Specifications live in `docs/Specs/` (frozen v2.1 specification,
  corrections, and golden-fixture spec); the serve-command contract is
  `docs/CLI_CONTRACT.md`.

## Roadmap

Remaining work is tracked in `BACKLOG.md` (phase backlog) and
`blueprints/INDEX.md` (per-item build blueprints).

## Development

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
| `pnpm mcp:stdio --db .tadori/tadori.sqlite --repo .` | Six-tool MCP server over stdio |
