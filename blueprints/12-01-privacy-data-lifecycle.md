---
graph_blueprint_version: 1
node_id: 12-01
state: in-progress
phase: 12
risk: medium
complexity: M
predecessors: [07-02]
successors: []
execution_card: blueprints/execution/12-01.md
dossier: blueprints/12-01-privacy-data-lifecycle.md
read_policy: execution-card-first
local_full_gate_budget: 1
independent_validation_budget: 1
architecture_review: on-demand-only
---

> **GRAPH EXECUTION MODE:** Read the execution card first. Planning-time line numbers are historical hints; live repository semantics win.

# BLUEPRINT 12-01: Privacy & data lifecycle

## 1. Header

- ID / Title / Phase: 12-01 — Privacy & data lifecycle — Phase 12
- Status: in-progress (delivered in slices)
- Depends on: 07-02 (`tadori serve` CLI + the `<repo>/.tadori/` data directory).

## 2. Scope (BACKLOG row 12-01)

Redaction, ignore rules, retention, **purge command**, **repository-root confinement audit**. Delivered as focused slices, each its own PR:

- **Slice 1 (this PR): `tadori purge` + confinement audit.** Delete a repository's local `.tadori` data directory, with a real-path confinement audit that defeats symlink escape. This is the data-lifecycle "delete my local index" operation and the confinement-audit primitive the other slices reuse.
- Slice 2 (later): retention policy / age-based pruning of `agent_events`/snapshots.
- Slice 3 (later): ignore-rule enforcement audit (`.tadoriignore`) + redaction of sensitive paths from served output.

## 3. Slice 1 — SWE + security design

VERIFIED LIVE:
- Local data lives at `<repo>/.tadori/` — `tadori.sqlite` (the DB) and `progress.json` (tour state). (`packages/cli/src/serve.ts:147`.)
- The CLI entry dispatches subcommands in `main` (`packages/cli/src/cli.ts`); `resolveRepoRoot` validates and absolutizes a repo path (`packages/cli/src/repoResolve.ts`).

Design decisions:
- **Confinement audit is the security core.** `confinedRealPath(target, root)` resolves BOTH paths through `realpathSync` before comparing, so a `.tadori` symlinked outside the repository is detected and refused — the purge deletes only a real descendant of the repository root. A planted symlink can never cause deletion outside the repo. This same primitive is reusable by later ignore/redaction slices.
- **Idempotent + fails safe.** No `.tadori` → "nothing to purge", exit 0. Any confinement failure → refuse, delete nothing, exit `5`. `rmSync` only after a directory `statSync` check (defense in depth — never recursive-remove a non-directory).
- **Least privilege / bounded blast radius.** Only `<root>/.tadori` is ever a deletion target; the repository and its source are never touched. Deterministic, synchronous, no network.
- **Testable by construction.** `runPurge(argv, deps)` injects stdout/stderr; exit codes mirror `serve.ts`.

## 4. Artifact ownership (slice 1)

| Artifact | Action | Reason |
|---|---|---|
| `packages/cli/src/purge.ts` | create | `runPurge` + `confinedRealPath` |
| `packages/cli/test/purge.test.ts` | create | happy/idempotent/unsupported + SECURITY symlink-escape + confinement unit |
| `packages/cli/src/cli.ts` | modify | dispatch the `purge` subcommand |

## 5. Proof cut (slice 1)

- `purge.test.ts`: deletes `.tadori` (repo untouched); idempotent no-op; missing arg / unsupported repo rejected; **SECURITY** — a `.tadori` symlink to an outside dir is refused and the outside sentinel survives; `confinedRealPath` accepts a descendant, rejects root/absent/outside.
- Manual E2E: `tadori purge <repo>` on a real temp repo deletes `.tadori`, second run is a clean no-op, unknown command prints usage.
- One local gate: root typecheck + cli vitest (the filesystem tests run without SQLite).
