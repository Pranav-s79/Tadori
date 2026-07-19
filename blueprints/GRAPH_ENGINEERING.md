# Tadori graph-engineering execution model

This directory uses a **graph-first** operating model for human and agent work.
The long blueprint files remain evidence dossiers, but they are no longer the
unit an agent must load into context. The executable unit is a small graph node
with explicit incoming contracts, outgoing artifacts, invariants, and proof.

## 1. Why the old loop was expensive

The earlier workflow treated each blueprint as a long sequential conversation:
read 30–50k characters, re-verify old evidence, implement 10–18 steps, run a
large gate repeatedly, request an adversarial review, correct every finding,
re-review, update several status documents, then finally commit. That produced
four predictable failure modes:

1. **Context inflation** — a single worker often loaded a blueprint,
   ARCHITECTURE, ASSUMPTIONS, RISKS, dependency blueprints, source, and test
   output. The task crossed 100k context before implementation was complete.
2. **Stale-evidence traps** — planning-time statements such as “package X does
   not exist” remained in dossiers after X shipped. Builders interpreted
   historical evidence as a current blocker and repeated repository archaeology.
3. **Validation amplification** — focused tests, full tests, fixture gates,
   independent validation, adversarial review, correction, re-review, and CI
   repeatedly proved the same edges.
4. **Oversized work nodes** — one blueprint could modify ten or more files and
   establish several contracts, yet was labelled “one focused session.” A usage
   cutoff near the end left a large uncommitted frontier.

## 2. Core graph model

Treat delivery as a typed directed graph:

- **Task node** — one blueprint ID.
- **Artifact node** — a source file, schema, migration, generated asset, or doc.
- **Contract node** — API, CLI, DB, event, or UI behavior that other tasks rely on.
- **Invariant node** — a frozen property that must remain true.
- **Proof node** — a focused test, benchmark, fixture comparison, CI job, or
  review finding with observable output.
- **Decision node** — a resolved architecture choice. Decisions are immutable
  during a task unless source evidence proves the node is invalid.

Edges use these meanings:

- `depends_on`: task cannot publish before predecessor contracts exist.
- `reads`: minimum artifact neighborhood needed to act.
- `writes`: artifacts owned by the task.
- `produces`: new contract or capability.
- `preserves`: invariant that must remain true.
- `proved_by`: proof nodes sufficient for completion.
- `unlocks`: downstream task frontier.

The project advances by applying a **small graph rewrite** at the current
frontier, not by replaying a long reasoning loop.

## 3. Context-neighborhood rule

An agent reads only the one-hop neighborhood required by its role:

- Coordinator: task card + task graph + checkpoint.
- Writer: task card + directly owned files + direct contract definitions.
- Validator: task card + final diff + named proof nodes.
- Architecture reviewer: only the disputed contract node and adjacent edges.

The verbose dossier is opened section-by-section only when an execution card
links to an unresolved detail. “Read the entire blueprint” is prohibited by
default.

Recommended context budgets:

- Mechanical preflight: <= 8k tokens.
- Writer: <= 30k tokens before compacting or checkpointing.
- Validator: <= 20k tokens.
- Architecture escalation: <= 25k tokens.

## 4. Frontier and slice execution

Each task card divides the ordered procedure into **slices** of at most three
cohesive steps. A slice should create one observable contract edge and its
focused proof.

For every slice:

1. Load only the slice neighborhood.
2. Implement the graph rewrite.
3. Run the named focused proof.
4. Record a concise checkpoint.
5. Continue to the next slice without a new review loop.

A local checkpoint commit is allowed after a coherent slice. The task branch is
pushed after the first coherent checkpoint and after each later checkpoint when
usage is at risk. The PR remains draft until the task completion cut is proven.

## 5. Proof policy

Proof is risk-weighted and non-duplicative:

- Focused tests run while writing.
- The validator runs the task-specific proof cut once after the final slice.
- The repository-wide local gate runs once before the completion commit.
- CI is the second independent platform proof.
- A separate architecture reviewer is used only for high-risk contract nodes.
- A re-review occurs only when a correction changes the disputed high-risk edge.
- Medium/low findings do not trigger another agent unless they threaten a frozen
  invariant, correctness, security, data loss, or the next task.

Do not run `pnpm install`, all fixture gates, all browser gates, and all
benchmarks for every task. Use `GATE_GRAPH.md` to select the minimal proof cut;
the full repository cut still runs once before completion.

## 6. Evidence freshness

Planning-time evidence is historical. At preflight:

- Verify existence and exported names with targeted commands.
- Semantic drift in line numbers is not a blocker.
- A stale “does not exist yet” statement is replaced by live repository truth.
- Stop only for a frozen-contract conflict, schema/migration mismatch, unsafe
  data-loss condition, or a prerequisite contract that truly is absent.

Update the execution card or checkpoint with the delta. Do not rewrite the
entire dossier.

## 7. Ownership and parallelism

Only one writer may own an artifact node at a time. Parallel work is allowed
only when two frontier tasks have disjoint `writes` sets and no shared contract
or migration edge. Use separate worktrees. Validation and next-task preflight
may run in parallel with coding because they are read-only.

## 8. Completion cut

A task is complete when this graph cut is closed:

- all predecessor edges are satisfied;
- every promised output contract exists;
- every preserved invariant has a proof node;
- focused proofs pass;
- one full local gate passes;
- required CI passes;
- no blocker/high finding remains;
- the branch and PR contain only owned artifacts;
- INDEX and checkpoint reflect the observed state.

Completion closes the node and exposes its `unlocks` immediately. The
coordinator then selects the next ready frontier node without returning to the
user.
