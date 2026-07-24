import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ApiEdge, ApiNode } from "../../api/types.ts";
import { AccessibleGraphTable } from "./AccessibleGraphTable.tsx";

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

  it("renders 'none' for a node with no outgoing edges", () => {
    render(<AccessibleGraphTable nodes={[node("lonely")]} edges={[]} />);
    expect(screen.getByText("none")).toBeTruthy();
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
});
