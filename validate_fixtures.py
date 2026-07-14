#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

try:
    import jsonschema
except ImportError as exc:
    raise SystemExit("Install jsonschema to validate fixture schemas: pip install jsonschema") from exc

ROOT = Path(__file__).resolve().parent


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def validate_graph(path: Path, schema: dict) -> list[str]:
    errors: list[str] = []
    graph = load(path)
    jsonschema.validate(graph, schema)

    nodes = graph["nodes"]
    edges = graph["edges"]
    node_by_id = {node["id"]: node for node in nodes}

    if len(node_by_id) != len(nodes):
        errors.append(f"{path}: duplicate node id")
    if len({node["entityKey"] for node in nodes}) != len(nodes):
        errors.append(f"{path}: duplicate node entityKey")
    if len({edge["entityKey"] for edge in edges}) != len(edges):
        errors.append(f"{path}: duplicate edge entityKey")

    for node in nodes:
        expected = sha256(node["canonicalIdentity"])
        if node["entityKey"] != expected:
            errors.append(f"{path}: node hash mismatch: {node['id']}")

    for edge in edges:
        if edge["src"] not in node_by_id or edge["dst"] not in node_by_id:
            errors.append(f"{path}: dangling edge alias: {edge['id']}")
            continue
        expected_canonical = (
            "edge|"
            + node_by_id[edge["src"]]["entityKey"]
            + "|"
            + edge["relation"]
            + "|"
            + node_by_id[edge["dst"]]["entityKey"]
        )
        if edge["canonicalIdentity"] != expected_canonical:
            errors.append(f"{path}: edge canonical mismatch: {edge['id']}")
        if edge["entityKey"] != sha256(edge["canonicalIdentity"]):
            errors.append(f"{path}: edge hash mismatch: {edge['id']}")

    repo_root = path.parent.parent / "repo"
    if graph["fixture"]["id"] == "diff-coalescing":
        repo_root = path.parent.parent / graph["fixture"]["snapshot"]

    for edge in edges:
        for evidence in edge["evidence"]:
            source = repo_root / evidence["file"]
            if not source.exists():
                errors.append(f"{path}: missing evidence file {evidence['file']}")
                continue
            lines = source.read_text(encoding="utf-8").splitlines()
            line_no = evidence["line"]
            if line_no < 1 or line_no > len(lines):
                errors.append(f"{path}: evidence line out of range: {edge['id']}")
            elif evidence["contains"] not in lines[line_no - 1]:
                errors.append(f"{path}: evidence substring mismatch: {edge['id']}")

    return errors


def main() -> int:
    graph_schema = load(ROOT / "schemas" / "expected-graph.schema.json")
    diff_schema = load(ROOT / "schemas" / "expected-diff.schema.json")

    graph_paths = [
        ROOT / "packages/fixtures/01-core-symbols/expected/graph.json",
        ROOT / "packages/fixtures/02-express-routes/expected/graph.json",
        ROOT / "packages/fixtures/03-next-routes/expected/graph.json",
        ROOT / "packages/fixtures/04-diff-coalescing/expected/before-graph.json",
        ROOT / "packages/fixtures/04-diff-coalescing/expected/after-graph.json",
    ]

    errors: list[str] = []
    for path in graph_paths:
        errors.extend(validate_graph(path, graph_schema))

    for path in [
        ROOT / "packages/fixtures/04-diff-coalescing/expected/raw-diff.json",
        ROOT / "packages/fixtures/04-diff-coalescing/expected/coalesced-diff.json",
    ]:
        jsonschema.validate(load(path), diff_schema)

    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1

    print("Tadori golden fixtures: all schema, identity, endpoint, and evidence checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
