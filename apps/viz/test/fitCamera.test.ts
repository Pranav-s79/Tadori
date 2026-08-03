import Graph from "graphology";
import { describe, expect, it, vi } from "vitest";
import { fitCameraToVisibleNodes } from "../src/graph/PackageMapCanvas.tsx";

/**
 * A stub in the same normalized framed-graph space Sigma's camera uses. Real
 * display data is camera-transformed, which is exactly why the fit must read
 * `getNodeDisplayData` rather than the raw layout coordinates on the nodes.
 */
function stubRenderer(display: Record<string, { x: number; y: number } | undefined>) {
  const setState = vi.fn();
  const animate = vi.fn();
  return {
    setState,
    animate,
    renderer: {
      getCamera: () => ({
        setState,
        animate,
        getState: () => ({ x: 0.5, y: 0.5, ratio: 1, angle: 0 })
      }),
      getNodeDisplayData: (key: string) => display[key]
    }
  };
}

function graphOf(keys: readonly string[], hidden: readonly string[] = []): Graph {
  const graph = new Graph();
  for (const key of keys) graph.addNode(key, { hidden: hidden.includes(key) });
  return graph;
}

describe("fitCameraToVisibleNodes", () => {
  it("centres on the visible extent and zooms to cover it", () => {
    const { renderer, setState } = stubRenderer({
      a: { x: 0.2, y: 0.4 },
      b: { x: 0.6, y: 0.8 }
    });

    expect(fitCameraToVisibleNodes(renderer, graphOf(["a", "b"]), true)).toBe(true);

    const state = setState.mock.calls[0]?.[0] as { x: number; y: number; ratio: number };
    expect(state.x).toBeCloseTo(0.4);
    expect(state.y).toBeCloseTo(0.6);
    // 0.4 extent plus breathing room, and never wider than the framed space.
    expect(state.ratio).toBeGreaterThan(0.4);
    expect(state.ratio).toBeLessThanOrEqual(1);
  });

  /**
   * The defect this exists for: one distant node stretched the extent so the
   * cluster sat in a corner. The fit has to include the outlier, which is what
   * keeps it on screen instead of off the edge.
   */
  it("frames an outlier rather than cropping it", () => {
    const { renderer, setState } = stubRenderer({
      a: { x: 0.50, y: 0.50 },
      b: { x: 0.52, y: 0.51 },
      far: { x: 0.50, y: 0.95 }
    });

    fitCameraToVisibleNodes(renderer, graphOf(["a", "b", "far"]), true);

    const state = setState.mock.calls[0]?.[0] as { y: number; ratio: number };
    expect(state.y).toBeCloseTo(0.725);
    expect(state.ratio).toBeGreaterThanOrEqual(0.45);
  });

  it("ignores hidden nodes so a filtered-out outlier cannot stretch the view", () => {
    const { renderer, setState } = stubRenderer({
      a: { x: 0.50, y: 0.50 },
      b: { x: 0.54, y: 0.50 },
      far: { x: 0.50, y: 0.99 }
    });

    fitCameraToVisibleNodes(renderer, graphOf(["a", "b", "far"], ["far"]), true);

    expect((setState.mock.calls[0]?.[0] as { y: number }).y).toBeCloseTo(0.5);
  });

  /**
   * A lone node has no extent. Deriving zoom from a zero span would divide the
   * view down to nothing, so it takes the same close ratio a focus request uses.
   */
  it("uses a readable ratio for a single node instead of dividing by its extent", () => {
    const { renderer, setState } = stubRenderer({ only: { x: 0.5, y: 0.5 } });

    fitCameraToVisibleNodes(renderer, graphOf(["only"]), true);

    expect((setState.mock.calls[0]?.[0] as { ratio: number }).ratio).toBe(0.2);
  });

  it("reports failure and moves nothing when no node can be placed", () => {
    const { renderer, setState, animate } = stubRenderer({ ghost: undefined });

    expect(fitCameraToVisibleNodes(renderer, graphOf(["ghost"]), true)).toBe(false);
    expect(setState).not.toHaveBeenCalled();
    expect(animate).not.toHaveBeenCalled();
  });

  it("animates only when motion is allowed", () => {
    const allowed = stubRenderer({ a: { x: 0.2, y: 0.2 }, b: { x: 0.8, y: 0.8 } });
    fitCameraToVisibleNodes(allowed.renderer, graphOf(["a", "b"]), false);
    expect(allowed.animate).toHaveBeenCalledTimes(1);
    expect(allowed.setState).not.toHaveBeenCalled();

    const reduced = stubRenderer({ a: { x: 0.2, y: 0.2 }, b: { x: 0.8, y: 0.8 } });
    fitCameraToVisibleNodes(reduced.renderer, graphOf(["a", "b"]), true);
    expect(reduced.setState).toHaveBeenCalledTimes(1);
    expect(reduced.animate).not.toHaveBeenCalled();
  });
});
