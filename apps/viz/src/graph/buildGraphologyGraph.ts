import Graph from "graphology";
import type { ApiEdge, ApiNode, LayoutPositionDto } from "../api/types.ts";

/**
 * Pure transform: (nodes, edges, positions) -> a graphology Graph.
 * Node/edge counts always match the input arrays (nodes are added
 * unconditionally; edges are added unconditionally too, using a
 * placeholder position of (0,0) for any endpoint missing a layout entry
 * rather than being dropped, so an incomplete layout response never
 * silently shrinks the edge count).
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
    graph.addNode(node.entityKey, {
      kind: node.kind,
      qualifiedName: node.qualifiedName,
      displayName: node.displayName,
      file: node.file,
      exported: node.exported,
      fanIn: node.fanIn,
      x: position?.x ?? 0,
      y: position?.y ?? 0,
      pinned: position?.pinned ?? false
    });
  }

  for (const edge of edges) {
    if (!graph.hasNode(edge.srcEntityKey)) {
      graph.addNode(edge.srcEntityKey, { kind: "unresolved", qualifiedName: edge.srcEntityKey, displayName: edge.srcEntityKey, file: null, exported: false, fanIn: 0, x: 0, y: 0, pinned: false });
    }
    if (!graph.hasNode(edge.dstEntityKey)) {
      graph.addNode(edge.dstEntityKey, { kind: "unresolved", qualifiedName: edge.dstEntityKey, displayName: edge.dstEntityKey, file: null, exported: false, fanIn: 0, x: 0, y: 0, pinned: false });
    }
    graph.addEdgeWithKey(edge.entityKey, edge.srcEntityKey, edge.dstEntityKey, {
      relation: edge.relation,
      origin: edge.origin,
      confidence: edge.confidence,
      resolution: edge.resolution
    });
  }

  return graph;
}
