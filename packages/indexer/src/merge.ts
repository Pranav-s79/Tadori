import type { Evidence, GraphEdge, GraphNode, NodeKind, SnapshotGraph } from "@tadori/core";
import { snapshotGraphSchema } from "@tadori/core";
import type { ExtractedGraph } from "./extract.js";
import { metadataScore } from "./semantics.js";

export type SnapshotGraphMetadata = Pick<
  SnapshotGraph,
  | "repoRootPath"
  | "kind"
  | "label"
  | "baseCommitSha"
  | "workspaceHash"
  | "analyzerVersion"
>;

export interface MergeSnapshotRegionOptions {
  invalidatedFiles: readonly string[];
  target: SnapshotGraphMetadata;
  /**
   * Declaration identity changes can invalidate unknown incoming consumers.
   * Keep the safe default and fall back to full extraction for renames,
   * additions, or removals of declaration nodes.
   */
  rejectStructuralChanges?: boolean;
}

export class UnsafeIncrementalMergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeIncrementalMergeError";
  }
}

const DECLARATION_KINDS: ReadonlySet<NodeKind> = new Set([
  "function",
  "method",
  "class",
  "interface",
  "type"
]);

function evidenceKey(evidence: Evidence): string {
  return JSON.stringify([
    evidence.file,
    evidence.kind,
    evidence.lineStart,
    evidence.lineEnd,
    evidence.columnStart ?? null,
    evidence.columnEnd ?? null,
    evidence.commitSha ?? null,
    evidence.excerptHash ?? null
  ]);
}

function compareEvidence(left: Evidence, right: Evidence): number {
  return evidenceKey(left).localeCompare(evidenceKey(right));
}

function mergeEvidence(...groups: ReadonlyArray<readonly Evidence[]>): Evidence[] {
  const byKey = new Map<string, Evidence>();
  for (const evidence of groups.flat()) {
    byKey.set(evidenceKey(evidence), evidence);
  }
  return [...byKey.values()].sort(compareEvidence);
}

function mergeNode(existing: GraphNode, replacement: GraphNode): GraphNode {
  if (
    existing.entityKey !== replacement.entityKey ||
    existing.canonicalIdentity !== replacement.canonicalIdentity
  ) {
    throw new UnsafeIncrementalMergeError(
      `Node identity collision while merging ${JSON.stringify(replacement.canonicalIdentity)}`
    );
  }
  return {
    ...existing,
    ...replacement,
    evidence: mergeEvidence(existing.evidence, replacement.evidence)
  };
}

function mergeEdge(existing: GraphEdge, replacement: GraphEdge): GraphEdge {
  if (
    existing.entityKey !== replacement.entityKey ||
    existing.canonicalIdentity !== replacement.canonicalIdentity ||
    existing.srcEntityKey !== replacement.srcEntityKey ||
    existing.dstEntityKey !== replacement.dstEntityKey ||
    existing.relation !== replacement.relation
  ) {
    throw new UnsafeIncrementalMergeError(
      `Edge identity collision while merging ${JSON.stringify(replacement.canonicalIdentity)}`
    );
  }
  const existingScore = metadataScore(existing);
  const replacementScore = metadataScore(replacement);
  const stronger = replacementScore > existingScore ? replacement : existing;
  return {
    ...existing,
    origin: stronger.origin,
    confidence: stronger.confidence,
    resolution: stronger.resolution,
    evidence: mergeEvidence(existing.evidence, replacement.evidence)
  };
}

