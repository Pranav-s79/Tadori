import { describe, expect, it } from "vitest";
import type { ApiNode } from "../api/types.ts";
import { atlasCapabilityForNode, atlasEdgeVisual, atlasNodeVisual } from "./atlasVisuals.ts";
import { ATLAS_EDGE_PROGRAMS, provenanceEdgeProgramDefinition } from "./ProvenanceEdgeProgram.ts";
import { ATLAS_NODE_PROGRAMS, atlasNodeProgramDefinition } from "./AtlasNodeProgram.ts";

function node(over: Partial<ApiNode> = {}): ApiNode {
  return {
    entityKey: "node",
    kind: "package",
    qualifiedName: "package",
    displayName: "package",
    file: null,
    exported: false,
    fanIn: 0,
    ...over
  };
}

describe("Stable Atlas visual mapping", () => {
  it("maps restrained archaeological forms from actual node kinds", () => {
    expect(atlasNodeVisual(node({ kind: "package" })).shape).toBe("foundation");
    expect(atlasNodeVisual(node({ kind: "file" })).shape).toBe("slab");
    expect(atlasNodeVisual(node({ kind: "function" })).shape).toBe("pillar");
    expect(atlasNodeVisual(node({ kind: "method" })).shape).toBe("stele");
    expect(atlasNodeVisual(node({ kind: "class" })).shape).toBe("colonnade");
    expect(atlasNodeVisual(node({ kind: "interface" })).shape).toBe("gateway");
    expect(atlasNodeVisual(node({ kind: "type" })).shape).toBe("seal");
    expect(atlasNodeVisual(node({ kind: "route" })).shape).toBe("gatehouse");
    expect(atlasNodeVisual(node({ kind: "adr" })).shape).toBe("tablet");
    expect(atlasNodeVisual(node({ kind: "doc_section" })).shape).toBe("tablet");
    expect(atlasNodeVisual(node({ kind: "test" })).shape).toBe("scaffold");
    expect(atlasNodeVisual(node({ kind: "external_dep" })).shape).toBe("outpost");
    expect(atlasNodeVisual(node({ kind: "unresolved" })).shape).toBe("terminus");
  });

  it("keeps every kind-derived structure legible at the base zoom", () => {
    expect(atlasNodeVisual(node({ kind: "package" })).size).toBe(13);
    expect(atlasNodeVisual(node({ kind: "file" })).size).toBe(11);
    expect(atlasNodeVisual(node({ kind: "method" })).size).toBe(9);
  });

  it("derives capability from provenance or honest aggregate data", () => {
    expect(atlasCapabilityForNode(node({
      provenance: {
        extractorId: "tree",
        extractorVersion: "1",
        capability: "structural",
        derivation: "parser-derived",
        unresolvedReason: null
      }
    }))).toBe("structural");
    expect(atlasCapabilityForNode(node({ aggregateCapabilities: ["semantic", "structural"] }))).toBe("mixed");
    expect(atlasCapabilityForNode(node())).toBe("unknown");
  });

  it("uses fan-in and selection without moving the node", () => {
    const quiet = atlasNodeVisual(node({ fanIn: 0 }));
    const connected = atlasNodeVisual(node({ fanIn: 31 }));
    const selected = atlasNodeVisual(node({ fanIn: 31 }), true);
    expect(connected.size).toBeGreaterThan(quiet.size);
    expect(selected.size).toBeGreaterThan(connected.size);
    expect(selected.color).toBe("#315f8c");
  });

  it("maps the authoritative provenance combinations to live program types", () => {
    expect(atlasEdgeVisual({ origin: "compiler", confidence: "certain", resolution: "resolved" }).type).toBe("solid");
    expect(atlasEdgeVisual({ origin: "compiler", confidence: "likely", resolution: "resolved" }).type).toBe("dashed");
    expect(atlasEdgeVisual({ origin: "heuristic", confidence: "inferred", resolution: "resolved" }).type).toBe("dotted");
    expect(atlasEdgeVisual({ origin: "doc", confidence: "certain", resolution: "resolved" }).color)
      .not.toBe(atlasEdgeVisual({ origin: "compiler", confidence: "certain", resolution: "resolved" }).color);
    expect(Object.keys(ATLAS_EDGE_PROGRAMS).sort()).toEqual(["dashed", "dotted", "solid"]);
    expect(ATLAS_NODE_PROGRAMS["atlas-foundation-semantic"]).toBeTypeOf("function");
    expect(ATLAS_NODE_PROGRAMS["atlas-gatehouse-structural"]).toBeTypeOf("function");
    expect(ATLAS_NODE_PROGRAMS["atlas-outpost-repository"]).toBeTypeOf("function");
    const structuralSlab = atlasNodeProgramDefinition("slab", "structural").FRAGMENT_SHADER_SOURCE;
    expect(structuralSlab).toContain("innerMark");
    expect(structuralSlab).toContain("vec3(0.91, 0.69, 0.34)");
    expect(structuralSlab.match(/discard/g)).toHaveLength(1);
    expect(provenanceEdgeProgramDefinition("dashed").CONSTANT_DATA).toEqual([
      [0, 1], [0, -1], [1, 1], [1, 1], [0, -1], [1, -1]
    ]);
    expect(provenanceEdgeProgramDefinition("dashed").FRAGMENT_SHADER_SOURCE).toContain("mod(v_distance, 6.0)");
    expect(provenanceEdgeProgramDefinition("dotted").FRAGMENT_SHADER_SOURCE).toContain("mod(v_distance, 3.0)");
    expect(provenanceEdgeProgramDefinition("solid").FRAGMENT_SHADER_SOURCE).toContain("circuitCore");
  });
});
