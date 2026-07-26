import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiEdge, ApiNode, LayoutPositionDto } from "../src/api/types.ts";
import Graph from "graphology";
import {
  PackageMapCanvas,
  PartialLodNotice,
  applyFiltersToCanvasGraph,
  applyStoryGraphEmphasis,
  directionalNeighbor,
  focusGraphEntity,
  projectRenderedNodePositions,
  projectedPackagePlates,
  renderedGraphSnapshot,
  truncateLabel
} from "../src/graph/PackageMapCanvas.tsx";
import { defaultFilters } from "../src/features/search/filterState.ts";

// jsdom has no WebGL implementation, and sigma's real constructor calls
// gl.blendFunc(...) unconditionally on the context it gets back from
// canvas.getContext("webgl2"/"webgl"/"experimental-webgl") — all of which
// are null in jsdom — so a real Sigma instance throws at construction time
// in this environment. Per the task's own note ("Sigma's WebGL renderer
// only needs mount/unmount to be jsdom-safe, not pixel output"), this
// smoke test mocks the sigma module so it can assert mount/unmount
// lifecycle wiring without needing a real WebGL context.
const killMock = vi.fn();
const sigmaConstructorMock = vi.fn();
const cameraAnimateMock = vi.fn();
const cameraSetStateMock = vi.fn();
const cameraHandlers = new Map<string, () => void>();
const rendererHandlers = new Map<string, () => void>();
let viewportOffset = 0;
vi.mock("sigma", () => ({
  default: class FakeSigma {
    constructor(...args: unknown[]) {
      sigmaConstructorMock(...args);
    }
    on(event: string, handler: () => void) {
      rendererHandlers.set(event, handler);
    }
    off(event: string) {
      rendererHandlers.delete(event);
    }
    refresh() {
      // redraw request is a no-op without a real WebGL renderer
    }
    resize() {
      // jsdom has no layout; projection is controlled by viewportOffset.
    }
    graphToViewport(point: { x: number; y: number }) {
      return { x: point.x + viewportOffset, y: point.y + viewportOffset };
    }
    getCamera() {
      return {
        animate: cameraAnimateMock,
        setState: cameraSetStateMock,
        getState: () => ({ x: 0.5, y: 0.5, ratio: 1, angle: 0 }),
        on: (event: string, handler: () => void) => cameraHandlers.set(event, handler),
        off: (event: string) => cameraHandlers.delete(event)
      };
    }
    kill() {
      killMock();
    }
  }
}));

afterEach(() => {
  cleanup();
  killMock.mockClear();
  sigmaConstructorMock.mockClear();
  cameraAnimateMock.mockClear();
  cameraSetStateMock.mockClear();
  cameraHandlers.clear();
  rendererHandlers.clear();
  viewportOffset = 0;
  vi.unstubAllGlobals();
});

const nodes: ApiNode[] = [
  { entityKey: "pkg:a", kind: "package", qualifiedName: "@tadori/a", displayName: "@tadori/a", file: null, exported: true, fanIn: 0 },
  { entityKey: "pkg:b", kind: "package", qualifiedName: "@tadori/b", displayName: "@tadori/b", file: null, exported: true, fanIn: 1 }
];
const edges: ApiEdge[] = [
  { entityKey: "e1", srcEntityKey: "pkg:a", relation: "imports", dstEntityKey: "pkg:b", origin: "compiler", confidence: "certain", resolution: "resolved" }
];
const positions: LayoutPositionDto[] = [
  { entityKey: "pkg:a", x: 0, y: 0, z: 0, pinned: false },
  { entityKey: "pkg:b", x: 10, y: 10, z: 0, pinned: false }
];

