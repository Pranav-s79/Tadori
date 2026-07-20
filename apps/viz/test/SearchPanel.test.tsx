import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchPanel } from "../src/features/search/SearchPanel.tsx";

function row(entityKey: string, exact = false) {
  return {
    node_id: 1,
    entity_key: entityKey,
    kind: "function",
    qualified_name: entityKey,
    display_name: entityKey,
    signature: null,
    file_path: "src/x.ts",
    line_start: 1,
    line_end: 2,
    exported: 1,
    rank: -1,
    exact_match: exact ? 1 : 0
  };
}

/** Fetch stub whose body is chosen per test; counts search calls so we can
 * assert a filter toggle issues NO new network request. */
function installSearchFetch(body: () => { matches: unknown[]; total: number }) {
  const fn = vi.fn(async () =>
    new Response(JSON.stringify(body()), { status: 200, headers: { "content-type": "application/json" } })
  );
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SearchPanel states", () => {
  it("shows idle copy for a blank query and issues no fetch", () => {
    const fetchMock = installSearchFetch(() => ({ matches: [], total: 0 }));
    render(<SearchPanel />);
    expect(screen.getByRole("status")).toHaveTextContent(/Type to search/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("typing populates results and shows an ok count", async () => {
    installSearchFetch(() => ({ matches: [row("fn:a"), row("fn:b")], total: 2 }));
    render(<SearchPanel />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "foo" } });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    expect(screen.getByRole("status")).toHaveTextContent(/Showing 2 of 2/i);
  });

  it("zero-result query shows explicit no-match copy distinct from idle", async () => {
    installSearchFetch(() => ({ matches: [], total: 0 }));
    render(<SearchPanel />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/No matches/i));
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("two tied exact matches show the ambiguous-adjacent banner", async () => {
    installSearchFetch(() => ({ matches: [row("fn:a", true), row("fn:b", true)], total: 2 }));
    render(<SearchPanel />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "foo" } });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Multiple exact matches/i));
  });

  it("selecting a result invokes focus + panel callbacks with the entityKey", async () => {
    installSearchFetch(() => ({ matches: [row("fn:target")], total: 1 }));
    const focusEntity = vi.fn();
    const openInspectionPanel = vi.fn();
    render(<SearchPanel focusEntity={focusEntity} openInspectionPanel={openInspectionPanel} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "foo" } });
    await waitFor(() => expect(screen.getByRole("option")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("option"));
    expect(focusEntity).toHaveBeenCalledWith("fn:target");
    expect(openInspectionPanel).toHaveBeenCalledWith("fn:target");
  });

  it("toggling a filter issues NO new network call (render-only overlay)", async () => {
    const fetchMock = installSearchFetch(() => ({ matches: [row("fn:a")], total: 1 }));
    render(<SearchPanel />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "foo" } });
    await waitFor(() => expect(screen.getByRole("option")).toBeInTheDocument());
    const callsAfterSearch = fetchMock.mock.calls.length;

    // Toggle a kind filter checkbox — must not fetch.
    const kindGroup = screen.getByRole("group", { name: "Filter by kind" });
    const firstKind = kindGroup.querySelectorAll("input[type=checkbox]")[0] as HTMLInputElement;
    fireEvent.click(firstKind);
    expect(firstKind.checked).toBe(true);
    expect(fetchMock.mock.calls.length).toBe(callsAfterSearch);
  });

  it("exposes all five filter groups as labeled groups", () => {
    installSearchFetch(() => ({ matches: [], total: 0 }));
    render(<SearchPanel />);
    for (const label of ["Filter by kind", "Filter by relation", "Filter by origin", "Filter by confidence", "Filter by resolution"]) {
      expect(screen.getByRole("group", { name: label })).toBeInTheDocument();
    }
  });
});
