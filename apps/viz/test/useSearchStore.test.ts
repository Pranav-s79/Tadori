import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSearchStore } from "../src/features/search/useSearchStore.ts";

// Deferred-resolution fetch harness: each call returns a promise we resolve
// manually, so we can force out-of-order resolution for the generation-guard
// test. Body is a valid FtsSearchResult echoing which query was requested.
interface Pending {
  url: string;
  resolve: (body: { matches: unknown[]; total: number }) => void;
}

let pending: Pending[] = [];

function installFetch(): void {
  pending = [];
  globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    return new Promise((resolve) => {
      pending.push({
        url,
        resolve: (body) =>
          resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }))
      });
    });
  }) as unknown as typeof fetch;
}

function row(entityKey: string, exact = false) {
  return {
    node_id: 1,
    entity_key: entityKey,
    kind: "function",
    qualified_name: entityKey,
    display_name: entityKey,
    signature: null,
    file_path: null,
    line_start: null,
    line_end: null,
    exported: 1,
    rank: -1,
    exact_match: exact ? 1 : 0
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  installFetch();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useSearchStore debounce + idle", () => {
  it("starts idle and never fetches for a blank query", () => {
    const { result } = renderHook(() => useSearchStore());
    expect(result.current.status).toBe("idle");
    act(() => result.current.setQuery("   "));
    act(() => vi.advanceTimersByTime(300));
    expect(pending).toHaveLength(0);
    expect(result.current.status).toBe("idle");
  });

  it("debounces: no fetch before 250ms, one after", () => {
    const { result } = renderHook(() => useSearchStore());
    act(() => result.current.setQuery("foo"));
    act(() => vi.advanceTimersByTime(200));
    expect(pending).toHaveLength(0);
    act(() => vi.advanceTimersByTime(60));
    expect(pending).toHaveLength(1);
  });

  it("only the last of several rapid queries fires a request", () => {
    const { result } = renderHook(() => useSearchStore());
    act(() => result.current.setQuery("a"));
    act(() => vi.advanceTimersByTime(100));
    act(() => result.current.setQuery("ab"));
    act(() => vi.advanceTimersByTime(100));
    act(() => result.current.setQuery("abc"));
    act(() => vi.advanceTimersByTime(300));
    expect(pending).toHaveLength(1);
    expect(pending[0]?.url).toContain("q=abc");
  });
});

describe("useSearchStore generation guard", () => {
  it("discards a stale (earlier) response resolving after a newer one", async () => {
    const { result } = renderHook(() => useSearchStore());

    act(() => result.current.setQuery("first"));
    act(() => vi.advanceTimersByTime(300));
    act(() => result.current.setQuery("second"));
    act(() => vi.advanceTimersByTime(300));

    expect(pending).toHaveLength(2);
    const firstReq = pending[0]!;
    const secondReq = pending[1]!;
    expect(firstReq.url).toContain("q=first");
    expect(secondReq.url).toContain("q=second");

    // Resolve newer FIRST, then the stale older one.
    await act(async () => {
      secondReq.resolve({ matches: [row("second-hit")], total: 1 });
    });
    await act(async () => {
      firstReq.resolve({ matches: [row("first-hit")], total: 1 });
    });

    // Store must reflect the NEWER query, not the late-arriving stale one.
    expect(result.current.results?.rows[0]?.entityKey).toBe("second-hit");
  });
});

describe("useSearchStore status derivation", () => {
  async function resolveWith(body: { matches: unknown[]; total: number }) {
    const { result } = renderHook(() => useSearchStore());
    act(() => result.current.setQuery("q"));
    act(() => vi.advanceTimersByTime(300));
    await act(async () => {
      pending[pending.length - 1]!.resolve(body);
    });
    return result;
  }

  it("empty when total is 0", async () => {
    const result = await resolveWith({ matches: [], total: 0 });
    expect(result.current.status).toBe("empty");
  });

  it("ambiguous_adjacent when top two rows are both exact matches", async () => {
    const result = await resolveWith({ matches: [row("a", true), row("b", true)], total: 2 });
    expect(result.current.status).toBe("ambiguous_adjacent");
  });

  it("ok for an ordinary non-empty, non-ambiguous result", async () => {
    const result = await resolveWith({ matches: [row("a", false), row("b", false)], total: 2 });
    expect(result.current.status).toBe("ok");
  });

  it("error when the response is malformed", async () => {
    const { result } = renderHook(() => useSearchStore());
    act(() => result.current.setQuery("q"));
    act(() => vi.advanceTimersByTime(300));
    // Resolve with a shape that fails the searchApi boundary check, then let
    // the rejected promise's .catch run (two microtask flushes inside act).
    await act(async () => {
      pending[pending.length - 1]!.resolve({ nope: true } as unknown as { matches: unknown[]; total: number });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).not.toBeNull();
  });
});

describe("useSearchStore selectResult", () => {
  it("invokes focus + panel callbacks with the entityKey", () => {
    const focusEntity = vi.fn();
    const openInspectionPanel = vi.fn();
    const { result } = renderHook(() => useSearchStore({ focusEntity, openInspectionPanel }));
    act(() => result.current.selectResult("fn:target"));
    expect(focusEntity).toHaveBeenCalledWith("fn:target");
    expect(openInspectionPanel).toHaveBeenCalledWith("fn:target");
  });
});
