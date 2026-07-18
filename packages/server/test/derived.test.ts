import { afterEach, describe, expect, it } from "vitest";
import { ConcurrentRefreshController } from "@tadori/mcp";
import type { FastifyInstance } from "fastify";
import { createServerApp } from "../src/app.js";
import type { DocsDto, NotYetImplementedDto, RoutesDto, TestsDto, TourProgressDto } from "../src/types.js";
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

describe("derived routes", () => {
  it("GET /tests returns 200 with observed:false and the honest note", async () => {
    const instance = await setup();
    const response = await instance.inject({ method: "GET", url: "/api/v1/tests" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as TestsDto;
    expect(body.observed).toBe(false);
    expect(body.note).toBe("not observed inspected");
  });

  it("GET /routes returns 200 with a routes array", async () => {
    const instance = await setup();
    const response = await instance.inject({ method: "GET", url: "/api/v1/routes" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as RoutesDto;
    expect(Array.isArray(body.routes)).toBe(true);
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
