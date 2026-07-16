import type {
  GraphEdge,
  GraphFile,
  GraphNode,
  NodeKind,
  Relation,
  RepoStateKind,
  SnapshotGraph
} from "@tadori/core";
import {
  edgeCanonicalIdentity,
  entityKey,
  fileCanonicalIdentity,
  nodeCanonicalIdentity,
  sha256Hex
} from "@tadori/core";
import { computeWorkspaceHash } from "@tadori/indexer";

export function makeFile(normalizedPath: string, content: string): GraphFile {
  const canonical = fileCanonicalIdentity(normalizedPath);
  return {
    path: normalizedPath,
    normalizedPath,
    originIdentity: canonical,
    fileKey: entityKey(canonical),
    packageName: "fixture",
    language: "typescript",
    contentHash: sha256Hex(content),
    sizeBytes: Buffer.byteLength(content),
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
    displayName: qualifiedName.split(".").at(-1) ?? qualifiedName,
    canonicalIdentity: canonical,
    entityKey: entityKey(canonical),
    file,
    exported: true,
    spanStart: file === null ? null : 0,
    spanEnd: file === null ? null : 20,
    lineStart: file === null ? null : 1,
    lineEnd: file === null ? null : 1,
    signature: null,
    bodyHash: null,
    evidence:
      file === null ? [] : [{ file, kind: "source", lineStart: 1, lineEnd: 1 }],
    ...overrides
  };
}

export function makeEdge(src: GraphNode, relation: Relation, dst: GraphNode): GraphEdge {
  const canonical = edgeCanonicalIdentity(src.entityKey, relation, dst.entityKey);
  return {
    srcEntityKey: src.entityKey,
    relation,
    dstEntityKey: dst.entityKey,
    canonicalIdentity: canonical,
    entityKey: entityKey(canonical),
    origin: "compiler",
    confidence: "certain",
    resolution: "resolved",
    evidence: src.file
      ? [{ file: src.file, kind: "source", lineStart: 1, lineEnd: 1 }]
      : []
  };
}

export function makeGraph(
  repoRoot: string,
  files: GraphFile[],
  nodes: GraphNode[],
  edges: GraphEdge[],
  kind: RepoStateKind = "working_tree"
): SnapshotGraph {
  return {
    repoRootPath: repoRoot.split("\\").join("/"),
    kind,
    label: null,
    baseCommitSha: null,
    workspaceHash: computeWorkspaceHash(
      files.map((file) => ({
        normalizedPath: file.normalizedPath,
        contentHash: file.contentHash
      }))
    ),
    analyzerVersion: "tadori-mcp-test/0.1.0",
    files,
    nodes,
    edges
  };
}
