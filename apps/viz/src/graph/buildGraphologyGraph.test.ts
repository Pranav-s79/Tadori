import { describe, expect, it } from "vitest";
import type { ApiEdge, ApiNode } from "../api/types.ts";
import { buildGraphologyGraph } from "./buildGraphologyGraph.ts";

const node: ApiNode = {
  entityKey: "present",
  kind: "package",
  qualifiedName: "present",
  displayName: "present",
  file: null,
  exported: false,
  fanIn: 0
};
const position = { entityKey: "present", x: 1, y: 2, z: 0, pinned: false } as const;

function edge(over: Partial<ApiEdge>): ApiEdge {
  return {
    entityKey: "edge",
    srcEntityKey: "present",
    relation: "calls",
    dstEntityKey: "present",
    origin: "compiler",
    confidence: "certain",
    resolution: "resolved",
    ...over
  };
}

describe("buildGraphologyGraph endpoint integrity", () => {
  it("rejects a missing source rather than fabricating an unresolved node", () => {
    expect(() => buildGraphologyGraph([node], [edge({ srcEntityKey: "missing" })], [position]))
      .toThrow('Graph edge "edge" references missing source node "missing"');
  });

  it("rejects a missing target rather than fabricating an unresolved node", () => {
    expect(() => buildGraphologyGraph([node], [edge({ dstEntityKey: "missing" })], [position]))
      .toThrow('Graph edge "edge" references missing target node "missing"');
  });

  it("rejects a node with no served layout rather than piling it up at zero", () => {
    expect(() => buildGraphologyGraph([node], [], []))
      .toThrow('Graph node "present" has no served layout position');
  });

  it("preserves aggregate buckets and accounting without inventing top-level provenance", () => {
    const aggregate: ApiEdge = {
      entityKey: "aggregate",
      srcEntityKey: "present",
      relation: "imports",
      dstEntityKey: "present",
      projectionKind: "package_aggregate",
      aggregateCount: 3,
      aggregateProvenance: [
        { origin: "compiler", confidence: "certain", resolution: "resolved", count: 2 },
        { origin: "heuristic", confidence: "likely", resolution: "partial", count: 1 }
      ],
      aggregateLanguages: ["python", "typescript"],
      aggregateCapabilities: ["semantic", "structural"],
      aggregateDerivations: ["compiler-resolved", "parser-derived"],
      sourceEdgeCount: 3,
      sourceEdgeOmittedCount: 1,
      evidenceOmittedCount: 4
    };
    const graph = buildGraphologyGraph([node], [aggregate], [position]);
    expect(graph.getEdgeAttribute("aggregate", "origin")).toBeUndefined();
    expect(graph.getEdgeAttribute("aggregate", "aggregateProvenance")).toEqual(aggregate.aggregateProvenance);
    expect(graph.getEdgeAttribute("aggregate", "aggregateLanguages")).toEqual(["python", "typescript"]);
    expect(graph.getEdgeAttribute("aggregate", "sourceEdgeOmittedCount")).toBe(1);
    expect(graph.getEdgeAttribute("aggregate", "evidenceOmittedCount")).toBe(4);
  });
});
