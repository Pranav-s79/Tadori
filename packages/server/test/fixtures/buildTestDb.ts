import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { indexRepositoryIntoStore } from "@tadori/indexer";
import { openDatabase, runMigrations, type Database } from "@tadori/store";

const FIXTURE_REPO_ROOT = fileURLToPath(
  new URL("../../../fixtures/01-core-symbols/repo", import.meta.url)
);

export interface TestDb {
  dbPath: string;
  db: Database;
  repoRoot: string;
  tempDir: string;
  snapshotId: number;
}

/**
 * Builds a temp-file SQLite DB (never `:memory:` — `ConcurrentRefreshController`
 * requires a file-backed database), runs frozen migrations, and indexes a copy
 * of the `01-core-symbols` fixture repo into it. Copies the fixture repo into
 * the temp dir too so tests can mutate/watch it without touching the checked-in
 * fixture.
 */
export function buildTestDb(): TestDb {
  const tempDir = mkdtempSync(path.join(tmpdir(), "tadori-server-test-"));
  const repoRoot = path.join(tempDir, "repo");
  cpSync(FIXTURE_REPO_ROOT, repoRoot, { recursive: true });
  const dbPath = path.join(tempDir, "tadori.sqlite");
  const db = openDatabase(dbPath);
  runMigrations(db);
  const result = indexRepositoryIntoStore(db, repoRoot, { kind: "working_tree" });
  return { dbPath, db, repoRoot: repoRoot.split(path.sep).join("/"), tempDir, snapshotId: result.snapshotId };
}

export function cleanupTestDb(testDb: TestDb): void {
  testDb.db.close();
  rmSync(testDb.tempDir, { recursive: true, force: true });
}
