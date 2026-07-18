import type { GraphEdge, GraphNode } from "@tadori/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { GraphService } from "@tadori/mcp";
import { notFound } from "../errors.js";
import { toToolEdge, toToolNode } from "./graph.js";
import type { PathResultDto } from "../types.js";

const DEFAULT_MAX_DEPTH = 6;

interface PathQuery {
  from?: string;
  to?: string;
  maxDepth?: string;
}

/** Breadth-first search from `from` to `to` following only allowed relations. */
function findPath(
  service: GraphService,
  from: GraphNode,
  to: GraphNode,
  maxDepth: number
): { nodes: GraphNode[]; edges: GraphEdge[] } | null {
  if (from.entityKey === to.entityKey) {
    return { nodes: [from], edges: [] };
  }
  const visited = new Set<string>([from.entityKey]);
  const queue: Array<{ node: GraphNode; path: GraphNode[]; edges: GraphEdge[] }> = [
    { node: from, path: [from], edges: [] }
  ];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    if (!current) {
      continue;
    }
    if (current.path.length - 1 >= maxDepth) {
      continue;
    }
    const outgoing = service.outEdges.get(current.node.entityKey) ?? [];
    for (const edge of outgoing) {
      if (visited.has(edge.dstEntityKey)) {
        continue;
      }
      const nextNode = service.nodesByKey.get(edge.dstEntityKey);
      if (!nextNode) {
        continue;
      }
      const nextPath = [...current.path, nextNode];
      const nextEdges = [...current.edges, edge];
      if (nextNode.entityKey === to.entityKey) {
        return { nodes: nextPath, edges: nextEdges };
      }
      visited.add(nextNode.entityKey);
      queue.push({ node: nextNode, path: nextPath, edges: nextEdges });
    }
  }
  return null;
}

export async function registerPathRoutes(app: FastifyInstance): Promise<void> {
  app.get("/path", async (request: FastifyRequest<{ Querystring: PathQuery }>, reply: FastifyReply) => {
    const service = app.graphState.current();
    const { from, to, maxDepth: rawMaxDepth } = request.query;
    if (from === undefined || to === undefined) {
      const { statusCode, payload } = notFound("unknown_endpoint");
      return reply.code(statusCode).send(payload);
    }
    const fromResolution = service.resolveEntity(from);
    const toResolution = service.resolveEntity(to);
    if (!fromResolution.node || !toResolution.node) {
      const { statusCode, payload } = notFound("unknown_endpoint");
      return reply.code(statusCode).send(payload);
    }
    const maxDepth =
      rawMaxDepth !== undefined && Number.isInteger(Number(rawMaxDepth))
        ? Number(rawMaxDepth)
        : DEFAULT_MAX_DEPTH;
    const result = findPath(service, fromResolution.node, toResolution.node, maxDepth);
    const body: PathResultDto = {
      nodes: result ? result.nodes.map((node) => toToolNode(app, node)) : [],
      edges: result ? result.edges.map((edge) => toToolEdge(app, edge)) : [],
      found: result !== null
    };
    return reply.send(body);
  });
}
