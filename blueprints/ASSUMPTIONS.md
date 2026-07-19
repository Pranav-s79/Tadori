# Tadori planning assumptions (living register)

> **Execution note (2026-07-19):** This is a shared decision/evidence dossier. Planning-time existence claims and source line numbers may be stale. Use `TASK_GRAPH.json`, the current execution card, and live repository semantics for preflight. Open only the sections adjacent to the current contract edge.


Every assumption is dated, owned, and either CONFIRMED (by whom/what) or OPEN.
Builders must not silently contradict an entry; a conflicting discovery is
reported back and this file is updated.

## Process / repository

- A-001 (2026-07-17, CONFIRMED by owner message): `origin/main` advances only
  via owner-merged GitHub PRs ("option a"). No local pushes of `main`; sprint
  branches are pushed under the 2026-07-15 authorization once 00-01 unblocks.
  Never force-push; no tags/releases.
- A-002 (2026-07-17, CONFIRMED by `.npmrc`): all Node tooling runs through
  pnpm with `use-node-version=22.14.0`; the machine-global Node 25 cannot
  build better-sqlite3. CI must pin Node 22.
- A-003 (2026-07-17, CONFIRMED by BACKLOG locked decisions): runtime deps
  allowed = react, sigma, graphology, fastify, simple-git (+ R3F behind
  experiment flag only) + minimal tooling (Vite). Anything else is justified
  in-blueprint and reviewed before addition.
- A-004 (2026-07-17, CONFIRMED): Windows is the primary dev/test OS; Linux in
  CI; macOS full pilot smoke before RC. Chromium full; Firefox critical-flow
  smoke; Safari basic smoke when macOS available.
- A-005 (2026-07-17, OPEN): the identifier `00-01A` for the scanner-defect
  corrective blueprint does not conflict with any real index row (verified
  against blueprints/INDEX.md today; re-verify before merge).
- A-006 (2026-07-17, CONFIRMED by this session's diagnosis): the allowJs
  scanner defect is real and reproducible (`pnpm tadori diff .` crashes on
  Tadori's own repo, "Could not find source file: eslint.config.js").
  IMPLEMENTATION_STATUS.md already documents "allowJs-gated JavaScript
  support", so gating the scan is conformance to documented behavior, not a
  scope change.
- A-007 (2026-07-17, OPEN): during this planning run no production code is
  implemented, nothing is pushed/merged/tagged; planning-vault commits are
  local only.

## Product / architecture (validated during Step 2 architecture pass)

- A-101 (2026-07-17, CONFIRMED-AMENDED by ARCHITECTURE.md AD-002):
  `packages/server` reuses `GraphService` (packages/mcp/src/service.ts —
  verified free of MCP-protocol dependencies) in place; no extraction into a
  new shared package; the six-tool MCP surface is untouched.
- A-102 (2026-07-17, REFUTED as written; corrected by ARCHITECTURE.md
  AD-005/AD-006 + C-1): there is NO migration 007. Frozen migration 004
  already defines `layout_positions`
  (packages/store/src/migrations.ts:442-458: repo_id, abstraction_level
  package|file|symbol, view_key, node_id, x/y/z, pinned, anchor_group,
  layout_version, last_snapshot_id) and is unused by production code today.
  Phase 8 populates this existing frozen table; no schema change.
- A-106 (2026-07-17, CONFIRMED by ARCHITECTURE.md C-2 + source): the
  observation store already exists — migration 003 `agent_events`
  (migrations.ts:358) + `EventLog` (packages/mcp/src/events.ts:65) with
  honesty invariants. `packages/hooks` feeds it via the server; it defines
  no new schema.
- A-103 (2026-07-17, CONFIRMED by docs/CLI_CONTRACT.md): the serve contract
  (behavior order, frozen flags, 2d default, 127.0.0.1) is frozen; blueprints
  refine implementation, never the contract.
- A-104 (2026-07-17, CONFIRMED by BACKLOG): `packages/hooks` is a narrow
  evidence receiver for observable agent events; it is not an orchestrator,
  agent runtime, workflow system, memory platform, or multi-agent framework.
- A-105 (2026-07-17, OPEN): Guided Explore is deterministic, offline,
  reproducible, evidence-backed; LLM narration is deferred and no blueprint
  may require an LLM at runtime.
