import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultFilters } from "../src/features/search/filterState.ts";
import { fetchSearch } from "../src/features/search/searchApi.ts";

function wireRow(over: Record<string, unknown> = {}) {
  return {
    node_id: 1,
    entity_key: "fn:a",
    kind: "function",
    qualified_name: "a",
    display_name: "a",
    signature: null,
    file_path: "src/a.ts",
    line_start: 3,
    line_end: 9,
    exported: 1,
    rank: -1.2,
    exact_match: 1,
    ...over
  };
}

function mockFetchOnce(body: unknown, ok = true) {
  const fn = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status: ok ? 200 : 500,
      headers: { "content-type": "application/json" }
    })
  );
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

let lastUrl = "";
afterEach(() => {
  vi.restoreAllMocks();
  lastUrl = "";
});

function capture(fn: ReturnType<typeof vi.fn>): void {
  const call = fn.mock.calls[0]?.[0];
  lastUrl = typeof call === "string" ? call : String(call);
}

describe("fetchSearch query-string construction", () => {
  it("sends q, limit, offset and NO kind when zero kinds selected", async () => {
    const fn = mockFetchOnce({ matches: [wireRow()], total: 1 });
    await fetchSearch("foo", defaultFilters(), { limit: 20, offset: 0 }, 1);
    capture(fn);
    expect(lastUrl).toContain("q=foo");
    expect(lastUrl).toContain("limit=20");
    expect(lastUrl).toContain("offset=0");
    expect(lastUrl).not.toContain("kind=");
  });

  it("sends kind ONLY when exactly one kind is selected", async () => {
    const fn = mockFetchOnce({ matches: [], total: 0 });
    await fetchSearch("foo", { ...defaultFilters(), kinds: ["class"] }, { limit: 20, offset: 0 }, 1);
    capture(fn);
    expect(lastUrl).toContain("kind=class");
  });

  it("omits kind when >1 kind selected and narrows client-side, preserving order", async () => {
    const fn = mockFetchOnce({
      matches: [
        wireRow({ entity_key: "fn:a", kind: "function" }),
        wireRow({ entity_key: "cls:b", kind: "class" }),
        wireRow({ entity_key: "route:c", kind: "route" })
      ],
      total: 3
    });
    const result = await fetchSearch(
      "foo",
      { ...defaultFilters(), kinds: ["function", "class"] },
      { limit: 20, offset: 0 },
      1
    );
    capture(fn);
    expect(lastUrl).not.toContain("kind=");
    // route filtered out; function then class order preserved verbatim.
    expect(result.rows.map((r) => r.entityKey)).toEqual(["fn:a", "cls:b"]);
  });
});

describe("fetchSearch clamping", () => {
  it("clamps limit to 100", async () => {
    const fn = mockFetchOnce({ matches: [], total: 0 });
    const result = await fetchSearch("foo", defaultFilters(), { limit: 5000, offset: 0 }, 1);
    capture(fn);
    expect(lastUrl).toContain("limit=100");
    expect(result.limit).toBe(100);
  });

  it("clamps offset to 1000000", async () => {
    const fn = mockFetchOnce({ matches: [], total: 0 });
    const result = await fetchSearch("foo", defaultFilters(), { limit: 20, offset: 9_999_999 }, 1);
    capture(fn);
    expect(lastUrl).toContain("offset=1000000");
    expect(result.offset).toBe(1_000_000);
  });

  it("clamps limit up to 1 and offset up to 0 for out-of-range low values", async () => {
    const fn = mockFetchOnce({ matches: [], total: 0 });
    const result = await fetchSearch("foo", defaultFilters(), { limit: 0, offset: -5 }, 1);
    capture(fn);
    expect(lastUrl).toContain("limit=1");
    expect(lastUrl).toContain("offset=0");
    expect(result.limit).toBe(1);
    expect(result.offset).toBe(0);
  });
});

describe("fetchSearch mapping + generation", () => {
  it("echoes back the generation it was given", async () => {
    mockFetchOnce({ matches: [], total: 0 });
    const result = await fetchSearch("foo", defaultFilters(), { limit: 20, offset: 0 }, 42);
    expect(result.generation).toBe(42);
  });

  it("maps wire fields (exported/exactMatch as booleans, file_path->file)", async () => {
    mockFetchOnce({ matches: [wireRow({ exported: 0, exact_match: 0 })], total: 1 });
    const result = await fetchSearch("foo", defaultFilters(), { limit: 20, offset: 0 }, 1);
    expect(result.rows[0]).toMatchObject({
      entityKey: "fn:a",
      kind: "function",
      file: "src/a.ts",
      lineStart: 3,
      lineEnd: 9,
      exported: false,
      exactMatch: false
    });
  });

  it("throws on non-ok HTTP", async () => {
    mockFetchOnce({ error: "boom" }, false);
    await expect(fetchSearch("foo", defaultFilters(), { limit: 20, offset: 0 }, 1)).rejects.toThrow(/search failed/);
  });

  it("throws on malformed response shape", async () => {
    mockFetchOnce({ nope: true });
    await expect(fetchSearch("foo", defaultFilters(), { limit: 20, offset: 0 }, 1)).rejects.toThrow(/unexpected search response/);
  });
});
