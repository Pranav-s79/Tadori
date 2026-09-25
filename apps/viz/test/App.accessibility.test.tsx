import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
vi.mock("../src/hooks/useCapabilities.ts", () => ({
  useCapabilities: () => ({
    data: {
      version: 1,
      claim: "Tadori can structurally map mixed-language repositories.",
      states: ["semantic", "structural", "repository-only", "unsupported", "experimental"],
      languages: []
    },
    loading: false, error: null, refetch: vi.fn()
  })
}));
vi.mock("../src/hooks/useAnalysis.ts", () => ({
  useAnalysis: () => ({
    data: {
      snapshotId: 1,
      analyzerVersion: "tadori-indexer/0.2.1",
      languages: [],
      extractors: [],
      diagnostics: {
        items: [], total: 0, omittedCount: 0, nextCursor: null,
        bySeverity: { info: 0, warning: 0, error: 0 }
      }
    },
    loading: false, error: null, refetch: vi.fn()
  })
}));
vi.mock("../src/graph/PackageMapCanvas.tsx", () => ({
  PackageMapCanvas: (props: { onRenderedGraphChange?: (snapshot: {
    nodes: Array<{ entityKey: string; kind: "package" | "file"; qualifiedName: string; displayName: string; file: string | null; exported: boolean; fanIn: number }>;
    edges: never[];
    selectedEntityKey: string | null;
    lodLevel: "repository" | "file" | "symbol";
    breadcrumb: readonly string[];
  }) => void; onRendererError?: (error: Error) => void }) => (
    <div>
      map
      <button type="button" onClick={() => props.onRendererError?.(new Error("WebGL unavailable"))}>
        Fail renderer
      </button>
      <button type="button" onClick={() => props.onRenderedGraphChange?.({
        nodes: [
          { entityKey: "pkg", kind: "package", qualifiedName: "pkg", displayName: "pkg", file: null, exported: false, fanIn: 0 },
          { entityKey: "file:expanded.py", kind: "file", qualifiedName: "expanded.py", displayName: "expanded.py", file: "expanded.py", exported: true, fanIn: 0 }
        ],
        edges: [],
        selectedEntityKey: "file:expanded.py",
        lodLevel: "file",
        breadcrumb: ["Repository", "pkg"]
      })}>Publish expanded graph</button>
    </div>
  )
}));
vi.mock("../src/features/search/SearchPanel.tsx", () => ({
  SearchPanel: (props: { openInspectionPanel?: (key: string) => void }) => (
    <button type="button" onClick={() => props.openInspectionPanel?.("pkg")}>Open package inspection</button>
  )
}));
vi.mock("../src/features/inspect/NodeView.tsx", () => ({
  NodeView: ({ repoRoot }: { repoRoot: string | null }) => <div>{`node detail · ${repoRoot ?? "no repository root"}`}</div>
}));

import { App, mapStoryPlaybackToGraph } from "../src/App.tsx";
import type { StoryPlaybackState } from "../src/features/story/StoryView.tsx";
import type { BehaviorStory, StoryTransition } from "../src/features/story/storyApi.ts";

