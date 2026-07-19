# Blueprint friction and vulnerability audit

Date: 2026-07-19

This audit explains why Fable/Sol sessions consumed large usage windows while
finishing only one task. It is an execution-system audit, not a criticism of
the implementation quality.

## Critical friction

### F-01 — Mandatory full-dossier reads

`BUILDER_HANDOFF.md` required a cold builder to read an entire blueprint and
then inspect shared architecture and dependency material. Existing dossiers
range from roughly 14k to 53k characters, with many between 30k and 45k.
Before source and test output, a worker could already carry a very large
context.

**Mitigation:** execution cards are now the default context. Dossiers are
on-demand references.

### F-02 — Historical facts masquerading as live preconditions

Multiple dossiers still say `packages/server`, `packages/cli`, or `apps/viz`
do not exist. INDEX now records Phase 7 as validated, so these statements are
historical. The previous handoff instructed builders to stop when evidence did
not match, turning successful prior work into a blocker.

**Mitigation:** live source and INDEX outrank planning-time existence claims;
line drift and historical non-existence claims are not stop conditions.

### F-03 — Stale checkpoint has contradictory world state

`AUTONOMOUS_RUN_CHECKPOINT.md` simultaneously described Phase 7 as merged and
07-01 as an untracked local implementation. A resumed coordinator could redo
completed work or spend context reconciling contradictory state.

**Mitigation:** checkpoint rewritten as a derived frontier snapshot with one
current node and no historical raw state.

### F-04 — Blueprint size does not match execution size

Several “M” or “one-session” blueprints contain 10–18 implementation steps,
multiple new packages/routes/contracts, performance work, docs, and full-gate
requirements. One usage cutoff near the end loses most of the value.

**Mitigation:** every task now has 1–3-step execution slices and permits
coherent checkpoint commits/pushes before final completion.

### F-05 — Duplicate proof loops

The prior protocol could run focused tests, full tests, full fixture gates,
adversarial review, a correction pass, re-review, another full gate, and then
Linux/Windows CI. Many edges were proved three or four times.

**Mitigation:** focused proof during writing, one independent validation cut,
one full local gate, then CI. Architecture review and re-review are risk-gated.

## High friction

### F-06 — Over-broad global gate copied into every blueprint

Every dossier repeats the same validation inventory even when the task cannot
affect fixtures, browser behavior, skills, or benchmarks.

**Mitigation:** `GATE_GRAPH.md` maps changed artifact classes to proof nodes.
The full repository gate runs once, not after each slice.

### F-07 — “Touch only §9” creates brittle false blockers

Package wiring, lockfiles, barrel exports, and status files are sometimes
required but omitted or stale in an exact file plan. The previous protocol
required the worker to stop rather than make a bounded, evidence-backed wiring
change.

**Mitigation:** execution cards distinguish owned artifacts from permitted
integration edges. A necessary one-hop wiring file may be added with a recorded
reason; broader scope still requires escalation.

### F-08 — Reviewer role duplication

A testing agent and an adversarial reviewer often re-read the same blueprint,
diff, and output. A correction then triggered the original reviewer again.

**Mitigation:** one validator handles ordinary tasks. A separate architecture
reviewer is reserved for high-risk contract nodes.

### F-09 — Status prose is difficult to schedule mechanically

INDEX status cells include dates, test counts, PRs, and prose. Agents must
parse natural language to determine the frontier.

**Mitigation:** `TASK_GRAPH.json` contains normalized status and explicit
edges. INDEX remains the human view.

### F-10 — Dependency edges were not sufficient to select safe parallel work

The index lists task dependencies but not artifact ownership. Agents either
serialize everything or risk conflicting writers.

**Mitigation:** execution cards list input and output artifact neighborhoods.
Parallel work requires disjoint write sets and contract edges.

## Vulnerabilities

### V-01 — Rework from stale source coordinates

Exact line numbers in large dossiers drift after every merge. Treating them as
strict facts invites repeated source archaeology and false contradiction
reports.

**Control:** line references are hints; symbol names and contract semantics are
authoritative.

### V-02 — Usage exhaustion before preservation

The previous workflow committed only at task completion. A large correction or
review cycle could consume the remaining window while all work remained
uncommitted.

**Control:** checkpoint after every coherent slice, push early to a draft PR,
and update the concise checkpoint before expensive validation.

### V-03 — Test weakening through “make the full gate pass” pressure

Long tasks with a terminal full gate create pressure to modify fixtures,
budgets, or assertions late in the session.

**Control:** existing golden fixtures and frozen migrations remain immutable;
performance-budget changes require a named decision and evidence. The writer
cannot unilaterally weaken proof nodes.

### V-04 — Automation can merge a semantically incomplete large task

A huge blueprint may pass tests while one promised route or state transition is
not actually connected.

**Control:** completion is evaluated against output contract edges in the
execution card, not only test exit codes.

### V-05 — Autonomous loops can spend usage on low-value review recursion

Generic adversarial prompts tend to produce medium/low findings indefinitely.

**Control:** only blockers/highs tied to a named invariant can block. One
correction cycle is default; a second requires a newly exposed blocker.

## Expected effect

The new graph model should reduce per-task context, make progress preservable,
prevent completed nodes from being rediscovered, and shift usage from repeated
planning/review toward code and proof. It does not lower the quality bar; it
removes redundant paths to the same proof.
