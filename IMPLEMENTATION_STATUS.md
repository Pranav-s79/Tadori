# Tadori status

Last updated 2026-09-24. Earlier detail lives in git history.

## What works

- **Indexer** (`packages/indexer`): multi-language registry. TS/JS semantic
  extraction; Python, C, C++, Go, Rust and Java structural parsing; repository
  and interface files (Protocol Buffers, JSON, YAML, Markdown, Dockerfile,
  Terraform, TOML, Make/CMake, shell). Incremental refresh, git co-change edges,
  persisted extraction diagnostics. Declared support lives in
  `docs/MULTILANGUAGE_CAPABILITIES.json`, which the CLI validates at startup.
- **Store** (`packages/store`): SQLite snapshots, diffs, rename/move coalescing,
  pruning.
- **Server and CLI** (`packages/server`, `packages/cli`): `tadori serve | diff |
  purge` on 127.0.0.1, with graph, layout, search, source, story, review-diff,
  regions, analysis and capability APIs.
- **MCP** (`packages/mcp`): six tools (`repo_overview`, `find_symbol`,
  `symbol_context`, `find_tests`, `impact`, `path`) over stdio.
- **App** (`apps/viz`): six workspaces (Overview, Atlas, Interview, Story,
  Changes, Table) in the "excavation plate" style, with self-hosted IBM Plex.
  The Atlas has Plan, Tilt (2.5D) and Relief projections. Table is the
  accessible peer view.
- **Tests**: `pnpm test` runs the package suites (including the golden-fixture
  comparisons in `packages/harness` against `packages/fixtures`), the CLI
  suites and the app suite. CI runs typecheck, lint and tests on Ubuntu.

## In flight

- PR #78: Story lists routes in place; Changes compares a real snapshot pair;
  real plurals.
- Branch `polish/atlas`: a repository's only package opens on landing; map
  labels stop colliding. The Tilt stem work is parked on `wip/atlas-tilt-stems`,
  superseded by the 3D Atlas below.

## Next

1. `pnpm view`: a development CLI that serves a repository, drives headless
   Chrome to any view, and writes a screenshot plus a JSON of what is on screen,
   so UI work can be checked without a person.
2. A real 3D Atlas (three.js) that replaces Tilt: packages as plates, files and
   symbols stacked above by level, with an orbit camera. Plan and Table stay.
3. A simpler layout: empty the crowded left bar by moving search to the top,
   folding Routes, Tests and Docs into the modes that use them, and moving
   analysis into Overview.

## Known gaps

- The generated package is `UNLICENSED`; a public npm release needs an owner
  decision.
- The main JS bundle is just over Vite's 500 kB warning.
