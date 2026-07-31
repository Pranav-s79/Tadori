import { describe, expect, it } from "vitest";
import { buildOverview, type OverviewInput, type OverviewSection } from "./overviewModel.ts";
import type { ApiNode } from "../../api/types.ts";

function node(overrides: Partial<ApiNode> = {}): ApiNode {
  return {
    entityKey: "pkg:a", kind: "package", qualifiedName: "a", displayName: "a",
    file: "src/a.ts", exported: true, fanIn: 0, ...overrides
  };
}

const empty: OverviewInput = {
  context: null, analysis: null, regions: null, capabilities: null, nodes: []
};

function sectionById(input: OverviewInput, id: string): OverviewSection | undefined {
  return buildOverview(input).find((section) => section.id === id);
}

describe("buildOverview", () => {
  it("never invents a repository purpose", () => {
    // Nothing served establishes intent, so purpose stays unknown rather than
    // being guessed from names — the core honesty rule.
    const purpose = sectionById(empty, "purpose");
    expect(purpose?.claims[0]?.basis).toBe("unknown");
    expect(purpose?.claims[0]?.value).toMatch(/does not infer intent/u);
  });

  it("states an absent entry point as unknown, not as 'the system has none'", () => {
    const claim = sectionById(empty, "entry-points")?.claims[0];
    expect(claim?.basis).toBe("unknown");
    expect(claim?.value).toMatch(/not that the system has none/u);
  });

  it("reports observed routes with the file as evidence", () => {
    const input = {
      ...empty,
      nodes: [node({ entityKey: "route:get", kind: "route", displayName: "GET /a", file: "src/api.ts" })]
    };
    const claim = sectionById(input, "entry-points")?.claims[0];
    expect(claim?.basis).toBe("observed");
    expect(claim?.evidence).toEqual(["src/api.ts"]);
    expect(claim?.entityKey).toBe("route:get");
  });

  it("ranks the most depended-upon entities by real fan-in", () => {
    const input = {
      ...empty,
      nodes: [
        node({ entityKey: "a", displayName: "a", fanIn: 2 }),
        node({ entityKey: "b", displayName: "b", fanIn: 9 })
      ]
    };
    const claims = sectionById(input, "risk")?.claims ?? [];
    expect(claims[0]?.label).toBe("b");
    expect(claims[0]?.basis).toBe("observed");
  });

  it("never upgrades a derived region role to documented", () => {
    const input: OverviewInput = {
      ...empty,
      regions: {
        regions: [{
          regionKey: "r", label: "Persistence", memberPackageKeys: ["pkg:store"],
          role: {
            text: "Owns storage", status: "derived_from_graph",
            evidence: [], evidenceOmittedCount: 0
          },
          basis: {
            kind: "package_containment", packageEntityKey: "pkg:store",
            sourceEdgeCount: 1, evidence: [], evidenceOmittedCount: 0
          },
          counts: {
            entities: 3, byKind: {} as never,
            incomingCrossRegionRelations: 0, outgoingCrossRegionRelations: 1
          },
          languages: ["typescript"], capabilities: ["semantic"], derivations: ["compiler-resolved"]
        }],
        accounting: {
          packageCount: 1, projectCount: 1, regionCount: 1,
          assignedEntityCount: 3, ambiguousEntityCount: 0, unownedEntityCount: 0
        }
      }
    };
    expect(sectionById(input, "regions")?.claims[0]?.basis).toBe("inferred");
  });

  it("omits the analysis-limits section when nothing was diagnosed", () => {
    expect(sectionById(empty, "limits")).toBeUndefined();
  });
});
