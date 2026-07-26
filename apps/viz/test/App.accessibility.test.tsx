import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/hooks/useSnapshot.ts", () => ({
  useSnapshot: () => ({ snapshot: { repository: "repo", snapshotId: 1, snapshotKind: "working_tree", freshness: "fresh", stale: false, staleReason: null }, loading: false, error: null, refetch: vi.fn() })
}));
vi.mock("../src/hooks/usePackageGraph.ts", () => ({
  usePackageGraph: () => ({
    data: {
      nodes: [{ entityKey: "pkg", kind: "package", qualifiedName: "pkg", displayName: "pkg", file: null, exported: false, fanIn: 0 }],
      edges: [], positions: [{ entityKey: "pkg", x: 0, y: 0, z: 0, pinned: false }], layoutVersion: 1,
      representativeByEntityKey: new Map([["pkg", "pkg"]]),
      bounded: { nodeTotal: 3, edgeTotal: 2, omittedNodes: 2, omittedEdges: 2, projection: null }
    },
    loading: false, error: null, refetch: vi.fn()
  })
}));
vi.mock("../src/hooks/useRefreshStatus.ts", () => ({ useRefreshStatus: () => null }));
vi.mock("../src/features/boundaries/useBoundaries.ts", () => ({
  useBoundaries: () => ({ data: { violations: [], rulesPresent: false }, filePositions: [], fileNodes: [], error: null, refetch: vi.fn() })
}));
vi.mock("../src/features/review/useReviewDiffStore.ts", () => ({
  useReviewDiffStore: () => ({ page: null })
}));
vi.mock("../src/graph/PackageMapCanvas.tsx", () => ({ PackageMapCanvas: () => <div>map</div> }));
vi.mock("../src/features/search/SearchPanel.tsx", () => ({
  SearchPanel: (props: { openInspectionPanel?: (key: string) => void }) => (
    <button type="button" onClick={() => props.openInspectionPanel?.("pkg")}>Open package inspection</button>
  )
}));
vi.mock("../src/features/explore/ExploreTabs.tsx", () => ({ ExploreTabs: () => <div>explore</div> }));
vi.mock("../src/features/inspect/NodeView.tsx", () => ({ NodeView: () => <div>node detail</div> }));

import { App } from "../src/App.tsx";

afterEach(cleanup);

describe("App focus ownership", () => {
  it("announces when the package view is bounded", () => {
    render(<App />);
    expect(screen.getByText("Bounded package view: 2 nodes and 2 relations omitted.")).toHaveAttribute("role", "status");
  });
  it("keeps InspectionPanel mounted so closing restores the actual opener", async () => {
    render(<App />);
    const opener = screen.getByRole("button", { name: "Open package inspection" });
    opener.focus();
    fireEvent.click(opener);
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Inspection" })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Close inspection panel" }));
    await waitFor(() => expect(opener).toHaveFocus());
    expect(screen.queryByRole("dialog", { name: "Inspection" })).not.toBeInTheDocument();
  });

  it("transfers focus into the navigation drawer and restores it when closed", async () => {
    render(<App />);
    const toggle = screen.getByRole("button", { name: "Explore" });
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveFocus());
    expect(document.querySelector("#atlas-navigation")).toHaveAttribute("inert");
    expect(document.querySelector("#atlas-navigation")).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByRole("button", { name: "Open package inspection" })).toHaveFocus());
    fireEvent.keyDown(screen.getByRole("button", { name: "Open package inspection" }), { key: "Escape" });
    await waitFor(() => expect(toggle).toHaveFocus());
  });

  it("disables map-only lenses in Table mode but leaves Agent Review actionable", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Table" }));
    expect(screen.getByRole("button", { name: /Boundaries lens unavailable/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Changes lens unavailable/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Provenance lens unavailable/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Agent review lens" })).toBeEnabled();
  });
});
