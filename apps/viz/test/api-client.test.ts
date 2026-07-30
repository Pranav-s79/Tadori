import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchEdges, fetchNodes, fetchSnapshot } from "../src/api/client.ts";

afterEach(() => vi.unstubAllGlobals());

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("graph API client", () => {
  it("unwraps the server snapshot summary context", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({
      context: { repository: "repo", snapshotId: 7, snapshotKind: "working_tree", freshness: "stale", stale: true, staleReason: "refresh_pending", refreshPending: true },
      analyzerVersion: "test", counts: { files: 1, nodes: 1, edges: 0 }
    })));
    await expect(fetchSnapshot()).resolves.toEqual(expect.objectContaining({ snapshotId: 7, stale: true }));
  });

  it("retrieves every node and edge page without silent first-page truncation", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const cursor = new URL(`http://local${url}`).searchParams.get("cursor");
      if (url.includes("/nodes")) {
        return response(cursor === null
          ? { items: [{ entityKey: "n1" }], nextCursor: "1", total: 2 }
          : { items: [{ entityKey: "n2" }], nextCursor: null, total: 2 });
      }
      return response(cursor === null
        ? { items: [{ entityKey: "e1" }], nextCursor: "1", total: 2 }
        : { items: [{ entityKey: "e2" }], nextCursor: null, total: 2 });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect((await fetchNodes()).map((item) => item.entityKey)).toEqual(["n1", "n2"]);
    expect((await fetchEdges()).map((item) => item.entityKey)).toEqual(["e1", "e2"]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("fails honestly when a paginated response omits rows", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ items: [], nextCursor: null, total: 1 })));
    await expect(fetchNodes()).rejects.toThrow("omitted 1 item");
  });
});
