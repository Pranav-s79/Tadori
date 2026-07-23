import type { GraphNode } from "@tadori/core";
import type { GraphService } from "@tadori/mcp";
import type { FastifyInstance } from "fastify";
import { toToolNode } from "./routes/graph.js";
import type { RouteRow } from "./types.js";

/**
 * Route rows with the provenance of each route's path. A route node is the
 * SOURCE of its `routes_to` edge (verified against fixtures 02/03), so the path
 * origin is read from the route's outgoing `routes_to` edge. When a route has no
 * such edge the origin is null — rendered explicitly by the UI, never guessed.
 * Reads GraphService maps directly (same idiom as deriveRouteStory).
 */
export function deriveRouteRows(app: FastifyInstance, service: GraphService): RouteRow[] {
  const routeNodes = service.graph.nodes.filter((node: GraphNode) => node.kind === "route");
  const rows = routeNodes.map((node) => {
    const routesToEdge = (service.outEdges.get(node.entityKey) ?? []).find(
      (edge) => edge.relation === "routes_to"
    );
    return {
      node: toToolNode(app, node),
      pathSourceOrigin: routesToEdge?.origin ?? null
    };
  });
  rows.sort((a, b) =>
    a.node.entityKey < b.node.entityKey ? -1 : a.node.entityKey > b.node.entityKey ? 1 : 0
  );
  return rows;
}
