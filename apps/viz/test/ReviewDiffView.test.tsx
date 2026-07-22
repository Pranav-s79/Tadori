import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewDiffView } from "../src/features/review/ReviewDiffView.tsx";
import type { AccumulatedDiff, ReviewDiffStatus, ReviewDiffStore } from "../src/features/review/useReviewDiffStore.ts";
import type { EdgeDiffRow, ReviewDiffNode } from "../src/features/review/reviewDiffApi.ts";
import { mockContext } from "./mockServer.ts";

afterEach(cleanup);

function node(entityKey: string, over: Partial<ReviewDiffNode> = {}): ReviewDiffNode {
  return {
    entityKey,
    kind: "function",
    qualifiedName: entityKey,
    displayName: entityKey,
    file: "src/x.ts",
    lineStart: 1,
    lineEnd: 2,
    signature: null,
    exported: true,
    fanIn: 0,
    evidence: [],
    evidenceOmittedCount: 0,
    freshness: "fresh",
    stale: false,
    staleReason: null,
    ...over
  };
}

function edge(over: Partial<EdgeDiffRow> = {}): EdgeDiffRow {
  return {
    change_kind: "resolution_or_provenance_changed",
    source: "mod.a",
    relation: "calls",
    destination: "mod.b",
    before_origin: "heuristic",
    before_confidence: "likely",
    before_resolution: "partial",
    after_origin: "compiler",
    after_confidence: "certain",
    after_resolution: "resolved",
    ...over
  };
}

function diff(over: Partial<AccumulatedDiff> = {}): AccumulatedDiff {
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
    presentation: "raw",
    coalesced: undefined,
    ambiguousGroups: undefined,
    ...over
  };
}

function fakeStore(over: Partial<ReviewDiffStore> = {}): ReviewDiffStore {
  return {
    kind: "snapshot",
    coalesced: false,
    page: null,
    status: "idle" as ReviewDiffStatus,
    errorCode: null,
    nextCursor: null,
    setKind: vi.fn(),
    setCoalesced: vi.fn(),
    loadMore: vi.fn(),
    ...over
  };
}

