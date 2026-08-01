import { ConcurrentRefreshController } from "@tadori/mcp";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createServerApp } from "../src/app.js";
import type { RegionProjectionDto } from "../src/types.js";
import {
  buildTestDb,
  cleanupTestDb,
  type TestDb
} from "./fixtures/buildTestDb.js";

let testDb: TestDb | null = null;
let refresh: ConcurrentRefreshController | null = null;
let app: FastifyInstance | null = null;

afterEach(async () => {
  if (app !== null) await app.close();
  if (refresh !== null) await refresh.stop();
  if (testDb !== null) cleanupTestDb(testDb);
  app = null;
  refresh = null;
  testDb = null;
});

describe("GET /api/v1/regions", () => {
  it("serves the deterministic region projection without changing the overview stub", async () => {
    testDb = buildTestDb();
    refresh = await ConcurrentRefreshController.start(testDb.db, testDb.repoRoot);
    app = await createServerApp({ db: testDb.db, repoRoot: testDb.repoRoot, refresh });

    const first = await app.inject({ method: "GET", url: "/api/v1/regions" });
    const second = await app.inject({ method: "GET", url: "/api/v1/regions" });
    expect(first.statusCode).toBe(200);
    expect(first.body).toBe(second.body);
    const body = first.json() as RegionProjectionDto;
    expect(body.accounting.regionCount).toBe(body.regions.length);
    expect(body.regions.length).toBeGreaterThan(0);
    expect(body.regions.every((region) => region.memberPackageKeys.length > 0)).toBe(true);
    expect(body.regions.every((region) => region.role.text === null
      || region.role.status === "documented")).toBe(true);

    const overview = await app.inject({ method: "GET", url: "/api/v1/overview" });
    expect(overview.statusCode).toBe(200);
    expect(overview.json()).toEqual({ available: false, reason: "not_yet_implemented" });
  });
});
