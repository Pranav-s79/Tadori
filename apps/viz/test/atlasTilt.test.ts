import Graph from "graphology";
import { describe, expect, it } from "vitest";
import type { ApiNode } from "../src/api/types.ts";
import { applyAtlasProjection, nodeAbstractionLevel } from "../src/graph/atlasTilt.ts";
import { renderedGraphSnapshot } from "../src/graph/PackageMapCanvas.tsx";
import { ISOMETRIC_TILT_RADIANS } from "../src/render/fixedTiltProjection.ts";

const COS = Math.cos(ISOMETRIC_TILT_RADIANS);

function apiNode(entityKey: string, kind: ApiNode["kind"]): ApiNode {
  return { entityKey, kind, qualifiedName: entityKey, displayName: entityKey, file: null, exported: true, fanIn: 0 };
}

/** A package, one of its files and one of that file's symbols, as expansion leaves them. */
function threeLevels(): Graph {
  const graph = new Graph({ multi: true, type: "directed" });
  graph.addNode("pkg", { apiNode: apiNode("pkg", "package"), kind: "package", x: 0, y: 10, z: 999 });
  graph.addNode("pkg::file", {
    apiNode: apiNode("file", "file"), kind: "file", x: 50, y: 10, z: -999, expandedFrom: "pkg"
  });
  graph.addNode("pkg::file::sym", {
    apiNode: apiNode("sym", "function"), kind: "function", x: 100, y: 10, z: 0, expandedFromFile: "pkg::file"
  });
  return graph;
}

describe("nodeAbstractionLevel", () => {
  it("reads the level each node was fetched at from the expansion markers", () => {
    const graph = threeLevels();
    expect(nodeAbstractionLevel(graph.getNodeAttributes("pkg"))).toBe("package");
    expect(nodeAbstractionLevel(graph.getNodeAttributes("pkg::file"))).toBe("file");
    expect(nodeAbstractionLevel(graph.getNodeAttributes("pkg::file::sym"))).toBe("symbol");
  });
});

describe("applyAtlasProjection", () => {
  it("keeps x, foreshortens the ground and lifts each level above the last", () => {
    const graph = threeLevels();
    applyAtlasProjection(graph, true);
    expect(graph.getNodeAttribute("pkg", "x")).toBe(0);
    expect(graph.getNodeAttribute("pkg::file", "x")).toBe(50);
    expect(graph.getNodeAttribute("pkg::file::sym", "x")).toBe(100);
    // Level 0 sits on the ground plane. Sigma's y grows upward, so a lift is +y.
    expect(graph.getNodeAttribute("pkg", "y")).toBeCloseTo(10 * COS, 10);
    const pkgY = graph.getNodeAttribute("pkg", "y") as number;
    const fileY = graph.getNodeAttribute("pkg::file", "y") as number;
    const symY = graph.getNodeAttribute("pkg::file::sym", "y") as number;
    expect(fileY).toBeGreaterThan(pkgY);
    expect(symY - fileY).toBeCloseTo(fileY - pkgY, 10);
  });

  it("never reads the server's z: depth comes from the level alone", () => {
    const graph = threeLevels();
    graph.setNodeAttribute("pkg", "z", 0);
    graph.setNodeAttribute("pkg::file", "z", 0);
    applyAtlasProjection(graph, true);
    const withZeroZ = graph.getNodeAttribute("pkg::file", "y");
    const other = threeLevels();
    applyAtlasProjection(other, true);
    expect(other.getNodeAttribute("pkg::file", "y")).toBe(withZeroZ);
  });

  it("is idempotent, so re-applying after a mutation never tilts twice", () => {
    const graph = threeLevels();
    applyAtlasProjection(graph, true);
    const once = graph.mapNodes((key, attrs) => [key, attrs.x, attrs.y]);
    applyAtlasProjection(graph, true);
    expect(graph.mapNodes((key, attrs) => [key, attrs.x, attrs.y])).toEqual(once);
  });

  it("restores Plan to the exact prior attributes", () => {
    const graph = threeLevels();
    const before = graph.mapNodes((key, attrs) => [key, { ...attrs }]);
    applyAtlasProjection(graph, true);
    applyAtlasProjection(graph, false);
    expect(graph.mapNodes((key, attrs) => [key, { ...attrs }])).toEqual(before);
  });

  it("leaves a graph that was never tilted untouched", () => {
    const graph = threeLevels();
    const before = graph.mapNodes((key, attrs) => [key, { ...attrs }]);
    applyAtlasProjection(graph, false);
    expect(graph.mapNodes((key, attrs) => [key, { ...attrs }])).toEqual(before);
  });

  it("keeps the published layout positions truthful while tilted", () => {
    const graph = threeLevels();
    const plan = renderedGraphSnapshot(graph).positions;
    applyAtlasProjection(graph, true);
    expect(renderedGraphSnapshot(graph).positions).toEqual(plan);
  });
});
