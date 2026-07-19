# Tadori graph-first builder handoff

This guide replaces the old cold-start rule that required reading an entire
30–50k-character blueprint. The builder operates on a small graph neighborhood
and loads the dossier only on demand.

## 1. Load the execution node

Read only:

1. `blueprints/execution/<ID>.md`;
2. `blueprints/TASK_GRAPH.json` entry for `<ID>`;
3. `blueprints/AUTONOMOUS_RUN_CHECKPOINT.md`;
4. directly named source and test artifacts.

Do not read every blueprint. Do not read all of ARCHITECTURE.md. Open only a
section linked by the execution card when a contract is genuinely unclear.

## 2. Verify the live one-hop neighborhood

Use targeted commands to verify:

- predecessor exports exist;
- owned files and direct importers;
- current branch/worktree;
- focused tests named by the card.

Planning-time line numbers and “does not exist yet” statements are historical.
Live repository semantics win. Stop only for the failure boundaries in the
execution card.

## 3. Execute slices, not a monolith

The card groups implementation into slices of at most three steps. For each
slice:

1. writer implements only the listed graph rewrite;
2. run the focused proof;
3. record the result in the checkpoint;
4. create a checkpoint commit when the slice is coherent;
5. push to the draft PR when usage risk is material;
6. continue to the next slice.

Only one production writer owns a file node at a time.

## 4. Subagent topology

Default team:

- **Writer (Sonnet/Codex):** card + owned files; writes code and focused tests.
- **Validator (Sonnet/cheaper capable):** card + final diff + proof nodes;
  independently runs the proof cut.
- **Pipeline agent (Haiku):** task graph, Git/PR/checkpoint, next-frontier prep.

Use an architecture reviewer only for the escalation edges listed in
`GATE_GRAPH.md`. Do not create separate investigator, validator, adversarial,
and re-review agents for an ordinary task.

Subagents exchange deltas, not full transcripts. Reuse a writer for one narrow
correction. A second correction cycle requires a newly exposed blocker.

## 5. Validation economy

- Focused tests: during each slice.
- Independent validation: once after the final slice.
- Full local completion gate: once before completion commit.
- CI: independent Windows/Linux proof.
- Re-review: only if a blocker/high correction changed the disputed edge.

Select gates from `GATE_GRAPH.md`. Never repeat the entire gate after a docs-
only or unrelated slice.

## 6. Branch and preservation policy

- One task branch and PR per blueprint node.
- Open a draft PR after the first coherent checkpoint when practical.
- Commit cohesive slices; squash at merge.
- If usage ends, push coherent work and leave a draft PR. Do not leave a large
  validated rewrite only in an uncommitted working tree.
- Never include unrelated stashes, local DBs, secrets, or unexplained deps.

## 7. Scope and integration

The card’s `writes` set is the ownership boundary. A directly required
workspace/barrel/export/status wiring file is a permitted one-hop integration
edge when recorded in the delta report. Broader files require coordinator
approval. Never scaffold future nodes.

## 8. Completion and continuation

Close the task only when the execution card’s completion cut is satisfied.
Update INDEX and checkpoint, commit, push, PR, CI, merge, pull main, then select
the next frontier node from TASK_GRAPH without asking the user.

Final task output is a concise delta report, not a replay of reasoning or raw
logs.
