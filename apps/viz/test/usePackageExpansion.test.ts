import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePackageExpansion } from "../src/hooks/usePackageExpansion.ts";
import { useFileExpansion } from "../src/hooks/useFileExpansion.ts";
import { installMockFetch } from "./mockServer.ts";

let restore: (() => void) | null = null;

afterEach(() => {
  restore?.();
  restore = null;
  vi.restoreAllMocks();
});

describe("usePackageExpansion", () => {
  it("preserves bounded file-page omission metadata", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("/nodes")
        ? { items: [{ entityKey: "file:a", kind: "file", qualifiedName: "a", displayName: "a", file: "a.ts", exported: false, fanIn: 0 }], nextCursor: null, total: 4, omittedCount: 3, scope: { totalNodeCount: 4, boundedNodeCount: 1, omittedNodeCount: 3, omittedEdgeCount: 0 } }
        : url.includes("/edges")
          ? { items: [], nextCursor: null, total: 0, omittedCount: 5, scope: { totalNodeCount: 4, boundedNodeCount: 1, omittedNodeCount: 3, omittedEdgeCount: 5 } }
          : { positions: [{ entityKey: "file:a", x: 0, y: 0, z: 0, pinned: false }], layoutVersion: 1 };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    restore = () => { globalThis.fetch = originalFetch; };
    const { result } = renderHook(() => usePackageExpansion());
    await act(async () => { await result.current.expand("pkg", "pkg"); });
    expect(result.current.fileData.get("pkg")?.partial).toEqual({ omittedNodes: 3, omittedEdges: 5 });
  });
  it("(a) expand(pkg) adds it to expandedPackages and loads file data from the mock", async () => {
    restore = installMockFetch();
    const { result } = renderHook(() => usePackageExpansion());

    await act(async () => {
      await result.current.expand("pkg:core", "@tadori/core");
    });

    expect(result.current.expandedPackages.has("pkg:core")).toBe(true);
    const data = result.current.fileData.get("pkg:core");
    expect(data?.nodes.map((n) => n.entityKey)).toEqual(["file:core/a.ts", "file:core/b.ts"]);
    expect(data?.positions).toHaveLength(2);
  });

  it("uses the qualified package name for server scoping while retaining the entity key as view identity", async () => {
    restore = installMockFetch();
    const spy = vi.spyOn(globalThis, "fetch");
    const { result } = renderHook(() => usePackageExpansion());
    await act(async () => {
      await result.current.expand("entity-key-is-not-the-name", "@tadori/core");
    });
    expect(result.current.expandedPackages.has("entity-key-is-not-the-name")).toBe(true);
    expect(result.current.fileData.get("entity-key-is-not-the-name")?.nodes).toHaveLength(2);
    expect(spy.mock.calls.some(([input]) => String(input).includes("packageName=%40tadori%2Fcore"))).toBe(true);
  });

  it("(b) collapse(pkg) removes it from expandedPackages", async () => {
    restore = installMockFetch();
    const { result } = renderHook(() => usePackageExpansion());

    await act(async () => {
      await result.current.expand("pkg:core", "@tadori/core");
    });
    act(() => {
      result.current.collapse("pkg:core");
    });

    expect(result.current.expandedPackages.has("pkg:core")).toBe(false);
  });

  it("(c) re-expanding a previously-collapsed package issues zero additional fetches (ref cache)", async () => {
    const spy = vi.fn(globalThis.fetch);
    restore = installMockFetch();
    const wrappedRestore = restore;
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      spy(...args);
      return realFetch(...args);
    }) as typeof fetch;
    restore = () => {
      globalThis.fetch = realFetch;
      wrappedRestore();
    };

    const { result } = renderHook(() => usePackageExpansion());
    await act(async () => {
      await result.current.expand("pkg:core", "@tadori/core");
    });
    const callsAfterFirstExpand = spy.mock.calls.length;
    expect(callsAfterFirstExpand).toBeGreaterThan(0);

    act(() => {
      result.current.collapse("pkg:core");
    });
    await act(async () => {
      await result.current.expand("pkg:core", "@tadori/core");
    });

    expect(spy.mock.calls.length).toBe(callsAfterFirstExpand);
    expect(result.current.expandedPackages.has("pkg:core")).toBe(true);
  });

  it("(d) expanding two different packages leaves both expanded", async () => {
    restore = installMockFetch();
    const { result } = renderHook(() => usePackageExpansion());

    await act(async () => {
      await result.current.expand("pkg:core", "@tadori/core");
      await result.current.expand("pkg:store", "@tadori/store");
    });

    await waitFor(() => {
      expect(result.current.expandedPackages.has("pkg:core")).toBe(true);
      expect(result.current.expandedPackages.has("pkg:store")).toBe(true);
    });
  });
});

describe("useFileExpansion bounded state", () => {
  it("preserves bounded symbol-page omission metadata", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("/nodes")
        ? { items: [{ entityKey: "symbol:a", kind: "function", qualifiedName: "a", displayName: "a", file: "a.ts", exported: true, fanIn: 0 }], nextCursor: null, total: 8, omittedCount: 7, scope: { totalNodeCount: 8, boundedNodeCount: 1, omittedNodeCount: 7, omittedEdgeCount: 0 } }
        : url.includes("/edges")
          ? { items: [], nextCursor: null, total: 0, omittedCount: 6, scope: { totalNodeCount: 8, boundedNodeCount: 1, omittedNodeCount: 7, omittedEdgeCount: 6 } }
          : { positions: [{ entityKey: "symbol:a", x: 0, y: 0, z: 0, pinned: false }], layoutVersion: 1 };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    restore = () => { globalThis.fetch = originalFetch; };
    const { result } = renderHook(() => useFileExpansion());
    await act(async () => { await result.current.expand("file:a", "a.ts"); });
    expect(result.current.symbolData.get("file:a")?.partial).toEqual({ omittedNodes: 7, omittedEdges: 6 });
  });
});
