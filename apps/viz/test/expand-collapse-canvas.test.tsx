import { act, cleanup, render, waitFor } from "@testing-library/react";
import type Graph from "graphology";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiEdge, ApiNode, LayoutPositionDto } from "../src/api/types.ts";
import { PackageMapCanvas } from "../src/graph/PackageMapCanvas.tsx";
import { installMockFetch } from "./mockServer.ts";

// Mock sigma (no WebGL in jsdom). The fake captures event handlers so the test
// can emit a clickNode, exercising the real activate -> expand/collapse path.
const handlers = new Map<string, (payload: { node: string }) => void>();
const refreshMock = vi.fn();
const killMock = vi.fn();
vi.mock("sigma", () => ({
  default: class FakeSigma {
    on(event: string, handler: (payload: { node: string }) => void) {
      handlers.set(event, handler);
    }
    refresh() {
      refreshMock();
    }
    kill() {
      killMock();
    }
  }
}));

let restore: (() => void) | null = null;
afterEach(() => {
  cleanup();
  handlers.clear();
  refreshMock.mockClear();
  killMock.mockClear();
  restore?.();
  restore = null;
});

const nodes: ApiNode[] = [
  { entityKey: "pkg:core", kind: "package", qualifiedName: "@tadori/core", displayName: "@tadori/core", file: null, exported: true, fanIn: 0 },
  { entityKey: "pkg:store", kind: "package", qualifiedName: "@tadori/store", displayName: "@tadori/store", file: null, exported: true, fanIn: 1 },
  { entityKey: "pkg:server", kind: "package", qualifiedName: "@tadori/server", displayName: "@tadori/server", file: null, exported: true, fanIn: 1 }
];
const edges: ApiEdge[] = [
  { entityKey: "e1", srcEntityKey: "pkg:server", relation: "imports", dstEntityKey: "pkg:store", origin: "compiler", confidence: "certain", resolution: "resolved" }
];
const positions: LayoutPositionDto[] = [
  { entityKey: "pkg:core", x: 0, y: 0, z: 0, pinned: false },
  { entityKey: "pkg:store", x: 100, y: 0, z: 0, pinned: false },
  { entityKey: "pkg:server", x: 50, y: 100, z: 0, pinned: false }
];

function snapshotPositions(graph: Graph): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  graph.forEachNode((key, attrs) => {
    out[key] = { x: attrs.x as number, y: attrs.y as number };
  });
  return out;
}

describe("expand/collapse canvas byte-stability", () => {
  it("expanding one package leaves every other package's node position Object.is-unchanged, and collapse restores exactly", async () => {
    restore = installMockFetch();
    let graph: Graph | null = null;
    render(<PackageMapCanvas nodes={nodes} edges={edges} positions={positions} onGraphReady={(g) => (graph = g)} />);
    expect(graph).not.toBeNull();
    const g = graph as unknown as Graph;

    const before = snapshotPositions(g);
    const beforeCount = g.order;
    const corePosBefore = g.getNodeAttribute("pkg:core", "x");

    // Expand pkg:core via the real clickNode -> activate -> expand path.
    await act(async () => {
      handlers.get("clickNode")?.({ node: "pkg:core" });
    });
    await waitFor(() => {
      expect(g.hasNode("pkg:core::file:core/a.ts")).toBe(true);
    });

    // Other packages' positions are Object.is-unchanged; pkg:core's own anchor too.
    expect(Object.is(g.getNodeAttribute("pkg:store", "x"), before["pkg:store"]?.x)).toBe(true);
    expect(Object.is(g.getNodeAttribute("pkg:store", "y"), before["pkg:store"]?.y)).toBe(true);
    expect(Object.is(g.getNodeAttribute("pkg:server", "x"), before["pkg:server"]?.x)).toBe(true);
    expect(Object.is(g.getNodeAttribute("pkg:core", "x"), corePosBefore)).toBe(true);

    // File label truncated at 20 chars (a.ts is short -> unchanged; assert present).
    expect(g.getNodeAttribute("pkg:core::file:core/a.ts", "label")).toBe("a.ts");

    // Collapse restores exact prior count + positions.
    await act(async () => {
      handlers.get("clickNode")?.({ node: "pkg:core" });
    });
    await waitFor(() => {
      expect(g.hasNode("pkg:core::file:core/a.ts")).toBe(false);
    });
    expect(g.order).toBe(beforeCount);
    const after = snapshotPositions(g);
    expect(after).toEqual(before);
    for (const key of Object.keys(before)) {
      expect(Object.is(after[key]?.x, before[key]?.x)).toBe(true);
      expect(Object.is(after[key]?.y, before[key]?.y)).toBe(true);
    }
  });

  it("keyboard Enter on a focused package node toggles expansion like a click", async () => {
    restore = installMockFetch();
    let graph: Graph | null = null;
    const { container } = render(
      <PackageMapCanvas nodes={nodes} edges={edges} positions={positions} onGraphReady={(g) => (graph = g)} />
    );
    const canvas = container.querySelector(".package-map-canvas") as HTMLDivElement;
    canvas.dataset.focusedNode = "pkg:store";
    const g = graph as unknown as Graph;

    await act(async () => {
      canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await waitFor(() => {
      expect(g.hasNode("pkg:store::file:store/index.ts")).toBe(true);
    });
  });
});
