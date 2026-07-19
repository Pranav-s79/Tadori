# Blueprint vault

Start here:

1. `GRAPH_ENGINEERING.md` — execution model.
2. `TASK_GRAPH.json` — normalized task/dependency graph.
3. `AUTONOMOUS_RUN_CHECKPOINT.md` — current frontier only.
4. `execution/<ID>.md` — compact card for the selected node.
5. Long `<ID>-*.md` dossier — open sections on demand.
6. `GATE_GRAPH.md` — minimal risk-based validation cut.
7. `GRAPH_FRICTION_AUDIT.md` — reasons for the redesign.
8. `tools/frontier.py` — select dependency-ready nodes without an LLM.
9. `tools/check_graph.py` — validate graph/card/dossier integrity.

Do not make a cold agent read the entire vault. Do not treat historical
non-existence claims as live blockers. Close one small graph rewrite and its
proof at a time, preserve coherent slices, and move immediately to the next
frontier node after merge.
