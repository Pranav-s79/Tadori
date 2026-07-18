import type { NodeKind } from "@tadori/core";
import { NODE_KINDS } from "@tadori/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { badRequest } from "../errors.js";

const NODE_KIND_SET: ReadonlySet<string> = new Set(NODE_KINDS);

interface SearchQuery {
  q?: string;
  kind?: string;
  limit?: string;
  offset?: string;
}

export async function registerSearchRoutes(app: FastifyInstance): Promise<void> {
  app.get("/search", async (request: FastifyRequest<{ Querystring: SearchQuery }>, reply: FastifyReply) => {
    const { q, kind, limit: rawLimit, offset: rawOffset } = request.query;
    if (q === undefined || q.trim().length === 0) {
      const { statusCode, payload } = badRequest("empty_query");
      return reply.code(statusCode).send(payload);
    }
    if (kind !== undefined && !NODE_KIND_SET.has(kind)) {
      const { statusCode, payload } = badRequest("empty_query", "unknown kind");
      return reply.code(statusCode).send(payload);
    }
    const limit = rawLimit !== undefined ? Number(rawLimit) : 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      const { statusCode, payload } = badRequest("empty_query", "limit out of range");
      return reply.code(statusCode).send(payload);
    }
    const offset = rawOffset !== undefined ? Number(rawOffset) : 0;
    if (!Number.isInteger(offset) || offset < 0 || offset > 1_000_000) {
      const { statusCode, payload } = badRequest("empty_query", "offset out of range");
      return reply.code(statusCode).send(payload);
    }
    const service = app.graphState.current();
    const result = service.searchNodes(q, limit, kind as NodeKind | undefined, offset);
    return reply.send(result);
  });
}
