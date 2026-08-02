import { describe, expect, it } from "vitest";
import type { ApiEdge, ApiNode, LayoutPositionDto, NodeKind, RegionDto } from "../../api/types.ts";
import { buildReliefScene, projectReliefPoint } from "./projectRelief.ts";

const KINDS: NodeKind[] = ["package", "file", "function", "method", "class", "interface", "type", "route", "test", "adr", "doc_section", "external_dep", "unresolved"];

function node(entityKey: string, kind: NodeKind, fanIn = 0): ApiNode {
  return { entityKey, kind, qualifiedName: entityKey, displayName: entityKey, file: null, exported: false, fanIn };
}

function region(overrides: Partial<RegionDto> = {}): RegionDto {
  return {
    regionKey: "region:a",
    label: "Package A",
    packageEntityKey: "pkg:a",
    memberPackageKeys: ["pkg:a"],
    role: { text: null, status: "derived_from_graph", evidence: [], evidenceOmittedCount: 0 },
    basis: { kind: "package_containment", packageEntityKey: "pkg:a", sourceEdgeCount: 1, evidence: [], evidenceOmittedCount: 0 },
    counts: {
      entities: 2,
      byKind: Object.fromEntries(KINDS.map((kind) => [kind, kind === "package" ? 1 : 0])) as Record<NodeKind, number>,
      incomingCrossRegionRelations: 0,
      outgoingCrossRegionRelations: 1
    },
    languages: ["typescript"], capabilities: ["semantic"], derivations: ["compiler-resolved"],
    ...overrides
  };
}

describe("projectRelief", () => {
  it("uses fixed 2:1 projection without mutating served coordinates", () => {
    const position = { entityKey: "a", x: 12, y: 4, z: 0, pinned: true };
    expect(projectReliefPoint(position)).toEqual({ x: 8, y: 8 });
    expect(position).toEqual({ entityKey: "a", x: 12, y: 4, z: 0, pinned: true });
  });

  it("builds deterministic regions, traces, structures, and honest unassigned accounting", () => {
    const nodes = [node("pkg:a", "package", 4), node("pkg:b", "package"), node("file:a", "file")];
    const edges: ApiEdge[] = [{ entityKey: "edge", srcEntityKey: "pkg:a", relation: "imports", dstEntityKey: "pkg:b", origin: "compiler", confidence: "certain", resolution: "resolved" }];
    const positions: LayoutPositionDto[] = nodes.map((item, index) => ({ entityKey: item.entityKey, x: index * 10, y: index * 3, z: 0, pinned: false }));
    const input = {
      nodes, edges, positions,
      packageKeyByEntityKey: { "pkg:a": "pkg:a", "pkg:b": "pkg:b", "file:a": "pkg:a" },
      regions: [region({ memberPackageKeys: ["pkg:a"] })]
    };
    const scene = buildReliefScene(input);
    expect(scene.marks.map((mark) => mark.node.entityKey).sort()).toEqual(nodes.map((item) => item.entityKey).sort());
    expect(scene.traces).toHaveLength(1);
    expect(scene.plates).toHaveLength(1);
    expect(scene.marks.find((mark) => mark.node.entityKey === "file:a")?.regionKey).toBe("region:a");
    expect(scene.unassignedPackageCount).toBe(1);
    expect(buildReliefScene(input)).toEqual(scene);
  });

  it("sorts region plates and traces and resolves overlapping membership by stable region key", () => {
    const nodes = [node("pkg:a", "package"), node("pkg:b", "package")];
    const positions: LayoutPositionDto[] = [
      { entityKey: "pkg:a", x: 0, y: 0, z: 0, pinned: false },
      { entityKey: "pkg:b", x: 10, y: 0, z: 0, pinned: false }
    ];
    const edge = (entityKey: string, srcEntityKey: string, dstEntityKey: string): ApiEdge => ({
      entityKey, srcEntityKey, dstEntityKey, relation: "imports",
      origin: "compiler", confidence: "certain", resolution: "resolved"
    });
    const regions = [
      region({ regionKey: "region:z", label: "Z", packageEntityKey: "pkg:b", memberPackageKeys: ["pkg:b", "pkg:a", "pkg:a"] }),
      region({ regionKey: "region:a", label: "A", packageEntityKey: "pkg:a", memberPackageKeys: ["pkg:a"] })
    ];
    const input = {
      nodes,
      edges: [edge("edge:z", "pkg:b", "pkg:a"), edge("edge:a", "pkg:a", "pkg:b")],
      positions,
      packageKeyByEntityKey: { "pkg:a": "pkg:a", "pkg:b": "pkg:b" },
      regions
    };

    const scene = buildReliefScene(input);
    expect(scene.plates.map((plate) => plate.region.regionKey)).toEqual(["region:a", "region:z"]);
    expect(scene.plates[1]?.memberPackageKeys).toEqual(["pkg:a", "pkg:b"]);
    expect(scene.traces.map((trace) => trace.edge.entityKey)).toEqual(["edge:a", "edge:z"]);
    expect(scene.marks.find((mark) => mark.node.entityKey === "pkg:a")?.regionKey).toBe("region:a");
    expect(buildReliefScene({ ...input, regions: [...regions].reverse(), edges: [...input.edges].reverse() })).toEqual(scene);
  });

  it("omits edges and region plates whose endpoints have no served layout position", () => {
    const scene = buildReliefScene({
      nodes: [node("pkg:a", "package"), node("pkg:b", "package")],
      edges: [{ entityKey: "edge", srcEntityKey: "pkg:a", relation: "imports", dstEntityKey: "pkg:b" }],
      positions: [{ entityKey: "pkg:a", x: 0, y: 0, z: 0, pinned: false }],
      packageKeyByEntityKey: { "pkg:a": "pkg:a", "pkg:b": "pkg:b" },
      regions: [region({ packageEntityKey: "pkg:b", memberPackageKeys: ["pkg:b"] })]
    });
    expect(scene.marks.map((mark) => mark.node.entityKey)).toEqual(["pkg:a"]);
    expect(scene.traces).toEqual([]);
    expect(scene.plates).toEqual([]);
    expect(scene.unassignedPackageCount).toBe(1);
  });
});
