import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReviewDiffStore } from "../src/features/review/useReviewDiffStore.ts";
import { mockContext } from "./mockServer.ts";

// Deferred-resolution fetch harness (same idiom as useSearchStore.test): every
// call parks a resolver we fire manually so we can force out-of-order responses.
interface Pending {
  url: string;
  resolve: (body: unknown, status?: number) => void;
}
let pending: Pending[] = [];

function installFetch(): void {
  pending = [];
  globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    return new Promise((resolve) => {
      pending.push({
        url,
        resolve: (body, status = 200) =>
          resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }))
      });
    });
  }) as unknown as typeof fetch;
}

function node(entityKey: string) {
  return {
    entityKey,
    kind: "function",
    qualifiedName: entityKey,
    displayName: entityKey,
    file: null,
    lineStart: null,
    lineEnd: null,
    signature: null,
    exported: true,
    fanIn: 0,
    evidence: [],
    evidenceOmittedCount: 0,
    freshness: "fresh",
    stale: false,
    staleReason: null
  };
}

function pageBody(over: Record<string, unknown> = {}) {
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

beforeEach(installFetch);
afterEach(() => vi.restoreAllMocks());

async function resolveInitial(body: unknown): Promise<void> {
  await waitFor(() => expect(pending.length).toBeGreaterThan(0));
  await act(async () => {
    pending[pending.length - 1]!.resolve(body);
  });
}

describe("useReviewDiffStore initial load + kind param", () => {
  it("defaults to snapshot and fetches kind=snapshot on mount", async () => {
    const { result } = renderHook(() => useReviewDiffStore());
    await waitFor(() => expect(pending.length).toBeGreaterThan(0));
    expect(pending[0]!.url).toContain("kind=snapshot");
    await act(async () => pending[0]!.resolve(pageBody({ nodesAdded: [node("a")] })));
    expect(result.current.kind).toBe("snapshot");
    expect(result.current.status).toBe("ok");
  });

  it("setKind(working_tree) sends kind=working_tree and no base/head", async () => {
    const { result } = renderHook(() => useReviewDiffStore());
    await resolveInitial(pageBody());
    act(() => result.current.setKind("working_tree"));
    await waitFor(() => expect(pending.some((p) => p.url.includes("kind=working_tree"))).toBe(true));
    const wtReq = pending.find((p) => p.url.includes("kind=working_tree"))!;
    expect(wtReq.url).not.toContain("base=");
    expect(wtReq.url).not.toContain("head=");
  });
});

describe("useReviewDiffStore status derivation", () => {
  it("empty when no rows and no omissions", async () => {
    const { result } = renderHook(() => useReviewDiffStore());
    await resolveInitial(pageBody());
    expect(result.current.status).toBe("empty");
  });

  it("ok when rows present and exhausted", async () => {
    const { result } = renderHook(() => useReviewDiffStore());
    await resolveInitial(pageBody({ nodesAdded: [node("a")], nextCursor: null }));
    expect(result.current.status).toBe("ok");
  });

  it("partial when nextCursor present", async () => {
    const { result } = renderHook(() => useReviewDiffStore());
    await resolveInitial(pageBody({ nodesAdded: [node("a")], nextCursor: "1" }));
    expect(result.current.status).toBe("partial");
  });

  it("partial when omitted counts present", async () => {
    const { result } = renderHook(() => useReviewDiffStore());
    await resolveInitial(pageBody({ nodesAdded: [node("a")], nodesAddedOmitted: 3 }));
    expect(result.current.status).toBe("partial");
  });
});

describe("useReviewDiffStore structured error mapping (never silent fallback)", () => {
  it("501 git_unavailable -> unsupported", async () => {
    const { result } = renderHook(() => useReviewDiffStore());
    await waitFor(() => expect(pending.length).toBeGreaterThan(0));
    await act(async () => {
      pending[0]!.resolve({ error: "x", code: "git_unavailable" }, 501);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.status).toBe("unsupported");
    expect(result.current.errorCode).toBe("git_unavailable");
  });

  it("400 not_a_git_repository -> failed with errorCode", async () => {
    const { result } = renderHook(() => useReviewDiffStore());
    await waitFor(() => expect(pending.length).toBeGreaterThan(0));
    await act(async () => {
      pending[0]!.resolve({ error: "x", code: "not_a_git_repository" }, 400);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.status).toBe("failed");
    expect(result.current.errorCode).toBe("not_a_git_repository");
  });
});

describe("useReviewDiffStore stale-response suppression", () => {
  it("discards the earlier kind's late response after a kind switch", async () => {
    const { result } = renderHook(() => useReviewDiffStore());
    // First (snapshot) request is in flight.
    await waitFor(() => expect(pending.length).toBe(1));
    const snapshotReq = pending[0]!;
    expect(snapshotReq.url).toContain("kind=snapshot");

    // Switch kind before snapshot resolves -> bumps generation.
    act(() => result.current.setKind("staged"));
    await waitFor(() => expect(pending.length).toBe(2));
    const stagedReq = pending[1]!;
    expect(stagedReq.url).toContain("kind=staged");

    // Resolve the NEW request, then the stale OLD one.
    await act(async () => stagedReq.resolve(pageBody({ nodesAdded: [node("staged-hit")] })));
    await act(async () => snapshotReq.resolve(pageBody({ nodesAdded: [node("snapshot-hit")] })));

    // Store reflects staged, not the late snapshot response.
    expect(result.current.kind).toBe("staged");
    expect(result.current.page?.nodesAdded[0]?.entityKey).toBe("staged-hit");
  });
});

describe("useReviewDiffStore cursor pagination dedupe", () => {
  it("appends the next page without duplicate rows and clears the cursor when exhausted", async () => {
    const { result } = renderHook(() => useReviewDiffStore());
    await resolveInitial(
      pageBody({ nodesAdded: [node("a"), node("b")], edges: [], nextCursor: "1" })
    );
    expect(result.current.status).toBe("partial");
    expect(result.current.nextCursor).toBe("1");

    act(() => result.current.loadMore());
    await waitFor(() => expect(pending.some((p) => p.url.includes("cursor=1"))).toBe(true));
    const page2 = pending.find((p) => p.url.includes("cursor=1"))!;
    // Page 2 overlaps ("b") and adds "c" — dedupe must drop the duplicate.
    await act(async () => page2.resolve(pageBody({ nodesAdded: [node("b"), node("c")], nextCursor: null })));

    expect(result.current.page?.nodesAdded.map((n) => n.entityKey)).toEqual(["a", "b", "c"]);
    expect(result.current.nextCursor).toBeNull();
    expect(result.current.status).toBe("ok");
  });

  it("loadMore is a no-op when there is no nextCursor", async () => {
    const { result } = renderHook(() => useReviewDiffStore());
    await resolveInitial(pageBody({ nodesAdded: [node("a")], nextCursor: null }));
    const before = pending.length;
    act(() => result.current.loadMore());
    expect(pending.length).toBe(before);
  });

  // Regression: the server's per-page omitted count = listTotal - thisPageLen,
  // so it counts rows on OTHER pages (including earlier ones). Naively keeping
  // the latest page's raw count left a stuck "N not shown" + "partial" after the
  // last page. The store must reconcile against accumulated rows → 0 when fully
  // paged.
  it("reconciles omitted counts across pages; a fully-paged diff reports 0 omitted and status ok", async () => {
    const { result } = renderHook(() => useReviewDiffStore());
    // 3 total added nodes, page size 2. Page 1 shows a,b; server says omitted=1.
    await resolveInitial(
      pageBody({ nodesAdded: [node("a"), node("b")], nodesAddedOmitted: 1, nextCursor: "2" })
    );
    expect(result.current.page?.nodesAddedOmitted).toBe(1);
    expect(result.current.status).toBe("partial");

    act(() => result.current.loadMore());
    await waitFor(() => expect(pending.some((p) => p.url.includes("cursor=2"))).toBe(true));
    const page2 = pending.find((p) => p.url.includes("cursor=2"))!;
    // Page 2 shows the last node c; server's per-page omitted = listTotal(3) - 1 = 2
    // (a and b, already shown). The store must NOT surface 2 — everything is now
    // shown, so the honest remaining-omitted is 0.
    await act(async () =>
      page2.resolve(pageBody({ nodesAdded: [node("c")], nodesAddedOmitted: 2, nextCursor: null }))
    );

    expect(result.current.page?.nodesAdded.map((n) => n.entityKey)).toEqual(["a", "b", "c"]);
    expect(result.current.page?.nodesAddedOmitted).toBe(0);
    expect(result.current.nextCursor).toBeNull();
    expect(result.current.status).toBe("ok");
  });
});
