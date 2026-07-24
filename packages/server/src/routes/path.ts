import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { badRequest, notFound } from "../errors.js";

interface PathQuery {
  from?: string;
  to?: string;
  relations?: string;
  k?: string;
}

/**
 * GET /api/v1/path (08-07). Returns the FULL path-tool output — `status`
 * (ok/not_found/ambiguous/no_path/search_limit), up to `k` paths,
 * `nearestApproach` (only when no path was found), and ambiguity candidates —
 * by calling the exact MCP `path` tool method through GraphStateManager.tools().
 * This is structural parity: the endpoint runs the same code the agent sees via
 * MCP, so the two can never silently diverge (asserted by the parity test).
 */
export async function registerPathRoutes(app: FastifyInstance): Promise<void> {
  app.get("/path", async (request: FastifyRequest<{ Querystring: PathQuery }>, reply: FastifyReply) => {
    const { from, to, relations: rawRelations, k: rawK } = request.query;
    if (from === undefined || to === undefined) {
      const { statusCode, payload } = notFound("unknown_endpoint");
      return reply.code(statusCode).send(payload);
    }

    // Build the tool input, letting the schema apply its own defaults when a
    // parameter is absent. relations is a comma-separated list; k is an integer.
    const input: Record<string, unknown> = { from, to };
    if (rawRelations !== undefined && rawRelations.length > 0) {
      input.relations = rawRelations.split(",").map((r) => r.trim());
    }
    if (rawK !== undefined && rawK.length > 0) {
      const k = Number(rawK);
      if (Number.isInteger(k)) {
        input.k = k;
      }
    }

    try {
      // The tool validates its own input (pathInputSchema) and produces the
      // frozen pathOutputSchema-shaped body, returned verbatim.
      const output = app.graphState.tools().path(input);
      return reply.send(output);
    } catch {
      // Invalid from/to/relations/k (schema rejection) is a bad request, not a
      // server error — the query itself was malformed.
      const { statusCode, payload } = badRequest("bad_schema");
      return reply.code(statusCode).send(payload);
    }
  });
}
