import type {
  Confidence,
  GraphEdge,
  GraphFile,
  GraphNode,
  NodeKind,
  Origin,
  Relation,
  RepoStateKind,
  Resolution,
  SnapshotGraph
} from "@tadori/core";
import {
  edgeCanonicalIdentity,
  entityKey,
  fileCanonicalIdentity,
  nodeCanonicalIdentity,
  sha256Hex
} from "@tadori/core";

export function makeFile(normalizedPath: string, content = normalizedPath): GraphFile {
  return {
    path: normalizedPath,
    normalizedPath,
    originIdentity: fileCanonicalIdentity(normalizedPath),
    fileKey: entityKey(fileCanonicalIdentity(normalizedPath)),
    packageName: "test-pkg",
    language: "typescript",
    contentHash: sha256Hex(content),
    sizeBytes: content.length,
    isGenerated: false,
    isBinary: false
  };
}

export function makeNode(
  kind: NodeKind,
  qualifiedName: string,
  file: string | null,
  overrides: Partial<GraphNode> = {}
): GraphNode {
  const canonical = nodeCanonicalIdentity(kind, qualifiedName);
  return {
    kind,
    qualifiedName,
    displayName: qualifiedName.split(/[./]/).at(-1) ?? qualifiedName,
    canonicalIdentity: canonical,
    entityKey: entityKey(canonical),
    file,
    exported: false,
    spanStart: null,
    spanEnd: null,
    lineStart: file === null ? null : 1,
    lineEnd: file === null ? null : 1,
    signature: null,
    bodyHash: null,
    evidence: [],
    ...overrides
  };
}

export function makeEdge(
  src: GraphNode,
  relation: Relation,
  dst: GraphNode,
  overrides: Partial<
    Pick<GraphEdge, "origin" | "confidence" | "resolution" | "evidence">
  > = {}
): GraphEdge {
  const canonical = edgeCanonicalIdentity(src.entityKey, relation, dst.entityKey);
  return {
    srcEntityKey: src.entityKey,
    relation,
    dstEntityKey: dst.entityKey,
    canonicalIdentity: canonical,
    entityKey: entityKey(canonical),
    origin: "compiler" as Origin,
    confidence: "certain" as Confidence,
    resolution: "resolved" as Resolution,
    evidence: [],
    ...overrides
  };
}

export function makeGraph(
  parts: Partial<SnapshotGraph> & Pick<SnapshotGraph, "files" | "nodes" | "edges">,
  kind: RepoStateKind = "commit"
): SnapshotGraph {
  return {
    repoRootPath: "C:/virtual/test-repo",
    kind,
    label: null,
    baseCommitSha: null,
    workspaceHash: sha256Hex(`workspace:${kind}:${parts.files.map((f) => f.contentHash).join(",")}`),
    analyzerVersion: "tadori-test/0.0.0",
    ...parts
  };
}
