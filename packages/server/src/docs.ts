import type { GraphNode } from "@tadori/core";
import type { GraphService } from "@tadori/mcp";
import type { FastifyInstance } from "fastify";
import { toToolEdge, toToolNode } from "./routes/graph.js";
import type { DocEntry } from "./types.js";

/** True if a doc node grounds `targetKey` via one of its outgoing `documents` edges. */
function documentsTarget(service: GraphService, docKey: string, targetKey: string): boolean {
  return (service.outEdges.get(docKey) ?? []).some(
    (edge) => edge.relation === "documents" && edge.dstEntityKey === targetKey
  );
}

/**
 * Doc/ADR entries with the `documents` edges each one grounds. A doc node is the
 * SOURCE of its `documents` edge (verified against fixture 01: adr:math ->
 * file:src/math.ts, origin=doc), so "what this doc documents" is its OUTGOING
 * `documents` edges. When `targetKey` is given, only docs that ground that entity
 * are returned (this is what powers /docs?for=<entity>); otherwise all docs.
 * Reads GraphService maps directly (same idiom as deriveRouteStory). Deterministic:
 * sorted by the doc node's entityKey.
 */
export function deriveDocEntries(
  app: FastifyInstance,
  service: GraphService,
  targetKey?: string
): DocEntry[] {
  const docNodes = service.graph.nodes.filter(
    (node: GraphNode) => node.kind === "doc_section" || node.kind === "adr"
  );
  const entries: DocEntry[] = [];
  for (const node of docNodes) {
    if (targetKey !== undefined && !documentsTarget(service, node.entityKey, targetKey)) {
      continue;
    }
    const documents = (service.outEdges.get(node.entityKey) ?? [])
      .filter((edge) => edge.relation === "documents")
      .map((edge) => toToolEdge(app, edge));
    entries.push({ node: toToolNode(app, node), body: service.readBody(node).body, documents });
  }
  entries.sort((a, b) =>
    a.node.entityKey < b.node.entityKey ? -1 : a.node.entityKey > b.node.entityKey ? 1 : 0
  );
  return entries;
}
