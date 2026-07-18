import { afterEach, describe, expect, it } from "vitest";
import { ConcurrentRefreshController } from "@tadori/mcp";
import type { FastifyInstance } from "fastify";
import { createServerApp } from "../src/app.js";
import type { PathResultDto } from "../src/types.js";
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

describe("path route", () => {
  it("finds a known two-hop fixture path (Runner.execute calls Strategy.run)", async () => {
    const instance = await setup();
    const response = await instance.inject({
      method: "GET",
      url: `/api/v1/path?${new URLSearchParams({
        from: "src/runner.ts.Runner.execute",
        to: "src/strategy.ts.Strategy.run"
      }).toString()}`
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as PathResultDto;
    expect(body.found).toBe(true);
    expect(body.nodes.length).toBeGreaterThanOrEqual(2);
    expect(body.edges.length).toBeGreaterThanOrEqual(1);
  });

  it("returns found:false for an unreachable pair", async () => {
    const instance = await setup();
    const response = await instance.inject({
      method: "GET",
      url: `/api/v1/path?${new URLSearchParams({
        from: "src/internal/secret.ts.readSecret",
        to: "src/math.ts.factorial"
      }).toString()}`
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as PathResultDto;
    expect(body.found).toBe(false);
  });

  it("returns 404 unknown_endpoint when from/to cannot be resolved", async () => {
    const instance = await setup();
    const response = await instance.inject({
      method: "GET",
      url: `/api/v1/path?${new URLSearchParams({ from: "does.not.exist", to: "also.missing" }).toString()}`
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("unknown_endpoint");
  });
});
