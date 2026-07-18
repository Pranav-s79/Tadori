import { afterEach, describe, expect, it } from "vitest";
import { ConcurrentRefreshController } from "@tadori/mcp";
import type { FastifyInstance } from "fastify";
import { createServerApp } from "../src/app.js";
import type { SourceSliceDto } from "../src/types.js";
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

describe("source route", () => {
  it("reads a fixture file inside the repo root and returns its body", async () => {
    const instance = await setup();
    const response = await instance.inject({ method: "GET", url: "/api/v1/source?file=src/math.ts" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as SourceSliceDto;
    expect(body.body).not.toBeNull();
    expect(body.freshness).toBe("fresh");
  });

  it("rejects a path-escape attempt with 403 outside_repository", async () => {
    const instance = await setup();
    const response = await instance.inject({
      method: "GET",
      url: `/api/v1/source?${new URLSearchParams({ file: "../outside.ts" }).toString()}`
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe("outside_repository");
  });

  it("returns 404 not_in_snapshot for a file not in the snapshot's file set", async () => {
    const instance = await setup();
    const response = await instance.inject({
      method: "GET",
      url: "/api/v1/source?file=src/does-not-exist.ts"
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("not_in_snapshot");
  });

  it("returns 400 bad_query when file is missing", async () => {
    const instance = await setup();
    const response = await instance.inject({ method: "GET", url: "/api/v1/source" });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("bad_query");
  });
});
