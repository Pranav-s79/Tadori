import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A deep link names an entity that is almost never in the rendered graph: the
 * landing view is level-of-detail bounded to the repository node. These tests
 * therefore keep the rendered graph deliberately tiny — one package — while the
 * linked entity exists only behind the entity endpoint, which is exactly the
 * shape that made `select=` silently drop.
 */
const ROOT = {
  entityKey: "pkg:root", kind: "package", qualifiedName: ".", displayName: ".",
  file: null, exported: false, fanIn: 0
};

const LINKED = "route:list-users";

// vi.mock is hoisted above module scope, so the spy has to be hoisted with it.
const { fetchNodeDetail } = vi.hoisted(() => ({
  fetchNodeDetail: vi.fn(async (key: string) =>
    key === "route:list-users"
      ? {
        status: "ok",
        node: {
          entityKey: "route:list-users", kind: "route", qualifiedName: "route:GET /users/:id",
          displayName: "GET /users/:id", file: "src/routes/users.ts", lineStart: 7, lineEnd: 7,
          signature: null, exported: false, fanIn: 1, representation: "name", body: null,
          evidence: [], evidenceOmittedCount: 0, freshness: "fresh", stale: false, staleReason: null,
          inEdges: [], outEdges: []
        }
      }
      : { status: "not_found" })
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
      nodes: [ROOT], edges: [], positions: [], layoutVersion: 1,
      // The linked entity is deliberately absent: this map is the LOD view.
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
vi.mock("../src/hooks/useRoutes.ts", () => ({
  useRoutes: () => ({ status: "ready", routes: [] })
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
      snapshotId: 1, analyzerVersion: "v", languages: [], extractors: [],
      diagnostics: { items: [], total: 0, omittedCount: 0, nextCursor: null, bySeverity: { info: 0, warning: 0, error: 0 } }
    },
    loading: false, error: null, refetch: vi.fn()
  })
}));
vi.mock("../src/graph/PackageMapCanvas.tsx", () => ({ PackageMapCanvas: () => <div>map</div> }));
vi.mock("../src/features/explore/ExploreTabs.tsx", () => ({ ExploreTabs: () => <div>explore</div> }));
vi.mock("../src/features/search/SearchPanel.tsx", () => ({ SearchPanel: () => <div>search</div> }));
vi.mock("../src/features/inspect/NodeView.tsx", () => ({ NodeView: () => <div>node detail</div> }));
vi.mock("../src/features/inspect/inspectApi.ts", () => ({ fetchNodeDetail }));
vi.mock("../src/features/explore/exploreApi.ts", () => ({
  fetchLikelyTests: vi.fn(async () => ({ target: null, tests: [], observed: false, note: "not observed" }))
}));

import { App } from "../src/App.tsx";

function land(search: string): void {
  window.history.replaceState(null, "", `/${search}`);
}

beforeEach(() => { fetchNodeDetail.mockClear(); });
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", window.location.pathname);
});

describe("deep-link selection", () => {
  it("restores an entity that is not in the rendered graph", async () => {
    land(`?mode=interview&select=${LINKED}`);
    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Interview preparation — GET \/users\/:id/u })).toBeInTheDocument()
    );
  });

  it("survives a reload of the same URL", async () => {
    land(`?mode=interview&select=${LINKED}`);
    const first = render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Interview preparation — GET \/users\/:id/u })).toBeInTheDocument()
    );

    // A reload is a fresh mount reading the same address bar.
    first.unmount();
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Interview preparation — GET \/users\/:id/u })).toBeInTheDocument()
    );
  });

  it("states plainly when a linked entity cannot be found", async () => {
    // A stale link must not read like a working whole-repository interview.
    land("?mode=interview&select=route:deleted");
    render(<App />);

    await waitFor(() =>
      expect(screen.getByText(/could not be found in this snapshot/u)).toBeInTheDocument()
    );
    expect(screen.queryByRole("heading", { name: /Interview preparation — this repository/u }))
      .not.toBeInTheDocument();
  });

  it("keeps a valid selection when the reader switches modes", async () => {
    land(`?mode=interview&select=${LINKED}`);
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Interview preparation — GET \/users\/:id/u })).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("tab", { name: "Table" }));
    fireEvent.click(screen.getByRole("tab", { name: "Interview" }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Interview preparation — GET \/users\/:id/u })).toBeInTheDocument()
    );
  });
});
