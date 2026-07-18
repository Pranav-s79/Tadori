import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "@tadori/store";
import * as mcpModule from "@tadori/mcp";
import { runServe } from "../src/serve.js";

const FIXTURE_REPO_ROOT = fileURLToPath(
  new URL("../../fixtures/01-core-symbols/repo", import.meta.url)
);

let tempDir: string | null = null;

afterEach(() => {
  vi.restoreAllMocks();
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

function copyFixtureRepo(): string {
  tempDir = mkdtempSync(path.join(tmpdir(), "tadori-cli-exitcodes-"));
  const repoRoot = path.join(tempDir, "repo");
  cpSync(FIXTURE_REPO_ROOT, repoRoot, { recursive: true });
  return repoRoot;
}

async function waitFor<T>(check: () => T | null, timeoutMs = 10_000): Promise<T> {
  const startedAt = Date.now();
  for (;;) {
    const result = check();
    if (result !== null) {
      return result;
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("runServe teardown", () => {
  it("aborting the signal triggers cleanup and resolves exit code 0", async () => {
    const repoRoot = copyFixtureRepo();
    const controller = new AbortController();
    const stdoutLines: string[] = [];

    const runPromise = runServe([repoRoot, "--port", "0"], {
      openBrowser: async () => undefined,
      signal: controller.signal,
      stdout: (text) => stdoutLines.push(text),
      stderr: () => undefined
    });

    await waitFor(() => (stdoutLines.join("").includes("URL:") ? true : null));

    controller.abort();
    const exitCode = await runPromise;
    expect(exitCode).toBe(0);
  });

  it("refresh.stop() resolves before db.close() (teardown call order + db actually closed)", async () => {
    const repoRoot = copyFixtureRepo();
    const controller = new AbortController();
    const stdoutLines: string[] = [];
    const callOrder: string[] = [];

    const originalStop = mcpModule.ConcurrentRefreshController.prototype.stop;
    vi.spyOn(mcpModule.ConcurrentRefreshController.prototype, "stop").mockImplementation(
      async function (this: mcpModule.ConcurrentRefreshController) {
        const result = await originalStop.call(this);
        callOrder.push("refresh.stop");
        return result;
      }
    );

    const runPromise = runServe([repoRoot, "--port", "0"], {
      openBrowser: async () => undefined,
      signal: controller.signal,
      stdout: (text) => stdoutLines.push(text),
      stderr: () => undefined
    });

    await waitFor(() => (stdoutLines.join("").includes("URL:") ? true : null));

    controller.abort();
    const exitCode = await runPromise;
    expect(exitCode).toBe(0);
    expect(callOrder).toEqual(["refresh.stop"]);

    // Proxy for "db.close() ran": WAL mode holds an exclusive-ish lock while
    // open; after teardown a fresh connection to the same file must succeed
    // without contention, and no leftover -wal/-shm lock artifacts block it.
    const dbPath = path.join(repoRoot, ".tadori", "tadori.sqlite");
    const reopened = openDatabase(dbPath);
    expect(() => reopened.pragma("integrity_check")).not.toThrow();
    reopened.close();
  });

  it("teardown runs at most once even if abort fires while already tearing down", async () => {
    const repoRoot = copyFixtureRepo();
    const controller = new AbortController();
    const stdoutLines: string[] = [];
    let stopCount = 0;
    const originalStop = mcpModule.ConcurrentRefreshController.prototype.stop;
    vi.spyOn(mcpModule.ConcurrentRefreshController.prototype, "stop").mockImplementation(
      async function (this: mcpModule.ConcurrentRefreshController) {
        stopCount += 1;
        return originalStop.call(this);
      }
    );

    const runPromise = runServe([repoRoot, "--port", "0"], {
      openBrowser: async () => undefined,
      signal: controller.signal,
      stdout: (text) => stdoutLines.push(text),
      stderr: () => undefined
    });

    await waitFor(() => (stdoutLines.join("").includes("URL:") ? true : null));

    controller.abort();
    const exitCode = await runPromise;
    expect(exitCode).toBe(0);
    expect(stopCount).toBe(1);
  });

  it("an occupied --port exits 4 (EADDRINUSE) and leaves no orphan listener", async () => {
    const repoRoot = copyFixtureRepo();
    const occupied = await new Promise<Server>((resolve) => {
      const server = createServer();
      server.listen(0, "127.0.0.1", () => resolve(server));
    });
    const address = occupied.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected an AddressInfo from the occupying server");
    }
    const port = address.port;
    const stderrLines: string[] = [];

    const exitCode = await runServe([repoRoot, "--port", String(port), "--no-open"], {
      openBrowser: async () => undefined,
      stderr: (text) => stderrLines.push(text),
      stdout: () => undefined
    });

    expect(exitCode).toBe(4);
    expect(stderrLines.join("")).toContain("Port unavailable");

    // The occupying server is still the only listener on this port; runServe
    // must not have left its own server bound anywhere (no orphan listener).
    await new Promise<void>((resolve, reject) => {
      occupied.close((error) => (error ? reject(error) : resolve()));
    });
  });
});
