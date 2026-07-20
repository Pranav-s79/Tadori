import { describe, expect, it } from "vitest";
import type { ApiEdge } from "../src/api/types.ts";
import { computeAggregatedEdges, diffExpandedNodes, truncate } from "../src/graph/expansion.ts";

function edge(
  entityKey: string,
  src: string,
  dst: string,
  relation: string,
  origin: ApiEdge["origin"] = "compiler",
  confidence: ApiEdge["confidence"] = "certain",
  resolution: ApiEdge["resolution"] = "resolved"
): ApiEdge {
  return { entityKey, srcEntityKey: src, relation, dstEntityKey: dst, origin, confidence, resolution };
}

// entityToPackage maps every node (package hull OR a file within a package) to
// its owning package key. computeAggregatedEdges collapses each cross-package
// group of same-relation edges into one AggregatedEdge; edges whose endpoints
// resolve to the SAME expanded package are intra-package and excluded (they
// render individually elsewhere).
describe("computeAggregatedEdges", () => {
  it("(a) aggregates a boundary edge between an expanded and a collapsed package by relation with count + provenance", () => {
    const entityToPackage = new Map([
      ["file:a1", "pkg:a"],
      ["file:a2", "pkg:a"],
      ["pkg:b", "pkg:b"]
    ]);
    const edges = [
      edge("e1", "file:a1", "pkg:b", "imports", "compiler", "certain", "resolved"),
      edge("e2", "file:a2", "pkg:b", "imports", "heuristic", "likely", "partial")
    ];
    const result = computeAggregatedEdges(edges, entityToPackage, new Set(["pkg:a"]));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ srcPackage: "pkg:a", dstPackage: "pkg:b", relation: "imports", count: 2 });
    expect(result[0]?.provenance).toEqual(
      expect.arrayContaining([
        { origin: "compiler", confidence: "certain", resolution: "resolved", count: 1 },
        { origin: "heuristic", confidence: "likely", resolution: "partial", count: 1 }
      ])
    );
  });

  it("(b) keeps two different relations across the same package pair as two separate aggregates", () => {
    const entityToPackage = new Map([
      ["pkg:a", "pkg:a"],
      ["pkg:b", "pkg:b"]
    ]);
    const edges = [
      edge("e1", "pkg:a", "pkg:b", "imports"),
      edge("e2", "pkg:a", "pkg:b", "calls")
    ];
    const result = computeAggregatedEdges(edges, entityToPackage, new Set());
    expect(result).toHaveLength(2);
    const relations = result.map((r) => r.relation).sort();
    expect(relations).toEqual(["calls", "imports"]);
  });

  it("(c) excludes an intra-expanded-package edge from aggregation entirely", () => {
    const entityToPackage = new Map([
      ["file:a1", "pkg:a"],
      ["file:a2", "pkg:a"]
    ]);
    const edges = [edge("e1", "file:a1", "file:a2", "imports")];
    const result = computeAggregatedEdges(edges, entityToPackage, new Set(["pkg:a"]));
    expect(result).toEqual([]);
  });

  it("(d) aggregates an edge between two different collapsed packages (baseline 08-02 behavior)", () => {
    const entityToPackage = new Map([
      ["pkg:a", "pkg:a"],
      ["pkg:b", "pkg:b"]
    ]);
    const edges = [edge("e1", "pkg:a", "pkg:b", "imports"), edge("e2", "pkg:a", "pkg:b", "imports")];
    const result = computeAggregatedEdges(edges, entityToPackage, new Set());
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ srcPackage: "pkg:a", dstPackage: "pkg:b", relation: "imports", count: 2 });
  });
});

describe("truncate (file labels at 20)", () => {
  it("leaves a label of exactly 20 chars unchanged", () => {
    expect(truncate("a".repeat(20), 20)).toBe("a".repeat(20));
  });

  it("truncates a longer label to exactly 20 chars + ellipsis", () => {
    const result = truncate("a".repeat(30), 20);
    expect(result).toBe(`${"a".repeat(20)}…`);
    expect(result.slice(0, 20).length).toBe(20);
    expect(result.endsWith("…")).toBe(true);
  });
});

describe("diffExpandedNodes", () => {
  it("returns the package to add for a newly-expanded package", () => {
    const diff = diffExpandedNodes(new Set(), new Set(["pkg:a"]));
    expect(diff.added).toEqual(["pkg:a"]);
    expect(diff.removed).toEqual([]);
  });

  it("returns the package to remove on collapse", () => {
    const diff = diffExpandedNodes(new Set(["pkg:a", "pkg:b"]), new Set(["pkg:b"]));
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual(["pkg:a"]);
  });

  it("returns no change when the expanded set is identical", () => {
    const diff = diffExpandedNodes(new Set(["pkg:a"]), new Set(["pkg:a"]));
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });
});
