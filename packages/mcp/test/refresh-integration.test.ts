import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { IncrementalRepositoryIndexer } from "@tadori/indexer";
import { openDatabase, runMigrations, type Database } from "@tadori/store";
import { EventLog } from "../src/events.js";
import { GraphService } from "../src/service.js";

let db: Database | null = null;
let repo: string | null = null;
let indexer: IncrementalRepositoryIndexer | null = null;

afterEach(async () => {
  await indexer?.stop();
  indexer = null;
  db?.close();
  db = null;
  if (repo) {
    rmSync(repo, { recursive: true, force: true });
    repo = null;
  }
});

describe("MCP incremental-generation integration", () => {
  it("keeps an in-flight task pinned while new sessions adopt the replacement", async () => {
    repo = mkdtempSync(path.join(tmpdir(), "tadori-mcp-refresh-"));
    mkdirSync(path.join(repo, "src"));
    writeFileSync(path.join(repo, "package.json"), '{"name":"mcp-refresh"}\n');
    writeFileSync(
      path.join(repo, "src", "value.ts"),
      "export function value(): number { return 1; }\n"
    );
    writeFileSync(
      path.join(repo, "src", "consumer.ts"),
      'import { value } from "./value.js";\nexport function consume(): number { return value(); }\n'
    );
    db = openDatabase(":memory:");
    runMigrations(db);
    let publishReady: () => void = () => undefined;
    let releasePublish: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      publishReady = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releasePublish = resolve;
    });
    indexer = new IncrementalRepositoryIndexer(db, repo, {
      beforePublish: async () => {
        publishReady();
        await gate;
      }
    });
    await indexer.initialize();
    const oldService = GraphService.open(db, repo, indexer, "working_tree");
    const eventLog = new EventLog(db, oldService, "vitest", "generation pin");
    const oldSnapshotId = oldService.snapshot.id;
    const consumer = oldService.graph.nodes.find(
      (node) => node.qualifiedName === "src/consumer.ts.consume"
    );
    if (!consumer) {
      throw new Error("Expected consumer node");
    }

    writeFileSync(
      path.join(repo, "src", "value.ts"),
      "export function value(): number { return 2; }\n"
    );
    indexer.enqueue([{ path: "src/value.ts", kind: "change" }]);
    const refreshing = indexer.waitForIdle().then(() => indexer?.state());
    expect(oldService.nodeFreshness(consumer)).toMatchObject({
      stale: true,
      reason: "refresh_pending"
    });
    await ready;
    expect(oldService.snapshot.id).toBe(oldSnapshotId);
    releasePublish();
    const state = await refreshing;
    if (!state) {
      throw new Error("Indexer disappeared during refresh");
    }

    expect(state.snapshotId).not.toBe(oldSnapshotId);
    expect(oldService.snapshotFreshness()).toMatchObject({
      stale: true,
      reason: "refresh_pending"
    });
    const newService = GraphService.open(db, repo, indexer, "working_tree");
    expect(newService.snapshot.id).toBe(state.snapshotId);
    expect(newService.snapshotFreshness().stale).toBe(false);
    const task = db
      .prepare("SELECT base_snapshot_id FROM tasks WHERE id = ?")
      .get(eventLog.taskId) as { base_snapshot_id: number };
    expect(task.base_snapshot_id).toBe(oldSnapshotId);
    eventLog.endTask();
  });
});
