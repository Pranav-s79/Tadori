import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { notFound } from "../errors.js";

interface LayoutQuery {
  level?: string;
  viewKey?: string;
}

/**
 * Route #15: `layout_positions` (frozen migration 004) has no production
 * reader/writer yet — 08-01 owns the seeded-layout writer (AD-005). This
 * blueprint stubs the "not yet materialized" 404 path only; it does not
 * compute layout.
 */
export async function registerLayoutRoutes(app: FastifyInstance): Promise<void> {
  app.get("/layout", async (request: FastifyRequest<{ Querystring: LayoutQuery }>, reply: FastifyReply) => {
    const service = app.graphState.current();
    const level = request.query.level ?? "package";
    const viewKey = request.query.viewKey ?? "base";
    const row = app.graphState
      .currentDb()
      .prepare(
        "SELECT 1 FROM layout_positions WHERE repo_id = ? AND abstraction_level = ? AND view_key = ? LIMIT 1"
      )
      .get(service.repoId, level, viewKey);
    if (!row) {
      const { statusCode, payload } = notFound("layout_not_materialized");
      return reply.code(statusCode).send(payload);
    }
    const positions = app.graphState
      .currentDb()
      .prepare(
        `SELECT ne.entity_key AS entity_key, lp.x, lp.y, lp.z, lp.pinned, lp.layout_version
         FROM layout_positions lp
         JOIN node_entities ne ON ne.id = lp.node_id
         WHERE lp.repo_id = ? AND lp.abstraction_level = ? AND lp.view_key = ?`
      )
      .all(service.repoId, level, viewKey) as Array<{
      entity_key: string;
      x: number;
      y: number;
      z: number;
      pinned: number;
      layout_version: number;
    }>;
    return reply.send({
      positions: positions.map((position) => ({
        entityKey: position.entity_key,
        x: position.x,
        y: position.y,
        z: position.z,
        pinned: Boolean(position.pinned)
      })),
      layoutVersion: positions[0]?.layout_version ?? 1
    });
  });
}
