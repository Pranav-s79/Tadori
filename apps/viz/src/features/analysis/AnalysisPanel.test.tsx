import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnalysisPanel, diagnosticSeveritySummary } from "./AnalysisPanel.tsx";
import type { SnapshotAnalysisDto } from "../../api/types.ts";
import type { UseAnalysisResult } from "../../hooks/useAnalysis.ts";

function analysisDto(overrides: Partial<SnapshotAnalysisDto> = {}): SnapshotAnalysisDto {
  return {
    snapshotId: 7,
    analyzerVersion: "tadori-indexer/0.2.1",
    languages: [
      {
        id: "python",
        fileCount: 12,
        generatedFileCount: 1,
        capabilities: ["structural"],
        extractors: [{ id: "tadori-tree-sitter", version: "1", capability: "structural" }]
      }
    ],
    extractors: [
      { id: "tadori-tree-sitter", version: "1", capability: "structural", languages: ["python"] }
    ],
    diagnostics: {
      items: [],
      total: 0,
      omittedCount: 0,
      nextCursor: null,
      bySeverity: { info: 0, warning: 0, error: 0 }
    },
    ...overrides
  };
}

function result(overrides: Partial<UseAnalysisResult> = {}): UseAnalysisResult {
  return { data: analysisDto(), loading: false, error: null, refetch: () => undefined, ...overrides };
}

describe("diagnosticSeveritySummary", () => {
  it("names only the severities actually present, most severe first", () => {
    expect(diagnosticSeveritySummary({ info: 2, warning: 1, error: 3 }))
      .toBe("3 errors, 1 warning, 2 infos");
  });

  it("returns null for a genuinely clean snapshot rather than a row of zeros", () => {
    expect(diagnosticSeveritySummary({ info: 0, warning: 0, error: 0 })).toBeNull();
  });
});

describe("AnalysisPanel", () => {
  it("reports observed languages as observation, never as declared support", () => {
    render(<AnalysisPanel analysis={result()} />);
    expect(screen.getByText(/not the product.s declared support/u)).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "python" })).toBeInTheDocument();
    // Capability is carried as text, not by texture alone.
    expect(screen.getByText("Structural")).toBeInTheDocument();
  });

  it("states a clean snapshot explicitly instead of rendering nothing", () => {
    render(<AnalysisPanel analysis={result()} />);
    expect(screen.getByText(/No extraction diagnostic was recorded/u)).toBeInTheDocument();
  });

  it("accounts for omitted diagnostics rather than implying completeness", () => {
    const analysis = result({
      data: analysisDto({
        diagnostics: {
          items: [{
            code: "parse-failed",
            severity: "error",
            message: "Tree-sitter could not parse this file",
            file: "src/broken.py",
            language: "python",
            extractorId: "tadori-tree-sitter",
            extractorVersion: "1",
            lineStart: 4,
            lineEnd: 4
          }],
          total: 9,
          omittedCount: 8,
          nextCursor: "1",
          bySeverity: { info: 0, warning: 0, error: 9 }
        }
      })
    });
    render(<AnalysisPanel analysis={analysis} />);
    expect(screen.getByText("Showing 1 of 9 diagnostics; 8 not shown.")).toBeInTheDocument();
    expect(screen.getByText("src/broken.py:4")).toBeInTheDocument();
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("surfaces an unavailable analysis as an alert, never as a clean result", () => {
    render(<AnalysisPanel analysis={result({ data: null, error: new Error("offline") })} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Analysis facts unavailable: offline");
    expect(screen.queryByText(/No extraction diagnostic was recorded/u)).not.toBeInTheDocument();
  });
});
