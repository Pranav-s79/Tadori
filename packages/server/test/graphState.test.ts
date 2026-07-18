import { afterEach, describe, expect, it } from "vitest";
import { ConcurrentRefreshController } from "@tadori/mcp";
import { GraphState } from "../src/graphState.js";
import { buildTestDb, type TestDb } from "./fixtures/buildTestDb.js";
import { rmSync } from "node:fs";

let testDb: TestDb | null = null;
let refresh: ConcurrentRefreshController | null = null;
let graphState: GraphState | null = null;

afterEach(async () => {
  if (graphState) {
    await graphState.close();
    graphState = null;
  }
  if (refresh) {
    await refresh.stop();
    refresh = null;
  }
  if (testDb) {
    try {
      testDb.db.close();
    } catch {
      // already closed by the test body
    }
    rmSync(testDb.tempDir, { recursive: true, force: true });
    testDb = null;
  }
});

describe("GraphState", () => {
  it("opens the fixture DB's active snapshot and closes without leaking the DB handle", async () => {
    testDb = buildTestDb();
    refresh = await ConcurrentRefreshController.start(testDb.db, testDb.repoRoot);
    graphState = new GraphState({ db: testDb.db, repoRoot: testDb.repoRoot, refresh });

    expect(graphState.current().snapshot.id).toBe(testDb.snapshotId);
    expect(graphState.current().snapshot.status).toBe("active");

    await graphState.close();
    graphState = null;

    // db.close() must not throw after GraphState.close() — proves no open
    // handle was leaked by GraphState itself (it does not own db/refresh).
    expect(() => testDb!.db.close()).not.toThrow();
  });
});
