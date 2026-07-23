import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode, NodeKind, Relation } from "@tadori/core";
import {
  computeBoundaryViolations,
  globToRegExp,
  parseBoundaryRules,
  type BoundaryRules
} from "../src/boundaries.js";

function fileNode(entityKey: string, file: string): GraphNode {
  return {
    kind: "file" as NodeKind,
    qualifiedName: file,
    displayName: file,
    canonicalIdentity: `file|${file}`,
    entityKey,
    file,
    exported: false,
    spanStart: 0,
    spanEnd: 1,
    lineStart: 1,
    lineEnd: 2,
    signature: null,
    bodyHash: null,
    evidence: []
  } as GraphNode;
}

function edge(src: string, dst: string, relation: Relation): GraphEdge {
  return {
    srcEntityKey: src,
    relation,
    dstEntityKey: dst,
    canonicalIdentity: `${relation}|${src}|${dst}`,
    entityKey: `${src}:${relation}:${dst}`,
    origin: "compiler",
    confidence: "certain",
    resolution: "resolved",
    evidence: [{ kind: "source", file: "src/public/report.ts", lineStart: 1, lineEnd: 1 }]
  } as GraphEdge;
}

describe("globToRegExp", () => {
  it("** spans path segments; * stays within one segment", () => {
    expect(globToRegExp("src/internal/**").test("src/internal/secret.ts")).toBe(true);
    expect(globToRegExp("src/internal/**").test("src/internal/deep/x.ts")).toBe(true);
    expect(globToRegExp("src/public/**").test("src/publicish/x.ts")).toBe(false);
    expect(globToRegExp("src/*.ts").test("src/a.ts")).toBe(true);
    expect(globToRegExp("src/*.ts").test("src/sub/a.ts")).toBe(false);
  });

  it("a/**/b matches both a/b and a/x/b", () => {
    expect(globToRegExp("a/**/b").test("a/b")).toBe(true);
    expect(globToRegExp("a/**/b").test("a/x/y/b")).toBe(true);
  });
});

describe("parseBoundaryRules", () => {
  it("accepts the fixture-01 shape and defaults severity to error", () => {
    const rules = parseBoundaryRules({
      boundaries: [{ id: "r", from: "src/public/**", deny: ["src/internal/**"] }]
    });
    expect(rules.boundaries[0]?.severity).toBe("error");
  });

  it("throws on a missing boundaries array", () => {
    expect(() => parseBoundaryRules({})).toThrow(/boundaries/);
  });

  it("throws on a boundary missing id/from or with non-string deny (never silently drops)", () => {
    expect(() => parseBoundaryRules({ boundaries: [{ from: "a/**", deny: [] }] })).toThrow(/id/);
    expect(() => parseBoundaryRules({ boundaries: [{ id: "r", deny: [] }] })).toThrow(/from/);
    expect(() => parseBoundaryRules({ boundaries: [{ id: "r", from: "a/**", deny: [1] }] })).toThrow(/deny/);
  });
});

describe("computeBoundaryViolations (fixture-01 seeded violation)", () => {
  const rules: BoundaryRules = {
    boundaries: [{ id: "public-must-not-import-internal", from: "src/public/**", deny: ["src/internal/**"], severity: "error" }]
  };

  it("flags a forbidden import edge, evidence verbatim from the edge", () => {
    const nodes = [fileNode("kPub", "src/public/report.ts"), fileNode("kInt", "src/internal/secret.ts")];
    const edges = [edge("kPub", "kInt", "imports")];
    const violations = computeBoundaryViolations(rules, nodes, edges);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      ruleId: "public-must-not-import-internal",
      src: "file:src/public/report.ts",
      edgeRelation: "imports",
      dst: "file:src/internal/secret.ts",
      severity: "error"
    });
    expect(violations[0]?.evidence).toEqual(edges[0]?.evidence);
  });

  it("does not flag an allowed import (dst not under deny)", () => {
    const nodes = [fileNode("kPub", "src/public/report.ts"), fileNode("kOk", "src/shared/util.ts")];
    const edges = [edge("kPub", "kOk", "imports")];
    expect(computeBoundaryViolations(rules, nodes, edges)).toHaveLength(0);
  });

  it("does not flag an edge whose source is outside `from`", () => {
    const nodes = [fileNode("kOther", "src/other/a.ts"), fileNode("kInt", "src/internal/secret.ts")];
    const edges = [edge("kOther", "kInt", "imports")];
    expect(computeBoundaryViolations(rules, nodes, edges)).toHaveLength(0);
  });

  it("ignores non-dependency relations (only imports/calls count)", () => {
    const nodes = [fileNode("kPub", "src/public/report.ts"), fileNode("kInt", "src/internal/secret.ts")];
    const edges = [edge("kPub", "kInt", "contains")];
    expect(computeBoundaryViolations(rules, nodes, edges)).toHaveLength(0);
  });

  it("returns [] when there are no rules", () => {
    const nodes = [fileNode("kPub", "src/public/report.ts"), fileNode("kInt", "src/internal/secret.ts")];
    const edges = [edge("kPub", "kInt", "imports")];
    expect(computeBoundaryViolations({ boundaries: [] }, nodes, edges)).toHaveLength(0);
  });
});
