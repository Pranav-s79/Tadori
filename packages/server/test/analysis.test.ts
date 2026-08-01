import { ConcurrentRefreshController } from "@tadori/mcp";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createServerApp } from "../src/app.js";
import type { SnapshotAnalysisDto } from "../src/types.js";
import { buildTestDb, cleanupTestDb, type TestDb } from "./fixtures/buildTestDb.js";

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

describe("GET /api/v1/analysis", () => {
  it("serves deterministic observed language facts and bounded persisted diagnostics", async () => {
    testDb = buildTestDb();
    refresh = await ConcurrentRefreshController.start(testDb.db, testDb.repoRoot);
    app = await createServerApp({ db: testDb.db, repoRoot: testDb.repoRoot, refresh });

    const first = await app.inject({
      method: "GET",
      url: "/api/v1/analysis?diagnosticLimit=1"
    });
    const second = await app.inject({
      method: "GET",
      url: "/api/v1/analysis?diagnosticLimit=1"
    });
    expect(first.statusCode).toBe(200);
    expect(first.body).toBe(second.body);
    const body = first.json() as SnapshotAnalysisDto;
    expect(body.snapshotId).toBe(testDb.snapshotId);
    expect(body.languages.map((language) => language.id)).toEqual(
      [...body.languages.map((language) => language.id)].sort()
    );
    expect(body.languages).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "typescript", fileCount: expect.any(Number) })
    ]));
    expect(body.diagnostics.items.length).toBeLessThanOrEqual(1);
    expect(body.diagnostics.total).toBe(
      body.diagnostics.bySeverity.info +
      body.diagnostics.bySeverity.warning +
      body.diagnostics.bySeverity.error
    );
    expect(body.diagnostics.omittedCount).toBe(
      Math.max(0, body.diagnostics.total - body.diagnostics.items.length)
    );
  });

  it("rejects invalid diagnostic pagination", async () => {
    testDb = buildTestDb();
    refresh = await ConcurrentRefreshController.start(testDb.db, testDb.repoRoot);
    app = await createServerApp({ db: testDb.db, repoRoot: testDb.repoRoot, refresh });
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/analysis?diagnosticLimit=0"
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "bad_diagnostic_page" });
  });
});
