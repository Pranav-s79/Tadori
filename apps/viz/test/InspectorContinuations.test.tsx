import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const ROUTE = {
  entityKey: "route:list-users", kind: "route", qualifiedName: "GET /users",
  displayName: "GET /users", file: "src/routes.py", exported: true, fanIn: 3
};
const HELPER = {
  entityKey: "fn:serialize", kind: "function", qualifiedName: "util.serialize",
  displayName: "serialize", file: "src/util.py", exported: true, fanIn: 9
};

vi.mock("../src/hooks/useSnapshot.ts", () => ({
  useSnapshot: () => ({
    snapshot: { repository: "repo", snapshotId: 1, snapshotKind: "working_tree", freshness: "fresh", stale: false, staleReason: null },
    loading: false, error: null, refetch: vi.fn()
  })
}));
vi.mock("../src/hooks/usePackageGraph.ts", () => ({
  usePackageGraph: () => ({
    data: {
      nodes: [ROUTE, HELPER],
      edges: [], positions: [], layoutVersion: 1,
      representativeByEntityKey: new Map(),
      bounded: { nodeTotal: 2, edgeTotal: 0, omittedNodes: 0, omittedEdges: 0, projection: null }
    },
    loading: false, error: null, refetch: vi.fn()
  })
}));
vi.mock("../src/hooks/useRefreshStatus.ts", () => ({ useRefreshStatus: () => null }));
// Route identity comes from the snapshot, not the level-of-detail graph, so the
// route list is what decides whether a behavior trace is offered.
vi.mock("../src/hooks/useRoutes.ts", () => ({
  useRoutes: () => ({ status: "ready", routes: [{ node: ROUTE, pathSourceOrigin: "compiler" }] })
}));
vi.mock("../src/hooks/useRegions.ts", () => ({
  useRegions: () => ({ data: null, loading: false, error: null, refetch: vi.fn() })
}));
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
      snapshotId: 1, analyzerVersion: "tadori-indexer/0.2.1", languages: [], extractors: [],
      diagnostics: { items: [], total: 0, omittedCount: 0, nextCursor: null, bySeverity: { info: 0, warning: 0, error: 0 } }
    },
    loading: false, error: null, refetch: vi.fn()
  })
}));
vi.mock("../src/graph/PackageMapCanvas.tsx", () => ({ PackageMapCanvas: () => <div>map</div> }));
vi.mock("../src/features/explore/ExploreTabs.tsx", () => ({ ExploreTabs: () => <div>explore</div> }));
vi.mock("../src/features/inspect/NodeView.tsx", () => ({ NodeView: () => <div>node detail</div> }));
vi.mock("../src/features/search/SearchPanel.tsx", () => ({
  SearchPanel: (props: { openInspectionPanel?: (key: string) => void }) => (
    <>
      <button type="button" onClick={() => props.openInspectionPanel?.(ROUTE.entityKey)}>Inspect route</button>
      <button type="button" onClick={() => props.openInspectionPanel?.(HELPER.entityKey)}>Inspect helper</button>
    </>
  )
}));

import { App } from "../src/App.tsx";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", window.location.pathname);
});

describe("inspector continuations", () => {
  it("carries a route from inspection into its execution flow", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Inspect route" }));

    fireEvent.click(screen.getByRole("button", { name: "Trace execution flow" }));
    expect(screen.getByRole("tab", { name: "Story" })).toHaveAttribute("aria-selected", "true");
  });

  it("offers interview preparation from any inspected entity", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Inspect helper" }));

    fireEvent.click(screen.getByRole("button", { name: "Prepare interview questions" }));
    expect(screen.getByRole("tab", { name: "Interview" })).toHaveAttribute("aria-selected", "true");
    // That the inspected entity becomes the interview subject is asserted in
    // InterviewPanel.test.tsx, where the node-detail fetch it now depends on is
    // mocked. This spec owns the continuation controls only.
  });

  it("does not offer a behavior trace for an entity that cannot start one", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Inspect helper" }));

    // A story starts at a route. A button here could only ever be refused.
    expect(screen.getByRole("button", { name: "Prepare interview questions" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Trace execution flow" })).not.toBeInTheDocument();
  });

  it("shows no continuations until something is inspected", () => {
    render(<App />);
    expect(screen.queryByRole("navigation", { name: "Continue from this entity" })).not.toBeInTheDocument();
  });
});