function sortedKeys(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

/**
 * Replaces one safe existing-file region in a complete snapshot graph.
 *
 * State and evidence owned by invalidated files is removed before replacement;
 * unaffected memberships are retained. Stable duplicates merge evidence and
 * the stronger honest edge metadata, and external dependency nodes with no
 * surviving incident edge are removed. Any unresolved endpoint or structural
 * declaration churn fails closed so the caller can perform a full extraction.
 */
export function mergeSnapshotRegion(
  previous: SnapshotGraph,
  replacement: ExtractedGraph,
  options: MergeSnapshotRegionOptions
): SnapshotGraph {
  const invalidated = new Set(options.invalidatedFiles);
  if (invalidated.size === 0) {
    throw new UnsafeIncrementalMergeError("At least one invalidated file is required");
  }
  if (invalidated.size !== options.invalidatedFiles.length) {
    throw new UnsafeIncrementalMergeError("invalidatedFiles contains duplicate paths");
  }
  if (
    previous.repoRootPath !== options.target.repoRootPath ||
    previous.analyzerVersion !== options.target.analyzerVersion
  ) {
    throw new UnsafeIncrementalMergeError(
      "Repository root or analyzer version changed; use full extraction"
    );
  }

  const replacementFiles = new Set(replacement.files.map((file) => file.normalizedPath));
  const missingReplacement = sortedKeys([...invalidated].filter((file) => !replacementFiles.has(file)));
  const unexpectedReplacement = sortedKeys(
    [...replacementFiles].filter((file) => !invalidated.has(file))
  );
  if (missingReplacement.length > 0 || unexpectedReplacement.length > 0) {
    throw new UnsafeIncrementalMergeError(
      `Replacement file set does not match invalidation: missing=${JSON.stringify(missingReplacement)}, unexpected=${JSON.stringify(unexpectedReplacement)}`
    );
  }

  const previousFiles = new Set(previous.files.map((file) => file.normalizedPath));
  for (const file of invalidated) {
    if (!previousFiles.has(file)) {
      throw new UnsafeIncrementalMergeError(
        `Invalidated file ${JSON.stringify(file)} is absent from the previous graph; use full extraction for additions`
      );
    }
  }

  if (options.rejectStructuralChanges !== false) {
    const declarationKeys = (nodes: readonly GraphNode[]): string[] =>
      sortedKeys(
        nodes
          .filter(
            (node) =>
              node.file !== null && invalidated.has(node.file) && DECLARATION_KINDS.has(node.kind)
          )
          .map((node) => node.entityKey)
      );
    const before = declarationKeys(previous.nodes);
    const after = declarationKeys(replacement.nodes);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new UnsafeIncrementalMergeError(
        "Declaration identities changed in the invalidated region; use full extraction for structural changes or renames"
      );
    }
  }

  const filesByPath = new Map(
    previous.files
      .filter((file) => !invalidated.has(file.normalizedPath))
      .map((file) => [file.normalizedPath, file])
  );
  for (const file of replacement.files) {
    filesByPath.set(file.normalizedPath, file);
  }

  const previousNodesByKey = new Map(previous.nodes.map((node) => [node.entityKey, node]));
  const nodesByKey = new Map<string, GraphNode>();
  for (const node of previous.nodes) {
    if (node.kind === "package" || (node.file !== null && invalidated.has(node.file))) {
      continue;
    }
    nodesByKey.set(node.entityKey, node);
  }
  for (const node of replacement.nodes) {
    const existing = nodesByKey.get(node.entityKey);
    nodesByKey.set(node.entityKey, existing ? mergeNode(existing, node) : node);
  }

  const edgesByKey = new Map<string, GraphEdge>();
  for (const edge of previous.edges) {
    const source = previousNodesByKey.get(edge.srcEntityKey);
    if (
      (source?.file !== null && source !== undefined && invalidated.has(source.file)) ||
      edge.evidence.some((evidence) => invalidated.has(evidence.file))
    ) {
      continue;
    }
    edgesByKey.set(edge.entityKey, edge);
  }
  for (const edge of replacement.edges) {
    const existing = edgesByKey.get(edge.entityKey);
    edgesByKey.set(edge.entityKey, existing ? mergeEdge(existing, edge) : edge);
  }

  for (const edge of edgesByKey.values()) {
    if (!nodesByKey.has(edge.srcEntityKey) || !nodesByKey.has(edge.dstEntityKey)) {
      throw new UnsafeIncrementalMergeError(
        `Merged edge ${JSON.stringify(edge.canonicalIdentity)} has an endpoint outside the merged node set; expand invalidation or use full extraction`
      );
    }
  }

  const referencedNodeKeys = new Set<string>();
  for (const edge of edgesByKey.values()) {
    referencedNodeKeys.add(edge.srcEntityKey);
    referencedNodeKeys.add(edge.dstEntityKey);
  }
  for (const [key, node] of nodesByKey) {
    if (node.kind === "external_dep" && !referencedNodeKeys.has(key)) {
      nodesByKey.delete(key);
    }
  }

  return snapshotGraphSchema.parse({
    ...options.target,
    files: [...filesByPath.values()].sort((left, right) =>
      left.normalizedPath.localeCompare(right.normalizedPath)
    ),
    nodes: [...nodesByKey.values()].sort((left, right) =>
      left.canonicalIdentity.localeCompare(right.canonicalIdentity)
    ),
    edges: [...edgesByKey.values()]
      .map((edge) => ({ ...edge, evidence: mergeEvidence(edge.evidence) }))
      .sort((left, right) => left.canonicalIdentity.localeCompare(right.canonicalIdentity))
  });
}
