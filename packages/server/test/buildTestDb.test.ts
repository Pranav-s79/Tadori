import { afterEach, describe, expect, it } from "vitest";
import { getActiveSnapshot } from "@tadori/store";
import { buildTestDb, cleanupTestDb, type TestDb } from "./fixtures/buildTestDb.js";

let testDb: TestDb | null = null;

afterEach(() => {
  if (testDb) {
    cleanupTestDb(testDb);
    testDb = null;
  }
});

describe("buildTestDb", () => {
  it("returns a file-backed DB with one active working_tree snapshot", () => {
    testDb = buildTestDb();
    expect(testDb.dbPath).not.toBe(":memory:");
    const repo = testDb.db
      .prepare("SELECT id FROM repositories WHERE root_path = ?")
      .get(testDb.repoRoot) as { id: number } | undefined;
    expect(repo).toBeDefined();
    const active = getActiveSnapshot(testDb.db, repo!.id, "working_tree");
    expect(active).toBeDefined();
    expect(active!.id).toBe(testDb.snapshotId);
    expect(active!.status).toBe("active");
  });
});
