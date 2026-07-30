import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApiEdge, ApiNode, RegionProjectionDto } from "../../api/types.ts";
import { defaultFilters } from "../../features/search/filterState.ts";
import type { RenderedGraphSnapshot, StoryMapEmphasis } from "../PackageMapCanvas.tsx";
import { ReliefStage } from "./ReliefStage.tsx";

function node(entityKey: string, kind: ApiNode["kind"], capability: "semantic" | "structural"): ApiNode {
  return {
    entityKey,
    kind,
    qualifiedName: entityKey,
    displayName: entityKey,
    file: kind === "package" ? null : "src/a.ts",
    exported: true,
    fanIn: kind === "package" ? 7 : 1,
    language: "typescript",
    provenance: {
      extractorId: "fixture",
      extractorVersion: "1",
      capability,
      derivation: capability === "semantic" ? "compiler-resolved" : "parser-derived",
      unresolvedReason: null
    }
  };
}

const packageNode = node("pkg:a", "package", "semantic");
const fileNode = node("file:a", "file", "structural");
const edge: ApiEdge = {
  entityKey: "edge:contains",
  srcEntityKey: packageNode.entityKey,
  relation: "contains",
  dstEntityKey: fileNode.entityKey,
  origin: "compiler",
  confidence: "certain",
  resolution: "resolved",
  language: "typescript",
  provenance: packageNode.provenance
};
const graph: RenderedGraphSnapshot = {
  nodes: [packageNode, fileNode],
  edges: [edge],
  positions: [
    { entityKey: packageNode.entityKey, x: 0, y: 0, z: 0, pinned: false },
    { entityKey: fileNode.entityKey, x: 10, y: 2, z: 0, pinned: false }
  ],
  packageKeyByEntityKey: { [packageNode.entityKey]: packageNode.entityKey, [fileNode.entityKey]: packageNode.entityKey },
  selectedEntityKey: fileNode.entityKey,
  lodLevel: "file",
  breadcrumb: ["Repository", "pkg:a"]
};
const regions: RegionProjectionDto = {
  regions: [{
    regionKey: "region:a",
    label: "Package A",
    packageEntityKey: packageNode.entityKey,
    memberPackageKeys: [packageNode.entityKey],
    role: { text: "Parser boundary", status: "documented", evidence: [], evidenceOmittedCount: 0 },
    basis: { kind: "package_containment", packageEntityKey: packageNode.entityKey, sourceEdgeCount: 1, evidence: [], evidenceOmittedCount: 0 },
    counts: {
      entities: 2,
      byKind: { package: 1, file: 1, function: 0, method: 0, class: 0, interface: 0, type: 0, route: 0, test: 0, adr: 0, doc_section: 0, external_dep: 0, unresolved: 0 },
      incomingCrossRegionRelations: 0,
      outgoingCrossRegionRelations: 0
    },
    languages: ["typescript"],
    capabilities: ["semantic", "structural"],
    derivations: ["compiler-resolved", "parser-derived"]
  }],
  accounting: { packageCount: 1, projectCount: 0, regionCount: 1, assignedEntityCount: 2, ambiguousEntityCount: 0, unownedEntityCount: 0 }
};

describe("ReliefStage", () => {
  it("renders graph-backed region, form, capability, selection, filter, and story states", () => {
    const onInspect = vi.fn();
    const storyEmphasis: StoryMapEmphasis = {
      pathEntityKeys: [packageNode.entityKey],
      transitions: [{ fromEntityKey: packageNode.entityKey, relation: edge.relation, toEntityKey: fileNode.entityKey }],
      activeEntityKey: packageNode.entityKey,
      unresolvedFromEntityKey: null
    };
    const filters = { ...defaultFilters(), kinds: ["package" as const], relations: ["imports" as const] };
    const { container } = render(
      <ReliefStage
        graph={graph}
        regions={regions}
        regionsLoading={false}
        regionsError={null}
        filters={filters}
        storyEmphasis={storyEmphasis}
        onInspect={onInspect}
      />
    );

    expect(screen.getByRole("region", { name: "Repository archaeological relief" })).toBeInTheDocument();
    expect(container.querySelector('[data-region-token="ochre"] text')?.textContent).toBe("Package A");
    const foundation = container.querySelector('[data-form="foundation"]');
    expect(foundation).toHaveAttribute("data-capability", "semantic");
    expect(foundation).toHaveAttribute("data-story-active", "true");
    expect(foundation).toHaveAttribute("data-filter-dimmed", "false");
    const slab = container.querySelector('[data-form="slab"]');
    expect(slab).toHaveAttribute("data-capability", "structural");
    expect(slab).toHaveAttribute("data-selected", "true");
    expect(slab).toHaveAttribute("data-story-dimmed", "true");
    expect(slab).toHaveAttribute("data-filter-dimmed", "true");
    const trace = container.querySelector('[data-pattern="solid"]');
    expect(trace).toHaveAttribute("data-story-active", "true");
    expect(trace).toHaveAttribute("data-filter-dimmed", "true");

    const fileTarget = screen.getByRole("button", { name: /file:a, inscribed file slab, Package A region, documented role, fan-in 1, structural capability/i });
    fireEvent.click(fileTarget);
    expect(onInspect).toHaveBeenCalledOnce();
    expect(onInspect).toHaveBeenCalledWith(fileNode.entityKey);
    expect(screen.getByRole("complementary", { name: "Relief encoding" })).toHaveTextContent("2 structures");
  });

  it("reports unavailable attribution honestly and publishes projected viewport positions", () => {
    const onViewportPositionsChange = vi.fn();
    render(
      <ReliefStage
        graph={graph}
        regions={null}
        regionsLoading={false}
        regionsError={new Error("offline")}
        filters={defaultFilters()}
        storyEmphasis={null}
        onInspect={vi.fn()}
        onViewportPositionsChange={onViewportPositionsChange}
      />
    );
    expect(screen.getByText("Region attribution unavailable; no districts inferred.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pkg:a, stepped package foundation, region not attributed/i })).toBeInTheDocument();
    expect(onViewportPositionsChange).toHaveBeenCalledOnce();
    expect(onViewportPositionsChange.mock.calls[0]?.[0]).toBeInstanceOf(Map);
    expect(onViewportPositionsChange.mock.calls[0]?.[0].size).toBe(2);
  });
});
