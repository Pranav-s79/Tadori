import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { badRequest } from "../errors.js";
import { toToolNode } from "./graph.js";
import type { DocsDto, NotYetImplementedDto, RoutesDto, TestsDto, TourProgressDto } from "../types.js";

interface TestsQuery {
  for?: string;
}

interface DocsQuery {
  for?: string;
}

interface TourProgressBody {
  tourId?: string;
  stepIndex?: number;
}

function progressFilePath(repoRoot: string): string {
  return path.join(repoRoot, ".tadori", "progress.json");
}

export async function registerDerivedRoutes(app: FastifyInstance): Promise<void> {
  // Route #11: GET /tests — thin honest stub until 08-07 lands the engine.
  app.get("/tests", async (request: FastifyRequest<{ Querystring: TestsQuery }>, reply: FastifyReply) => {
    const service = app.graphState.current();
    const testNodes = service.graph.nodes.filter((node) => node.kind === "test");
    const body: TestsDto = {
      tests: testNodes.map((node) => toToolNode(app, node)),
      observed: false,
      note: "not observed inspected"
    };
    return reply.send(body);
  });

  // Route #12: GET /routes — thin honest stub until 08-07 lands the engine.
  app.get("/routes", async (_request: FastifyRequest, reply: FastifyReply) => {
    const service = app.graphState.current();
    const routeNodes = service.graph.nodes.filter((node) => node.kind === "route");
    const body: RoutesDto = { routes: routeNodes.map((node) => toToolNode(app, node)) };
    return reply.send(body);
  });

  // Route #13: GET /docs — thin honest stub until 08-07 lands the engine.
  app.get("/docs", async (_request: FastifyRequest<{ Querystring: DocsQuery }>, reply: FastifyReply) => {
    const service = app.graphState.current();
    const docNodes = service.graph.nodes.filter((node) => node.kind === "doc_section" || node.kind === "adr");
    const docs = docNodes.map((node) => {
      const read = service.readBody(node);
      return { node: toToolNode(app, node), body: read.body };
    });
    const body: DocsDto = { docs };
    return reply.send(body);
  });

  // Route #16: GET /overview — honest "not yet implemented" stub until 08B-01.
  app.get("/overview", async (_request: FastifyRequest, reply: FastifyReply) => {
    const body: NotYetImplementedDto = { available: false, reason: "not_yet_implemented" };
    return reply.send(body);
  });

  // Route #17: GET /tour — honest "not yet implemented" stub until 08B-02.
  // §11 step 11 requires stub routes to return 200 (not a failure code) with
  // the documented body; the 404 in ARCHITECTURE.md Section 3's table is
  // reserved for a future known-but-missing `id` once 08B-02 lands real
  // tours, not for "the feature doesn't exist yet" (that is `available:
  // false`, mirroring /overview).
  app.get("/tour", async (_request: FastifyRequest, reply: FastifyReply) => {
    const body: NotYetImplementedDto = { available: false, reason: "not_yet_implemented" };
    return reply.send(body);
  });

  // Route #18: GET/PUT /tour/progress — persists to .tadori/progress.json if present.
  app.get("/tour/progress", async (_request: FastifyRequest, reply: FastifyReply) => {
    const repoRoot = app.graphState.current().repoRoot;
    const filePath = progressFilePath(repoRoot);
    if (!existsSync(filePath)) {
      return reply.send(null);
    }
    try {
      const raw = readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw) as TourProgressDto;
      return reply.send(parsed);
    } catch {
      return reply.send(null);
    }
  });

  app.put(
    "/tour/progress",
    async (request: FastifyRequest<{ Body: TourProgressBody }>, reply: FastifyReply) => {
      const { tourId, stepIndex } = request.body ?? {};
      if (tourId === undefined || stepIndex === undefined) {
        const { statusCode, payload } = badRequest("bad_schema");
        return reply.code(statusCode).send(payload);
      }
      const repoRoot = app.graphState.current().repoRoot;
      const filePath = progressFilePath(repoRoot);
      const progress: TourProgressDto = {
        tourId,
        stepIndex,
        updatedAt: new Date().toISOString()
      };
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, JSON.stringify(progress, null, 2), "utf8");
      return reply.send(progress);
    }
  );
}
