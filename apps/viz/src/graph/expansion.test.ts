import Graph from "graphology";
import { describe, expect, it } from "vitest";
import type { ApiEdge, ApiNode, LayoutPositionDto } from "../api/types.ts";
import { applySymbolCollapse, applySymbolExpansion, symbolNodeId } from "./expansion.ts";

function symbolNode(entityKey: string, file: string): ApiNode {
  return {
    entityKey,
    kind: "function",
    qualifiedName: entityKey,
    displayName: entityKey,
    file,
    exported: true,
    fanIn: 0
  };
}

function symbolEdge(entityKey: string, src: string, dst: string): ApiEdge {
  return {
    entityKey,
    srcEntityKey: src,
    relation: "calls",
    dstEntityKey: dst,
    origin: "compiler",
    confidence: "certain",
    resolution: "resolved"
  };
}

function pos(entityKey: string, x: number, y: number): LayoutPositionDto {
  return { entityKey, x, y, z: 0, pinned: false };
}

/** A base graph with one already-present file node the symbols expand under. */
function baseGraph(fileKey: string): Graph {
  const graph = new Graph();
  graph.addNode(fileKey, { kind: "file", displayName: "f.ts", file: "src/f.ts", x: 5, y: 7 });
  return graph;
}

describe("symbol-level expansion (08-04)", () => {
  const fileKey = "pkg::filekey";
  const data = {
    nodes: [symbolNode("s1", "src/f.ts"), symbolNode("s2", "src/f.ts")],
    edges: [symbolEdge("e1", "s1", "s2")],
    positions: [pos("s1", 10, 20), pos("s2", 30, 40)]
  };

  it("adds symbol nodes namespaced under their file key, at their layout positions", () => {
    const graph = baseGraph(fileKey);
    applySymbolExpansion(graph, fileKey, data);
    expect(graph.hasNode(symbolNodeId(fileKey, "s1"))).toBe(true);
    expect(graph.hasNode(symbolNodeId(fileKey, "s2"))).toBe(true);
    expect(graph.getNodeAttribute(symbolNodeId(fileKey, "s1"), "x")).toBe(10);
    expect(graph.getNodeAttribute(symbolNodeId(fileKey, "s1"), "expandedFromFile")).toBe(fileKey);
    expect(graph.hasEdge("sym:pkg::filekey:e1")).toBe(true);
  });

  it("never touches the pre-existing file node (byte-stable positions)", () => {
    const graph = baseGraph(fileKey);
    const beforeX = graph.getNodeAttribute(fileKey, "x");
    const beforeY = graph.getNodeAttribute(fileKey, "y");
    applySymbolExpansion(graph, fileKey, data);
    expect(graph.getNodeAttribute(fileKey, "x")).toBe(beforeX);
    expect(graph.getNodeAttribute(fileKey, "y")).toBe(beforeY);
  });

  it("collapse restores the graph exactly (same nodes/edges as before expansion)", () => {
    const graph = baseGraph(fileKey);
    const nodesBefore = graph.nodes().sort();
    const edgesBefore = graph.edges().sort();
    applySymbolExpansion(graph, fileKey, data);
    applySymbolCollapse(graph, fileKey, data);
    expect(graph.nodes().sort()).toEqual(nodesBefore);
    expect(graph.edges().sort()).toEqual(edgesBefore);
  });

  it("namespaces symbols by file so the same entity under two files never collides", () => {
    const graph = new Graph();
    graph.addNode("pkg::fileA", { kind: "file", file: "a.ts", x: 0, y: 0 });
    graph.addNode("pkg::fileB", { kind: "file", file: "b.ts", x: 1, y: 1 });
    const shared = { nodes: [symbolNode("shared", "a.ts")], edges: [], positions: [pos("shared", 0, 0)] };
    applySymbolExpansion(graph, "pkg::fileA", shared);
    applySymbolExpansion(graph, "pkg::fileB", shared);
    expect(graph.hasNode(symbolNodeId("pkg::fileA", "shared"))).toBe(true);
    expect(graph.hasNode(symbolNodeId("pkg::fileB", "shared"))).toBe(true);
    expect(symbolNodeId("pkg::fileA", "shared")).not.toBe(symbolNodeId("pkg::fileB", "shared"));
  });
});
