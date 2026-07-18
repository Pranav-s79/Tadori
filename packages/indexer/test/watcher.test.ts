import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BatchedRepositoryWatcher,
  type RepositoryChangeBatch
} from "@tadori/indexer";

const roots: string[] = [];
const watchers: BatchedRepositoryWatcher[] = [];

afterEach(async () => {
  for (const watcher of watchers.splice(0)) {
    await watcher.close();
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function root(): string {
  const value = mkdtempSync(path.join(tmpdir(), "tadori-watcher-"));
  roots.push(value);
  return value;
}

describe("batched repository watcher", () => {
  it("normalizes, deduplicates, prioritizes event kinds, and ignores generated/database files", async () => {
    const batches: RepositoryChangeBatch[] = [];
    const watcher = new BatchedRepositoryWatcher(root(), {
      debounceMs: 5,
      maxWaitMs: 25,
      onBatch: (batch) => {
        batches.push(batch);
      }
    });
    watchers.push(watcher);

    // Platform-native separators must normalize to "/". A backslash is only
    // a separator on Windows; on POSIX it is a legal filename character, so
    // a hardcoded "src\\b.ts" would (correctly) not normalize on Linux.
    watcher.recordChange(["src", "b.ts"].join(path.sep), "change");
    watcher.recordChange("src/a.ts", "change");
    watcher.recordChange("src/a.ts", "rename");
    watcher.recordChange(".tadori/index.db", "change");
    watcher.recordChange("outside.sqlite-wal", "change");
    await watcher.flushNow();

    expect(batches).toEqual([
      {
        generation: 1,
        changes: [
          { path: "src/a.ts", kind: "rename" },
          { path: "src/b.ts", kind: "change" }
        ]
      }
    ]);
  });

  it("emits deterministic reconciliation batches at startup and restart", async () => {
    const batches: RepositoryChangeBatch[] = [];
    const repository = root();
    mkdirSync(path.join(repository, "src"));
    writeFileSync(path.join(repository, "src", "a.ts"), "export const a = 1;\n");
    const watcher = new BatchedRepositoryWatcher(repository, {
      debounceMs: 5,
      maxWaitMs: 25,
      onBatch: (batch) => {
        batches.push(batch);
      }
    });
    watchers.push(watcher);

    watcher.start();
    await watcher.waitForIdle();
    watcher.restart();
    await watcher.waitForIdle();

    expect(batches.map((batch) => batch.changes)).toEqual([
      [{ path: ".", kind: "rescan" }],
      [{ path: ".", kind: "rescan" }]
    ]);
  });

  it("turns a native file save into a normalized change batch", async () => {
    const repository = root();
    mkdirSync(path.join(repository, "src"));
    const source = path.join(repository, "src", "a.ts");
    writeFileSync(source, "export const a = 1;\n");
    let resolveChange: ((batch: RepositoryChangeBatch) => void) | null = null;
    const changed = new Promise<RepositoryChangeBatch>((resolve) => {
      resolveChange = resolve;
    });
    const watcher = new BatchedRepositoryWatcher(repository, {
      debounceMs: 10,
      maxWaitMs: 100,
      onBatch: (batch) => {
        if (batch.changes.some((change) => change.path === "src/a.ts")) {
          resolveChange?.(batch);
        }
      }
    });
    watchers.push(watcher);
    watcher.start();
    await watcher.waitForIdle();

    writeFileSync(source, "export const a = 2;\n");
    const batch = await Promise.race([
      changed,
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error("native watcher did not report the save")), 2_000)
      )
    ]);
    expect(batch.changes).toContainEqual({ path: "src/a.ts", kind: "change" });
  });

  it("flushes pending saves before close and rejects invalid batching bounds", async () => {
    const batches: RepositoryChangeBatch[] = [];
    const repository = root();
    expect(
      () =>
        new BatchedRepositoryWatcher(repository, {
          debounceMs: 10,
          maxWaitMs: 9,
          onBatch: () => undefined
        })
    ).toThrow(/maxWaitMs/);

    const watcher = new BatchedRepositoryWatcher(repository, {
      debounceMs: 100,
      maxWaitMs: 500,
      onBatch: (batch) => {
        batches.push(batch);
      }
    });
    watchers.push(watcher);
    watcher.recordChange("src/a.ts", "change");
    await watcher.close();
    expect(batches).toHaveLength(1);
    watchers.splice(watchers.indexOf(watcher), 1);
  });
});