describe("PackageMapCanvas mount/unmount", () => {
  it("surfaces honest partial expansion counts", () => {
    const { getByRole } = render(<PartialLodNotice scopes={[
      { omittedNodes: 3, omittedEdges: 4 }, { omittedNodes: 2, omittedEdges: 1 }
    ]} />);
    expect(getByRole("status")).toHaveTextContent(
      "Partial expanded view: 5 nodes and 5 relations omitted by LOD budgets."
    );
  });
  it("mounts a Sigma instance without throwing", () => {
    const { unmount } = render(<PackageMapCanvas nodes={nodes} edges={edges} positions={positions} />);
    expect(sigmaConstructorMock).toHaveBeenCalledTimes(1);
    const settings = sigmaConstructorMock.mock.calls[0]?.[2] as {
      nodeProgramClasses: Record<string, unknown>;
      edgeProgramClasses: Record<string, unknown>;
    };
    expect(settings.nodeProgramClasses["atlas-foundation-unknown"]).toBeTypeOf("function");
    expect(Object.keys(settings.edgeProgramClasses).sort()).toEqual(["dashed", "dotted", "solid"]);
    unmount();
  });

  it("kills the Sigma instance on unmount", () => {
    const { unmount } = render(<PackageMapCanvas nodes={nodes} edges={edges} positions={positions} />);
    unmount();
    expect(killMock).toHaveBeenCalledTimes(1);
  });

  it("handles an empty graph without throwing", () => {
    const { unmount } = render(<PackageMapCanvas nodes={[]} edges={[]} positions={[]} />);
    expect(sigmaConstructorMock).toHaveBeenCalledTimes(1);
    unmount();
  });
});

describe("truncateLabel", () => {
  it("leaves labels of 24 chars or fewer unchanged", () => {
    expect(truncateLabel("a".repeat(24))).toBe("a".repeat(24));
    expect(truncateLabel("short")).toBe("short");
    expect(truncateLabel("")).toBe("");
  });

  it("truncates labels longer than 24 chars to exactly 24 chars + ellipsis", () => {
    const result = truncateLabel("a".repeat(25));
    expect(result).toBe(`${"a".repeat(24)}…`);
    expect(result.length).toBe(25); // 24 chars + 1 ellipsis char
  });

  it("truncates a realistic long package name", () => {
    const result = truncateLabel("@tadori/some-extremely-long-package-name");
    expect(result).toBe("@tadori/some-extremely-l…");
    expect(result.startsWith(result.slice(0, 24))).toBe(true);
    expect(result.slice(0, 24).length).toBe(24);
    expect(result.endsWith("…")).toBe(true);
  });
});

