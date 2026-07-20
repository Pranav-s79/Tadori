import { describe, expect, it } from "vitest";
import type { ApiEdge, ApiNode } from "../src/api/types.ts";
import {
  applyFiltersToGraph,
  defaultFilters,
  filtersActive,
  type RenderableGraph
} from "../src/features/search/filterState.ts";

const nodes: ApiNode[] = [
  { entityKey: "fn:a", kind: "function", qualifiedName: "a", displayName: "a", file: null, exported: true, fanIn: 0 },
  { entityKey: "cls:b", kind: "class", qualifiedName: "B", displayName: "B", file: null, exported: true, fanIn: 1 },
  { entityKey: "pkg:c", kind: "package", qualifiedName: "@c", displayName: "@c", file: null, exported: true, fanIn: 2 }
];
const edges: ApiEdge[] = [
  { entityKey: "e1", srcEntityKey: "fn:a", relation: "calls", dstEntityKey: "cls:b", origin: "compiler", confidence: "certain", resolution: "resolved" },
  { entityKey: "e2", srcEntityKey: "cls:b", relation: "imports", dstEntityKey: "pkg:c", origin: "git", confidence: "likely", resolution: "partial" }
];
const graph: RenderableGraph = { nodes, edges };

describe("defaultFilters / filtersActive", () => {
  it("default filters are all-empty and inactive", () => {
    const f = defaultFilters();
    expect(f).toEqual({ kinds: [], relations: [], origins: [], confidences: [], resolutions: [] });
    expect(filtersActive(f)).toBe(false);
  });

  it("filtersActive is true when any category is non-empty", () => {
    expect(filtersActive({ ...defaultFilters(), kinds: ["function"] })).toBe(true);
    expect(filtersActive({ ...defaultFilters(), relations: ["calls"] })).toBe(true);
    expect(filtersActive({ ...defaultFilters(), resolutions: ["partial"] })).toBe(true);
  });
});

describe("applyFiltersToGraph", () => {
  it("marks everything visible with default filters", () => {
    const result = applyFiltersToGraph(graph, defaultFilters());
    expect(result.nodes.every((n) => n.visible)).toBe(true);
    expect(result.edges.every((e) => e.visible)).toBe(true);
  });

  it("kind filter hides non-matching nodes without removing them", () => {
    const result = applyFiltersToGraph(graph, { ...defaultFilters(), kinds: ["function"] });
    // Same count — nothing removed, existence preserved.
    expect(result.nodes).toHaveLength(nodes.length);
    const byKey = new Map(result.nodes.map((n) => [n.node.entityKey, n.visible]));
    expect(byKey.get("fn:a")).toBe(true);
    expect(byKey.get("cls:b")).toBe(false);
    expect(byKey.get("pkg:c")).toBe(false);
  });

  it("never mutates its input (returns a new object, same underlying row refs)", () => {
    const result = applyFiltersToGraph(graph, { ...defaultFilters(), kinds: ["class"] });
    expect(Object.is(result, graph)).toBe(false);
    expect(Object.is(result.nodes, graph.nodes)).toBe(false);
    // input arrays untouched
    expect(graph.nodes).toHaveLength(3);
    // the wrapped node objects are the SAME references (no fabrication/clone)
    expect(result.nodes[0]?.node).toBe(nodes[0]);
  });

  it("edge relation filter hides non-matching edges", () => {
    const result = applyFiltersToGraph(graph, { ...defaultFilters(), relations: ["calls"] });
    const byKey = new Map(result.edges.map((e) => [e.edge.entityKey, e.visible]));
    expect(byKey.get("e1")).toBe(true);
    expect(byKey.get("e2")).toBe(false);
  });

  it("intersects across categories (edge must satisfy ALL active edge filters)", () => {
    // relation=imports matches e2, but origin=compiler excludes e2 (it's git) → e2 hidden.
    const result = applyFiltersToGraph(graph, {
      ...defaultFilters(),
      relations: ["imports"],
      origins: ["compiler"]
    });
    const byKey = new Map(result.edges.map((e) => [e.edge.entityKey, e.visible]));
    expect(byKey.get("e1")).toBe(false); // relation=calls, excluded by relation filter
    expect(byKey.get("e2")).toBe(false); // relation ok but origin=git excluded
  });

  it("intersects provenance categories (confidence + resolution together)", () => {
    const result = applyFiltersToGraph(graph, {
      ...defaultFilters(),
      confidences: ["certain"],
      resolutions: ["resolved"]
    });
    const byKey = new Map(result.edges.map((e) => [e.edge.entityKey, e.visible]));
    expect(byKey.get("e1")).toBe(true); // certain + resolved
    expect(byKey.get("e2")).toBe(false); // likely + partial
  });
});
