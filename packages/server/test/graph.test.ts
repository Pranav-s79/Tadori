import { afterEach, describe, expect, it } from "vitest";
import { ConcurrentRefreshController } from "@tadori/mcp";
import type { FastifyInstance } from "fastify";
import { createServerApp } from "../src/app.js";
import type { NodeDetailDto, NodeEvidenceDto, Page } from "../src/types.js";
import type { ToolEdge, ToolNode } from "@tadori/mcp";
import { buildTestDb, cleanupTestDb, type TestDb } from "./fixtures/buildTestDb.js";

let testDb: TestDb | null = null;
let refresh: ConcurrentRefreshController | null = null;
let app: FastifyInstance | null = null;

afterEach(async () => {
  if (app) {
    await app.close();
    app = null;
  }
  if (refresh) {
    await refresh.stop();
    refresh = null;
  }
  if (testDb) {
    cleanupTestDb(testDb);
    testDb = null;
  }
});

async function setup(): Promise<FastifyInstance> {
  testDb = buildTestDb();
  refresh = await ConcurrentRefreshController.start(testDb.db, testDb.repoRoot);
  app = await createServerApp({ db: testDb.db, repoRoot: testDb.repoRoot, refresh });
  return app;
}

describe("graph routes", () => {
  it("GET /nodes?level=package returns only package-kind nodes", async () => {
    const instance = await setup();
    const response = await instance.inject({ method: "GET", url: "/api/v1/nodes?level=package" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as Page<ToolNode>;
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((item) => item.kind === "package")).toBe(true);
  });

  it("GET /nodes with limit=1 paginates via cursor", async () => {
    const instance = await setup();
    const first = await instance.inject({ method: "GET", url: "/api/v1/nodes?level=symbol&limit=1" });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as Page<ToolNode>;
    expect(firstBody.items.length).toBe(1);
    expect(firstBody.nextCursor).not.toBeNull();

    const second = await instance.inject({
      method: "GET",
      url: `/api/v1/nodes?level=symbol&limit=1&cursor=${firstBody.nextCursor}`
    });
    const secondBody = second.json() as Page<ToolNode>;
    expect(secondBody.items.length).toBe(1);
    expect(secondBody.items[0]!.entityKey).not.toBe(firstBody.items[0]!.entityKey);
  });

  it("GET /edges?relation=calls filters correctly", async () => {
    const instance = await setup();
    const response = await instance.inject({ method: "GET", url: "/api/v1/edges?relation=calls" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as Page<ToolEdge>;
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((item) => item.relation === "calls")).toBe(true);
  });

  it("GET /edges with limit=1 and >=2 matching rows returns 1 item + non-null nextCursor", async () => {
    const instance = await setup();
    const response = await instance.inject({ method: "GET", url: "/api/v1/edges?relation=contains&limit=1" });
    const body = response.json() as Page<ToolEdge>;
    expect(body.items.length).toBe(1);
    expect(body.nextCursor).not.toBeNull();
  });

  it("GET /nodes/:entityKey returns out/in edges and fanIn matching GraphService.fanIn", async () => {
    const instance = await setup();
    const nodesResponse = await instance.inject({ method: "GET", url: "/api/v1/nodes?level=symbol&limit=500" });
    const nodesBody = nodesResponse.json() as Page<ToolNode>;
    const target = nodesBody.items.find((item) => item.displayName === "factorial" || item.fanIn > 0);
    expect(target).toBeDefined();

    const service = app!.graphState.current();
    const response = await instance.inject({ method: "GET", url: `/api/v1/nodes/${target!.entityKey}` });
    expect(response.statusCode).toBe(200);
    const body = response.json() as NodeDetailDto;
    expect(body.fanIn).toBe(service.fanIn(target!.entityKey));
    expect(Array.isArray(body.outEdges)).toBe(true);
    expect(Array.isArray(body.inEdges)).toBe(true);
  });

  it("GET /nodes/:entityKey for an unknown key returns 404 unknown_entity", async () => {
    const instance = await setup();
    const response = await instance.inject({
      method: "GET",
      url: `/api/v1/nodes/${"0".repeat(64)}`
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("unknown_entity");
  });

  it("GET /nodes/:entityKey for an ambiguous display name returns 409 ambiguous", async () => {
    // Fixture 01-core-symbols has three methods named "run"
    // (Strategy.run, DoubleStrategy.run, TripleStrategy.run) — resolveEntity
    // reports multiple display-name matches as candidates instead of
    // silently picking one (M3 fix: route uses resolveEntity, not a raw
    // nodesByKey lookup).
    const instance = await setup();
    const response = await instance.inject({ method: "GET", url: "/api/v1/nodes/run" });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("ambiguous");
  });

  it("GET /nodes/:entityKey/evidence returns the node's evidence array", async () => {
    const instance = await setup();
    const nodesResponse = await instance.inject({ method: "GET", url: "/api/v1/nodes?level=symbol&limit=1" });
    const nodesBody = nodesResponse.json() as Page<ToolNode>;
    const entityKey = nodesBody.items[0]!.entityKey;
    const response = await instance.inject({ method: "GET", url: `/api/v1/nodes/${entityKey}/evidence` });
    expect(response.statusCode).toBe(200);
    const body = response.json() as NodeEvidenceDto;
    expect(Array.isArray(body.evidence)).toBe(true);
  });
});
