import { describe, expect, it } from "vitest";
import type { ApiEdge, ApiNode } from "../src/api/types.ts";
import {
  activeFilterCount,
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
    expect(f).toEqual({ kinds: [], relations: [], origins: [], confidences: [], resolutions: [], languages: [], capabilities: [], derivations: [] });
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

  it("matches aggregate buckets without combining facts from different source edges", () => {
    const aggregate: ApiEdge = {
      entityKey: "aggregate",
      srcEntityKey: "fn:a",
      relation: "imports",
      dstEntityKey: "pkg:c",
      projectionKind: "package_aggregate",
      aggregateCount: 2,
      aggregateProvenance: [
        { origin: "compiler", confidence: "certain", resolution: "resolved", count: 1 },
        { origin: "heuristic", confidence: "likely", resolution: "partial", count: 1 }
      ],
      aggregateLanguages: ["python"],
      aggregateCapabilities: ["structural"]
    };
    const crossedFacts = applyFiltersToGraph({ nodes, edges: [aggregate] }, {
      ...defaultFilters(), origins: ["compiler"], confidences: ["likely"]
    });
    expect(crossedFacts.edges[0]?.visible).toBe(false);
    const sameBucket = applyFiltersToGraph({ nodes, edges: [aggregate] }, {
      ...defaultFilters(), origins: ["heuristic"], confidences: ["likely"],
      languages: ["python"], capabilities: ["structural"]
    });
    expect(sameBucket.edges[0]?.visible).toBe(true);
  });
});

describe("activeFilterCount", () => {
  it("counts nothing when no filter is selected", () => {
    expect(activeFilterCount(defaultFilters())).toBe(0);
  });

  /**
   * The filter groups live behind a collapsed disclosure whose summary shows
   * this number. It has to sum across groups, not report how many groups are
   * touched, or a reader could not tell two active filters from five.
   */
  it("sums selected values across every group", () => {
    expect(activeFilterCount({
      ...defaultFilters(),
      kinds: ["class", "function"],
      capabilities: ["semantic"],
      languages: ["python", "typescript"]
    })).toBe(5);
  });

  it("agrees with filtersActive at the zero boundary", () => {
    expect(filtersActive(defaultFilters())).toBe(false);
    expect(filtersActive({ ...defaultFilters(), kinds: ["class"] })).toBe(true);
  });
});
