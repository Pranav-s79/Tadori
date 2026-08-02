import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getRegionProjection } from "../regionProjection.js";

/** Returns deterministic, evidence-backed package-root regions. */
export async function registerRegionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/regions", async (_request: FastifyRequest, reply: FastifyReply) => {
    const service = app.graphState.current();
    return reply.send(getRegionProjection(service.graph));
  });
}
