import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchReviewDiff, ReviewDiffError } from "../src/features/review/reviewDiffApi.ts";
import { mockContext } from "./mockServer.ts";

function emptyPageBody(over: Record<string, unknown> = {}) {
  return {
    context: mockContext,
    base: { id: 1, kind: "snapshot", label: "base", baseCommitSha: null, workspaceHash: null, pinned: false, status: "sealed", createdAt: null },
    head: { id: 2, kind: "snapshot", label: "head", baseCommitSha: null, workspaceHash: null, pinned: false, status: "sealed", createdAt: null },
    nodesAdded: [],
    nodesRemoved: [],
    edges: [],
    nodesAddedOmitted: 0,
    nodesRemovedOmitted: 0,
    edgesOmitted: 0,
    nextCursor: null,
    presentation: "raw",
    ...over
  };
}

function mockFetchOnce(body: unknown, status = 200) {
  const fn = vi.fn(
    async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  );
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

function lastUrl(fn: ReturnType<typeof vi.fn>): string {
  const call = fn.mock.calls[0]?.[0];
  return typeof call === "string" ? call : String(call);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchReviewDiff query-string construction", () => {
  it("sends kind=snapshot with base/head and cursor/limit", async () => {
    const fn = mockFetchOnce(emptyPageBody());
    await fetchReviewDiff({ kind: "snapshot", base: "10", head: "20", cursor: "5", limit: 50 }, 1);
    const url = lastUrl(fn);
    expect(url).toContain("kind=snapshot");
    expect(url).toContain("base=10");
    expect(url).toContain("head=20");
    expect(url).toContain("cursor=5");
    expect(url).toContain("limit=50");
  });

  it("sends kind=working_tree WITHOUT base/head even if provided", async () => {
    const fn = mockFetchOnce(emptyPageBody());
    await fetchReviewDiff({ kind: "working_tree", base: "10", head: "20", limit: 50 }, 1);
    const url = lastUrl(fn);
    expect(url).toContain("kind=working_tree");
    expect(url).not.toContain("base=");
    expect(url).not.toContain("head=");
    expect(url).toContain("limit=50");
  });

  it("sends kind=staged WITHOUT base/head", async () => {
    const fn = mockFetchOnce(emptyPageBody());
    await fetchReviewDiff({ kind: "staged", limit: 50 }, 1);
    const url = lastUrl(fn);
    expect(url).toContain("kind=staged");
    expect(url).not.toContain("base=");
    expect(url).not.toContain("head=");
  });

  it("echoes back the generation it was given", async () => {
    mockFetchOnce(emptyPageBody());
    const page = await fetchReviewDiff({ kind: "snapshot", limit: 50 }, 99);
    expect(page.generation).toBe(99);
  });

  it("passes server rows through verbatim (no re-sorting)", async () => {
    mockFetchOnce(
      emptyPageBody({
        nodesAdded: [
          { entityKey: "z", kind: "function", qualifiedName: "z", displayName: "z", file: null, lineStart: null, lineEnd: null, signature: null, exported: true, fanIn: 0, evidence: [], evidenceOmittedCount: 0, freshness: "fresh", stale: false, staleReason: null },
          { entityKey: "a", kind: "function", qualifiedName: "a", displayName: "a", file: null, lineStart: null, lineEnd: null, signature: null, exported: true, fanIn: 0, evidence: [], evidenceOmittedCount: 0, freshness: "fresh", stale: false, staleReason: null }
        ]
      })
    );
    const page = await fetchReviewDiff({ kind: "snapshot", limit: 50 }, 1);
    expect(page.nodesAdded.map((n) => n.entityKey)).toEqual(["z", "a"]);
  });
});

describe("fetchReviewDiff structured errors (never silent snapshot fallback)", () => {
  it("throws ReviewDiffError carrying code/status for 400 not_a_git_repository", async () => {
    mockFetchOnce({ error: "not a git repo", code: "not_a_git_repository", detail: "no .git" }, 400);
    await expect(fetchReviewDiff({ kind: "working_tree", limit: 50 }, 1)).rejects.toMatchObject({
      code: "not_a_git_repository",
      status: 400,
      detail: "no .git"
    });
  });

  it("throws ReviewDiffError carrying code for 501 git_unavailable", async () => {
    mockFetchOnce({ error: "git unavailable", code: "git_unavailable" }, 501);
    const err = await fetchReviewDiff({ kind: "staged", limit: 50 }, 1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReviewDiffError);
    expect((err as ReviewDiffError).code).toBe("git_unavailable");
    expect((err as ReviewDiffError).status).toBe(501);
  });

  it("still throws (with null code) on a non-JSON error body", async () => {
    const fn = vi.fn(async () => new Response("<html>500</html>", { status: 500 }));
    globalThis.fetch = fn as unknown as typeof fetch;
    const err = await fetchReviewDiff({ kind: "snapshot", limit: 50 }, 1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReviewDiffError);
    expect((err as ReviewDiffError).status).toBe(500);
    expect((err as ReviewDiffError).code).toBeNull();
  });
});
