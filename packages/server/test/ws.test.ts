import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConcurrentRefreshController } from "@tadori/mcp";
import type { FastifyInstance } from "fastify";
import { createServerApp } from "../src/app.js";
import type { ServerEvent } from "../src/types.js";
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
  await app.ready();
  return app;
}

function mutateFixtureFile(revision: number): void {
  writeFileSync(
    path.join(testDb!.repoRoot, "src", "math.ts"),
    `export function factorial(n: number): number { return n <= ${revision} ? 1 : n * factorial(n - 1); }\n`
  );
}

describe("WS channel", () => {
  it("delivers a refresh_pending/refresh_settled frame after subscribing to refresh", async () => {
    const instance = await setup();
    // @fastify/websocket's own injectWS test helper (README "Testing"
    // section) — an in-process WS client with no additional test-only
    // dependency beyond what @fastify/websocket already pulls in (§13).
    const socket = await instance.injectWS("/api/v1/ws");
    const frames: ServerEvent[] = [];
    socket.on("message", (data: Buffer) => {
      frames.push(JSON.parse(data.toString("utf8")) as ServerEvent);
    });
    socket.send(JSON.stringify({ type: "subscribe", channels: ["refresh"] }));
    await new Promise((resolve) => setTimeout(resolve, 300));

    mutateFixtureFile(1);

    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 10_000;
      const check = (): void => {
        if (frames.some((frame) => frame.type === "refresh_pending" || frame.type === "refresh_settled")) {
          resolve();
          return;
        }
        if (Date.now() > deadline) {
          reject(new Error("Timed out waiting for a refresh_pending/refresh_settled frame"));
          return;
        }
        setTimeout(check, 100);
      };
      check();
    });

    expect(frames.some((frame) => frame.type === "refresh_pending" || frame.type === "refresh_settled")).toBe(
      true
    );
    socket.terminate();
  }, 20_000);

  it("delivers a snapshot_replaced frame (new generation/snapshotId) after a rotation", async () => {
    const instance = await setup();
    const socket = await instance.injectWS("/api/v1/ws");
    const frames: ServerEvent[] = [];
    socket.on("message", (data: Buffer) => {
      frames.push(JSON.parse(data.toString("utf8")) as ServerEvent);
    });
    socket.send(JSON.stringify({ type: "subscribe", channels: ["refresh"] }));
    await new Promise((resolve) => setTimeout(resolve, 300));

    const originalSnapshotId = testDb!.snapshotId;
    mutateFixtureFile(3);

    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 15_000;
      const check = (): void => {
        if (frames.some((frame) => frame.type === "snapshot_replaced")) {
          resolve();
          return;
        }
        if (Date.now() > deadline) {
          reject(new Error("Timed out waiting for a snapshot_replaced frame"));
          return;
        }
        setTimeout(check, 100);
      };
      check();
    });

    const replaced = frames.find((frame) => frame.type === "snapshot_replaced");
    expect(replaced).toBeDefined();
    if (replaced?.type === "snapshot_replaced") {
      expect(replaced.snapshotId).not.toBe(originalSnapshotId);
      expect(replaced.snapshotKind).toBe("working_tree");
      expect(typeof replaced.generation).toBe("number");
      expect(typeof replaced.workspaceHash).toBe("string");
    }
    socket.terminate();
  }, 20_000);

  it("delivers no frame for an unsubscribed channel", async () => {
    const instance = await setup();
    const socket = await instance.injectWS("/api/v1/ws");
    const frames: ServerEvent[] = [];
    socket.on("message", (data: Buffer) => {
      frames.push(JSON.parse(data.toString("utf8")) as ServerEvent);
    });
    // Subscribe to "observation" only, never "refresh".
    socket.send(JSON.stringify({ type: "subscribe", channels: ["observation"] }));
    await new Promise((resolve) => setTimeout(resolve, 300));

    mutateFixtureFile(2);
    // Wait long enough that a refresh cycle would have completed, then assert
    // nothing arrived (since we only subscribed to "observation").
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(frames.length).toBe(0);
    socket.terminate();
  }, 20_000);
});
