import { afterEach, describe, expect, it } from "vitest";
import { ConcurrentRefreshController } from "@tadori/mcp";
import type { FastifyInstance } from "fastify";
import { createServerApp } from "../src/app.js";
import { buildTestDb, cleanupTestDb, type TestDb } from "./fixtures/buildTestDb.js";
import type { FtsSearchResult } from "@tadori/store";

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

describe("search route", () => {
  it("a known fixture symbol name returns a match with total >= 1", async () => {
    const instance = await setup();
    const response = await instance.inject({ method: "GET", url: "/api/v1/search?q=factorial" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as FtsSearchResult;
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.matches.length).toBeGreaterThanOrEqual(1);
  });

  it("empty q returns 400 empty_query", async () => {
    const instance = await setup();
    const response = await instance.inject({ method: "GET", url: "/api/v1/search?q=" });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("empty_query");
  });

  it("missing q returns 400 empty_query", async () => {
    const instance = await setup();
    const response = await instance.inject({ method: "GET", url: "/api/v1/search" });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("empty_query");
  });
});
