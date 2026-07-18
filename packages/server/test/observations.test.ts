import { afterEach, describe, expect, it } from "vitest";
import { ConcurrentRefreshController } from "@tadori/mcp";
import type { FastifyInstance } from "fastify";
import { createServerApp } from "../src/app.js";
import type { ObservationsResponse, Page } from "../src/types.js";
import type { ToolNode } from "@tadori/mcp";
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

describe("observations route", () => {
  it("accepts a well-formed plan_mentioned event with no targets", async () => {
    const instance = await setup();
    const response = await instance.inject({
      method: "POST",
      url: "/api/v1/observations",
      payload: [{ type: "plan_mentioned", source: "claude_hook", at: new Date().toISOString() }]
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as ObservationsResponse;
    expect(body.accepted).toBe(1);
    expect(body.rejected).toEqual([]);
  });

  it("partial batch: one well-formed + one referencing an unknown node ref -> accepted:1, rejected has 1 entry", async () => {
    const instance = await setup();
    const response = await instance.inject({
      method: "POST",
      url: "/api/v1/observations",
      payload: [
        { type: "plan_mentioned", source: "claude_hook", at: new Date().toISOString() },
        {
          type: "file_read_observed",
          source: "claude_hook",
          at: new Date().toISOString(),
          targets: [{ kind: "node", ref: "0".repeat(64) }]
        }
      ]
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as ObservationsResponse;
    expect(body.accepted).toBe(1);
    expect(body.rejected.length).toBe(1);
    expect(body.rejected[0]!.index).toBe(1);
  });

  it("accepts an event with a resolvable node target", async () => {
    const instance = await setup();
    const nodesResponse = await instance.inject({ method: "GET", url: "/api/v1/nodes?level=symbol&limit=1" });
    const nodesBody = nodesResponse.json() as Page<ToolNode>;
    const entityKey = nodesBody.items[0]!.entityKey;

    const response = await instance.inject({
      method: "POST",
      url: "/api/v1/observations",
      payload: [
        {
          type: "modified",
          source: "claude_hook",
          at: new Date().toISOString(),
          targets: [{ kind: "node", ref: entityKey }]
        }
      ]
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as ObservationsResponse;
    expect(body.accepted).toBe(1);
    expect(body.rejected).toEqual([]);
  });

  it("accepts an event with a resolvable file target", async () => {
    const instance = await setup();
    const response = await instance.inject({
      method: "POST",
      url: "/api/v1/observations",
      payload: [
        {
          type: "file_read_observed",
          source: "claude_hook",
          at: new Date().toISOString(),
          targets: [{ kind: "file", ref: "src/math.ts" }]
        }
      ]
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as ObservationsResponse;
    expect(body.accepted).toBe(1);
    expect(body.rejected).toEqual([]);
  });

  it("a malformed body (missing type) returns 400 bad_schema for the whole request", async () => {
    const instance = await setup();
    const response = await instance.inject({
      method: "POST",
      url: "/api/v1/observations",
      payload: [{ source: "claude_hook", at: new Date().toISOString() }]
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("bad_schema");
  });

  it("rejects a task_start event type with 400 bad_schema", async () => {
    const instance = await setup();
    const response = await instance.inject({
      method: "POST",
      url: "/api/v1/observations",
      payload: [{ type: "task_start", source: "claude_hook", at: new Date().toISOString() }]
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("bad_schema");
  });

  it("rejects a non-array body with 400 bad_schema", async () => {
    const instance = await setup();
    const response = await instance.inject({
      method: "POST",
      url: "/api/v1/observations",
      payload: { type: "plan_mentioned", source: "claude_hook", at: new Date().toISOString() }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("bad_schema");
  });

  it("returns 409 no_active_task during the narrow post-rotation window (task not yet active)", async () => {
    const instance = await setup();
    // Simulates the narrow post-rotation race documented in §14/§17: the
    // bound EventLog's task row is no longer active (e.g. ended mid-rotation
    // before the replacement EventLog is constructed). The server creates
    // exactly one active task at startup (base_snapshot_id = the served
    // snapshot); ending it directly via the store is the test double for
    // that window, without reaching into GraphState's private EventLog field.
    testDb!.db
      .prepare("UPDATE tasks SET status = 'aborted' WHERE base_snapshot_id = ? AND status = 'active'")
      .run(testDb!.snapshotId);
    const response = await instance.inject({
      method: "POST",
      url: "/api/v1/observations",
      payload: [{ type: "plan_mentioned", source: "claude_hook", at: new Date().toISOString() }]
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("no_active_task");
  });
});
