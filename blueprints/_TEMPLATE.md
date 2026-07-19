# GRAPH BLUEPRINT [ID]: [Title]

> This is an evidence dossier. The executable context is
> `blueprints/execution/[ID].md`. A builder reads this full file only for a
> linked unresolved contract or escalation.

## 1. Graph node

```yaml
id: [ID]
state: pending | drafting | review | ready | built | validated | blocked
phase: [phase]
risk: low | medium | high
complexity: S | M | L
predecessors: []
successors: []
reads: []
writes: []
produces: []
preserves: []
proofs: []
```

State the observable graph rewrite in two sentences: what nodes/edges exist
before and what becomes true after completion.

## 2. Contract neighborhood

Only the one-hop contracts required by this task:

- predecessor contract and exact exported symbol/API;
- owned output contract;
- frozen invariants preserved;
- explicitly rejected adjacent edges.

Separate `VERIFIED LIVE` facts from `HISTORICAL PLANNING EVIDENCE` and
`PROPOSED` items. Line numbers are hints, never preconditions.

## 3. Artifact ownership

| Artifact | Action | Ownership reason | Integration edge |
|---|---|---|---|
| path | create/modify/delete | responsibility | importer/export/barrel/wiring |

A one-hop wiring artifact omitted here may be added with a recorded reason.
Anything broader requires coordinator escalation.

## 4. Execution slices

Each slice contains at most three cohesive implementation steps and closes one
contract edge.

### Slice A — [contract edge]

- Reads:
- Writes:
- Implementation:
- Focused proof:
- Checkpoint condition:

Repeat only as needed. A coherent slice may be committed and pushed to the
draft PR before the full task is complete.

## 5. Proof graph

| Output/invariant | Proof node | Exact assertion | Risk class |
|---|---|---|---|

Use `GATE_GRAPH.md`. Focused proofs run per slice; independent validation and
the full local completion cut each run once.

## 6. Failure boundaries

Only conditions that stop this task:

- frozen-contract contradiction;
- absent predecessor contract;
- migration/schema mismatch with data-loss risk;
- inability to restore focused proofs without weakening an invariant;
- required credential or external platform unavailable.

Historical existence claims, line drift, and a necessary one-hop wiring change
do not stop the task.

## 7. Completion cut

Binary checklist:

- [ ] predecessor edges satisfied;
- [ ] promised output contracts exist;
- [ ] preserved invariants have proof;
- [ ] focused proof cut passes;
- [ ] independent validator passes;
- [ ] full local completion cut passes once;
- [ ] required CI passes;
- [ ] no blocker/high remains;
- [ ] branch owns only listed artifacts;
- [ ] INDEX and checkpoint updated;
- [ ] PR merged or task explicitly left as draft/WIP.

## 8. Delta report

Require only:

- graph rewrite completed;
- files changed;
- contracts produced/preserved;
- proof nodes and exact results;
- commit/PR/SHA;
- blocker/high findings and disposition;
- remaining medium/low risks;
- next unlocked node.

## Global invariants

Frozen v2.1; TS/JS only; exactly six MCP tools; stable 2D default; 2.5D/3D
experimental; no city metaphor or default hairball; progressive disclosure;
evidence/origin/confidence/resolution preserved; unresolved remains visible;
static test linkage is not runtime coverage; “not observed inspected” honesty;
hooks are evidence receivers only; invalid snapshots are never served;
localhost default; no cloud dependency; no seventh tool; no runtime tracing;
never weaken golden fixtures or frozen migrations.
