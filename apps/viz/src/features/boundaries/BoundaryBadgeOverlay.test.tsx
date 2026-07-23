import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ApiNode } from "../../api/types.ts";
import { BoundaryBadgeOverlay, partitionViolations, type BadgePosition } from "./BoundaryBadgeOverlay.tsx";
import type { BoundaryViolation } from "./boundariesApi.ts";

function fileNode(entityKey: string, file: string): ApiNode {
  return { entityKey, kind: "file", qualifiedName: file, displayName: file, file, exported: false, fanIn: 0 };
}

const publicReport = fileNode("k-public", "src/public/report.ts");
const internalSecret = fileNode("k-internal", "src/internal/secret.ts");

const violation: BoundaryViolation = {
  ruleId: "public-must-not-import-internal",
  src: "file:src/public/report.ts",
  edgeRelation: "imports",
  dst: "file:src/internal/secret.ts",
  severity: "error",
  evidence: [{ file: "src/public/report.ts", line: 1, contains: "../internal/secret.js" }]
};

describe("partitionViolations", () => {
  it("places a violation at its source file's layout coordinate", () => {
    const positions = new Map<string, BadgePosition>([["k-public", { x: 12, y: 34 }]]);
    const { placed, unplaced } = partitionViolations([violation], [publicReport, internalSecret], positions);
    expect(unplaced).toHaveLength(0);
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({ entityKey: "k-public", x: 12, y: 34 });
  });

  it("lists a violation as unplaced when the source file's node has no layout position", () => {
    // Node exists (resolves to an entityKey) but it is not in the positions map
    // (its package is collapsed). Never drawn at a guessed spot.
    const { placed, unplaced } = partitionViolations([violation], [publicReport, internalSecret], new Map());
    expect(placed).toHaveLength(0);
    expect(unplaced).toHaveLength(1);
    expect(unplaced[0]?.entityKey).toBe("k-public");
  });

  it("lists a violation as unplaced with null entityKey when no node matches the source file", () => {
    const { placed, unplaced } = partitionViolations([violation], [internalSecret], new Map());
    expect(placed).toHaveLength(0);
    expect(unplaced[0]?.entityKey).toBeNull();
  });

  it("never matches the package node (file:null) to a file-crossing violation", () => {
    const pkg: ApiNode = {
      entityKey: "k-pkg",
      kind: "package",
      qualifiedName: "@x/core",
      displayName: "@x/core",
      file: null,
      exported: false,
      fanIn: 0
    };
    const positions = new Map<string, BadgePosition>([["k-pkg", { x: 1, y: 1 }]]);
    const { placed, unplaced } = partitionViolations([violation], [pkg], positions);
    expect(placed).toHaveLength(0);
    expect(unplaced[0]?.entityKey).toBeNull();
  });
});

describe("BoundaryBadgeOverlay rendering", () => {
  it("shows the no-rules message when rulesPresent is false", () => {
    render(<BoundaryBadgeOverlay violations={[]} nodes={[]} positions={new Map()} rulesPresent={false} />);
    expect(screen.getByText(/No boundary rules declared/)).toBeTruthy();
  });

  it("shows the clean message when rules are present but no violations", () => {
    render(<BoundaryBadgeOverlay violations={[]} nodes={[]} positions={new Map()} rulesPresent />);
    expect(screen.getByText(/No boundary violations/)).toBeTruthy();
  });

  it("renders a placed badge with an accessible label describing the crossing", () => {
    const positions = new Map<string, BadgePosition>([["k-public", { x: 5, y: 6 }]]);
    render(
      <BoundaryBadgeOverlay
        violations={[violation]}
        nodes={[publicReport, internalSecret]}
        positions={positions}
        rulesPresent
      />
    );
    expect(screen.getByLabelText(/error: src\/public\/report\.ts imports src\/internal\/secret\.ts/)).toBeTruthy();
    expect(screen.getByText(/1 boundary violation\./)).toBeTruthy();
  });

  it("surfaces an error state honestly instead of a silent empty result", () => {
    render(
      <BoundaryBadgeOverlay
        violations={[]}
        nodes={[]}
        positions={new Map()}
        rulesPresent={false}
        error={new Error("tadori.rules.json: broken")}
      />
    );
    expect(screen.getByRole("alert").textContent).toMatch(/tadori\.rules\.json: broken/);
  });
});
