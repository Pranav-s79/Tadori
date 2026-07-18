import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export async function registerRefreshRoutes(app: FastifyInstance): Promise<void> {
  app.get("/refresh", async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(app.graphState.refreshState());
  });
}
