import { afterEach, describe, expect, it } from "vitest";
import { ConcurrentRefreshController } from "@tadori/mcp";
import type { FastifyInstance } from "fastify";
import { createServerApp } from "../src/app.js";
import { testLinkageFor } from "../src/tests.js";
import type { DocsDto, NotYetImplementedDto, RoutesDto, TestsDto, TourProgressDto } from "../src/types.js";
import { buildFixtureTestDb, buildTestDb, cleanupTestDb, type TestDb } from "./fixtures/buildTestDb.js";

let testDb: TestDb | null = null;
let refresh: ConcurrentRefreshController | null = null;
let app: FastifyInstance | null = null;

// A second lifecycle for tests that need a non-default fixture repo.
let fixtureDb: TestDb | null = null;
let fixtureRefresh: ConcurrentRefreshController | null = null;
let fixtureApp: FastifyInstance | null = null;

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
  if (fixtureApp) {
    await fixtureApp.close();
    fixtureApp = null;
  }
  if (fixtureRefresh) {
    await fixtureRefresh.stop();
    fixtureRefresh = null;
  }
  if (fixtureDb) {
    cleanupTestDb(fixtureDb);
    fixtureDb = null;
  }
});

async function setup(): Promise<FastifyInstance> {
  testDb = buildTestDb();
  refresh = await ConcurrentRefreshController.start(testDb.db, testDb.repoRoot);
  app = await createServerApp({ db: testDb.db, repoRoot: testDb.repoRoot, refresh });
  return app;
}

describe("derived routes", () => {
  it("GET /tests returns the whole-snapshot listing with observed:false, no target, linkage:null", async () => {
    const instance = await setup();
    const response = await instance.inject({ method: "GET", url: "/api/v1/tests" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as TestsDto;
    expect(body.observed).toBe(false);
    expect(body.note).toBe("not observed inspected");
    expect(body.target).toBeNull();
    // No target ⇒ no linkage claimed for any listed test.
    expect(body.tests.every((t) => t.linkage === null && t.edge === null)).toBe(true);
  });

  it("GET /tests?for=<unresolved> returns an honest empty result, not a fabricated listing", async () => {
    const instance = await setup();
    const response = await instance.inject({
      method: "GET",
      url: "/api/v1/tests?for=definitely-not-an-entity"
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as TestsDto;
    expect(body.target).toBeNull();
    expect(body.tests).toEqual([]);
    expect(body.observed).toBe(false);
  });

  it("testLinkageFor maps each origin to its static linkage kind", () => {
    expect(testLinkageFor("compiler")).toBe("statically_linked");
    expect(testLinkageFor("heuristic")).toBe("naming_associated");
    expect(testLinkageFor("git")).toBe("historically_associated");
    expect(testLinkageFor("doc")).toBe("evidence_associated");
    expect(testLinkageFor("human")).toBe("evidence_associated");
    expect(testLinkageFor("llm")).toBe("evidence_associated");
  });

  it("GET /routes returns each route with a node and a path-source origin (null or an Origin)", async () => {
    const instance = await setup();
    const response = await instance.inject({ method: "GET", url: "/api/v1/routes" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as RoutesDto;
    expect(Array.isArray(body.routes)).toBe(true);
    // Every row carries its route node and an explicit path-source origin field
    // (null when there is no routes_to edge — never omitted, never guessed).
    for (const row of body.routes) {
      expect(row.node.kind).toBe("route");
      expect("pathSourceOrigin" in row).toBe(true);
    }
  });

  it("GET /routes on the express fixture resolves a compiler path-source origin", async () => {
    // fixture 02 has literal Express routes → routes_to edges with origin=compiler.
    fixtureDb = buildFixtureTestDb("02-express-routes");
    fixtureRefresh = await ConcurrentRefreshController.start(fixtureDb.db, fixtureDb.repoRoot);
    const instance = await createServerApp({
      db: fixtureDb.db,
      repoRoot: fixtureDb.repoRoot,
      refresh: fixtureRefresh
    });
    fixtureApp = instance;
    const response = await instance.inject({ method: "GET", url: "/api/v1/routes" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as RoutesDto;
    expect(body.routes.length).toBeGreaterThan(0);
    expect(body.routes.some((r) => r.pathSourceOrigin === "compiler")).toBe(true);
  });

  it("GET /docs returns 200 with a docs array", async () => {
    const instance = await setup();
    const response = await instance.inject({ method: "GET", url: "/api/v1/docs" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as DocsDto;
    expect(Array.isArray(body.docs)).toBe(true);
  });

  it("GET /overview returns 200 with available:false not_yet_implemented", async () => {
    const instance = await setup();
    const response = await instance.inject({ method: "GET", url: "/api/v1/overview" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as NotYetImplementedDto;
    expect(body.available).toBe(false);
    expect(body.reason).toBe("not_yet_implemented");
  });

  it("GET /tour returns 200 with available:false not_yet_implemented", async () => {
    const instance = await setup();
    const response = await instance.inject({ method: "GET", url: "/api/v1/tour" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as NotYetImplementedDto;
    expect(body.available).toBe(false);
  });

  it("GET /tour/progress returns null when no progress file exists", async () => {
    const instance = await setup();
    const response = await instance.inject({ method: "GET", url: "/api/v1/tour/progress" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toBeNull();
  });

  it("PUT then GET /tour/progress round-trips through .tadori/progress.json", async () => {
    const instance = await setup();
    const put = await instance.inject({
      method: "PUT",
      url: "/api/v1/tour/progress",
      payload: { tourId: "entry-point-tour", stepIndex: 2 }
    });
    expect(put.statusCode).toBe(200);
    const putBody = put.json() as TourProgressDto;
    expect(putBody.tourId).toBe("entry-point-tour");
    expect(putBody.stepIndex).toBe(2);

    const get = await instance.inject({ method: "GET", url: "/api/v1/tour/progress" });
    const getBody = get.json() as TourProgressDto;
    expect(getBody.tourId).toBe("entry-point-tour");
    expect(getBody.stepIndex).toBe(2);
  });

  it("PUT /tour/progress with a missing field returns 400 bad_schema", async () => {
    const instance = await setup();
    const response = await instance.inject({
      method: "PUT",
      url: "/api/v1/tour/progress",
      payload: { tourId: "x" }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("bad_schema");
  });
});
