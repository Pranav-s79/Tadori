import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SourceSliceResult } from "./inspectApi.ts";
import { SourceView } from "./SourceView.tsx";

describe("SourceView stale suppression", () => {
  it("renders body only when ok + matches_snapshot + non-null body", () => {
    const ok: SourceSliceResult = {
      status: "ok",
      slice: { body: "const x = 1;", freshness: "fresh", staleReason: "matches_snapshot" }
    };
    render(<SourceView result={ok} loading={false} />);
    expect(screen.getByText("const x = 1;")).toBeInTheDocument();
  });

  it("never renders body text when staleReason is not matches_snapshot, even if body is non-null", () => {
    // Defensive/malformed: ok status + non-null body but a stale reason.
    const malformed: SourceSliceResult = {
      status: "ok",
      slice: { body: "SECRET STALE CONTENT", freshness: "stale", staleReason: "content_changed" }
    };
    render(<SourceView result={malformed} loading={false} />);
    expect(screen.queryByText("SECRET STALE CONTENT")).not.toBeInTheDocument();
    expect(screen.getByText(/suppressed/i)).toBeInTheDocument();
  });

  it("renders a notice for content_changed status", () => {
    render(<SourceView result={{ status: "content_changed" }} loading={false} />);
    expect(screen.getByText(/changed since this snapshot/i)).toBeInTheDocument();
  });

  it("renders a notice for outside_repository status", () => {
    render(<SourceView result={{ status: "outside_repository" }} loading={false} />);
    expect(screen.getByText(/outside the repository root/i)).toBeInTheDocument();
  });

  it("shows a loading state and no body while loading", () => {
    render(<SourceView result={null} loading />);
    expect(screen.getByText(/loading source/i)).toBeInTheDocument();
  });
});
