import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DocumentsPanel } from "./DocumentsPanel.tsx";
import { ExploreTabs } from "./ExploreTabs.tsx";
import { LikelyTests } from "./LikelyTests.tsx";
import { PathFinder } from "./PathFinder.tsx";
import { RouteTable } from "./RouteTable.tsx";

function stubFetch(body: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: async () => Promise.resolve(body)
      } as Response)
    )
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LikelyTests honesty wording", () => {
  it("renders the frozen heading and 'not observed inspected' caption verbatim", async () => {
    stubFetch({ tests: [], observed: false, note: "not observed inspected" });
    render(<LikelyTests />);
    expect(screen.getByText("Likely relevant tests")).toBeTruthy();
    expect(screen.getByText("not observed inspected")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("No likely-relevant tests found.")).toBeTruthy());
  });

  it("renders the linkage badge but never a runtime-coverage claim", async () => {
    stubFetch({
      target: { entityKey: "tgt", kind: "function", qualifiedName: "f", displayName: "f", file: "f.ts" },
      tests: [
        {
          node: { entityKey: "t1", kind: "test", qualifiedName: "a.test", displayName: "a.test", file: "a.test.ts" },
          linkage: "statically_linked",
          edge: null
        }
      ],
      observed: false,
      note: "not observed inspected"
    });
    const { container } = render(<LikelyTests forEntity="tgt" />);
    await waitFor(() => expect(screen.getByText("a.test")).toBeTruthy());
    expect(screen.getByText(/Statically linked/)).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/passing|covers|verified running/i);
  });
});

describe("RouteTable path source", () => {
  it("renders the real path-source label from the route's origin", async () => {
    stubFetch({
      routes: [
        {
          node: { entityKey: "r1", kind: "route", qualifiedName: "GET /u", displayName: "GET /u", file: "r.ts", signature: 'app.get("/u")' },
          pathSourceOrigin: "compiler"
        }
      ]
    });
    render(<RouteTable />);
    await waitFor(() => expect(screen.getByText("GET /u")).toBeTruthy());
    expect(screen.getByText("path source: direct")).toBeTruthy();
  });

  it("shows an explicit cell, not a guess, when a route has no routes_to edge", async () => {
    stubFetch({
      routes: [
        {
          node: { entityKey: "r2", kind: "route", qualifiedName: "orphan", displayName: "orphan", file: null },
          pathSourceOrigin: null
        }
      ]
    });
    render(<RouteTable />);
    await waitFor(() => expect(screen.getByText("no route-registration edge")).toBeTruthy());
  });
});

describe("DocumentsPanel grounding", () => {
  it("shows a grounded doc's citation count and lists ungrounded docs explicitly", async () => {
    stubFetch({
      docs: [
        {
          node: { entityKey: "adr1", kind: "adr", qualifiedName: "ADR-1", displayName: "ADR-1", file: "docs/adr1.md" },
          body: "Because reasons.",
          documents: [{ entityKey: "e1", srcEntityKey: "adr1", relation: "documents", dstEntityKey: "f1", origin: "doc", confidence: "certain", resolution: "resolved" }]
        },
        {
          node: { entityKey: "adr2", kind: "adr", qualifiedName: "ADR-2", displayName: "ADR-2", file: "docs/adr2.md" },
          body: null,
          documents: []
        }
      ]
    });
    render(<DocumentsPanel />);
    await waitFor(() => expect(screen.getByText("ADR-1")).toBeTruthy());
    expect(screen.getByText(/documents 1 entity/)).toBeTruthy();
    // The ungrounded doc is never dropped — it appears under its own section.
    expect(screen.getByText(/Ungrounded \(1\)/)).toBeTruthy();
    expect(screen.getByText("ADR-2")).toBeTruthy();
  });
});

describe("PathFinder status rendering", () => {
  it("renders a found path (status ok) as an ordered sequence", async () => {
    stubFetch({
      status: "ok",
      from: null,
      to: null,
      fromCandidates: [],
      toCandidates: [],
      paths: [
        {
          nodes: [
            { entityKey: "a", kind: "method", qualifiedName: "A", displayName: "A", file: "a.ts" },
            { entityKey: "b", kind: "method", qualifiedName: "B", displayName: "B", file: "b.ts" }
          ],
          edges: [{ entityKey: "e", srcEntityKey: "a", relation: "calls", dstEntityKey: "b", origin: "compiler", confidence: "certain", resolution: "resolved" }]
        }
      ],
      nearestApproach: [],
      message: "1 path"
    });
    render(<PathFinder />);
    const inputs = screen.getAllByPlaceholderText("entity key or name");
    fireEvent.change(inputs[0]!, { target: { value: "A" } });
    fireEvent.change(inputs[1]!, { target: { value: "B" } });
    fireEvent.click(screen.getByRole("button", { name: "Find path" }));
    await waitFor(() => expect(screen.getByLabelText("Found paths")).toBeTruthy());
    expect(screen.getByRole("button", { name: "A" })).toBeTruthy();
  });

  it("shows the nearestApproach hint on no_path, labelled as not a path", async () => {
    stubFetch({
      status: "no_path",
      from: null,
      to: null,
      fromCandidates: [],
      toCandidates: [],
      paths: [],
      nearestApproach: [{ entityKey: "n", kind: "method", qualifiedName: "N", displayName: "N", file: "n.ts" }],
      message: "no path"
    });
    render(<PathFinder />);
    const inputs = screen.getAllByPlaceholderText("entity key or name");
    fireEvent.change(inputs[0]!, { target: { value: "X" } });
    fireEvent.change(inputs[1]!, { target: { value: "Y" } });
    fireEvent.click(screen.getByRole("button", { name: "Find path" }));
    await waitFor(() => expect(screen.getByText("No path found between these two entities.")).toBeTruthy());
    expect(screen.getByText(/not a path/)).toBeTruthy();
  });
});

describe("ExploreTabs", () => {
  it("mounts only the active tab's view, never two at once", async () => {
    stubFetch({
      status: "not_found",
      from: null,
      to: null,
      fromCandidates: [],
      toCandidates: [],
      paths: [],
      nearestApproach: [],
      message: "not found"
    });
    render(<ExploreTabs />);
    // Path tab is default: its from/to form is present, the routes table is not.
    expect(screen.getByLabelText("Path finder")).toBeTruthy();
    expect(screen.queryByLabelText("Routes")).toBeNull();

    stubFetch({ routes: [] });
    fireEvent.click(screen.getByRole("tab", { name: "Routes" }));
    await waitFor(() => expect(screen.queryByLabelText("Path finder")).toBeNull());
  });
});
