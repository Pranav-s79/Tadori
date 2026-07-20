import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePackageExpansion } from "../src/hooks/usePackageExpansion.ts";
import { installMockFetch } from "./mockServer.ts";

let restore: (() => void) | null = null;

afterEach(() => {
  restore?.();
  restore = null;
  vi.restoreAllMocks();
});

describe("usePackageExpansion", () => {
  it("(a) expand(pkg) adds it to expandedPackages and loads file data from the mock", async () => {
    restore = installMockFetch();
    const { result } = renderHook(() => usePackageExpansion());

    await act(async () => {
      await result.current.expand("pkg:core");
    });

    expect(result.current.expandedPackages.has("pkg:core")).toBe(true);
    const data = result.current.fileData.get("pkg:core");
    expect(data?.nodes.map((n) => n.entityKey)).toEqual(["file:core/a.ts", "file:core/b.ts"]);
    expect(data?.positions).toHaveLength(2);
  });

  it("(b) collapse(pkg) removes it from expandedPackages", async () => {
    restore = installMockFetch();
    const { result } = renderHook(() => usePackageExpansion());

    await act(async () => {
      await result.current.expand("pkg:core");
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
      await result.current.expand("pkg:core");
    });
    const callsAfterFirstExpand = spy.mock.calls.length;
    expect(callsAfterFirstExpand).toBeGreaterThan(0);

    act(() => {
      result.current.collapse("pkg:core");
    });
    await act(async () => {
      await result.current.expand("pkg:core");
    });

    expect(spy.mock.calls.length).toBe(callsAfterFirstExpand);
    expect(result.current.expandedPackages.has("pkg:core")).toBe(true);
  });

  it("(d) expanding two different packages leaves both expanded", async () => {
    restore = installMockFetch();
    const { result } = renderHook(() => usePackageExpansion());

    await act(async () => {
      await result.current.expand("pkg:core");
      await result.current.expand("pkg:store");
    });

    await waitFor(() => {
      expect(result.current.expandedPackages.has("pkg:core")).toBe(true);
      expect(result.current.expandedPackages.has("pkg:store")).toBe(true);
    });
  });
});
