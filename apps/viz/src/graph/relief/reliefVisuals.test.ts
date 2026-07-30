import { describe, expect, it } from "vitest";
import type { ApiNode, ExtractionCapability, NodeKind } from "../../api/types.ts";
import { reliefHeight, reliefVisualForNode } from "./reliefVisuals.ts";

const EXPECTED_FORMS: Readonly<Record<NodeKind, string>> = {
  package: "foundation", file: "slab", function: "pillar", method: "stele",
  class: "colonnade", interface: "gateway", type: "seal", route: "gatehouse",
  test: "scaffold", adr: "tablet", doc_section: "tablet", external_dep: "outpost",
  unresolved: "terminus"
};

function node(kind: NodeKind, overrides: Partial<ApiNode> = {}): ApiNode {
  return { entityKey: kind, kind, qualifiedName: kind, displayName: kind, file: null, exported: false, fanIn: 0, ...overrides };
}

describe("reliefVisualForNode", () => {
  it("maps every canonical node kind to a specific built form", () => {
    for (const [kind, form] of Object.entries(EXPECTED_FORMS) as Array<[NodeKind, string]>) {
      expect(reliefVisualForNode(node(kind)).form).toBe(form);
      expect(reliefVisualForNode(node(kind)).formLabel).not.toHaveLength(0);
      expect(reliefVisualForNode(node(kind)).footprintWidth).toBeGreaterThan(0);
      expect(reliefVisualForNode(node(kind)).footprintDepth).toBeGreaterThan(0);
    }
  });

  it("maps extraction capability without claiming unknown or mixed evidence as semantic", () => {
    const provenance = (capability: ExtractionCapability): ApiNode["provenance"] => ({
      extractorId: "fixture",
      extractorVersion: "1",
      capability,
      derivation: capability === "semantic" ? "compiler-resolved" : capability === "structural" ? "parser-derived" : "repository-derived",
      unresolvedReason: null
    });
    expect(reliefVisualForNode(node("file", { provenance: provenance("semantic") })).capability).toBe("semantic");
    expect(reliefVisualForNode(node("file", { provenance: provenance("structural") })).capability).toBe("structural");
    expect(reliefVisualForNode(node("file", { provenance: provenance("repository") })).capability).toBe("repository");
    expect(reliefVisualForNode(node("file", { aggregateCapabilities: ["semantic", "structural"] })).capability).toBe("mixed");
    expect(reliefVisualForNode(node("file"))).toMatchObject({ capability: "unknown", form: "slab" });
  });

  it("uses monotonic bounded fan-in height", () => {
    expect(reliefHeight(0)).toBe(8);
    expect(reliefHeight(-4)).toBe(8);
    expect(reliefHeight(3)).toBeGreaterThan(reliefHeight(1));
    expect(reliefHeight(1_000_000)).toBe(40);
    expect(reliefHeight(Number.NaN)).toBe(8);
    expect(reliefHeight(Number.POSITIVE_INFINITY)).toBe(8);
  });
});
