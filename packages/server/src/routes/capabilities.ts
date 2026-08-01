import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { CAPABILITY_MATRIX, CAPABILITY_MATRIX_JSON_SCHEMA } from "@tadori/indexer";

/** Serves the validated product capability contract verbatim. */
export async function registerCapabilityRoutes(app: FastifyInstance): Promise<void> {
  app.get("/capabilities", async (_request: FastifyRequest, reply: FastifyReply) =>
    reply.send(CAPABILITY_MATRIX)
  );
  app.get(
    "/multilanguage-capabilities.schema.json",
    async (_request: FastifyRequest, reply: FastifyReply) =>
      reply.send(CAPABILITY_MATRIX_JSON_SCHEMA)
  );
}
