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
    expect(screen.getAllByRole("dialog")).toHaveLength(1);

    fireEvent.click(screen.getByText("open-b"));
    await waitFor(() => expect(screen.getByText("Beta")).toBeInTheDocument());
    // Exactly one panel root, and the previous content is gone.
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
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

  it("Escape closes the panel", async () => {
    routeFetch({ a: nodeBody("a", "Alpha") });
    render(<Harness />);
    fireEvent.click(screen.getByText("open-a"));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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
      staleReason: null
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
  });
});
