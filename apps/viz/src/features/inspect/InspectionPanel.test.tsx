import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InspectionPanel } from "./InspectionPanel.tsx";
import type { ToolEdge } from "./inspectApi.ts";
import { useInspectionStore } from "./useInspectionStore.ts";

/** Minimal node-detail body for a given key with no linked doc. */
function nodeBody(entityKey: string, displayName: string) {
  return {
    entityKey,
    kind: "function",
    qualifiedName: `pkg/${displayName}`,
    displayName,
    file: null,
    lineStart: null,
    lineEnd: null,
    signature: null,
    exported: true,
    fanIn: 0,
    representation: "name",
    body: null,
    evidence: [],
    evidenceOmittedCount: 0,
    freshness: "fresh",
    stale: false,
    staleReason: null,
    outEdges: [],
    inEdges: []
  };
}

/** Route the mocked fetch by URL to node detail / docs (empty) endpoints. */
function routeFetch(nodesByKey: Record<string, unknown>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/docs")) {
        return { ok: true, status: 200, json: async () => ({ docs: [] }) } as Response;
      }
      const match = /\/nodes\/([^/?]+)/.exec(url);
      const key = match?.[1] !== undefined ? decodeURIComponent(match[1]) : "";
      const body = nodesByKey[key];
      if (body === undefined) {
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      }
      return { ok: true, status: 200, json: async () => body } as Response;
    })
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Harness({ edgesByKey }: { edgesByKey?: ReadonlyMap<string, ToolEdge> }) {
  const store = useInspectionStore();
  return (
    <>
      <button type="button" onClick={() => store.openEntity({ entityKey: "a", entityType: "node" })}>
        open-a
      </button>
      <button type="button" onClick={() => store.openEntity({ entityKey: "b", entityType: "node" })}>
        open-b
      </button>
      <InspectionPanel store={store} repoRoot="/repo" edgesByKey={edgesByKey} />
    </>
  );
}

