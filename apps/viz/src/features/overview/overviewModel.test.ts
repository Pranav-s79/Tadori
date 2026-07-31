import { describe, expect, it } from "vitest";
import { buildOverview, type OverviewInput, type OverviewSection } from "./overviewModel.ts";
import type { ApiNode } from "../../api/types.ts";
import type { RouteRow } from "../explore/exploreApi.ts";

function node(overrides: Partial<ApiNode> = {}): ApiNode {
  return {
    entityKey: "pkg:a", kind: "package", qualifiedName: "a", displayName: "a",
    file: "src/a.ts", exported: true, fanIn: 0, ...overrides
  };
}

function route(entityKey: string, displayName: string, file: string): RouteRow {
  return {
    node: {
      entityKey, kind: "route", qualifiedName: displayName, displayName,
      file, lineStart: 7, lineEnd: 7, exported: false, fanIn: 0
    },
    pathSourceOrigin: "compiler"
  } as unknown as RouteRow;
}

const empty: OverviewInput = {
  context: null, analysis: null, regions: null, capabilities: null,
  routes: { status: "ready", routes: [] },
  coupling: { status: "ready", nodes: [] },
  nodes: []
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
      routes: { status: "ready" as const, routes: [route("route:get", "GET /a", "src/api.ts")] }
    };
    const claim = sectionById(input, "entry-points")?.claims[0];
    expect(claim?.basis).toBe("observed");
    expect(claim?.evidence).toEqual(["src/api.ts"]);
    expect(claim?.entityKey).toBe("route:get");
  });

  it("reads entry points from the snapshot, not the level-of-detail view", () => {
    // Regression: the landing view renders a single repository node, so counting
    // `route` nodes in the rendered graph reported "no entry points" for a
    // repository that has them. A rendered graph with no route node must not
    // suppress a route the snapshot carries.
    const input = {
      ...empty,
      nodes: [node({ entityKey: "pkg:root", kind: "package", displayName: "." })],
      routes: { status: "ready" as const, routes: [route("route:get", "GET /users/:id", "src/routes/users.ts")] }
    };
    const claim = sectionById(input, "entry-points")?.claims[0];
    expect(claim?.basis).toBe("observed");
    expect(claim?.label).toBe("GET /users/:id");
  });

  it("never renders a pending or failed route read as 'no entry points'", () => {
    for (const routes of [{ status: "loading" as const }, { status: "error" as const }]) {
      const claim = sectionById({ ...empty, routes }, "entry-points")?.claims[0];
      expect(claim?.basis).toBe("unknown");
      expect(claim?.value).not.toMatch(/No route node was extracted/u);
    }
  });

  it("ranks coupling from the snapshot, not the level-of-detail view", () => {
    // Regression: fan-in was ranked over the rendered graph, which holds one
    // repository node at the landing view, so the headline "what is important
    // or fragile" question answered UNKNOWN for every real repository.
    const input = {
      ...empty,
      nodes: [node({ entityKey: "pkg:root", kind: "package" as const, displayName: ".", fanIn: 0 })],
      coupling: {
        status: "ready" as const,
        nodes: [
          node({ entityKey: "cls:svc", kind: "class" as const, displayName: "UserService", fanIn: 2, file: "src/services/user-service.ts" }),
          node({ entityKey: "dep:express", kind: "external_dep" as const, displayName: "express", fanIn: 5, file: null })
        ]
      }
    };
    const claims = sectionById(input, "risk")?.claims ?? [];
    expect(claims[0]?.label).toBe("express");
    expect(claims[0]?.basis).toBe("observed");
    expect(claims[1]?.label).toBe("UserService");
  });

  it("never renders a pending or failed coupling read as 'no references'", () => {
    for (const coupling of [{ status: "loading" as const }, { status: "error" as const }]) {
      const claim = sectionById({ ...empty, coupling }, "risk")?.claims[0];
      expect(claim?.basis).toBe("unknown");
      expect(claim?.value).not.toMatch(/No incoming references/u);
    }
  });

  it("ranks the most depended-upon entities by real fan-in", () => {
    const input = {
      ...empty,
      coupling: {
        status: "ready" as const,
        nodes: [
          node({ entityKey: "a", displayName: "a", fanIn: 2 }),
          node({ entityKey: "b", displayName: "b", fanIn: 9 })
        ]
      }
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
