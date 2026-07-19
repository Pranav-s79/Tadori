#!/usr/bin/env python3
"""Print the current Tadori task frontier without using an LLM."""
from __future__ import annotations
import argparse, json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def load() -> dict:
    return json.loads((ROOT / "TASK_GRAPH.json").read_text(encoding="utf-8"))

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true", help="show all non-closed nodes")
    ap.add_argument("--json", action="store_true", help="emit JSON")
    args = ap.parse_args()
    graph = load()
    nodes = graph["nodes"]
    if args.all:
        selected = [n for n in nodes if n["frontier_state"] != "closed"]
    else:
        selected = [n for n in nodes if n["frontier_state"] in {"available", "finish_completion_cut"}]
    if args.json:
        print(json.dumps(selected, indent=2))
    else:
        for n in selected:
            print(f"{n['id']:7} {n['frontier_state']:22} {n['status']:10} {n['title']}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
