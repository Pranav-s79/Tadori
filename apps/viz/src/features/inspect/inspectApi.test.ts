import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLinkedDoc, fetchNodeDetail, fetchSource } from "./inspectApi.ts";

function mockFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: async () => Promise.resolve(body)
      } as Response)
    )
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchNodeDetail status discrimination", () => {
  it("maps 200 to ok with the node body", async () => {
    mockFetch(200, { entityKey: "x", kind: "function", outEdges: [], inEdges: [] });
    const res = await fetchNodeDetail("x");
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.node.entityKey).toBe("x");
    }
  });

  it("maps 404 to not_found", async () => {
    mockFetch(404, { error: "unknown_entity" });
    expect((await fetchNodeDetail("x")).status).toBe("not_found");
  });

  it("maps 409 to ambiguous", async () => {
    mockFetch(409, { error: "ambiguous" });
    expect((await fetchNodeDetail("x")).status).toBe("ambiguous");
  });

  it("maps other non-2xx to error", async () => {
    mockFetch(500, { error: "boom" });
    expect((await fetchNodeDetail("x")).status).toBe("error");
  });

  it("maps a thrown fetch to error without leaking a stack", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("network down"))));
    const res = await fetchNodeDetail("x");
    expect(res.status).toBe("error");
    if (res.status === "error") {
      expect(res.message).toBe("network down");
    }
  });
});

describe("fetchSource status discrimination", () => {
  it("maps 200 to ok with the slice", async () => {
    mockFetch(200, { body: "line1", freshness: "fresh", staleReason: "matches_snapshot" });
    const res = await fetchSource("src/a.ts", 1, 1);
    expect(res.status).toBe("ok");
  });

  it("maps 403 to outside_repository", async () => {
    mockFetch(403, { error: "outside_repository" });
    expect((await fetchSource("../x")).status).toBe("outside_repository");
  });

  it("maps 404 to not_in_snapshot", async () => {
    mockFetch(404, { error: "not_in_snapshot" });
    expect((await fetchSource("src/a.ts")).status).toBe("not_in_snapshot");
  });

  it("maps 409 to content_changed", async () => {
    mockFetch(409, { error: "content_changed" });
    expect((await fetchSource("src/a.ts")).status).toBe("content_changed");
  });
});

describe("fetchLinkedDoc", () => {
  it("returns the single doc when exactly one is linked", async () => {
    mockFetch(200, { docs: [{ node: { entityKey: "adr1" }, body: "Because reasons." }] });
    const doc = await fetchLinkedDoc("x");
    expect(doc?.body).toBe("Because reasons.");
  });

  it("returns null when zero docs are linked", async () => {
    mockFetch(200, { docs: [] });
    expect(await fetchLinkedDoc("x")).toBeNull();
  });

  it("returns null when more than one doc is linked (08-07 owns the multi-doc panel)", async () => {
    mockFetch(200, { docs: [{ node: {}, body: "a" }, { node: {}, body: "b" }] });
    expect(await fetchLinkedDoc("x")).toBeNull();
  });

  it("returns null on a non-2xx response", async () => {
    mockFetch(404, {});
    expect(await fetchLinkedDoc("x")).toBeNull();
  });
});
