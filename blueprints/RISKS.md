# Tadori project-level risks (living register)

> **Execution note (2026-07-19):** This is a shared decision/evidence dossier. Planning-time existence claims and source line numbers may be stale. Use `TASK_GRAPH.json`, the current execution card, and live repository semantics for preflight. Open only the sections adjacent to the current contract edge.


Severity: H / M / L. Every risk names a mitigation owner (blueprint ID or
process rule). Dated entries; resolved risks move to the bottom with outcome.

- R-001 (H, 2026-07-17): **Docs/code drift.** IMPLEMENTATION_STATUS claimed
  "allowJs-gated JavaScript support" while scan.ts never gated JS — caught
  only by adversarial README command execution. Mitigation: every blueprint's
  acceptance criteria must be command-verifiable (template §14/§15); 00-01A
  fixes the instance.
- R-002 (H, 2026-07-17): **Remote topology divergence.** origin/main moved
  under the plan once already (PR merges vs fast-forward assumption).
  Mitigation: blueprints assert exact SHAs before ref operations and stop on
  mismatch (00-01 pattern); Program Manager re-verifies branch state at each
  wave start.
- R-003 (M, 2026-07-17): **better-sqlite3 ABI / Node pinning in CI.** Global
  Node 25 cannot build it; CI must use `.npmrc` pin + prebuilds on Linux and
  Windows runners. Owner: 00-02.
- R-004 (M, 2026-07-17): **WebGL/GPU nondeterminism.** Frozen layout must be
  byte-identical across reloads and machines; rendering may not be. Budget
  and assertions must target position data, not pixels. Owner: 08-01, 08-10.
- R-005 (M, 2026-07-17): **New-dependency risk (sigma/graphology/fastify/
  react/vite versions).** Version pinning + lockfile discipline + offline
  bundle requirement (no CDN). Owner: 07-01, 08-02.
- R-006 (M, 2026-07-17): **Competitor irreproducibility** (codebase-memory-mcp,
  codegraph install/behavior may be unstable or ambiguous). A failed install
  is a recorded result, never fabricated output. Owner: 11-03 + R-02 research.
- R-007 (M, 2026-07-17): **Canvas accessibility.** WebGL canvas is opaque to
  screen readers; the accessible list/outline fallback must be a real,
  data-complete alternative, not a stub. Owner: 08-11.
- R-008 (M, 2026-07-17): **Single-machine performance evidence.** All gates
  measured on one Windows box; CI Linux numbers will differ. Budgets must
  state machine class; CI gates get separate thresholds. Owner: 00-02, 08-10,
  11-01.
- R-009 (L, 2026-07-17): **Migration 007 (layout) coupling.** Additive only;
  must not alter frozen 001–006 semantics or snapshot identity. Owner: 08-01.
- R-010 (M, 2026-07-17): **Human-study integrity.** Depth-study and pilot
  artifacts must never fabricate or auto-execute participant results;
  infrastructure + protocol docs only. Owner: 10-03, 12-05.
- R-011 (M, 2026-07-17): **Scope creep via visualization enthusiasm.** The
  spatial-atlas direction is not permission for decoration; every encoding
  maps to a named graph property or interaction state. Spec Guardian reviews
  every Phase 8/8B/10 blueprint. Owner: process rule.
- R-012 (L, 2026-07-17): **GateGuard/hook friction** on file creation in this
  environment (first-write denials requiring fact restatement). Builders
  should expect and retry; not a product risk.