describe("InspectionPanel", () => {
  it("mounts at most one panel instance; a second entity replaces content", async () => {
    routeFetch({ a: nodeBody("a", "Alpha"), b: nodeBody("b", "Beta") });
    render(<Harness />);

    fireEvent.click(screen.getByText("open-a"));
    await waitFor(() => expect(screen.getByText("Alpha")).toBeInTheDocument());
    expect(screen.getAllByRole("complementary", { name: "Inspection" })).toHaveLength(1);

    fireEvent.click(screen.getByText("open-b"));
    await waitFor(() => expect(screen.getByText("Beta")).toBeInTheDocument());
    // Exactly one panel root, and the previous content is gone.
    expect(screen.getAllByRole("complementary", { name: "Inspection" })).toHaveLength(1);
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
  });

  it("renders the exact ADR fallback string when no doc resolves", async () => {
    routeFetch({ a: nodeBody("a", "Alpha") });
    render(<Harness />);
    fireEvent.click(screen.getByText("open-a"));
    await waitFor(() =>
      expect(screen.getByText("No documented design decision found.")).toBeInTheDocument()
    );
  });

  it("shows multi-language extraction attribution without upgrading legacy facts", async () => {
    routeFetch({
      a: {
        ...nodeBody("a", "Alpha"),
        language: "python",
        provenance: {
          extractorId: "tadori-tree-sitter",
          extractorVersion: "1",
          capability: "structural",
          derivation: "parser-derived",
          unresolvedReason: null
        }
      }
    });
    render(<Harness />);
    fireEvent.click(screen.getByText("open-a"));
    await waitFor(() => expect(screen.getByText("python")).toBeInTheDocument());
    expect(screen.getByText("structural")).toBeInTheDocument();
    expect(screen.getByText("parser-derived")).toBeInTheDocument();
  });

  it("Escape closes the panel", async () => {
    routeFetch({ a: nodeBody("a", "Alpha") });
    render(<Harness />);
    fireEvent.click(screen.getByText("open-a"));
    await waitFor(() => expect(screen.getByRole("complementary", { name: "Inspection" })).toBeInTheDocument());
    fireEvent.keyDown(screen.getByRole("complementary", { name: "Inspection" }), { key: "Escape" });
    expect(screen.queryByRole("complementary", { name: "Inspection" })).not.toBeInTheDocument();
  });

  it("restores focus to the actual opener after close", async () => {
    routeFetch({ a: nodeBody("a", "Alpha") });
    render(<Harness />);
    const opener = screen.getByText("open-a");
    opener.focus();
    fireEvent.click(opener);
    await waitFor(() => expect(screen.getByRole("complementary", { name: "Inspection" })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Close inspection panel" }));
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("edge view shows all three provenance badges", () => {
    const edge: ToolEdge = {
      entityKey: "e1",
      srcEntityKey: "a",
      srcQualifiedName: "pkg/A",
      relation: "calls",
      dstEntityKey: "b",
      dstQualifiedName: "pkg/B",
      origin: "compiler",
      confidence: "certain",
      resolution: "resolved",
      evidence: [],
      evidenceOmittedCount: 0,
      freshness: "fresh",
      stale: false,
      staleReason: null,
      language: null,
      provenance: {
        extractorId: "tadori-cross-language-boundaries",
        extractorVersion: "1",
        capability: "repository",
        derivation: "repository-derived",
        unresolvedReason: null
      }
    };
    routeFetch({});
    function EdgeHarness() {
      const store = useInspectionStore();
      return (
        <>
          <button type="button" onClick={() => store.openEntity({ entityKey: "e1", entityType: "edge" })}>
            open-edge
          </button>
          <InspectionPanel store={store} repoRoot="/repo" edgesByKey={new Map([["e1", edge]])} />
        </>
      );
    }
    render(<EdgeHarness />);
    fireEvent.click(screen.getByText("open-edge"));
    expect(screen.getByText(/origin: compiler/)).toBeInTheDocument();
    expect(screen.getByText(/confidence: certain/)).toBeInTheDocument();
    expect(screen.getByText(/resolution: resolved/)).toBeInTheDocument();
    expect(screen.getByText(/capability: repository/)).toBeInTheDocument();
    expect(screen.getByText(/derivation: repository-derived/)).toBeInTheDocument();
  });

  it("registers a node connection for edge inspection and preserves it for back navigation", async () => {
    const edge: ToolEdge = {
      entityKey: "e1",
      srcEntityKey: "a",
      srcQualifiedName: "pkg/Alpha",
      relation: "calls",
      dstEntityKey: "b",
      dstQualifiedName: "pkg/Beta",
      origin: "compiler",
      confidence: "certain",
      resolution: "resolved",
      evidence: [],
      evidenceOmittedCount: 0,
      freshness: "fresh",
      stale: false,
      staleReason: null,
      language: "typescript",
      provenance: null
    };
    routeFetch({
      a: { ...nodeBody("a", "Alpha"), outEdges: [edge] },
      b: nodeBody("b", "Beta")
    });
    render(<Harness />);

    fireEvent.click(screen.getByText("open-a"));
    await waitFor(() => expect(screen.getByText("Alpha")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "calls → pkg/Beta" }));
    expect(screen.queryByText("Edge details are unavailable.")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "calls" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "pkg/Beta" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Beta" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Back to previous entity" }));

    expect(screen.getByRole("heading", { name: "calls" })).toBeInTheDocument();
    expect(screen.queryByText("Edge details are unavailable.")).not.toBeInTheDocument();
  });

  /**
   * "What depends on this?" is the question an interview asks, and the incoming
   * edges were already fetched and then reduced to a bare count. Both
   * directions are now listed, and each says plainly when it is empty rather
   * than rendering an unexplained gap.
   */
  it("lists dependents and dependencies separately instead of one count", async () => {
    const incoming: ToolEdge = {
      entityKey: "e:in",
      srcEntityKey: "b",
      srcQualifiedName: "pkg/Beta",
      relation: "references",
      dstEntityKey: "a",
      dstQualifiedName: "pkg/Alpha",
      origin: "compiler",
      confidence: "certain",
      resolution: "resolved",
      evidence: [],
      evidenceOmittedCount: 0,
      freshness: "fresh",
      stale: false,
      staleReason: null
    };
    routeFetch({ a: { ...nodeBody("a", "Alpha"), inEdges: [incoming] } });
    render(<Harness />);

    fireEvent.click(screen.getByText("open-a"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Alpha" })).toBeInTheDocument());

    expect(screen.getByRole("region", { name: "Dependents" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "pkg/Beta → references" })).toBeInTheDocument();
    expect(screen.getByText("No outgoing relation was extracted for this entity."))
      .toBeInTheDocument();
  });
});
