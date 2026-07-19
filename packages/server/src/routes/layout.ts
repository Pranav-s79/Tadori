import { ensureLayout, type LayoutLevel } from "@tadori/store";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { badRequest } from "../errors.js";

interface LayoutQuery {
  level?: string;
  viewKey?: string;
}

const LAYOUT_LEVELS: ReadonlySet<string> = new Set(["package", "file", "symbol"]);
const BASE_VIEW_KEY = "base";

/** Materializes and returns deterministic positions for the current snapshot. */
export async function registerLayoutRoutes(app: FastifyInstance): Promise<void> {
  app.get("/layout", async (request: FastifyRequest<{ Querystring: LayoutQuery }>, reply: FastifyReply) => {
    const level = request.query.level ?? "package";
    if (!LAYOUT_LEVELS.has(level)) {
      const { statusCode, payload } = badRequest("bad_level");
      return reply.code(statusCode).send(payload);
    }

    const viewKey = request.query.viewKey ?? BASE_VIEW_KEY;
    if (viewKey !== BASE_VIEW_KEY) {
      const { statusCode, payload } = badRequest("bad_view_key");
      return reply.code(statusCode).send(payload);
    }

    // Capture one coherent service view. A refresh may replace GraphState's
    // current service between requests, but this request must materialize the
    // exact graph selected here.
    const service = app.graphState.current();
    try {
      const layout = ensureLayout(
        app.graphState.currentDb(),
        service.graph,
        level as LayoutLevel,
        viewKey
      );
      return reply.send({
        positions: layout.positions.map((position) => ({
          entityKey: position.entityKey,
          x: position.x,
          y: position.y,
          z: position.z,
          pinned: position.pinned
        })),
        layoutVersion: layout.layoutVersion
      });
    } catch {
      return reply.code(500).send({
        error: "layout_engine_error",
        code: "layout_engine_error"
      });
    }
  });
}
