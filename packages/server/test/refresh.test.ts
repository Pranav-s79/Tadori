import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConcurrentRefreshController } from "@tadori/mcp";
import type { FastifyInstance } from "fastify";
import { createServerApp } from "../src/app.js";
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

describe("refresh route", () => {
  it("reflects ConcurrentRefreshController.state() verbatim against a real worker", async () => {
    testDb = buildTestDb();
    refresh = await ConcurrentRefreshController.start(testDb.db, testDb.repoRoot);
    app = await createServerApp({ db: testDb.db, repoRoot: testDb.repoRoot, refresh });

    const idle = await app.inject({ method: "GET", url: "/api/v1/refresh" });
    expect(idle.statusCode).toBe(200);
    const idleBody = idle.json();
    expect(idleBody).toMatchObject(refresh.state());
    expect(idleBody.dirtyPaths).toEqual([]);

    // Mutate a fixture file to drive the real worker into a dirty/refreshing
    // phase, then poll until it reports the change.
    writeFileSync(
      path.join(testDb.repoRoot, "src", "math.ts"),
      "export function factorial(n: number): number { return n <= 1 ? 1 : n * factorial(n - 1); }\n"
    );

    let sawDirtyOrRefreshing = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const state = refresh.state();
      if (state.phase === "dirty" || state.phase === "refreshing" || state.snapshotId !== testDb.snapshotId) {
        sawDirtyOrRefreshing = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(sawDirtyOrRefreshing).toBe(true);

    const afterChange = await app.inject({ method: "GET", url: "/api/v1/refresh" });
    expect(afterChange.statusCode).toBe(200);
    expect(afterChange.json()).toMatchObject(refresh.state());
  }, 20_000);
});
