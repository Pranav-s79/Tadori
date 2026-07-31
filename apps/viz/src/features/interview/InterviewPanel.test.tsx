import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InterviewPanel } from "./InterviewPanel.tsx";
import type { ApiEdge, ApiNode } from "../../api/types.ts";

function node(overrides: Partial<ApiNode> = {}): ApiNode {
  return {
    entityKey: "fn:handle", kind: "function", qualifiedName: "api.handle",
    displayName: "handle", file: "src/api.ts", exported: true, fanIn: 0, ...overrides
  };
}

function edge(src: string, dst: string): ApiEdge {
  return { entityKey: `${src}->${dst}`, srcEntityKey: src, relation: "calls", dstEntityKey: dst };
}

describe("InterviewPanel evidence", () => {
  it("offers inspection only for evidence the served graph can resolve", () => {
    const subject = node();
    const caller = node({ entityKey: "fn:caller", displayName: "caller" });
    render(
      <InterviewPanel
        subject={subject}
        nodes={[subject, caller]}
        edges={[edge("fn:caller", "fn:handle")]}
        analysis={null}
        onSelectEntity={vi.fn()}
      />
    );

    // A dependent is a real node, so it is inspectable.
    expect(screen.getByRole("button", { name: "fn:caller" })).toBeInTheDocument();
    // The subject's own file path is evidence too, but it is not an entity key.
    // It must read as text, never as a button that resolves to nothing.
    expect(screen.getAllByText("src/api.ts").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "src/api.ts" })).not.toBeInTheDocument();
  });
});
