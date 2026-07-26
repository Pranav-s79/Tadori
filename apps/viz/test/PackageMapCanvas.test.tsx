import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiEdge, ApiNode, LayoutPositionDto } from "../src/api/types.ts";
import Graph from "graphology";
import { PackageMapCanvas, PartialLodNotice, applyFiltersToCanvasGraph, focusGraphEntity, truncateLabel } from "../src/graph/PackageMapCanvas.tsx";
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
vi.mock("sigma", () => ({
  default: class FakeSigma {
    constructor(...args: unknown[]) {
      sigmaConstructorMock(...args);
    }
    on() {
      // event wiring (clickNode) is no-op in the mount/unmount smoke test
    }
    refresh() {
      // redraw request is a no-op without a real WebGL renderer
    }
    getCamera() {
      return { animate: cameraAnimateMock, setState: cameraSetStateMock };
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
    const renderer = { getCamera: () => ({ animate: cameraAnimateMock, setState: cameraSetStateMock }) };
    expect(focusGraphEntity(renderer, graph, "target", false)).toBe(true);
    expect(cameraAnimateMock).toHaveBeenCalledWith({ x: 4, y: 7, ratio: 0.2 }, { duration: 350 });
    expect(focusGraphEntity(renderer, graph, "missing", false)).toBe(false);
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
