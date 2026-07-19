#!/usr/bin/env python3
"""Validate task graph/card/dossier integrity without model reasoning."""
from __future__ import annotations
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def main() -> int:
    graph = json.loads((ROOT / "TASK_GRAPH.json").read_text(encoding="utf-8"))
    nodes = {n["id"]: n for n in graph["nodes"]}
    errors: list[str] = []
    for node in nodes.values():
        for dep in node["depends_on"]:
            if dep not in nodes:
                errors.append(f"{node['id']}: unknown dependency {dep}")
        card = ROOT.parent / node["execution_card"]
        if not card.exists():
            errors.append(f"{node['id']}: missing card {node['execution_card']}")
        if node.get("blueprint"):
            dossier = ROOT.parent / node["blueprint"]
            if not dossier.exists():
                errors.append(f"{node['id']}: missing dossier {node['blueprint']}")
    # cycle check
    visiting: set[str] = set(); visited: set[str] = set()
    def visit(nid: str, trail: list[str]) -> None:
        if nid in visiting:
            errors.append("cycle: " + " -> ".join(trail + [nid])); return
        if nid in visited: return
        visiting.add(nid)
        for dep in nodes[nid]["depends_on"]:
            if dep in nodes: visit(dep, trail + [nid])
        visiting.remove(nid); visited.add(nid)
    for nid in nodes: visit(nid, [])
    if errors:
        for e in errors: print("ERROR", e)
        return 1
    print(f"PASS nodes={len(nodes)} edges={len(graph['edges'])} cards={len(nodes)}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
