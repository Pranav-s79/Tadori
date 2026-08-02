import Graph from "graphology";
import type { ApiEdge, ApiNode, LayoutPositionDto } from "../api/types.ts";

/**
 * Pure transform: (nodes, edges, positions) -> a graphology Graph.
 * Node/edge counts always match the input arrays. Every rendered node must have
 * a served layout position, and every edge endpoint must be a real response
 * node. Inconsistency is explicit; the renderer never fabricates a (0,0)
 * pile-up or placeholder graph entity.
 */
export function buildGraphologyGraph(
  nodes: readonly ApiNode[],
  edges: readonly ApiEdge[],
  positions: readonly LayoutPositionDto[]
): Graph {
  const graph = new Graph({ multi: true, type: "directed" });
  const positionByKey = new Map(positions.map((p) => [p.entityKey, p]));

  for (const node of nodes) {
    const position = positionByKey.get(node.entityKey);
    if (position === undefined) {
      throw new Error(`Graph node ${JSON.stringify(node.entityKey)} has no served layout position`);
    }
    graph.addNode(node.entityKey, {
      apiNode: node,
      kind: node.kind,
      qualifiedName: node.qualifiedName,
      displayName: node.displayName,
      file: node.file,
      exported: node.exported,
      fanIn: node.fanIn,
      language: node.language ?? null,
      provenance: node.provenance ?? null,
      aggregateLanguages: node.aggregateLanguages ?? [],
      aggregateCapabilities: node.aggregateCapabilities ?? [],
      aggregateDerivations: node.aggregateDerivations ?? [],
      x: position.x,
      y: position.y,
      z: position.z,
      pinned: position.pinned
    });
  }

  for (const edge of edges) {
    if (!graph.hasNode(edge.srcEntityKey)) {
      throw new Error(`Graph edge ${JSON.stringify(edge.entityKey)} references missing source node ${JSON.stringify(edge.srcEntityKey)}`);
    }
    if (!graph.hasNode(edge.dstEntityKey)) {
      throw new Error(`Graph edge ${JSON.stringify(edge.entityKey)} references missing target node ${JSON.stringify(edge.dstEntityKey)}`);
    }
    graph.addEdgeWithKey(edge.entityKey, edge.srcEntityKey, edge.dstEntityKey, {
      apiEdge: edge,
      relation: edge.relation,
      origin: edge.origin,
      confidence: edge.confidence,
      resolution: edge.resolution,
      language: edge.language ?? null,
      provenance: edge.provenance ?? null,
      projectionKind: edge.projectionKind ?? null,
      aggregateCount: edge.aggregateCount ?? 1,
      aggregateProvenance: edge.aggregateProvenance ?? [],
      aggregateLanguages: edge.aggregateLanguages ?? [],
      aggregateCapabilities: edge.aggregateCapabilities ?? [],
      aggregateDerivations: edge.aggregateDerivations ?? [],
      sourceEdgeCount: edge.sourceEdgeCount ?? 1,
      sourceEdgeOmittedCount: edge.sourceEdgeOmittedCount ?? 0,
      evidenceOmittedCount: edge.evidenceOmittedCount ?? 0
    });
  }

  return graph;
}
