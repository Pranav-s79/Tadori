# Graph-engineering rewrite summary

## Added

- `GRAPH_ENGINEERING.md` — graph-first execution model.
- `GRAPH_FRICTION_AUDIT.md` — identified usage, context, review, checkpoint,
  and stale-evidence friction.
- `GATE_GRAPH.md` — risk-based validation selection.
- `TASK_GRAPH.json` — 36 normalized task nodes and 48 dependency edges,
  including read/write neighborhoods, slice counts, risk, and frontier state.
- `execution/*.md` — 36 compact execution cards, including placeholders for
  the 13 not-yet-drafted blueprints.
- `tools/frontier.py` — deterministic frontier selection.
- `tools/check_graph.py` — graph/card/dossier integrity validation.
- `README.md` — vault entrypoint.

## Rewritten

- `_TEMPLATE.md` — replaced 22-section mandatory execution format with an
  eight-block graph blueprint focused on nodes, edges, slices, proof, and
  completion cuts.
- `BUILDER_HANDOFF.md` — card-first, one-hop context, slice checkpoints,
  risk-gated review, and non-duplicative validation.
- `AUTONOMOUS_RUN_CHECKPOINT.md` — removed contradictory historical state and
  reduced it to the current frontier.

## Annotated

- Every existing numbered blueprint dossier now has machine-readable graph
  metadata and a card-first warning.
- `ARCHITECTURE.md`, `ASSUMPTIONS.md`, and `RISKS.md` now warn that historical
  existence claims and line numbers are not live preconditions.
- `INDEX.md` links to TASK_GRAPH and execution cards.

## Integrity checks

- 36 task nodes.
- 48 dependency edges.
- 36 execution cards.
- All dependency IDs resolve.
- No dependency cycle detected.
- Every existing dossier path resolves.
- Every execution-card path resolves.
