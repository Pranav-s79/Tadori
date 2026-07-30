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
vi.mock("../src/features/explore/ExploreTabs.tsx", () => ({ ExploreTabs: () => <div>explore</div> }));
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
  vi.stubGlobal("matchMedia", vi.fn((media: string) => media === "(max-width: 860px)" ? query : inactiveQuery));
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

  it("closes responsive navigation with Escape and restores persistent desktop navigation", async () => {
    const media = installNavigationMediaQuery(true);
    render(<App />);
    const toggle = screen.getByRole("button", { name: "Explore" });
    const navigation = document.querySelector("#atlas-navigation");
    expect(navigation).toHaveAttribute("inert");
    expect(navigation).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByRole("button", { name: "Open package inspection" })).toHaveFocus());
    fireEvent.keyDown(screen.getByRole("button", { name: "Open package inspection" }), { key: "Escape" });
    await waitFor(() => expect(toggle).toHaveFocus());
    expect(navigation).toHaveAttribute("inert");

    act(() => media.setMatches(false));
    await waitFor(() => expect(navigation).not.toHaveAttribute("inert"));
    fireEvent.keyDown(screen.getByRole("button", { name: "Open package inspection" }), { key: "Escape" });
    expect(navigation).toHaveAttribute("aria-hidden", "false");
  });

  it("disables map-only lenses in Table mode but leaves Agent Review actionable", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Table" }));
    expect(screen.getByRole("button", { name: /Boundaries lens unavailable/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Changes lens unavailable/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Provenance lens unavailable/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Agent review lens" })).toBeEnabled();
  });

  it("falls back to the structured graph when the map renderer is unavailable", async () => {
    render(<App />);
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
