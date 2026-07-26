import type { GraphEdge, GraphNode, SnapshotGraph } from "@tadori/core";
import { edgeCanonicalIdentity, entityKey, nodeCanonicalIdentity, sha256Hex } from "@tadori/core";
import { describe, expect, it } from "vitest";
import { getPackageProjection, projectSnapshotPackages } from "../src/packageProjection.js";

function node(kind: GraphNode["kind"], qualifiedName: string, language: string | null = null): GraphNode {
  const canonicalIdentity = nodeCanonicalIdentity(kind, qualifiedName);
  return {
    kind,
    qualifiedName,
    displayName: qualifiedName,
    canonicalIdentity,
    entityKey: entityKey(canonicalIdentity),
    file: kind === "package" || kind === "external_dep" ? null : `${qualifiedName}.ts`,
    exported: false,
    spanStart: null,
    spanEnd: null,
    lineStart: null,
    lineEnd: null,
    signature: null,
    bodyHash: null,
    evidence: [],
    language,
    ...(language === null ? {} : {
      provenance: {
        extractorId: "test",
        extractorVersion: "1",
        capability: "structural" as const,
        derivation: "parser-derived" as const,
        unresolvedReason: null
      }
    })
  };
}

function edge(source: GraphNode, relation: GraphEdge["relation"], target: GraphNode): GraphEdge {
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
    evidence: []
  };
}

describe("server package projection", () => {
  it("projects canonical ownership once and leaves ambiguous/unowned entities unlinked", () => {
    const packageA = node("package", "a");
    const packageB = node("package", "b");
    const fileA = node("file", "a/file", "typescript");
    const fileB = node("file", "b/file", "python");
    const shared = node("function", "shared");
    const external = node("external_dep", "outside");
    const containsA = edge(packageA, "contains", fileA);
    const containsB = edge(packageB, "contains", fileB);
    const sharedA = edge(packageA, "contains", shared);
    const sharedB = edge(packageB, "contains", shared);
    const cross = edge(fileA, "imports", fileB);
    const unowned = edge(external, "imports", fileA);
    const graph: SnapshotGraph = {
      repoRootPath: "C:/repo",
      kind: "working_tree",
      label: null,
      baseCommitSha: null,
      workspaceHash: sha256Hex("workspace"),
      analyzerVersion: "test",
      files: [],
      nodes: [packageA, packageB, fileA, fileB, shared, external],
      edges: [containsA, containsB, sharedA, sharedB, cross, unowned]
    };

    const server = projectSnapshotPackages(graph);
    expect(server.nodes.map((item) => item.entityKey)).toEqual(
      [packageA.entityKey, packageB.entityKey].sort()
    );
    expect(server.edges.map((item) => ({
      srcEntityKey: item.srcPackageKey,
      dstEntityKey: item.dstPackageKey,
      relation: item.relation
    }))).toEqual([{
      srcEntityKey: packageA.entityKey,
      dstEntityKey: packageB.entityKey,
      relation: "imports"
    }]);
    expect(server.edges[0]).toMatchObject({ projectionKind: "package_aggregate" });
    expect(server.edges[0]!.sourceEdges).toHaveLength(1);
    expect(server.representativeByEntityKey.has(shared.entityKey)).toBe(false);
    expect(server.representativeByEntityKey.has(external.entityKey)).toBe(false);
    expect(server.accounting.ambiguousEntityCount).toBe(1);
    expect(server.accounting.unownedEntityCount).toBe(1);
    expect(server.aggregatesByPackageKey.get(packageA.entityKey)?.aggregateLanguages).toEqual(["typescript"]);
    expect(server.aggregatesByPackageKey.get(packageB.entityKey)?.aggregateLanguages).toEqual(["python"]);
    const cached = getPackageProjection(graph);
    expect(getPackageProjection(graph)).toBe(cached);
    expect(Object.isFrozen(cached)).toBe(true);
    expect(Object.isFrozen(cached.edges)).toBe(true);
    expect(Object.isFrozen(cached.edges[0]?.sourceEdges)).toBe(true);
    expect(Object.isFrozen(cached.edges[0]?.sourceEdges[0])).toBe(true);
    expect("set" in cached.representativeByEntityKey).toBe(false);
    expect("set" in cached.aggregatesByPackageKey).toBe(false);
  });
});
