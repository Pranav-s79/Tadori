import type Graph from "graphology";
import type { AggregatedEdge, AggregatedProvenance, ApiEdge, ApiNode, LayoutPositionDto } from "../api/types.ts";

/**
 * Collapse individual edges into one summary edge per
 * `(srcPackage, dstPackage, relation)` triple.
 *
 * `entityToPackage` maps every endpoint entity (a package hull key, or a file
 * key once its package is expanded) to its owning package. An edge whose two
 * endpoints resolve to the *same* package that is currently expanded is an
 * intra-package edge — it renders individually inside the expanded region and
 * is excluded here. Any endpoint with no package mapping is skipped (it cannot
 * be attributed to a package group). Two different relations across the same
 * package pair stay as two distinct aggregates.
 */
export function computeAggregatedEdges(
  edges: readonly ApiEdge[],
  entityToPackage: ReadonlyMap<string, string>,
  expandedPackages: ReadonlySet<string>
): AggregatedEdge[] {
  const groups = new Map<string, AggregatedEdge>();

  for (const edge of edges) {
    const srcPackage = entityToPackage.get(edge.srcEntityKey);
    const dstPackage = entityToPackage.get(edge.dstEntityKey);
    if (srcPackage === undefined || dstPackage === undefined) {
      continue;
    }
    // Intra-package edge inside an expanded package: rendered individually.
    if (srcPackage === dstPackage && expandedPackages.has(srcPackage)) {
      continue;
    }
    // Self-loop on a collapsed package carries no cross-boundary meaning.
    if (srcPackage === dstPackage) {
      continue;
    }

    const groupKey = `${srcPackage} ${dstPackage} ${edge.relation}`;
    let aggregate = groups.get(groupKey);
    if (aggregate === undefined) {
      aggregate = { srcPackage, dstPackage, relation: edge.relation, count: 0, provenance: [] };
      groups.set(groupKey, aggregate);
    }
    aggregate.count += 1;
    bumpProvenance(aggregate.provenance, edge);
  }

  return [...groups.values()];
}

function bumpProvenance(provenance: AggregatedProvenance[], edge: ApiEdge): void {
  const existing = provenance.find(
    (p) => p.origin === edge.origin && p.confidence === edge.confidence && p.resolution === edge.resolution
  );
  if (existing !== undefined) {
    existing.count += 1;
    return;
  }
  provenance.push({ origin: edge.origin, confidence: edge.confidence, resolution: edge.resolution, count: 1 });
}

export interface ExpansionDiff {
  /** Packages newly expanded since the previous set (file nodes to add). */
  added: string[];
  /** Packages newly collapsed since the previous set (file nodes to remove). */
  removed: string[];
}

/**
 * Pure set diff between the previous and next expanded-package sets. The canvas
 * uses this to apply only the additive/removal graph mutations for the packages
 * that actually changed — never a full rebuild, so untouched packages' node
 * positions stay byte-identical.
 */
export function diffExpandedNodes(
  previous: ReadonlySet<string>,
  next: ReadonlySet<string>
): ExpansionDiff {
  const added = [...next].filter((pkg) => !previous.has(pkg));
  const removed = [...previous].filter((pkg) => !next.has(pkg));
  return { added, removed };
}

const FILE_LABEL_MAX = 20;

export interface FileLevelData {
  nodes: readonly ApiNode[];
  edges: readonly ApiEdge[];
  positions: readonly LayoutPositionDto[];
}

/**
 * Additively add one package's file nodes + intra-package file edges to an
 * existing graphology graph, WITHOUT touching any pre-existing node. Every
 * mutation is `addNode`/`addEdge` only — no rebuild — so other packages' node
 * positions stay `Object.is`-identical. File-node keys are namespaced by
 * package to avoid collisions across expansions.
 */
export function applyExpansion(graph: Graph, packageKey: string, data: FileLevelData): void {
  const positionByKey = new Map(data.positions.map((p) => [p.entityKey, p]));
  for (const node of data.nodes) {
    const nodeId = fileNodeId(packageKey, node.entityKey);
    if (graph.hasNode(nodeId)) {
      continue;
    }
    const pos = positionByKey.get(node.entityKey);
    graph.addNode(nodeId, {
      kind: node.kind,
      qualifiedName: node.qualifiedName,
      displayName: node.displayName,
      label: truncate(node.displayName, FILE_LABEL_MAX),
      file: node.file,
      exported: node.exported,
      fanIn: node.fanIn,
      x: pos?.x ?? 0,
      y: pos?.y ?? 0,
      pinned: pos?.pinned ?? false,
      expandedFrom: packageKey,
      size: 4,
      color: "#26de81"
    });
  }
  for (const edge of data.edges) {
    const src = fileNodeId(packageKey, edge.srcEntityKey);
    const dst = fileNodeId(packageKey, edge.dstEntityKey);
    const edgeId = `exp:${packageKey}:${edge.entityKey}`;
    if (!graph.hasNode(src) || !graph.hasNode(dst) || graph.hasEdge(edgeId)) {
      continue;
    }
    graph.addEdgeWithKey(edgeId, src, dst, {
      relation: edge.relation,
      origin: edge.origin,
      confidence: edge.confidence,
      resolution: edge.resolution,
      expandedFrom: packageKey
    });
  }
}

/**
 * Inverse of {@link applyExpansion}: remove exactly the nodes/edges that
 * expansion added for `packageKey` (identified by the `expandedFrom` marker).
 * graphology drops incident edges when a node is dropped, so removing the file
 * nodes is sufficient; explicit edge removal covers any expansion-only edge
 * whose endpoints survive. No other node is touched.
 */
export function applyCollapse(graph: Graph, packageKey: string, data: FileLevelData): void {
  for (const edge of data.edges) {
    const edgeId = `exp:${packageKey}:${edge.entityKey}`;
    if (graph.hasEdge(edgeId)) {
      graph.dropEdge(edgeId);
    }
  }
  for (const node of data.nodes) {
    const nodeId = fileNodeId(packageKey, node.entityKey);
    if (graph.hasNode(nodeId)) {
      graph.dropNode(nodeId);
    }
  }
}

export function fileNodeId(packageKey: string, entityKey: string): string {
  return `${packageKey}::${entityKey}`;
}

/** Truncate `text` at exactly `maxLen` chars, appending an ellipsis if longer. */
export function truncate(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : `${text.slice(0, maxLen)}…`;
}
