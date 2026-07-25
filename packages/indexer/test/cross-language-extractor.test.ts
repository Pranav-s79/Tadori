import path from "node:path";

import { describe, expect, test } from "vitest";

import { indexRepository } from "../src/indexRepository.js";

const FIXTURE = path.resolve("packages/bench/fixtures/mixed-oracle");

describe("explicit cross-language boundary extraction", () => {
  test("resolves corroborated HTTP, generated binding, FFI, subprocess, and build links deterministically", () => {
    const first = indexRepository(FIXTURE, { kind: "working_tree" });
    const second = indexRepository(FIXTURE, { kind: "working_tree" });
    const nodes = new Map(first.extracted.nodes.map((node) => [node.entityKey, node]));
    const boundaries = first.extracted.edges.filter((edge) =>
      edge.provenance?.extractorId === "tadori-cross-language-boundaries"
    );

    expect(JSON.stringify(second.extracted.edges.filter((edge) =>
      edge.provenance?.extractorId === "tadori-cross-language-boundaries"
    ))).toBe(JSON.stringify(boundaries));
    expect(boundaries).toHaveLength(6);
    expect(boundaries.every((edge) => edge.resolution === "resolved" && edge.evidence.length > 0)).toBe(true);

    const facts = boundaries.map((edge) => ({
      relation: edge.relation,
      source: nodes.get(edge.srcEntityKey)?.qualifiedName,
      target: nodes.get(edge.dstEntityKey)?.qualifiedName,
      derivation: edge.provenance?.derivation,
      evidenceLines: edge.evidence.map((item) => `${item.file}:${String(item.lineStart)}`)
    }));
    expect(facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ relation: "routes_to", source: "src/typescript/client.ts.score", target: "python:src/python/api.py::score", derivation: "convention-derived" }),
      expect.objectContaining({ relation: "references", source: "src/python/api.py", target: "protobuf:mixed.oracle.v1.ScoreRequest", derivation: "repository-derived" }),
      expect.objectContaining({ relation: "references", source: "src/go/client.go", target: "proto/oracle.proto", derivation: "repository-derived" }),
      expect.objectContaining({ relation: "calls", source: "oracle::transform", target: "c:src/c/checksum.c::c_checksum", derivation: "parser-derived" }),
      expect.objectContaining({ relation: "calls", source: "cpp:src/cpp/bridge.cpp::run_python_healthcheck", target: "src/python/api.py", derivation: "parser-derived" }),
      expect.objectContaining({ relation: "references", source: "cmake:CMakeLists.txt::target:cpp_bridge", target: "cmake:CMakeLists.txt::target:checksum", derivation: "repository-derived" })
    ]));
    expect(facts).not.toContainEqual(expect.objectContaining({
      source: "oracle::transform",
      target: "c:src/c/checksum.c::transform"
    }));
  });
});