describe("ReviewDiffView rendering", () => {
  it("renders added/removed node rows and a changed-edge row in server order", () => {
    const store = fakeStore({
      status: "ok",
      page: diff({ nodesAdded: [node("added.one")], nodesRemoved: [node("removed.one")], edges: [edge()] })
    });
    render(<ReviewDiffView store={store} />);
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveAttribute("aria-label", expect.stringContaining("added function: added.one"));
    expect(options[1]).toHaveAttribute("aria-label", expect.stringContaining("removed function: removed.one"));
    expect(options[2]).toHaveAttribute("aria-label", expect.stringContaining("mod.a --calls--> mod.b"));
  });

  it("shows omitted counts honestly", () => {
    const store = fakeStore({
      status: "partial",
      page: diff({ nodesAdded: [node("a")], nodesAddedOmitted: 4, edgesOmitted: 2 })
    });
    render(<ReviewDiffView store={store} />);
    expect(screen.getByText(/\+4 added nodes not shown/)).toBeInTheDocument();
    expect(screen.getByText(/2 changed edges not shown/)).toBeInTheDocument();
  });

  it("renders the empty state", () => {
    render(<ReviewDiffView store={fakeStore({ status: "empty", page: diff() })} />);
    expect(screen.getByText(/No changes in this comparison/)).toBeInTheDocument();
  });

  it("renders an unsupported (501) state with the code, not a snapshot fallback", () => {
    render(<ReviewDiffView store={fakeStore({ status: "unsupported", errorCode: "git_unavailable" })} />);
    expect(screen.getByRole("status")).toHaveTextContent(/not available here.*git_unavailable/);
  });

  it("renders a failed state via role=alert", () => {
    render(<ReviewDiffView store={fakeStore({ status: "failed", errorCode: "not_a_git_repository" })} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/not_a_git_repository/);
  });

  it("shows a Load more button only when nextCursor is present", () => {
    const { rerender } = render(
      <ReviewDiffView store={fakeStore({ status: "partial", page: diff({ nodesAdded: [node("a")] }), nextCursor: "1" })} />
    );
    expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
    rerender(<ReviewDiffView store={fakeStore({ status: "ok", page: diff({ nodesAdded: [node("a")] }), nextCursor: null })} />);
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("calls loadMore when Load more is clicked", () => {
    const loadMore = vi.fn();
    render(<ReviewDiffView store={fakeStore({ status: "partial", page: diff({ nodesAdded: [node("a")] }), nextCursor: "1", loadMore })} />);
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(loadMore).toHaveBeenCalledOnce();
  });
});

describe("ReviewDiffView kind switcher", () => {
  it("calls setKind when a different kind radio is chosen", () => {
    const setKind = vi.fn();
    render(<ReviewDiffView store={fakeStore({ status: "empty", page: diff(), setKind })} />);
    fireEvent.click(screen.getByRole("radio", { name: "Working tree" }));
    expect(setKind).toHaveBeenCalledWith("working_tree");
  });
});

describe("ReviewDiffView coalesce toggle", () => {
  it("calls setCoalesced(true) when the toggle is pressed", () => {
    const setCoalesced = vi.fn();
    render(<ReviewDiffView store={fakeStore({ status: "empty", page: diff(), setCoalesced })} />);
    fireEvent.click(screen.getByRole("button", { name: /group renames/i }));
    expect(setCoalesced).toHaveBeenCalledWith(true);
  });

  it("renders coalesced rows (likely, never certain) and expands to the referenced raw rows", () => {
    const edgeRows = [
      edge({ change_kind: "removed", source: "src/task.ts", relation: "imports", destination: "src/legacy/helper.ts" }),
      edge({ change_kind: "added", source: "src/task.ts", relation: "imports", destination: "src/helpers/helper.ts" })
    ];
    const page = diff({
      edges: edgeRows,
      presentation: "coalesced",
      coalesced: [{ kind: "move", fromKey: "keyA", toKey: "keyB", rawRowIndexes: [0, 1] }],
      ambiguousGroups: []
    });
    render(<ReviewDiffView store={fakeStore({ status: "ok", coalesced: true, page })} />);
    // The coalesced row is present and labeled "likely", not certain.
    const row = screen.getByRole("button", { name: /Moved — likely/ });
    expect(row).toBeTruthy();
    // Before expanding, the endpoint text appears once (in the raw rows list).
    const before = screen.getAllByText(/src\/legacy\/helper\.ts/).length;
    // Expanding renders the underlying raw rows again (no refetch) → count grows.
    fireEvent.click(row);
    const after = screen.getAllByText(/src\/legacy\/helper\.ts/).length;
    expect(after).toBeGreaterThan(before);
  });

  it("surfaces an ambiguous group's honest reason text", () => {
    const page = diff({
      presentation: "coalesced",
      coalesced: [],
      ambiguousGroups: [{ candidateKeys: ["k1", "k2"], reason: "2 removed share bodyHash abc; cannot disambiguate" }]
    });
    render(<ReviewDiffView store={fakeStore({ status: "ok", coalesced: true, page })} />);
    expect(screen.getByText(/cannot disambiguate/)).toBeTruthy();
  });
});

describe("ReviewDiffView keyboard navigation + inspect", () => {
  it("ArrowDown moves the active option; Enter inspects the node entityKey", () => {
    const onInspect = vi.fn();
    const store = fakeStore({
      status: "ok",
      page: diff({ nodesAdded: [node("added.one")], nodesRemoved: [node("removed.one")] })
    });
    render(<ReviewDiffView store={store} onInspect={onInspect} />);
    const list = screen.getByRole("listbox");
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(list, { key: "Enter" });
    expect(onInspect).toHaveBeenCalledWith("removed.one", "node");
  });

  it("selecting an edge row inspects the DESTINATION node (documented choice)", () => {
    const onInspect = vi.fn();
    const store = fakeStore({ status: "ok", page: diff({ edges: [edge({ source: "mod.a", destination: "mod.dest" })] }) });
    render(<ReviewDiffView store={store} onInspect={onInspect} />);
    fireEvent.click(screen.getByRole("option"));
    expect(onInspect).toHaveBeenCalledWith("mod.dest", "node");
  });

  it("is navigable/functional as a list even with no onInspect (list-only fallback)", () => {
    const store = fakeStore({ status: "ok", page: diff({ nodesAdded: [node("a"), node("b")] }) });
    render(<ReviewDiffView store={store} />);
    const list = screen.getByRole("listbox");
    fireEvent.keyDown(list, { key: "End" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    // Enter with no onInspect must not throw.
    expect(() => fireEvent.keyDown(list, { key: "Enter" })).not.toThrow();
  });
});

describe("ReviewDiffView determinism", () => {
  it("renders the same fixture in the same DOM order every time (no re-sort)", () => {
    const page = diff({ nodesAdded: [node("z"), node("a"), node("m")] });
    const first = render(<ReviewDiffView store={fakeStore({ status: "ok", page })} />);
    const firstOrder = Array.from(first.container.querySelectorAll('[role="option"]')).map((el) => el.getAttribute("aria-label"));
    cleanup();
    const second = render(<ReviewDiffView store={fakeStore({ status: "ok", page })} />);
    const secondOrder = Array.from(second.container.querySelectorAll('[role="option"]')).map((el) => el.getAttribute("aria-label"));
    expect(secondOrder).toEqual(firstOrder);
    expect(firstOrder[0]).toContain("z");
    expect(firstOrder[2]).toContain("m");
  });
});
