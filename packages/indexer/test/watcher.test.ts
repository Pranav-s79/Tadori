import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BatchedRepositoryWatcher,
  type RepositoryChange,
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

async function waitFor<T>(
  check: () => T | null,
  describeFailure: () => string,
  timeoutMs = 10_000
): Promise<T> {
  const startedAt = Date.now();
  for (;;) {
    const result = check();
    if (result !== null) {
      return result;
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`${describeFailure()} after ${String(Date.now() - startedAt)}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * Resolves once the operating system is actually delivering events for `root`,
 * and returns how long that took.
 *
 * `fs.watch` returns before macOS has armed its FSEvents stream — libuv starts
 * that stream asynchronously on its own thread, while Linux (inotify_add_watch)
 * and Windows (ReadDirectoryChangesW) arm inside the call. `waitForIdle()` does
 * not cover the gap: it calls `flushNow()`, which clears the debounce timer and
 * delivers already-recorded changes immediately, so it grants the OS no
 * wall-clock time at all. A save issued in that window is never reported by the
 * OS, which is why only the macOS leg failed, and only intermittently.
 *
 * Writing a probe repeatedly and waiting for the watcher to report anything new
 * is the condition that "the watcher is live" actually means; a stream stays
 * armed once armed, so a save after this returns is reported.
 */
async function waitUntilWatching(
  repository: string,
  observed: () => readonly RepositoryChange[]
): Promise<number> {
  const probe = path.join(repository, "watch-readiness-probe");
  const before = observed().length;
  const startedAt = Date.now();
  try {
    await waitFor(
      () => {
        writeFileSync(probe, `${String(Date.now())}\n`);
        return observed().length > before ? true : null;
      },
      () =>
        `watcher never reported the readiness probe; observed ${JSON.stringify(
          observed().map((change) => change.path)
        )}`
    );
    return Date.now() - startedAt;
  } finally {
    rmSync(probe, { force: true });
  }
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

  it("turns a native file save into a normalized mutation batch", async () => {
    const repository = root();
    mkdirSync(path.join(repository, "src"));
    const source = path.join(repository, "src", "a.ts");
    writeFileSync(source, "export const a = 1;\n");
    const observed: RepositoryChange[] = [];
    // A watcher error is otherwise swallowed: `attach` routes it to the
    // optional `onError`, so an event dropped by path normalization would be
    // indistinguishable from an event the OS never sent.
    const errors: Error[] = [];
    const watcher = new BatchedRepositoryWatcher(repository, {
      debounceMs: 10,
      maxWaitMs: 100,
      onBatch: (batch) => {
        observed.push(...batch.changes);
      },
      onError: (error) => {
        errors.push(error);
      }
    });
    watchers.push(watcher);
    watcher.start();
    await watcher.waitForIdle();
    const armedAfterMs = await waitUntilWatching(repository, () => observed);
    // Recorded on every run, not just failures: a green macOS leg still shows
    // how much of the arming window this test used to race against.
    console.log(`native watcher armed after ${String(armedAfterMs)}ms on ${process.platform}`);

    writeFileSync(source, "export const a = 2;\n");
    const sourceChange = await waitFor(
      () => observed.find((change) => change.path === "src/a.ts") ?? null,
      () =>
        `native watcher did not report the save; observed ${JSON.stringify(
          observed.map((change) => change.path)
        )} and errors ${JSON.stringify(errors.map((error) => error.message))}`
    );
    // fs.watch event names are platform hints: macOS commonly reports an
    // atomic file replacement as `rename`, while Windows/Linux may report the
    // same save as `change`. Both force the required repository reconciliation.
    expect(["change", "rename"]).toContain(sourceChange.kind);
    expect(errors).toEqual([]);
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
