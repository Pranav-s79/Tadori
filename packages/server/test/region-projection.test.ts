import type { GraphEdge, GraphNode, GraphProject } from "@tadori/core";
import {
  edgeCanonicalIdentity,
  entityKey,
  nodeCanonicalIdentity,
  sha256Hex
} from "@tadori/core";
import { describe, expect, it } from "vitest";
import { getRegionProjection, projectSnapshotRegions } from "../src/regionProjection.js";

const sourceEvidence = (file: string) => [{
  file,
  kind: "source" as const,
  lineStart: 1,
  lineEnd: 1
}];

function node(
  kind: GraphNode["kind"],
  qualifiedName: string,
  file: string | null,
  language: string | null = null,
  evidence = file === null ? [] : sourceEvidence(file)
): GraphNode {
  const canonicalIdentity = nodeCanonicalIdentity(kind, qualifiedName);
  return {
    kind,
    qualifiedName,
    displayName: qualifiedName,
    canonicalIdentity,
    entityKey: entityKey(canonicalIdentity),
    file,
    exported: false,
    spanStart: null,
    spanEnd: null,
    lineStart: file === null ? null : 1,
    lineEnd: file === null ? null : 1,
    signature: null,
    bodyHash: null,
    evidence,
    language,
    ...(language === null ? {} : {
      provenance: {
        extractorId: "test",
        extractorVersion: "1",
        capability: language === "typescript" ? "semantic" as const : "structural" as const,
        derivation: language === "typescript" ? "compiler-resolved" as const : "parser-derived" as const,
        unresolvedReason: null
      }
    })
  };
}

function edge(
  source: GraphNode,
  relation: GraphEdge["relation"],
  target: GraphNode,
  evidence = sourceEvidence(source.file ?? target.file ?? "README.md")
): GraphEdge {
  const canonicalIdentity = edgeCanonicalIdentity(source.entityKey, relation, target.entityKey);
  return {
    srcEntityKey: source.entityKey,
    relation,
    dstEntityKey: target.entityKey,
    canonicalIdentity,
    entityKey: entityKey(canonicalIdentity),
    origin: "compiler",
    confidence: "certain",
    resolution: "resolved",
    evidence
  };
}

function project(root: string, manifest: string, name: string): GraphProject {
  return {
    projectId: sha256Hex(`project|${manifest}`),
    root,
    manifest,
    kind: "manifest",
    name,
    languages: ["python"]
  };
}

