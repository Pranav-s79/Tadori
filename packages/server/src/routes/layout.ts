import { ensureLayout, type LayoutLevel } from "@tadori/store";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { badRequest } from "../errors.js";
import { getPackageProjection } from "../packageProjection.js";
import { selectLodScope } from "../lodScope.js";

interface LayoutQuery {
  level?: string;
  viewKey?: string;
  packageName?: string;
  file?: string;
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
      const projection = level === "package" ? getPackageProjection(service.graph) : undefined;
      const scope = selectLodScope(service.graph, level as LayoutLevel, {
        ...(request.query.packageName === undefined ? {} : { packageName: request.query.packageName }),
        ...(request.query.file === undefined ? {} : { file: request.query.file })
      }, projection);
      const layout = ensureLayout(
        app.graphState.currentDb(),
        service.graph,
        level as LayoutLevel,
        viewKey
      );
      return reply.send({
        positions: layout.positions.filter((position) => scope.keys.has(position.entityKey)).map((position) => ({
          entityKey: position.entityKey,
          x: position.x,
          y: position.y,
          z: position.z,
          pinned: position.pinned
        })),
        layoutVersion: layout.layoutVersion,
        scope: {
          totalNodeCount: scope.allNodes.length,
          boundedNodeCount: scope.nodes.length,
          omittedNodeCount: scope.omittedNodeCount
        }
      });
    } catch {
      return reply.code(500).send({
        error: "layout_engine_error",
        code: "layout_engine_error"
      });
    }
  });
}
