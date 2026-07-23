import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { badRequest } from "../errors.js";
import { deriveDocEntries } from "../docs.js";
import { deriveRouteRows } from "../routeRows.js";
import { deriveTestLinks } from "../tests.js";
import { toToolNode } from "./graph.js";
import type { DocsDto, NotYetImplementedDto, RoutesDto, TestLink, TestsDto, TourProgressDto } from "../types.js";

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
  // Route #11: GET /tests. With `for=<entity>`, returns that target's
  // likely-relevant tests WITH their linkage kind (derived from the tests-edge
  // origin — static/heuristic/historical/evidence). Without `for`, returns the
  // whole-snapshot test listing with linkage:null (no target to link against).
  // `observed:false` + the note keep the honesty invariant: linkage is a static
  // claim, never observed runtime coverage.
  app.get("/tests", async (request: FastifyRequest<{ Querystring: TestsQuery }>, reply: FastifyReply) => {
    const service = app.graphState.current();
    const forRef = request.query.for;

    if (forRef !== undefined && forRef.length > 0) {
      const resolution = service.resolveEntity(forRef);
      if (!resolution.node) {
        // Unresolved target: honest empty result, not a fabricated listing.
        const body: TestsDto = { target: null, tests: [], observed: false, note: "not observed inspected" };
        return reply.send(body);
      }
      const body: TestsDto = {
        target: toToolNode(app, resolution.node),
        tests: deriveTestLinks(app, service, resolution.node),
        observed: false,
        note: "not observed inspected"
      };
      return reply.send(body);
    }

    // No target: the whole-snapshot test listing carries no linkage.
    const tests: TestLink[] = service.graph.nodes
      .filter((node) => node.kind === "test")
      .map((node) => ({ node: toToolNode(app, node), linkage: null, edge: null }));
    const body: TestsDto = { target: null, tests, observed: false, note: "not observed inspected" };
    return reply.send(body);
  });

  // Route #12: GET /routes — each route with its path-source origin, read from
  // the route's outgoing `routes_to` edge (compiler = direct/literal path,
  // heuristic = derived; null when no such edge exists, rendered explicitly).
  app.get("/routes", async (_request: FastifyRequest, reply: FastifyReply) => {
    const service = app.graphState.current();
    const body: RoutesDto = { routes: deriveRouteRows(app, service) };
    return reply.send(body);
  });

  // Route #13: GET /docs. Each doc/ADR carries its `documents` edges (what it
  // grounds). With ?for=<entity>, returns only docs that ground that entity —
  // which is what fetchLinkedDoc relies on; an unresolved `for` yields an empty
  // list, never the whole-snapshot dump.
  app.get("/docs", async (request: FastifyRequest<{ Querystring: DocsQuery }>, reply: FastifyReply) => {
    const service = app.graphState.current();
    const forRef = request.query.for;
    if (forRef !== undefined && forRef.length > 0) {
      const resolution = service.resolveEntity(forRef);
      const docs = resolution.node ? deriveDocEntries(app, service, resolution.node.entityKey) : [];
      const body: DocsDto = { docs };
      return reply.send(body);
    }
    const body: DocsDto = { docs: deriveDocEntries(app, service) };
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
