import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Focusing the map can only ever succeed for something the map is rendering.
 * The rendered graph is level-of-detail bounded, so a search hit or an Overview
 * entry point usually names an entity the camera cannot reach. Returning
 * silently — the previous behaviour — left the reader clicking a result and
 * watching nothing happen.
 */
const RENDERED = {
  entityKey: "pkg:root", kind: "package", qualifiedName: ".", displayName: ".",
  file: null, exported: false, fanIn: 0
};

const { fetchNodeDetail } = vi.hoisted(() => ({
  fetchNodeDetail: vi.fn(async () => ({ status: "not_found" }))
}));

vi.mock("../src/hooks/useSnapshot.ts", () => ({
  useSnapshot: () => ({
    snapshot: { repository: "repo", snapshotId: 1, snapshotKind: "working_tree", freshness: "fresh", stale: false, staleReason: null },
    loading: false, error: null, refetch: vi.fn()
  })
}));
vi.mock("../src/hooks/usePackageGraph.ts", () => ({
  usePackageGraph: () => ({
    data: {
      nodes: [RENDERED], edges: [], positions: [], layoutVersion: 1,
      representativeByEntityKey: new Map([["pkg:root", "pkg:root"]]),
      bounded: { nodeTotal: 1, edgeTotal: 0, omittedNodes: 0, omittedEdges: 0, projection: null }
    },
    loading: false, error: null, refetch: vi.fn()
  })
}));
vi.mock("../src/hooks/useRefreshStatus.ts", () => ({ useRefreshStatus: () => null }));
vi.mock("../src/hooks/useRegions.ts", () => ({
  useRegions: () => ({ data: null, loading: false, error: null, refetch: vi.fn() })
}));
vi.mock("../src/hooks/useRoutes.ts", () => ({ useRoutes: () => ({ status: "ready", routes: [] }) }));
vi.mock("../src/features/boundaries/useBoundaries.ts", () => ({
  useBoundaries: () => ({ data: { violations: [], rulesPresent: false }, filePositions: [], fileNodes: [], error: null, refetch: vi.fn() })
}));
vi.mock("../src/features/review/useReviewDiffStore.ts", () => ({ useReviewDiffStore: () => ({ page: null }) }));
vi.mock("../src/hooks/useCapabilities.ts", () => ({
  useCapabilities: () => ({ data: null, loading: false, error: null, refetch: vi.fn() })
}));
vi.mock("../src/hooks/useAnalysis.ts", () => ({
  useAnalysis: () => ({
    data: {
      snapshotId: 1, analyzerVersion: "v", languages: [], extractors: [],
      diagnostics: { items: [], total: 0, omittedCount: 0, nextCursor: null, bySeverity: { info: 0, warning: 0, error: 0 } }
    },
    loading: false, error: null, refetch: vi.fn()
  })
}));
vi.mock("../src/graph/PackageMapCanvas.tsx", () => ({ PackageMapCanvas: () => <div>map</div> }));
vi.mock("../src/features/explore/ExploreTabs.tsx", () => ({ ExploreTabs: () => <div>explore</div> }));
vi.mock("../src/features/inspect/NodeView.tsx", () => ({ NodeView: () => <div>node detail</div> }));
vi.mock("../src/features/inspect/inspectApi.ts", () => ({ fetchNodeDetail }));
vi.mock("../src/features/explore/exploreApi.ts", () => ({
  fetchLikelyTests: vi.fn(async () => ({ target: null, tests: [], observed: false, note: "not observed" }))
}));
vi.mock("../src/features/search/SearchPanel.tsx", () => ({
  SearchPanel: (props: { focusEntity?: (key: string) => void }) => (
    <>
      <button type="button" onClick={() => props.focusEntity?.("fn:deep")}>Focus unrendered</button>
      <button type="button" onClick={() => props.focusEntity?.("pkg:root")}>Focus rendered</button>
    </>
  )
}));

import { App } from "../src/App.tsx";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", window.location.pathname);
});

describe("focusing an entity the map is not rendering", () => {
  it("says so instead of doing nothing", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Focus unrendered" }));

    await waitFor(() =>
      expect(screen.getByText(/not shown at this level/u)).toBeInTheDocument()
    );
  });

  it("focuses silently when the map can actually reach the entity", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Focus rendered" }));

    expect(screen.getByRole("tab", { name: "Atlas" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText(/not shown at this level/u)).not.toBeInTheDocument();
  });

  it("clears the notice once a reachable entity is focused", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Focus unrendered" }));
    await waitFor(() => expect(screen.getByText(/not shown at this level/u)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Focus rendered" }));
    expect(screen.queryByText(/not shown at this level/u)).not.toBeInTheDocument();
  });
});