describe("camera focus and render-only filters", () => {
  it("focuses the real graph entity through the Sigma camera", () => {
    const graph = new Graph();
    graph.addNode("target", { x: 4, y: 7 });
    const renderer = { getCamera: () => ({
      animate: cameraAnimateMock,
      setState: cameraSetStateMock,
      getState: () => ({ x: 0.5, y: 0.5, ratio: 1, angle: 0 })
    }) };
    expect(focusGraphEntity(renderer, graph, "target", false)).toBe(true);
    expect(cameraAnimateMock).toHaveBeenCalledWith({ x: 4, y: 7, ratio: 0.2 }, { duration: 350 });
    expect(focusGraphEntity(renderer, graph, "target", true)).toBe(true);
    expect(cameraSetStateMock).toHaveBeenCalledWith({ x: 4, y: 7, ratio: 0.2 });
    expect(focusGraphEntity(renderer, graph, "missing", false)).toBe(false);
  });

  it("publishes Sigma viewport coordinates again after a camera update", () => {
    const published: ReadonlyMap<string, { x: number; y: number }>[] = [];
    render(
      <PackageMapCanvas
        nodes={nodes}
        edges={edges}
        positions={positions}
        onViewportPositionsChange={(next) => published.push(next)}
      />
    );
    expect(published.at(-1)?.get("pkg:b")).toEqual({ x: 10, y: 10 });

    viewportOffset = 40;
    act(() => cameraHandlers.get("updated")?.());
    expect(published.at(-1)?.get("pkg:b")).toEqual({ x: 50, y: 50 });
  });

  it("deduplicates canonical expansion entities and preserves edge endpoints", () => {
    const graph = new Graph({ multi: true, type: "directed" });
    const file: ApiNode = { entityKey: "file:shared", kind: "file", qualifiedName: "shared", displayName: "shared", file: "shared.ts", exported: true, fanIn: 0 };
    const symbol: ApiNode = { entityKey: "symbol:shared#run", kind: "function", qualifiedName: "shared.run", displayName: "run", file: "shared.ts", exported: true, fanIn: 1 };
    for (const prefix of ["root", "nested"]) {
      graph.addNode(`${prefix}:file`, { apiNode: file, x: 1, y: 2, selected: prefix === "nested" });
      graph.addNode(`${prefix}:symbol`, { apiNode: symbol, x: 3, y: 4 });
      graph.addEdgeWithKey(`${prefix}:edge`, `${prefix}:file`, `${prefix}:symbol`, {
        apiEdge: { entityKey: "edge:shared", srcEntityKey: file.entityKey, relation: "contains", dstEntityKey: symbol.entityKey, origin: "parser", confidence: "certain", resolution: "resolved" } satisfies ApiEdge
      });
    }

    const snapshot = renderedGraphSnapshot(graph);
    expect(snapshot.nodes.map((node) => node.entityKey)).toEqual([file.entityKey, symbol.entityKey]);
    expect(snapshot.edges.map((edge) => edge.entityKey)).toEqual(["edge:shared"]);
    expect(snapshot.edges.every((edge) => snapshot.nodes.some((node) => node.entityKey === edge.srcEntityKey)
      && snapshot.nodes.some((node) => node.entityKey === edge.dstEntityKey))).toBe(true);
    expect(snapshot.selectedEntityKey).toBe(file.entityKey);
  });

  it("projects each duplicate canonical entity once using deterministic graph-key order", () => {
    const graph = new Graph();
    const node: ApiNode = { entityKey: "file:shared", kind: "file", qualifiedName: "shared", displayName: "shared", file: "shared.ts", exported: true, fanIn: 0 };
    graph.addNode("z-copy", { apiNode: node, x: 50, y: 60 });
    graph.addNode("a-copy", { apiNode: node, x: 5, y: 6 });
    const projected = projectRenderedNodePositions({ graphToViewport: ({ x, y }) => ({ x: x * 2, y: y * 3 }) }, graph);
    expect([...projected]).toEqual([[node.entityKey, { x: 10, y: 18 }]]);
  });

  it("draws package plates only for repository-known expanded membership", () => {
    const graph = new Graph();
    const pkg: ApiNode = { entityKey: "pkg:known", kind: "package", qualifiedName: "known", displayName: "known", file: null, exported: true, fanIn: 0 };
    const collapsed: ApiNode = { ...pkg, entityKey: "pkg:collapsed", qualifiedName: "collapsed", displayName: "collapsed" };
    graph.addNode(pkg.entityKey, { apiNode: pkg, kind: "package", packageMembershipKnown: true, x: 0, y: 0 });
    graph.addNode(collapsed.entityKey, { apiNode: collapsed, kind: "package", x: 9, y: 9 });
    for (const [key, x, y] of [["file:a", 0, 0], ["file:b", 10, 0], ["file:c", 0, 10]] as const) {
      const file: ApiNode = { entityKey: key, kind: "file", qualifiedName: key, displayName: key, file: `${key}.ts`, exported: true, fanIn: 0 };
      graph.addNode(key, { apiNode: file, kind: "file", expandedFrom: pkg.entityKey, x, y });
    }
    const plates = projectedPackagePlates({ graphToViewport: ({ x, y }) => ({ x: x + 4, y: y + 5 }) }, graph);
    expect(plates).toHaveLength(1);
    expect(plates[0]).toEqual(expect.objectContaining({
      packageEntityKey: pkg.entityKey,
      label: "known",
      attribution: "repository-derived package boundary",
      shape: expect.objectContaining({ kind: "hull" })
    }));
  });

  it("dims unrelated marks and uses copper only for the evidenced Story path", () => {
    const graph = new Graph({ multi: true, type: "directed" });
    const apiNodes = ["a", "b", "other"].map((entityKey) => ({ entityKey, kind: "package", qualifiedName: entityKey, displayName: entityKey, file: null, exported: true, fanIn: 0 } satisfies ApiNode));
    for (const node of apiNodes) graph.addNode(node.entityKey, { apiNode: node, x: 0, y: 0, baseSize: 8, size: 8, color: "blue" });
    const pathEdge: ApiEdge = { entityKey: "path", srcEntityKey: "a", relation: "calls", dstEntityKey: "b", origin: "compiler", confidence: "certain", resolution: "resolved" };
    const otherEdge: ApiEdge = { entityKey: "other-edge", srcEntityKey: "a", relation: "references", dstEntityKey: "other", origin: "doc", confidence: "likely", resolution: "resolved" };
    graph.addEdgeWithKey(pathEdge.entityKey, "a", "b", { apiEdge: pathEdge, relation: pathEdge.relation, baseSize: 1, size: 1 });
    graph.addEdgeWithKey(otherEdge.entityKey, "a", "other", { apiEdge: otherEdge, relation: otherEdge.relation, baseSize: 1, size: 1 });
    applyStoryGraphEmphasis(graph, {
      pathEntityKeys: ["a", "b"],
      transitions: [{ fromEntityKey: "a", toEntityKey: "b", relation: "calls" }],
      activeEntityKey: "b",
      unresolvedFromEntityKey: null
    });
    expect(graph.getNodeAttribute("a", "color")).toBe("#b87333");
    expect(graph.getNodeAttribute("b", "color")).toBe("#9a4f22");
    expect(graph.getNodeAttribute("other", "storyDimmed")).toBe(true);
    expect(graph.getEdgeAttribute("path", "color")).toBe("#b87333");
    expect(graph.getEdgeAttribute("other-edge", "storyDimmed")).toBe(true);
  });

  it("focuses Story representatives without animation under reduced motion", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    render(<PackageMapCanvas nodes={nodes} edges={edges} positions={positions} storyEmphasis={{
      pathEntityKeys: ["pkg:a"], transitions: [], activeEntityKey: "pkg:a", unresolvedFromEntityKey: null
    }} />);
    expect(cameraSetStateMock).toHaveBeenCalledWith({ x: 0, y: 0, ratio: 0.2 });
  });

  it("finds the nearest node in the requested keyboard direction", () => {
    const graph = new Graph();
    graph.addNode("center", { x: 0, y: 0 });
    graph.addNode("near-right", { x: 2, y: 1 });
    graph.addNode("far-right", { x: 9, y: 0 });
    graph.addNode("left", { x: -1, y: 0 });
    expect(directionalNeighbor(graph, "center", "ArrowRight")).toBe("near-right");
    expect(directionalNeighbor(graph, "center", "ArrowLeft")).toBe("left");
  });

  it("dims non-matches while preserving every node and edge", () => {
    const graph = new Graph({ multi: true, type: "directed" });
    graph.addNode("py", { kind: "package", qualifiedName: "py", displayName: "py", file: null, exported: false, fanIn: 0, x: 0, y: 0, language: null, aggregateLanguages: ["python"], aggregateCapabilities: ["structural"], aggregateDerivations: ["parser-derived"], color: "blue", size: 6 });
    graph.addNode("ts", { kind: "package", qualifiedName: "ts", displayName: "ts", file: null, exported: false, fanIn: 0, x: 1, y: 1, language: null, aggregateLanguages: ["typescript"], aggregateCapabilities: ["semantic"], aggregateDerivations: ["compiler-resolved"], color: "blue", size: 6 });
    graph.addEdgeWithKey("edge", "py", "ts", { relation: "calls", origin: "heuristic", confidence: "likely", resolution: "resolved", language: "python", provenance: { extractorId: "x", extractorVersion: "1", capability: "structural", derivation: "parser-derived", unresolvedReason: null }, color: "gray", size: 1 });
    const before = { order: graph.order, size: graph.size };
    applyFiltersToCanvasGraph(graph, { ...defaultFilters(), languages: ["python"] });
    expect({ order: graph.order, size: graph.size }).toEqual(before);
    expect(graph.getNodeAttribute("py", "filterDimmed")).toBe(false);
    expect(graph.getNodeAttribute("ts", "filterDimmed")).toBe(true);
    expect(graph.getEdgeAttribute("edge", "filterDimmed")).toBe(false);
    expect(graph.getNodeAttribute("ts", "hidden")).toBe(false);
  });
});
