import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CapabilityPanel, declaredResolution, observationStatus } from "./CapabilityPanel.tsx";
import type { CapabilityLanguageDto, CapabilityMatrixDto } from "../../api/types.ts";
import type { UseCapabilitiesResult } from "../../hooks/useCapabilities.ts";

function language(overrides: Partial<CapabilityLanguageDto> = {}): CapabilityLanguageDto {
  return {
    id: "python",
    extractorId: "tadori-tree-sitter",
    extractorVersion: "1",
    features: { semanticResolution: "unsupported", structuralResolution: "structural" },
    ...overrides
  };
}

function matrix(overrides: Partial<CapabilityMatrixDto> = {}): CapabilityMatrixDto {
  return {
    version: 1,
    claim: "Tadori can structurally map mixed-language repositories.",
    states: ["semantic", "structural", "repository-only", "unsupported", "experimental"],
    languages: [language()],
    ...overrides
  };
}

function result(overrides: Partial<UseCapabilitiesResult> = {}): UseCapabilitiesResult {
  return { data: matrix(), loading: false, error: null, refetch: () => undefined, ...overrides };
}

describe("observationStatus", () => {
  it("separates declared support from what this snapshot observed", () => {
    expect(observationStatus("python", ["python", "go"])).toBe("observed");
    expect(observationStatus("rust", ["python", "go"])).toBe("not_in_snapshot");
  });
});

describe("declaredResolution", () => {
  it("reports the contract's own vocabulary verbatim", () => {
    expect(declaredResolution(language())).toBe("structural");
    expect(declaredResolution(language({
      features: { semanticResolution: "semantic", structuralResolution: "semantic" }
    }))).toBe("semantic");
    expect(declaredResolution(language({
      features: { semanticResolution: "experimental", structuralResolution: "structural" }
    }))).toBe("experimental");
  });

  it("falls to unsupported rather than guessing when neither axis is declared", () => {
    expect(declaredResolution(language({ features: {} }))).toBe("unsupported");
  });
});

describe("CapabilityPanel", () => {
  it("never lets declared support read as verified", () => {
    render(<CapabilityPanel capabilities={result()} observedLanguageIds={[]} />);
    expect(screen.getByText(/never evidence that a language was analyzed here/u)).toBeInTheDocument();
    // Declared but absent must say so rather than imply verification.
    const row = screen.getByRole("rowheader", { name: "python" }).closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("Not present in this repository")).toBeInTheDocument();
  });

  it("marks a language the snapshot actually observed", () => {
    render(<CapabilityPanel capabilities={result()} observedLanguageIds={["python"]} />);
    const row = screen.getByRole("rowheader", { name: "python" }).closest("tr");
    expect(within(row as HTMLElement).getByText("Observed in this snapshot")).toBeInTheDocument();
  });

  it("preserves extractor provenance for every declared language", () => {
    render(<CapabilityPanel capabilities={result()} observedLanguageIds={["python"]} />);
    expect(screen.getByText("tadori-tree-sitter@1")).toBeInTheDocument();
  });

  it("shows the product claim verbatim rather than paraphrasing it", () => {
    render(<CapabilityPanel capabilities={result()} observedLanguageIds={[]} />);
    expect(screen.getByText(matrix().claim)).toBeInTheDocument();
  });

  it("surfaces an unavailable contract as an alert, never as no support", () => {
    render(
      <CapabilityPanel
        capabilities={result({ data: null, error: new Error("offline") })}
        observedLanguageIds={[]}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Declared capabilities unavailable: offline");
  });
});
