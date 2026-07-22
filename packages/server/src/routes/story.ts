import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { badRequest, conflict, notFound } from "../errors.js";
import { deriveRouteStory } from "../story.js";

interface StoryParams {
  entityKey: string;
}

export async function registerStoryRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/story/route/:entityKey",
    async (request: FastifyRequest<{ Params: StoryParams }>, reply: FastifyReply) => {
      const service = app.graphState.current();
      const { entityKey } = request.params;

      const resolution = service.resolveEntity(entityKey);
      if (!resolution.node) {
        if (resolution.candidates.length > 1) {
          const { statusCode, payload } = conflict("ambiguous");
          return reply.code(statusCode).send(payload);
        }
        const { statusCode, payload } = notFound("unknown_entity");
        return reply.code(statusCode).send(payload);
      }

      // A behavior story is triggered by a route node (HTTP trigger). Refuse to
      // fabricate a story rooted at a non-route entity rather than mislabel it.
      if (resolution.node.kind !== "route") {
        const { statusCode, payload } = badRequest("not_a_route");
        return reply.code(statusCode).send(payload);
      }

      const story = deriveRouteStory(app, service, resolution.node);
      return reply.send(story);
    }
  );
}
