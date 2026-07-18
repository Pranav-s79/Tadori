import { afterEach, describe, expect, it } from "vitest";
import { ConcurrentRefreshController } from "@tadori/mcp";
import type { FastifyInstance } from "fastify";
import { createServerApp } from "../src/app.js";
import type { SnapshotRowDto, SnapshotSummaryDto } from "../src/types.js";
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

describe("snapshot routes", () => {
  it("GET /snapshot returns the fixture DB's active snapshot context", async () => {
    const instance = await setup();
    const response = await instance.inject({ method: "GET", url: "/api/v1/snapshot" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as SnapshotSummaryDto;
    expect(body.context.snapshotId).toBe(testDb!.snapshotId);
    expect(body.context.snapshotKind).toBe("working_tree");
    expect(body.counts.files).toBeGreaterThan(0);
    expect(body.counts.nodes).toBeGreaterThan(0);
  });

  it("GET /snapshots lists the active snapshot", async () => {
    const instance = await setup();
    const response = await instance.inject({ method: "GET", url: "/api/v1/snapshots" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as SnapshotRowDto[];
    expect(body.some((row) => row.id === testDb!.snapshotId)).toBe(true);
    const row = body.find((entry) => entry.id === testDb!.snapshotId)!;
    expect(typeof row.pinned).toBe("boolean");
  });

  it("POST /snapshots/:id/pin toggles pinned and returns the updated row", async () => {
    const instance = await setup();
    const response = await instance.inject({
      method: "POST",
      url: `/api/v1/snapshots/${testDb!.snapshotId}/pin`,
      payload: { pinned: true }
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as SnapshotRowDto;
    expect(body.pinned).toBe(true);

    const unpin = await instance.inject({
      method: "POST",
      url: `/api/v1/snapshots/${testDb!.snapshotId}/pin`,
      payload: { pinned: false }
    });
    expect((unpin.json() as SnapshotRowDto).pinned).toBe(false);
  });

  it("POST /snapshots/:id/pin on an unknown id returns 404 unknown_snapshot", async () => {
    const instance = await setup();
    const response = await instance.inject({
      method: "POST",
      url: "/api/v1/snapshots/999999/pin",
      payload: { pinned: true }
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("unknown_snapshot");
  });
});
