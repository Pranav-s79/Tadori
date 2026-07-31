import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const SUBJECT = {
  entityKey: "fn:handle", kind: "function", qualifiedName: "api.handle",
  displayName: "handle", file: "src/api.ts", lineStart: 1, lineEnd: 4,
  signature: null, exported: true, fanIn: 1, representation: "name", body: null,
  evidence: [], evidenceOmittedCount: 0, freshness: "fresh", stale: false, staleReason: null,
  inEdges: [{
    entityKey: "e1", srcEntityKey: "fn:caller", srcQualifiedName: "api.caller",
    relation: "calls", dstEntityKey: "fn:handle", dstQualifiedName: "api.handle",
    origin: "compiler", confidence: "certain", resolution: "resolved"
  }],
  outEdges: []
};

vi.mock("../inspect/inspectApi.ts", () => ({
  fetchNodeDetail: vi.fn(async () => ({ status: "ok", node: SUBJECT }))
}));
vi.mock("../explore/exploreApi.ts", () => ({
  fetchLikelyTests: vi.fn(async () => ({ target: null, tests: [], observed: false, note: "not observed" }))
}));

import { InterviewPanel } from "./InterviewPanel.tsx";

describe("InterviewPanel", () => {
  it("interviews about the selected entity, not the repository at large", async () => {
    // Regression: the subject was looked up in the level-of-detail graph, which
    // holds one repository node at the landing view, so a selected entity still
    // produced a generic "this repository" interview.
    render(
      <InterviewPanel
        subjectEntityKey="fn:handle"
        routes={{ status: "ready", routes: [] }}
        analysis={null}
        onSelectEntity={vi.fn()}
      />
    );

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Interview preparation — handle/u })).toBeInTheDocument()
    );
  });

  it("offers inspection only for evidence the snapshot can resolve", async () => {
    render(
      <InterviewPanel
        subjectEntityKey="fn:handle"
        routes={{ status: "ready", routes: [] }}
        analysis={null}
        onSelectEntity={vi.fn()}
      />
    );

    // A dependent is a real entity, so it is inspectable.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "api.caller" })).toBeInTheDocument()
    );
    // The subject's file path is evidence but not an entity: text, never a button
    // that would resolve to nothing.
    expect(screen.getAllByText("src/api.ts").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "src/api.ts" })).not.toBeInTheDocument();
  });

  it("runs a whole-repository interview when nothing is selected", async () => {
    render(
      <InterviewPanel
        subjectEntityKey={null}
        routes={{ status: "ready", routes: [] }}
        analysis={null}
        onSelectEntity={vi.fn()}
      />
    );

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Interview preparation — this repository/u })).toBeInTheDocument()
    );
  });
});
