import { afterEach, describe, expect, it } from "vitest";
import { ConcurrentRefreshController } from "@tadori/mcp";
import type { FastifyInstance } from "fastify";
import { createServerApp } from "../src/app.js";
import type { BoundariesDto } from "../src/types.js";
import { buildFixtureTestDb, buildTestDb, cleanupTestDb, type TestDb } from "./fixtures/buildTestDb.js";

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

async function serve(db: TestDb): Promise<FastifyInstance> {
  testDb = db;
  refresh = await ConcurrentRefreshController.start(db.db, db.repoRoot);
  app = await createServerApp({ db: db.db, repoRoot: db.repoRoot, refresh });
  return app;
}

describe("GET /api/v1/boundaries", () => {
  it("detects the fixture-02 seeded controllers→infra violation, evidence-backed", async () => {
    const instance = await serve(buildFixtureTestDb("02-express-routes"));
    const response = await instance.inject({ method: "GET", url: "/api/v1/boundaries" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as BoundariesDto;
    expect(body.rulesPresent).toBe(true);
    // Exactly one violation for the rule (imports + calls between the same two
    // files dedupe to one, preferring imports — the file-level crossing).
    const forRule = body.violations.filter((x) => x.ruleId === "controllers-must-not-import-infra");
    expect(forRule).toHaveLength(1);
    const v = forRule[0];
    expect(v?.src).toBe("file:src/controllers/user-controller.ts");
    expect(v?.dst).toBe("file:src/infra/db.ts");
    expect(v?.edgeRelation).toBe("imports");
    expect(v?.severity).toBe("error");
    expect(v?.evidence.length).toBeGreaterThanOrEqual(1);
  });

  it("runs end-to-end over a second fixture and reports rulesPresent + a violations array", async () => {
    const instance = await serve(buildTestDb());
    const response = await instance.inject({ method: "GET", url: "/api/v1/boundaries" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as BoundariesDto;
    expect(typeof body.rulesPresent).toBe("boolean");
    expect(Array.isArray(body.violations)).toBe(true);
  });
});
