import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DocumentsPanel } from "./DocumentsPanel.tsx";
import { LikelyTests } from "./LikelyTests.tsx";
import { PathFinder } from "./PathFinder.tsx";

function stubFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: async () => Promise.resolve(body)
    } as Response)
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LikelyTests honesty wording", () => {
  it("renders the frozen heading and 'not observed inspected' caption verbatim", async () => {
    stubFetch({ tests: [], observed: false, note: "not observed inspected" });
    render(<LikelyTests forEntity="tgt" />);
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

describe("DocumentsPanel for an inspected entity", () => {
  it("asks only for the docs that cite the entity and pivots into each", async () => {
    const fetchMock = stubFetch({
      docs: [
        {
          node: { entityKey: "adr1", kind: "adr", qualifiedName: "ADR-1", displayName: "ADR-1", file: "docs/adr1.md" },
          body: "Because reasons.",
          documents: [{ entityKey: "e1", srcEntityKey: "adr1", relation: "documents", dstEntityKey: "f1", origin: "doc", confidence: "certain", resolution: "resolved" }]
        }
      ]
    });
    const onInspect = vi.fn();
    render(<DocumentsPanel forEntity="f1" onInspect={onInspect} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "ADR-1" })).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/docs?for=f1");
    expect(screen.getByText("docs/adr1.md")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ADR-1" }));
    expect(onInspect).toHaveBeenCalledWith("adr1");
  });

  it("says plainly when nothing cites the entity", async () => {
    stubFetch({ docs: [] });
    render(<DocumentsPanel forEntity="f1" />);
    await waitFor(() => expect(screen.getByText("No document or ADR in this snapshot cites this entity.")).toBeTruthy());
  });
});

describe("PathFinder status rendering", () => {
  it("searches from the inspected entity to the named one", async () => {
    const fetchMock = stubFetch({
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
    render(<PathFinder from="a" />);
    expect(screen.queryByLabelText("From")).toBeNull();
    const to = screen.getByLabelText("To");
    expect(to).toHaveFocus();
    fireEvent.change(to, { target: { value: "B" } });
    fireEvent.click(screen.getByRole("button", { name: "Find path" }));
    await waitFor(() => expect(screen.getByLabelText("Found paths")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/path?from=a&to=B");
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
    render(<PathFinder from="x" />);
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "Y" } });
    fireEvent.click(screen.getByRole("button", { name: "Find path" }));
    await waitFor(() => expect(screen.getByText("No path found between these two entities.")).toBeTruthy());
    expect(screen.getByText(/not a path/)).toBeTruthy();
  });
});