describe("repository region projection", () => {
  it("keeps legacy package regions deterministic, evidenced, and explicitly accounted", () => {
    const packageA = node("package", "a", null);
    const packageB = node("package", "b", null);
    const fileA = node("file", "a/file.ts", "a/file.ts", "typescript");
    const fileB = node("file", "b/file.py", "b/file.py", "python");
    const functionA = node("function", "a.fn", "a/file.ts", "typescript");
    const adr = node("adr", "adr:a", "docs/a.md", "markdown");
    const ambiguous = node("function", "shared", "shared.ts", "typescript");
    const external = node("external_dep", "outside", null);
    const graph = {
      nodes: [packageB, external, fileB, ambiguous, packageA, adr, functionA, fileA],
      edges: [
        edge(packageA, "contains", fileA),
        edge(fileA, "contains", functionA),
        edge(packageA, "contains", adr),
        edge(packageA, "contains", ambiguous),
        edge(packageB, "contains", fileB),
        edge(packageB, "contains", ambiguous),
        edge(fileA, "imports", fileB),
        edge(adr, "documents", functionA)
      ]
    };

    const first = projectSnapshotRegions(graph);
    const second = projectSnapshotRegions(graph);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.accounting).toEqual({
      packageCount: 2,
      projectCount: 0,
      regionCount: 2,
      assignedEntityCount: 6,
      ambiguousEntityCount: 1,
      unownedEntityCount: 1
    });
    const regionA = first.regions.find((region) => region.memberPackageKeys.includes(packageA.entityKey));
    const regionB = first.regions.find((region) => region.memberPackageKeys.includes(packageB.entityKey));
    expect(regionA).toMatchObject({
      label: "a",
      role: { status: "derived_from_graph", text: null },
      counts: {
        entities: 4,
        incomingCrossRegionRelations: 0,
        outgoingCrossRegionRelations: 1
      },
      languages: ["markdown", "typescript"],
      capabilities: ["semantic", "structural"]
    });
    expect(regionA?.basis.kind).toBe("package_containment");
    expect(regionA?.basis.evidence.length).toBeGreaterThan(0);
    expect(regionB).toMatchObject({
      role: { status: "derived_from_graph", text: null },
      counts: { incomingCrossRegionRelations: 1, outgoingCrossRegionRelations: 0 }
    });
    expect(first.regions.every((region) => region.memberPackageKeys.length > 0)).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("prefers the deepest explicit project root while keeping packages atomic", () => {
    const rootPackage = node("package", "workspace", null);
    const apiPackage = node("package", "api", null);
    const rootFile = node("file", "README.md", "README.md", "markdown");
    const apiFile = node("file", "services/api/main.py", "services/api/main.py", "python");
    const apiFunction = node("function", "python:services/api/main.py.run", "services/api/main.py", "python");
    const projects = [
      project(".", "pyproject.toml", "workspace"),
      {
        ...project("services/api", "services/api/pyproject.toml", "api-service"),
        projectId: "0".repeat(64)
      },
      {
        ...project("services/api", "services/api/CMakeLists.txt", "same-root-loses"),
        projectId: "f".repeat(64)
      }
    ];
    const extensiveEvidence = Array.from({ length: 30 }, (_, index) => ({
      file: "services/api/main.py",
      kind: "source" as const,
      lineStart: index + 1,
      lineEnd: index + 1
    }));
    const graph = {
      nodes: [rootPackage, apiPackage, rootFile, apiFile, apiFunction],
      edges: [
        edge(rootPackage, "contains", rootFile),
        edge(apiPackage, "contains", apiFile, extensiveEvidence),
        edge(apiFile, "contains", apiFunction)
      ],
      projects
    };

    const result = projectSnapshotRegions(graph);
    const rootRegion = result.regions.find((region) => region.memberPackageKeys.includes(rootPackage.entityKey));
    const apiRegion = result.regions.find((region) => region.memberPackageKeys.includes(apiPackage.entityKey));
    expect(rootRegion?.basis).toMatchObject({ kind: "project_root", root: "." });
    expect(apiRegion?.basis).toMatchObject({
      kind: "project_root",
      projectId: "0".repeat(64),
      root: "services/api",
      evidenceOmittedCount: 5
    });
    expect(apiRegion?.basis.evidence).toHaveLength(25);
    expect(apiRegion).toMatchObject({
      label: "api-service",
      role: { text: null, status: "derived_from_graph" },
      counts: { entities: 3 },
      languages: ["python"]
    });
    expect(result.accounting).toMatchObject({ projectCount: 3, regionCount: 2 });
    expect(result.regions.some((region) => region.label === "same-root-loses")).toBe(false);
    expect(result.regions.filter((region) => region.counts.entities > 0)
      .every((region) => region.memberPackageKeys.length > 0)).toBe(true);
    expect(getRegionProjection(graph)).toBe(getRegionProjection(graph));
    expect(projectSnapshotRegions({
      nodes: [...graph.nodes].reverse(),
      edges: [...graph.edges].reverse(),
      projects: [...projects].reverse()
    })).toEqual(result);
  });

  it("matches a synthetic package to project-root manifest evidence", () => {
    const manifest = "services/worker/pyproject.toml";
    const syntheticPackage = node("package", "worker", null, null, sourceEvidence(manifest));
    const discovered = project("services/worker", manifest, "worker-service");
    const result = projectSnapshotRegions({
      nodes: [syntheticPackage],
      edges: [],
      projects: [discovered]
    });

    expect(result.regions).toHaveLength(1);
    expect(result.regions[0]).toMatchObject({
      label: "worker-service",
      memberPackageKeys: [syntheticPackage.entityKey],
      role: { status: "derived_from_graph", text: null },
      basis: {
        kind: "project_root",
        projectId: discovered.projectId,
        root: "services/worker",
        manifest
      }
    });
    expect(result.regions[0]?.basis.evidence).toEqual(sourceEvidence(manifest));
  });
});
