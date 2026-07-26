import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPackageNodes } from "../src/api/client.ts";
import {
  LABEL_BUDGET,
  LOD_BUDGETS,
  clampLodRequestLimit,
  visibleLabelEntityKeys
} from "../src/lod/budgets.ts";

afterEach(() => vi.unstubAllGlobals());

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

describe("LOD budgets", () => {
  it("keeps every frozen node, edge, and label ceiling exact", () => {
    expect(LOD_BUDGETS).toEqual({
      package: { nodes: 500, edges: 1_000 },
      file: { nodes: 500, edges: 1_000 },
      symbol: { nodes: 1_000, edges: 1_000 }
    });
    expect(LABEL_BUDGET).toEqual({ minRadiusPx: 6, maxSimultaneous: 200 });
  });

  it("clamps an oversized package request before fetch and accepts only one bounded page", async () => {
    const items = Array.from({ length: 500 }, (_, index) => ({ entityKey: `package-${String(index)}` }));
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response({
      items,
      nextCursor: "500",
      total: 750,
      omittedCount: 250
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchPackageNodes(9_999)).resolves.toHaveLength(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("level=package");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("limit=500");
    expect(clampLodRequestLimit("symbol", "nodes", 9_999)).toBe(1_000);
  });

  it("rejects a server response that exceeds the package budget", async () => {
    const items = Array.from({ length: 501 }, (_, index) => ({ entityKey: `package-${String(index)}` }));
    vi.stubGlobal("fetch", vi.fn(async () => response({ items, nextCursor: null, total: 501 })));
    await expect(fetchPackageNodes()).rejects.toThrow("package nodes response contained 501 items; budget is 500");
  });

  it("renders no more than 200 labels and excludes radii below 6px", () => {
    const candidates = Array.from({ length: 500 }, (_, index) => ({
      entityKey: `node-${String(index).padStart(3, "0")}`,
      radiusPx: index < 25 ? 5.99 : 6 + index / 1_000
    }));
    const visible = visibleLabelEntityKeys(candidates);
    expect(visible).toHaveLength(200);
    expect(visible.every((key) => Number(key.slice(5)) >= 25)).toBe(true);
  });
});
