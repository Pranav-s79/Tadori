import { afterEach, describe, expect, it } from "vitest";
import { ConcurrentRefreshController } from "@tadori/mcp";
import type { FastifyInstance } from "fastify";
import { createServerApp } from "../src/app.js";
import { computeReviewObservationsOverlay } from "../src/reviewObservations.js";
import type { ReviewObservationsOverlayDto } from "../src/types.js";
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

/** The served snapshot id + the serve session's task id, read straight from the DB. */
function servedIds(): { snapshotId: number; taskId: number } {
  const snap = testDb!.snapshotId;
  const task = testDb!.db.prepare("SELECT id FROM tasks ORDER BY id DESC LIMIT 1").get() as {
    id: number;
  };
  return { snapshotId: snap, taskId: task.id };
}

describe("computeReviewObservationsOverlay (correlation logic)", () => {
  it("flags a file modified in the diff but never read as modifiedButNotRetrieved", async () => {
    await setup();
    const { snapshotId, taskId } = servedIds();
    // No observations recorded for this task; the diff changed src/math.ts.
    const overlay = computeReviewObservationsOverlay(
      testDb!.db,
      taskId,
      snapshotId,
      new Set(["src/math.ts"])
    );
    const math = overlay.files.find((f) => f.file === "src/math.ts");
    expect(math?.modifiedActual).toBe(true);
    expect(math?.retrieved).toBe(false);
    expect(math?.modifiedButNotRetrieved).toBe(true);
    expect(math?.modifiedNotPlanned).toBe(true);
  });

  it("output is sorted by file and lists each file exactly once", async () => {
    await setup();
    const { snapshotId, taskId } = servedIds();
    const overlay = computeReviewObservationsOverlay(
      testDb!.db,
      taskId,
      snapshotId,
      new Set(["src/strategy.ts", "src/math.ts"])
    );
    const paths = overlay.files.map((f) => f.file);
    expect(paths).toEqual([...paths].sort());
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("GET /review/observations-overlay", () => {
  it("correlates recorded plan/read observations for the served task", async () => {
    const instance = await setup();
    // Agent planned and read src/math.ts (both against the live task).
    await instance.inject({
      method: "POST",
      url: "/api/v1/observations",
      payload: [
        {
          type: "plan_mentioned",
          source: "claude_hook",
          at: new Date().toISOString(),
          targets: [{ kind: "file", ref: "src/math.ts" }]
        },
        {
          type: "file_read_observed",
          source: "claude_hook",
          at: new Date().toISOString(),
          targets: [{ kind: "file", ref: "src/math.ts" }]
        }
      ]
    });

    const response = await instance.inject({ method: "GET", url: "/api/v1/review/observations-overlay" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as ReviewObservationsOverlayDto;
    expect(body.taskPresent).toBe(true);
    const math = body.files.find((f) => f.file === "src/math.ts");
    expect(math?.planned).toBe(true);
    expect(math?.retrieved).toBe(true);
    // A read+planned file that the (unmodified) working tree did not change is
    // planned-not-modified, not a blind edit.
    expect(math?.plannedNotModified).toBe(true);
    expect(math?.modifiedButNotRetrieved).toBe(false);
  });

  it("SECURITY: an observation under a DIFFERENT task never appears in the overlay", async () => {
    const instance = await setup();
    const { taskId } = servedIds();
    const db = testDb!.db;

    // Forge a second, foreign task with its own plan_mentioned event on a real
    // fixture file. The overlay is scoped to the served task only.
    const repoId = db.prepare("SELECT repo_id FROM tasks WHERE id = ?").get(taskId) as {
      repo_id: number;
    };
    const baseSnap = db.prepare("SELECT base_snapshot_id FROM tasks WHERE id = ?").get(taskId) as {
      base_snapshot_id: number;
    };
    const foreignTask = db
      .prepare(
        `INSERT INTO tasks (repo_id, base_snapshot_id, agent, description) VALUES (?, ?, 'other', 'foreign')`
      )
      .run(repoId.repo_id, baseSnap.base_snapshot_id);
    const foreignTaskId = Number(foreignTask.lastInsertRowid);
    const fileRow = db
      .prepare(
        `SELECT fe.id AS id FROM file_entities fe
           JOIN snapshot_files sf ON sf.file_id = fe.id
          WHERE sf.normalized_path = 'src/math.ts' LIMIT 1`
      )
      .get() as { id: number };
    const ev = db
      .prepare(
        `INSERT INTO agent_events (task_id, snapshot_id, event_type, source) VALUES (?, ?, 'plan_mentioned', 'claude_hook')`
      )
      .run(foreignTaskId, testDb!.snapshotId);
    db.prepare(
      `INSERT INTO agent_event_targets (event_id, target_kind, file_id) VALUES (?, 'file', ?)`
    ).run(Number(ev.lastInsertRowid), fileRow.id);

    const response = await instance.inject({ method: "GET", url: "/api/v1/review/observations-overlay" });
    const body = response.json() as ReviewObservationsOverlayDto;
    // The served task recorded nothing, so the foreign task's plan must not leak.
    expect(body.taskPresent).toBe(false);
    expect(body.files.find((f) => f.file === "src/math.ts")?.planned).not.toBe(true);
  });
});
