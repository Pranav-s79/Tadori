import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePackageGraph } from "../src/hooks/usePackageGraph.ts";

afterEach(() => vi.unstubAllGlobals());

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("usePackageGraph server projection", () => {
  it("loads one capped package page and consumes deterministic projected edges", async () => {
    const packageNodes = [
      { entityKey: "pkg:a", kind: "package", qualifiedName: "a", displayName: "a", file: null, exported: false, fanIn: 0 },
      { entityKey: "pkg:b", kind: "package", qualifiedName: "b", displayName: "b", file: null, exported: false, fanIn: 0 }
    ];
    const projectedEdges = [
      { entityKey: "package-projection:imports", srcEntityKey: "pkg:a", relation: "imports", dstEntityKey: "pkg:b", origin: "compiler", confidence: "certain", resolution: "resolved" },
      { entityKey: "package-projection:calls", srcEntityKey: "pkg:b", relation: "calls", dstEntityKey: "pkg:a", origin: "heuristic", confidence: "likely", resolution: "partial" }
    ];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(`http://local${String(input)}`);
      if (url.pathname.endsWith("/nodes")) {
        expect(url.searchParams.get("level")).toBe("package");
        expect(url.searchParams.get("limit")).toBe("500");
        return response({ items: packageNodes, nextCursor: null, total: 2, omittedCount: 0 });
      }
      if (url.pathname.endsWith("/edges")) {
        expect(url.searchParams.get("level")).toBe("package");
        expect(url.searchParams.get("relation")).toBeNull();
        expect(url.searchParams.get("limit")).toBe("1000");
        return response({ items: projectedEdges, nextCursor: null, total: 2, omittedCount: 0 });
      }
      if (url.pathname.endsWith("/layout")) return response({ positions: [
        { entityKey: "pkg:a", x: 0, y: 0, z: 0, pinned: false },
        { entityKey: "pkg:b", x: 1, y: 1, z: 0, pinned: false }
      ], layoutVersion: 1 });
      throw new Error(`unexpected request ${url.pathname}`);
    }));
    const { result } = renderHook(() => usePackageGraph());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.data?.nodes).toEqual(packageNodes);
    expect(result.current.data?.edges).toEqual(projectedEdges);
    const endpointKeys = new Set(result.current.data?.nodes.map((node) => node.entityKey));
    expect(result.current.data?.edges.every((edge) => endpointKeys.has(edge.srcEntityKey) && endpointKeys.has(edge.dstEntityKey))).toBe(true);
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(3);
  });
});
