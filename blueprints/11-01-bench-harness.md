---
graph_blueprint_version: 1
node_id: 11-01
state: in-progress
phase: 11
risk: medium
complexity: M
predecessors: [00-02]
successors: [11-02]
execution_card: blueprints/execution/11-01.md
dossier: blueprints/11-01-bench-harness.md
read_policy: execution-card-first
local_full_gate_budget: 1
independent_validation_budget: 1
architecture_review: on-demand-only
---

> **GRAPH EXECUTION MODE:** Read the execution card first. Planning-time line numbers are historical hints; live repository semantics win.

# BLUEPRINT 11-01: `packages/bench` harness

## 1. Header

- ID / Title / Phase: 11-01 — `packages/bench` harness — Phase 11
- Status: in-progress (harness core delivered; 11-02 adds corpora/tasks)
- Depends on: 00-02 (CI pipeline / package conventions).

## 2. Scope (BACKLOG row 11-01)

Task runner, per-run raw logs, metrics capture (success, regressions, files inspected, boundary violations, unsupported claims, tokens where observable, wall time), reproducible seeds. This slice delivers the **harness core** — the metrics model, the seeded run recorder, and the suite aggregate — that 11-02's tasks/corpora plug into. The task RUNNER that executes agents against seeded repos is 11-02's concern; 11-01 is the recorder/metrics those runs produce and roll up.

## 3. Design (industry standards)

- **Metrics are a validated, frozen contract.** `benchRunMetricsSchema` (Zod, `.strict()`) — every field is an OBSERVED non-negative measurement, nothing inferred. `tokens` is nullable because token usage is only capturable "where observable"; null means "not observed", never zero. `finalize()` parses through the schema, so a malformed metric can never enter a result set.
- **Reproducible seeds.** `SeededRandom` (FNV-1a seed hash → mulberry32) is deterministic: same seed string ⇒ same sequence. A run is reproducible from its seed alone. `RunRecorder` is constructed with `(taskId, seed)` and exposes a seeded `random`.
- **Raw logs are the audit trail.** `RunRecorder.record()` captures lines verbatim, in order; `finalize()` embeds them in the `BenchRunResult` — never summarized.
- **Honest aggregation.** `summarizeRuns()` sums counts and computes `successRate`; `tokensTotal` is poisoned to `null` if ANY run did not observe tokens (a partial sum would misrepresent cost). An empty set yields a zeroed summary, never NaN. Order-independent (commutative reductions).
- **Package conventions.** `@tadori/bench` mirrors sibling packages: `type:module`, `main`/`types` → `src/index.ts`, `.js` import extensions (NodeNext), added to `pnpm-workspace.yaml`, root `tsconfig.json` include, and the `vitest.config.ts` alias.

## 4. Artifact ownership

| Artifact | Action | Reason |
|---|---|---|
| `packages/bench/package.json` | create | `@tadori/bench` manifest |
| `packages/bench/src/metrics.ts` | create | `benchRunMetricsSchema` / `benchRunResultSchema` |
| `packages/bench/src/recorder.ts` | create | `SeededRandom` + `RunRecorder` |
| `packages/bench/src/aggregate.ts` | create | `summarizeRuns` → `BenchSuiteSummary` |
| `packages/bench/src/index.ts` | create | barrel |
| `packages/bench/test/bench.test.ts` | create | schema + seed reproducibility + recorder + aggregate |
| `pnpm-workspace.yaml`, `tsconfig.json`, `vitest.config.ts` | modify | register the package in workspace/typecheck/test |

## 5. Proof cut

- `bench.test` (13): metrics schema accepts/rejects (negative, fractional tokens, extra field); seeded reproducibility (same seed ⇒ same sequence; different seeds differ; nextInt bounds); recorder verbatim log + validated finalize + empty-arg rejection + out-of-contract throw; aggregate success rate/sums, token-null poisoning, all-observed sum, empty-set no-NaN.
- Verified end-to-end LOCALLY (pure TS, no SQLite): tsc + eslint + 13/13.
