import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CapabilityMark } from "./CapabilityMark.tsx";
import { ProvenanceStroke } from "./ProvenanceStroke.tsx";

// The stylesheet-as-a-file assertions live in
// apps/viz/test/stylesheetContract.test.ts: they need node:fs, and apps/viz/src
// is the browser bundle, which lint correctly forbids from importing Node
// builtins.

describe("archaeological-circuit design primitives", () => {
  it("names capability and analysis limits without relying on texture", () => {
    render(<CapabilityMark capability="structural" />);
    expect(screen.getByLabelText("Structural: Parser-derived structure is available"))
      .toHaveAttribute("data-capability", "structural");
    expect(screen.getByText("Structural")).toBeInTheDocument();
  });

  it("uses the shared dotted provenance encoding and exposes it as text", () => {
    const { container } = render(
      <ProvenanceStroke origin="heuristic" confidence="inferred" resolution="unresolved" />
    );
    expect(screen.getByLabelText("inferred, unresolved, heuristic provenance")).toBeInTheDocument();
    expect(container.querySelector("line")).toHaveAttribute("stroke-dasharray", "1 2");
  });
});
