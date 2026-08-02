import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ApiEdge, ApiNode } from "../../api/types.ts";
import { AccessibleGraphTable, tableStoryState } from "./AccessibleGraphTable.tsx";
import { defaultFilters } from "../search/filterState.ts";

function node(entityKey: string, over: Partial<ApiNode> = {}): ApiNode {
  return {
    entityKey,
    kind: "package",
    qualifiedName: entityKey,
    displayName: entityKey,
    file: null,
    exported: false,
    fanIn: 0,
    ...over
  };
}

function edge(src: string, relation: string, dst: string): ApiEdge {
  return {
    entityKey: `${src}-${relation}-${dst}`,
    srcEntityKey: src,
    relation,
    dstEntityKey: dst,
    origin: "compiler",
    confidence: "certain",
    resolution: "resolved"
  };
}

describe("AccessibleGraphTable", () => {
  it("renders the graph content as a semantic table with column and row headers", () => {
    render(
      <AccessibleGraphTable
        nodes={[node("pkg-a", { kind: "package", fanIn: 2, file: "src/a.ts" })]}
        edges={[]}
      />
    );
    // A real <table> with a header row and a row <th scope="row"> for the node.
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Capability" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Archaeological form" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Material" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Story state" })).toBeTruthy();
    expect(screen.getByRole("rowheader")).toBeTruthy();
    const table = screen.getByRole("table");
    expect(within(table).getByText("package")).toBeTruthy();
    expect(within(table).getByText("src/a.ts")).toBeTruthy();
  });

  it("summarizes a node's outgoing relations as text (not a canvas)", () => {
    render(
      <AccessibleGraphTable
        nodes={[node("a"), node("b"), node("c")]}
        edges={[edge("a", "calls", "b"), edge("a", "calls", "c"), edge("a", "imports", "b")]}
      />
    );
    // Node "a" has calls→2, imports→1 rendered verbatim as accessible text.
    expect(screen.getByText("calls → 2, imports → 1")).toBeTruthy();
  });

  it("names edge provenance in text alongside the relation summary", () => {
    render(
      <AccessibleGraphTable
        nodes={[node("source"), node("target")]}
        edges={[edge("source", "calls", "target")]}
      />
    );
    expect(screen.getByText("calls: certain, resolved, compiler")).toBeInTheDocument();
  });

  it("uses aggregate counts and provenance buckets instead of representative facts", () => {
    render(
      <AccessibleGraphTable
        nodes={[node("source"), node("target")]}
        edges={[{
          entityKey: "aggregate",
          srcEntityKey: "source",
          relation: "imports",
          dstEntityKey: "target",
          projectionKind: "package_aggregate",
          aggregateCount: 3,
          aggregateProvenance: [
            { origin: "compiler", confidence: "certain", resolution: "resolved", count: 2 },
            { origin: "heuristic", confidence: "likely", resolution: "partial", count: 1 }
          ]
        }]}
      />
    );
    expect(screen.getByText(/imports.*3/)).toBeInTheDocument();
    expect(screen.getByText(/2 certain, resolved, compiler; 1 likely, partial, heuristic/)).toBeInTheDocument();
  });

  it("names language, capability, and derivation as text equivalents", () => {
    render(
      <AccessibleGraphTable
        nodes={[node("py", {
          language: "python",
          provenance: {
            extractorId: "tree",
            extractorVersion: "1",
            capability: "structural",
            derivation: "parser-derived",
            unresolvedReason: null
          }
        })]}
        edges={[]}
      />
    );
    expect(screen.getByText("python")).toBeInTheDocument();
    expect(screen.getByText("structural")).toBeInTheDocument();
    expect(screen.getByText("parser-derived")).toBeInTheDocument();
    expect(screen.getByText("package foundation")).toBeInTheDocument();
    expect(screen.getByText("open-course green-grey stone; structural")).toBeInTheDocument();
  });

  it("names every evidence-backed Story state without relying on copper emphasis", () => {
    const storyEmphasis = {
      pathEntityKeys: ["source", "active", "wall"],
      transitions: [{ fromEntityKey: "source", toEntityKey: "active", relation: "calls" }],
      activeEntityKey: "active",
      unresolvedFromEntityKey: "wall"
    } as const;
    render(
      <AccessibleGraphTable
        nodes={[node("source"), node("active"), node("wall"), node("other")]}
        edges={[]}
        storyEmphasis={storyEmphasis}
      />
    );
    expect(screen.getByText("on active story path")).toBeInTheDocument();
    expect(screen.getByText("active story step")).toBeInTheDocument();
    expect(screen.getByText("active unresolved termination source")).toBeInTheDocument();
    expect(screen.getByText("outside active story path")).toBeInTheDocument();
    expect(tableStoryState("source", null)).toBe("no active story");
  });

  it("renders 'none' for a node with no outgoing edges", () => {
    render(<AccessibleGraphTable nodes={[node("lonely")]} edges={[]} />);
    expect(screen.getAllByText("none")).toHaveLength(2);
  });

  it("opens a node in the inspection panel when its row header button is activated", () => {
    const onInspect = vi.fn();
    render(<AccessibleGraphTable nodes={[node("pkg-x")]} edges={[]} onInspect={onInspect} />);
    fireEvent.click(screen.getByRole("button", { name: "pkg-x" }));
    expect(onInspect).toHaveBeenCalledWith("pkg-x");
  });

  it("shows an empty-state status when there are no nodes", () => {
    render(<AccessibleGraphTable nodes={[]} edges={[]} />);
    expect(screen.getByText("No nodes in this snapshot.")).toBeTruthy();
  });

  it("dims with the same active filters without removing nodes or relations", () => {
    const nodes = [
      node("python", { language: "python", provenance: { extractorId: "tree", extractorVersion: "1", capability: "structural", derivation: "parser-derived", unresolvedReason: null } }),
      node("typescript", { language: "typescript", provenance: { extractorId: "ts", extractorVersion: "1", capability: "semantic", derivation: "compiler-resolved", unresolvedReason: null } })
    ];
    const edges = [edge("python", "calls", "typescript")];
    render(<AccessibleGraphTable nodes={nodes} edges={edges} filters={{ ...defaultFilters(), languages: ["python"] }} />);
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(screen.getByRole("button", { name: "python" }).closest("tr")).toHaveAttribute("data-filter-dimmed", "false");
    expect(screen.getByRole("button", { name: "typescript" }).closest("tr")).toHaveAttribute("data-filter-dimmed", "true");
    expect(screen.getAllByText(/calls/)).toHaveLength(2);
  });
});
