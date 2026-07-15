import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MIGRATIONS,
  foreignKeyCheck,
  forceRunMigration,
  getActiveSnapshot,
  openDatabase,
  runMigrations,
  type Database
} from "@tadori/store";

let db: Database;

beforeEach(() => {
  db = openDatabase(":memory:");
});

afterEach(() => {
  db.close();
});

describe("database migrations", () => {
  it("keeps the five frozen migrations first and applies additive migrations in order", () => {
    expect(MIGRATIONS.slice(0, 5).map((migration) => migration.version)).toEqual([1, 2, 3, 4, 5]);
    const ran = runMigrations(db);
    expect(ran).toEqual([1, 2, 3, 4, 5, 6]);

    const versions = db
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all() as Array<{ version: number }>;
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3, 4, 5, 6]);

    const tables = new Set(
      (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')")
          .all() as Array<{ name: string }>
      ).map((t) => t.name)
    );
    for (const expected of [
      "repositories",
      "repository_snapshots",
      "file_entities",
      "snapshot_files",
      "node_entities",
      "snapshot_nodes",
      "edge_entities",
      "snapshot_edges",
      "evidence_items",
      "node_evidence",
      "edge_evidence",
      "boundary_entities",
      "snapshot_boundaries",
      "decision_entities",
      "snapshot_decisions",
      "decision_links",
      "tasks",
      "retrieval_events",
      "retrieval_result_nodes",
      "retrieval_result_edges",
      "retrieval_omissions",
      "agent_events",
      "agent_event_targets",
      "change_sets",
      "change_set_files",
      "test_runs",
      "test_run_cases",
      "layout_positions",
      "summaries",
      "node_fts",
      "snapshot_activations"
    ]) {
      expect(tables, `missing table ${expected}`).toContain(expected);
    }
  });

  it("returns zero foreign_key_check rows after migrating", () => {
    runMigrations(db);
    expect(foreignKeyCheck(db)).toEqual([]);
  });

  it("skips already-applied migrations on a second run", () => {
    expect(runMigrations(db)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(runMigrations(db)).toEqual([]);
  });

  it("fails loudly when an applied migration is forced to run again", () => {
    runMigrations(db);
    for (const migration of MIGRATIONS) {
      expect(() => forceRunMigration(db, migration.version)).toThrow();
    }
    // The forced failures must not have corrupted the schema.
    expect(foreignKeyCheck(db)).toEqual([]);
    expect(runMigrations(db)).toEqual([]);
  });

  it("keeps foreign keys enabled on the connection", () => {
    runMigrations(db);
    const fk = db.pragma("foreign_keys", { simple: true });
    expect(fk).toBe(1);
  });

  it("keeps active-snapshot reads compatible with a migration-1-to-5 database", () => {
    const legacy = openDatabase(":memory:");
    try {
      for (const migration of MIGRATIONS.slice(0, 5)) {
        legacy.exec(migration.sql);
      }
      const repoId = Number(
        legacy.prepare("INSERT INTO repositories(root_path) VALUES ('C:/legacy')").run()
          .lastInsertRowid
      );
      const snapshotId = Number(
        legacy
          .prepare(
            `INSERT INTO repository_snapshots(repo_id, kind, workspace_hash)
             VALUES (?, 'working_tree', ?)`
          )
          .run(repoId, "a".repeat(64)).lastInsertRowid
      );
      expect(getActiveSnapshot(legacy, repoId, "working_tree")?.id).toBe(snapshotId);
    } finally {
      legacy.close();
    }
  });

  it("rejects activation rows whose repository or kind disagrees with the snapshot", () => {
    runMigrations(db);
    const firstRepo = Number(
      db.prepare("INSERT INTO repositories(root_path) VALUES ('C:/first')").run().lastInsertRowid
    );
    const secondRepo = Number(
      db.prepare("INSERT INTO repositories(root_path) VALUES ('C:/second')").run().lastInsertRowid
    );
    const snapshotId = Number(
      db
        .prepare(
          `INSERT INTO repository_snapshots(repo_id, kind, workspace_hash)
           VALUES (?, 'commit', ?)`
        )
        .run(firstRepo, "b".repeat(64)).lastInsertRowid
    );
    expect(() =>
      db
        .prepare(
          `INSERT INTO snapshot_activations(repo_id, kind, snapshot_id)
           VALUES (?, 'working_tree', ?)`
        )
        .run(secondRepo, snapshotId)
    ).toThrow(/repo\/kind mismatch/);
  });
});
