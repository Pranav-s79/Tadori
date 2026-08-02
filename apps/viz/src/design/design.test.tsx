import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CapabilityMark } from "./CapabilityMark.tsx";
import { ProvenanceStroke } from "./ProvenanceStroke.tsx";

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 0xff)
    + 0.7152 * channel((n >> 8) & 0xff)
    + 0.0722 * channel(n & 0xff);
}

function contrastRatio(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function readStylesheet(name: string): string {
  return readFileSync(new URL(name, import.meta.url), "utf8");
}

function token(tokens: string, name: string): string {
  const value = new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i").exec(tokens)?.[1];
  if (value === undefined) throw new Error(`token ${name} is not declared`);
  return value;
}

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

describe("reading surfaces", () => {
  it("declares a link colour that reaches AA on the ground surface", () => {
    const tokens = readStylesheet("./tokens.css");
    expect(contrastRatio(token(tokens, "--tadori-link"), token(tokens, "--tadori-ground")))
      .toBeGreaterThanOrEqual(4.5);
  });

  it("declares a link colour that reaches AA on the raised panel surface", () => {
    const tokens = readStylesheet("./tokens.css");
    expect(contrastRatio(token(tokens, "--tadori-link"), token(tokens, "--tadori-panel-raised")))
      .toBeGreaterThanOrEqual(4.5);
  });

  // The document modes size themselves to their content. While every mode
  // panel was `overflow: hidden` that made two thirds of the Overview
  // unreachable by wheel or scrollbar, so the scroll has to live here.
  it("lets the document modes scroll instead of clipping them", () => {
    expect(readStylesheet("../index.css"))
      .toMatch(/\.mode-panel-overview,\s*\n\.mode-panel-interview\s*\{[^}]*overflow-y:\s*auto/);
  });
});
