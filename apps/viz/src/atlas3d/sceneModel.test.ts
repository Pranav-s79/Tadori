import Graph from "graphology";
import { describe, expect, it } from "vitest";
import type { ApiNode, NodeKind } from "../api/types.ts";
import { LEVEL_HEIGHT, PLATE_THICKNESS, WORLD_SPAN, buildAtlasScene, nodeAbstractionLevel } from "./sceneModel.ts";

function apiNode(entityKey: string, kind: NodeKind): ApiNode {
  return { entityKey, kind, qualifiedName: entityKey, displayName: entityKey, file: null, exported: true, fanIn: 0 };
}

/** A package expanded to two files, one of which is expanded to a symbol. */
function layeredGraph(): Graph {
  const graph = new Graph({ multi: true, type: "directed" });
  graph.addNode("pkg", { apiNode: apiNode("pkg", "package"), kind: "package", displayName: "pkg", x: 0, y: 0, color: "#a98e55", packageMembershipKnown: true });
  graph.addNode("pkg::a", { apiNode: apiNode("a", "file"), kind: "file", displayName: "a.ts", x: -50, y: 0, expandedFrom: "pkg", color: "#b88d55" });
  graph.addNode("pkg::b", { apiNode: apiNode("b", "file"), kind: "file", displayName: "b.ts", x: 50, y: 20, expandedFrom: "pkg", color: "#b88d55", selected: true });
  graph.addNode("pkg::a::f", { apiNode: apiNode("f", "function"), kind: "function", displayName: "f", x: 0, y: -50, expandedFromFile: "pkg::a", color: "#b88d55", filterDimmed: true });
  graph.addEdgeWithKey("e1", "pkg::a", "pkg::b", { type: "dashed", color: "#7c4d27" });
  graph.addEdgeWithKey("e2", "pkg::b", "pkg::a::f", { type: "dotted", color: "#9a968c" });
  graph.addEdgeWithKey("loop", "pkg", "pkg", { type: "solid" });
  return graph;
}

describe("nodeAbstractionLevel", () => {
  it("reads the level a node was fetched at from its expansion marker", () => {
    expect(nodeAbstractionLevel({})).toBe("package");
    expect(nodeAbstractionLevel({ expandedFrom: "pkg" })).toBe("file");
    expect(nodeAbstractionLevel({ expandedFrom: "pkg", expandedFromFile: "file" })).toBe("symbol");
  });
});

describe("buildAtlasScene", () => {
  it("lifts each node by its abstraction level and nothing else", () => {
    const scene = buildAtlasScene(layeredGraph());
    const height = (key: string) => scene.nodes.find((node) => node.key === key)?.base[1];
    expect(height("pkg")).toBe(0);
    expect(height("pkg::a")).toBe(LEVEL_HEIGHT);
    expect(height("pkg::b")).toBe(LEVEL_HEIGHT);
    expect(height("pkg::a::f")).toBe(2 * LEVEL_HEIGHT);
  });

  it("keeps the served layout, scaled to the world span, with layout y pointing away (-Z)", () => {
    const scene = buildAtlasScene(layeredGraph());
    const ground = (key: string) => scene.nodes.find((node) => node.key === key)?.ground;
    // x spans -50..50 and y spans -50..20, so 100 layout units become WORLD_SPAN.
    expect(ground("pkg::a")).toEqual([-WORLD_SPAN / 2, 0, -15 * (WORLD_SPAN / 100)]);
    expect(ground("pkg::b")![0]).toBe(WORLD_SPAN / 2);
    // b is further up the plan than a, so it is further from the camera.
    expect(ground("pkg::b")![2]).toBeLessThan(ground("pkg::a")![2]);
    expect(ground("pkg::a::f")![2]).toBeGreaterThan(ground("pkg")![2]);
  });

  it("carries Plan's colour, selection and dimming, and names each node", () => {
    const scene = buildAtlasScene(layeredGraph());
    const b = scene.nodes.find((node) => node.key === "pkg::b")!;
    const f = scene.nodes.find((node) => node.key === "pkg::a::f")!;
    expect(b).toMatchObject({ entityKey: "b", label: "b.ts", selected: true, dimmed: false, color: "#b88d55" });
    expect(f).toMatchObject({ level: "symbol", dimmed: true });
    expect(b.anchor[1]).toBeCloseTo(b.base[1] + b.size[1], 10);
  });

  it("draws every served edge between node tops, keeps its provenance pattern and drops self-loops", () => {
    const scene = buildAtlasScene(layeredGraph());
    const a = scene.nodes.find((node) => node.key === "pkg::a")!;
    const b = scene.nodes.find((node) => node.key === "pkg::b")!;
    expect(scene.edges.map((edge) => [edge.key, edge.pattern])).toEqual([["e1", "dashed"], ["e2", "dotted"]]);
    expect(scene.edges[0]).toMatchObject({ from: a.anchor, to: b.anchor });
  });

  it("lays an expanded package's slab under all of its files, and a collapsed one under itself", () => {
    const scene = buildAtlasScene(layeredGraph());
    const outline = scene.plates.find((plate) => plate.key === "pkg")!.outline;
    const xs = outline.map((point) => point.x);
    const zs = outline.map((point) => point.y);
    for (const key of ["pkg", "pkg::a", "pkg::b"]) {
      const [x, , z] = scene.nodes.find((node) => node.key === key)!.ground;
      expect(x).toBeGreaterThan(Math.min(...xs));
      expect(x).toBeLessThan(Math.max(...xs));
      expect(z).toBeGreaterThan(Math.min(...zs));
      expect(z).toBeLessThan(Math.max(...zs));
    }

    const lone = new Graph();
    lone.addNode("solo", { kind: "package", x: 5, y: 5 });
    const [plate] = buildAtlasScene(lone).plates;
    expect(plate!.outline).toHaveLength(4);
    expect(buildAtlasScene(lone).nodes[0]!.anchor[1]).toBe(PLATE_THICKNESS);
  });

  it("is deterministic and never fabricates entities", () => {
    const graph = layeredGraph();
    const first = buildAtlasScene(graph);
    expect(buildAtlasScene(graph)).toEqual(first);
    expect(first.nodes.map((node) => node.key)).toEqual(graph.nodes().sort());
    expect(buildAtlasScene(new Graph())).toEqual({ nodes: [], plates: [], edges: [] });
  });
});
