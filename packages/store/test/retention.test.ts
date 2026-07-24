import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  foreignKeyCheck,
  openDatabase,
  pruneAgentEventsOlderThan,
  runMigrations,
  type Database
} from "@tadori/store";

let db: Database;

beforeEach(() => {
  db = openDatabase(":memory:");
  runMigrations(db);
});

afterEach(() => {
  db.close();
});

/** Seed a repo + snapshot + one file entity, returning their ids. */
function seedRepo(): { repoId: number; snapshotId: number; fileId: number } {
  const repoId = Number(
    db.prepare("INSERT INTO repositories (root_path) VALUES ('/tmp/r')").run().lastInsertRowid
  );
  const snapshotId = Number(
    db
      .prepare(
        "INSERT INTO repository_snapshots (repo_id, kind, workspace_hash) VALUES (?, 'working_tree', 'wh')"
      )
      .run(repoId).lastInsertRowid
  );
  // agent_event_targets.file_id references file_entities(id) directly, so a
  // file_entities row is all the retention test needs — no snapshot_files row.
  const fileId = Number(
    db
      .prepare(
        "INSERT INTO file_entities (repo_id, file_key, origin_identity) VALUES (?, 'fk', 'oi')"
      )
      .run(repoId).lastInsertRowid
  );
  return { repoId, snapshotId, fileId };
}

function insertTask(repoId: number, snapshotId: number, status: string): number {
  return Number(
    db
      .prepare(
        "INSERT INTO tasks (repo_id, base_snapshot_id, agent, description, status) VALUES (?, ?, 'a', 'd', ?)"
      )
      .run(repoId, snapshotId, status).lastInsertRowid
  );
}

function insertEvent(taskId: number, snapshotId: number, createdAt: string, fileId?: number): number {
  const id = Number(
    db
      .prepare(
        "INSERT INTO agent_events (task_id, snapshot_id, event_type, source, created_at) VALUES (?, ?, 'file_read_observed', 'claude_hook', ?)"
      )
      .run(taskId, snapshotId, createdAt).lastInsertRowid
  );
  if (fileId !== undefined) {
    db.prepare(
      "INSERT INTO agent_event_targets (event_id, target_kind, file_id) VALUES (?, 'file', ?)"
    ).run(id, fileId);
  }
  return id;
}

function eventCount(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM agent_events").get() as { n: number }).n;
}

function targetCount(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM agent_event_targets").get() as { n: number }).n;
}

const CUTOFF = "2026-01-01 00:00:00";

describe("pruneAgentEventsOlderThan", () => {
  it("deletes an old event of a finished task and cascades its targets", () => {
    const { repoId, snapshotId, fileId } = seedRepo();
    const task = insertTask(repoId, snapshotId, "completed");
    insertEvent(task, snapshotId, "2025-06-01 00:00:00", fileId); // old, finished

    expect(eventCount()).toBe(1);
    expect(targetCount()).toBe(1);
    const deleted = pruneAgentEventsOlderThan(db, CUTOFF);
    expect(deleted).toBe(1);
    expect(eventCount()).toBe(0);
    // Targets cascaded with their event.
    expect(targetCount()).toBe(0);
    expect(foreignKeyCheck(db)).toEqual([]);
  });

  it("NEVER prunes the active task's events, even when older than the cutoff", () => {
    const { repoId, snapshotId } = seedRepo();
    const active = insertTask(repoId, snapshotId, "active");
    insertEvent(active, snapshotId, "2020-01-01 00:00:00"); // ancient, but ACTIVE

    const deleted = pruneAgentEventsOlderThan(db, CUTOFF);
    expect(deleted).toBe(0);
    expect(eventCount()).toBe(1); // survives — live session data
  });

  it("keeps events newer than the cutoff", () => {
    const { repoId, snapshotId } = seedRepo();
    const task = insertTask(repoId, snapshotId, "completed");
    insertEvent(task, snapshotId, "2026-07-01 00:00:00"); // newer than cutoff

    const deleted = pruneAgentEventsOlderThan(db, CUTOFF);
    expect(deleted).toBe(0);
    expect(eventCount()).toBe(1);
  });

  it("prunes only the old finished-task events in a mixed set", () => {
    const { repoId, snapshotId } = seedRepo();
    const finished = insertTask(repoId, snapshotId, "completed");
    const active = insertTask(repoId, snapshotId, "active");
    insertEvent(finished, snapshotId, "2025-01-01 00:00:00"); // prune
    insertEvent(finished, snapshotId, "2026-07-01 00:00:00"); // keep (recent)
    insertEvent(active, snapshotId, "2020-01-01 00:00:00"); // keep (active)

    const deleted = pruneAgentEventsOlderThan(db, CUTOFF);
    expect(deleted).toBe(1);
    expect(eventCount()).toBe(2);
    expect(foreignKeyCheck(db)).toEqual([]);
  });
});