function installNavigationMediaQuery(initialMatches: boolean): { setMatches(matches: boolean): void } {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = {
    media: "(max-width: 860px)",
    get matches() { return matches; },
    onchange: null,
    addEventListener: (_type: "change", listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeEventListener: (_type: "change", listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true
  } as MediaQueryList;
  const inactiveQuery = {
    ...query,
    get matches() { return false; }
  } as MediaQueryList;
  // A narrow screen is also narrower than the search field's own breakpoint.
  vi.stubGlobal("matchMedia", vi.fn((media: string) =>
    media === "(max-width: 860px)" || media === "(max-width: 1100px)" ? query : inactiveQuery));
  return {
    setMatches(nextMatches: boolean): void {
      matches = nextMatches;
      const event = { matches, media: query.media } as MediaQueryListEvent;
      for (const listener of listeners) listener(event);
    }
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // The app persists mode/lens/selection in the query string, and jsdom keeps
  // one location for the whole file. Without this reset a test that switches
  // mode would silently decide the next test's starting view.
  window.history.replaceState(null, "", window.location.pathname);
});

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
    await waitFor(() => expect(screen.getByRole("complementary", { name: "Inspection" })).toHaveFocus());
    expect(screen.getByText("node detail · repo")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close inspection panel" }));
    await waitFor(() => expect(opener).toHaveFocus());
    expect(screen.queryByRole("complementary", { name: "Inspection" })).not.toBeInTheDocument();
  });

  /**
   * On a narrow screen the header keeps only the brand, a search button and a
   * mode menu. Each opens its own panel, takes focus into it, and gives focus
   * back to its button on Escape or on choosing a view.
   */
  it("opens the narrow-screen search and mode menu and returns focus on close", async () => {
    installNavigationMediaQuery(true);
    render(<App />);
    const searchToggle = screen.getByRole("button", { name: "Search" });
    expect(searchToggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(searchToggle);
    await waitFor(() => expect(screen.getByRole("button", { name: "Open package inspection" })).toHaveFocus());
    fireEvent.keyDown(screen.getByRole("button", { name: "Open package inspection" }), { key: "Escape" });
    await waitFor(() => expect(searchToggle).toHaveFocus());
    expect(searchToggle).toHaveAttribute("aria-expanded", "false");

    const modeToggle = screen.getByRole("button", { name: "View: Overview" });
    fireEvent.click(modeToggle);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Overview" })).toHaveFocus());
    fireEvent.click(screen.getByRole("tab", { name: "Atlas" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "View: Atlas" })).toHaveFocus());
    expect(screen.getByRole("button", { name: "View: Atlas" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("tab", { name: "Atlas" })).toHaveAttribute("aria-selected", "true");
  });

  it("closes a narrow-screen panel when the screen widens", async () => {
    const media = installNavigationMediaQuery(true);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(document.querySelector("#atlas-search")).toHaveAttribute("data-open", "true");
    act(() => media.setMatches(false));
    await waitFor(() => expect(document.querySelector("#atlas-search")).toHaveAttribute("data-open", "false"));
  });

  it("keeps the wide-screen search in the header, where Escape does not hide it", () => {
    installNavigationMediaQuery(false);
    render(<App />);
    const opener = screen.getByRole("button", { name: "Open package inspection" });
    opener.focus();
    fireEvent.keyDown(opener, { key: "Escape" });
    expect(document.querySelector("#atlas-search")).toHaveAttribute("data-open", "false");
    expect(opener).toHaveFocus();
  });

  it("opens Overview at its diagnostics from the header chip", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Atlas" }));
    fireEvent.click(screen.getByRole("button", { name: "No diagnostics" }));
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(document.getElementById("overview-section-diagnostics")).toHaveFocus());
    expect(screen.getByRole("heading", { name: "Analysis and diagnostics" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Declared language support" })).toBeInTheDocument();
  });

  it("finds a path from the inspected entity and closes only the path finder on Escape", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Open package inspection" }));
    const toggle = await screen.findByRole("button", { name: "Find path from here…" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const to = screen.getByLabelText("To");
    await waitFor(() => expect(to).toHaveFocus());
    fireEvent.keyDown(to, { key: "Escape" });
    await waitFor(() => expect(toggle).toHaveFocus());
    expect(screen.queryByLabelText("To")).not.toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Inspection" })).toBeInTheDocument();
  });

  /**
   * Overview and Interview showed the lens rail and "Showing N nodes" although
   * neither draws a map, and the Atlas bar read "Repository" beside
   * "Repository level". The count keeps announcing refreshes off-map; it is
   * only no longer drawn there.
   */
  it("draws map chrome only in the modes that show a map", () => {
    render(<App />);
    expect(screen.queryByRole("group", { name: "Map lenses" })).not.toBeInTheDocument();
    expect(screen.getByText(/^Showing \d+ nodes? and/)).toHaveClass("tadori-visually-hidden");

    fireEvent.click(screen.getByRole("tab", { name: "Interview" }));
    expect(screen.queryByRole("group", { name: "Map lenses" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Atlas" }));
    expect(screen.getByRole("group", { name: "Map lenses" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Boundaries lens" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/^Showing \d+ nodes? and/)).not.toHaveClass("tadori-visually-hidden");
    expect(screen.getByRole("navigation", { name: "Atlas location" })).toHaveTextContent("Repository");
    expect(screen.queryByText(/level$/)).not.toBeInTheDocument();
  });

  it("counts a single node in the singular", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Atlas" }));
    expect(screen.getByText("Showing 1 node and 0 relations")).toBeInTheDocument();
  });

  /** Lenses belong to a drawn map; Table lists the graph and draws none. */
  it("draws no lens keys in Table mode but keeps its location and count", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Table" }));
    expect(screen.queryByRole("group", { name: "Map lenses" })).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Atlas location" })).toBeInTheDocument();
    expect(screen.getByText("Showing 1 node and 0 relations")).not.toHaveClass("tadori-visually-hidden");
  });

  it("falls back to the structured graph when the map renderer is unavailable", async () => {
    render(<App />);
    // Overview is the landing mode now, so enter Atlas before driving the map.
    fireEvent.click(screen.getByRole("tab", { name: "Atlas" }));
    fireEvent.click(screen.getByRole("button", { name: "Fail renderer" }));

    await waitFor(() => expect(screen.getByRole("tab", { name: "Table" })).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The repository map renderer is unavailable. Showing the structured graph instead."
    );
    expect(screen.getByText("1 node")).toBeInTheDocument();
  });

  it("automatically uses the text-equivalent Table in forced-colors mode", async () => {
    const query = {
      media: "(forced-colors: active)", matches: true, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn()
    } as unknown as MediaQueryList;
    const inactive = { ...query, matches: false } as MediaQueryList;
    vi.stubGlobal("matchMedia", vi.fn((media: string) => media === "(forced-colors: active)" ? query : inactive));
    render(<App />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Table" })).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByRole("alert")).toHaveTextContent("Forced-colors mode is active");
    fireEvent.click(screen.getByRole("tab", { name: "Atlas" }));
    expect(screen.getByRole("tab", { name: "Table" })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps the rendered expansion available to Table mode and its inspector", async () => {
    render(<App />);
    // Overview is the landing mode now, so enter Atlas before driving the map.
    fireEvent.click(screen.getByRole("tab", { name: "Atlas" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish expanded graph" }));
    expect(screen.getByText("Showing 2 nodes and 0 relations")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Atlas location" })).toHaveTextContent("Repositorypkg");
    expect(screen.getByText("file level")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Table" }));
    expect(screen.getByText("2 nodes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "expanded.py" }));
    await waitFor(() =>
      expect(screen.getByRole("complementary", { name: "Inspection" })).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("tab", { name: "Atlas" }));
    expect(screen.getByRole("button", { name: "Publish expanded graph" })).toBeInTheDocument();
    expect(screen.getByText("Showing 2 nodes and 0 relations")).toBeInTheDocument();
  });
});

describe("Story representative mapping", () => {
  const story: BehaviorStory = {
    id: "story", title: "route", trigger: "route", entryPoint: "route", tests: [], branches: [],
    evidenceOmittedCount: 0, snapshotId: 1, confidence: "certain", runtimeObserved: false,
    steps: [
      { id: "step:a", entityKey: "a", kind: "function", resolved: true, label: "statically-resolved", origin: "compiler", confidence: "certain", resolution: "resolved", evidence: [] },
      { id: "step:b", entityKey: "b", kind: "function", resolved: true, label: "statically-resolved", origin: "compiler", confidence: "certain", resolution: "resolved", evidence: [] }
    ],
    transitions: [
      { from: "route", to: "a", relation: "routes_to", origin: "compiler", confidence: "certain", resolution: "resolved", resolved: true, evidence: [] },
      { from: "a", to: "b", relation: "calls", origin: "compiler", confidence: "certain", resolution: "resolved", resolved: true, evidence: [] }
    ],
    unresolvedTransitions: []
  };

  it("maps the evidenced predecessor path through package representatives", () => {
    const playback: StoryPlaybackState = { story, activeStepIndex: 1, activeStep: story.steps[1]!, activeTransition: story.transitions[1]! };
    expect(mapStoryPlaybackToGraph(playback, new Map([
      ["route", "pkg:web"], ["a", "pkg:service"], ["b", "pkg:data"]
    ]))).toEqual({
      pathEntityKeys: ["pkg:web", "pkg:service", "pkg:data"],
      transitions: [
        { fromEntityKey: "pkg:web", toEntityKey: "pkg:service", relation: "routes_to" },
        { fromEntityKey: "pkg:service", toEntityKey: "pkg:data", relation: "calls" }
      ],
      activeEntityKey: "pkg:data",
      unresolvedFromEntityKey: null
    });
  });

  it("keeps an unresolved termination on its known source without a destination", () => {
    const unresolved: StoryTransition = { from: "a", to: null, relation: "calls", origin: "heuristic", confidence: "inferred", resolution: "unresolved", resolved: false, evidence: [] };
    const unresolvedStory: BehaviorStory = {
      ...story,
      steps: [...story.steps, { id: "step:wall", entityKey: null, kind: "unresolved", resolved: false, label: "unresolved", origin: "heuristic", confidence: "inferred", resolution: "unresolved", evidence: [] }],
      transitions: [...story.transitions, unresolved],
      unresolvedTransitions: [unresolved]
    };
    const playback: StoryPlaybackState = { story: unresolvedStory, activeStepIndex: 2, activeStep: unresolvedStory.steps[2]!, activeTransition: unresolved };
    const mapped = mapStoryPlaybackToGraph(playback, new Map([["route", "pkg:web"], ["a", "pkg:service"], ["b", "pkg:data"]]));
    expect(mapped?.unresolvedFromEntityKey).toBe("pkg:service");
    expect(mapped?.activeEntityKey).toBeNull();
    expect(mapped?.transitions.some((transition) => transition.toEntityKey === null)).toBe(false);
  });
});
