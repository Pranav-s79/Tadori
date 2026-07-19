# Tadori validation gate graph

Select proof nodes from the changed artifact neighborhood. Focused gates run
during implementation; the full local completion cut runs once before the
completion commit. CI supplies the independent Windows/Linux cut.

## Always-required completion proof

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `git diff --check`

Run `pnpm install --frozen-lockfile` only when dependencies or the lockfile
changed, or when the workspace is not installed. Do not reinstall for every
slice.

## Artifact-to-proof edges

| Changed neighborhood | Focused proof nodes | Additional completion proof |
|---|---|---|
| `packages/core/**` | core tests for changed types/enums/identity | fixture validation and fixture typecheck |
| `packages/store/**` or migrations | store tests, migration/integrity tests | all fixture gates; crash/integrity tests named by blueprint |
| `packages/indexer/**` | affected indexer tests | `fixtures:validate`, `fixtures:index`, `fixtures:typecheck`; incremental benchmark only when indexing/refresh semantics changed |
| `packages/mcp/**` | affected MCP/service tests | stdio purity/recovery only when stdio changed; fixture gates when retrieval semantics changed |
| `packages/server/**` | server route/service/WebSocket tests | server integration/performance tests named by blueprint; fixture gates only when graph semantics changed |
| `packages/cli/**` or `scripts/tadori.mts` | CLI parser/lifecycle tests | manual smoke only when lifecycle cannot be automated; packaging only when package metadata changed |
| `packages/hooks/**` | hook client/log/script tests | event-schema parity and size/truncation checks |
| `apps/viz/**` | component/store/pure-render tests | browser/a11y only for user-flow, keyboard, rendering, or accessibility changes |
| `e2e/**` / Playwright | named browser specs | browser matrix required by the owning blueprint |
| `schemas/**` or golden fixtures | schema/fixture-specific tests | all fixture gates; no weakening or unexplained expectation delta |
| dependency/workspace files | package build/typecheck | frozen-lockfile install on clean temp workspace when packaging behavior changed |
| docs/planning only | `git diff --check` and targeted link/path checks | no full 200+ test suite unless docs drive generated code |
| benchmark scripts/budgets | benchmark unit tests + one representative run | recorded environment and raw output; budget changes need explicit evidence |

## Review escalation edges

A separate architecture reviewer is required only when the diff touches:

- a frozen migration or persisted data meaning;
- public HTTP/WS/MCP/CLI contract compatibility;
- snapshot publication, concurrency, crash recovery, or watcher lifecycle;
- path confinement, privacy, purge, or untrusted payload handling;
- raw-vs-derived review truth semantics;
- packaging/release boundaries;
- default 2D vs experimental rendering isolation.

For other diffs, the independent validator is the sole review node.

## Prohibited proof shortcuts

- Do not delete or weaken a golden fixture.
- Do not increase a budget merely because a test is red; provide measurements
  and a decision node.
- Do not convert a deterministic assertion to a snapshot or broad truthy check
  without a contract reason.
- Do not call static test linkage runtime coverage.
- Do not infer successful inspection from missing or partial agent events.
