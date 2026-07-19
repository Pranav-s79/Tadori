import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as mcpModule from "@tadori/mcp";
import * as serverModule from "@tadori/server";
import { runServe } from "../src/serve.js";

type ServerApp = Awaited<ReturnType<typeof serverModule.createServerApp>>;

const FIXTURE_REPO_ROOT = fileURLToPath(
  new URL("../../fixtures/01-core-symbols/repo", import.meta.url)
);
const MARKER_WORKER = fileURLToPath(new URL("./fixtures/testMarkerWorker.ts", import.meta.url));

// Direct tsx ESM loader entry so we can spawn `node --import <tsx>` with NO
// shell/pnpm wrapper — child.pid is then the real node process we kill, with
// no intermediate wrapper to orphan behind it (a wrapper would falsify the
// orphan assertion for reasons unrelated to the code under test).
const require = createRequire(import.meta.url);
const TSX_LOADER = pathToFileURL(require.resolve("tsx/esm")).href;

/** §16: bounded wait for process-exit to become observable to the OS table. */
const GRACE_PERIOD_MS = 2_000;

const tempDirs: string[] = [];
const spawned: ChildProcess[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const child of spawned.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        // Already gone.
      }
    }
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function copyFixtureRepo(): { repoRoot: string; markerFile: string } {
  const tempDir = mkdtempSync(path.join(tmpdir(), "tadori-cli-orphan-"));
  tempDirs.push(tempDir);
  const repoRoot = path.join(tempDir, "repo");
  cpSync(FIXTURE_REPO_ROOT, repoRoot, { recursive: true });
  return { repoRoot, markerFile: path.join(tempDir, "marker.txt") };
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(check: () => T | null, timeoutMs = 20_000): Promise<T> {
  const startedAt = Date.now();
  for (;;) {
    const result = check();
    if (result !== null) {
      return result;
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await delay(25);
  }
}

/**
 * §15 setup probe: attempt one OS process-listing call. If it fails, the
 * OS-listing assertions skip with a named reason; the spawn/signal/exit-code
 * assertions still run.
 */
function probeProcessListing(): { ok: boolean; reason: string } {
  try {
    if (process.platform === "win32") {
      const result = spawnSync("tasklist", ["/FI", `PID eq ${process.pid}`, "/NH"], {
        encoding: "utf8"
      });
      if (result.status === 0 && result.stdout.includes(String(process.pid))) {
        return { ok: true, reason: "" };
      }
      return { ok: false, reason: `tasklist probe failed (status ${String(result.status)})` };
    }
    const result = spawnSync("ps", ["-p", String(process.pid)], { encoding: "utf8" });
    if (result.status === 0) {
      return { ok: true, reason: "" };
    }
    return { ok: false, reason: `ps probe failed (status ${String(result.status)})` };
  } catch (error) {
    return { ok: false, reason: `process-listing probe threw: ${String(error)}` };
  }
}

/** True if a process with this PID is still present in the OS process table. */
function pidAlive(pid: number): boolean {
  if (process.platform === "win32") {
    const result = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/NH"], { encoding: "utf8" });
    return result.status === 0 && result.stdout.includes(String(pid));
  }
  const result = spawnSync("ps", ["-p", String(pid)], { encoding: "utf8" });
  return result.status === 0 && result.stdout.trim().split("\n").length > 1;
}

const LISTING = probeProcessListing();

/**
 * Spawns `tsx testMarkerWorker.ts <repo> <marker>` and resolves once its
 * HTTP server is listening (worker thread up), returning the child and its PID.
 */
async function spawnMarkerServe(
  repoRoot: string,
  markerFile: string
): Promise<{ child: ChildProcess; pid: number }> {
  const child = spawn(
    process.execPath,
    ["--import", TSX_LOADER, MARKER_WORKER, repoRoot, markerFile],
    {
      cwd: path.resolve(fileURLToPath(new URL("../..", import.meta.url))),
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  spawned.push(child);
  let stdout = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr?.on("data", () => undefined);

  // Wait for the worker's own "READY <pid>" line; with a direct spawn (no
  // shell), that pid equals child.pid — assert the equality so a future
  // wrapper regression is caught rather than silently orphaning.
  const announcedPid = await waitFor(() => {
    const match = stdout.match(/READY (\d+)/);
    return match ? Number(match[1]) : null;
  });
  expect(announcedPid).toBe(child.pid);
  return { child, pid: announcedPid };
}

describe("orphan supervision — OS-level process cleanup (§10 matrix / §15)", () => {
  it.skipIf(!LISTING.ok)(
    `SIGTERM: killing a spawned tadori serve leaves zero processes at its PID (probe: ${LISTING.reason || "ok"})`,
    async () => {
      const { repoRoot, markerFile } = copyFixtureRepo();
      const { child, pid } = await spawnMarkerServe(repoRoot, markerFile);
      expect(readFileSync(markerFile, "utf8")).toContain("ready");

      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill("SIGTERM");
      await exited;
      await delay(GRACE_PERIOD_MS);

      expect(pidAlive(pid)).toBe(false);
    },
    40_000
  );

  it.skipIf(!LISTING.ok)(
    `SIGINT: killing a spawned tadori serve leaves zero processes at its PID (probe: ${LISTING.reason || "ok"})`,
    async () => {
      const { repoRoot, markerFile } = copyFixtureRepo();
      const { child, pid } = await spawnMarkerServe(repoRoot, markerFile);

      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill("SIGINT");
      await exited;
      await delay(GRACE_PERIOD_MS);

      expect(pidAlive(pid)).toBe(false);
    },
    40_000
  );

  it.skipIf(!LISTING.ok)(
    `parent death (SIGKILL): the whole tadori serve process dies with its worker thread (probe: ${LISTING.reason || "ok"})`,
    async () => {
      const { repoRoot, markerFile } = copyFixtureRepo();
      const { child, pid } = await spawnMarkerServe(repoRoot, markerFile);

      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill("SIGKILL");
      await exited;
      await delay(GRACE_PERIOD_MS);

      // A worker_threads.Worker cannot outlive its owning process: no orphan.
      expect(pidAlive(pid)).toBe(false);
    },
    40_000
  );
});

describe("orphan supervision — spawn/signal/exit checks always run", () => {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    it(`${signal}: the real spawned handler exits cleanly where Node supports graceful delivery`, async () => {
      const { repoRoot, markerFile } = copyFixtureRepo();
      const { child } = await spawnMarkerServe(repoRoot, markerFile);
      const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child.once("exit", (code, exitSignal) => resolve({ code, signal: exitSignal }));
      });

      expect(child.kill(signal)).toBe(true);
      const result = await exited;
      if (process.platform === "win32") {
        expect(result).toEqual({ code: null, signal });
      } else {
        expect(result).toEqual({ code: 0, signal: null });
        expect(readFileSync(markerFile, "utf8")).toContain("exit");
      }
    }, 40_000);
  }

  it("SIGKILL: the real spawned process exits even without cleanup handlers", async () => {
    const { repoRoot, markerFile } = copyFixtureRepo();
    const { child } = await spawnMarkerServe(repoRoot, markerFile);
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });

    expect(child.kill("SIGKILL")).toBe(true);
    expect(await exited).toEqual({ code: null, signal: "SIGKILL" });
  }, 40_000);
});

describe("graceful teardown exit codes (in-process AbortSignal path)", () => {
  // On Windows, child.kill('SIGINT'/'SIGTERM') hard-terminates a spawned child
  // (verified: the handler never runs), so exit-0 + teardown-order for the
  // real SIGINT/SIGTERM handlers is exercised through serve.ts's deps.signal
  // hook — the SAME teardown() function the process.once('SIGINT'/'SIGTERM')
  // handlers invoke (serve.ts:250-259).
  it("an aborted signal (SIGINT/SIGTERM handler equivalent) tears down and exits 0", async () => {
    const { repoRoot } = copyFixtureRepo();
    const controller = new AbortController();
    const stdoutLines: string[] = [];

    const runPromise = runServe([repoRoot, "--port", "0", "--no-open"], {
      openBrowser: async () => undefined,
      signal: controller.signal,
      stdout: (text) => stdoutLines.push(text),
      stderr: () => undefined
    });

    await waitFor(() => (stdoutLines.join("").includes("URL:") ? true : null));
    controller.abort();
    expect(await runPromise).toBe(0);
  });
});

describe("worker crash mid-session (§8 / §10 row 4)", () => {
  it("forcing the refresh worker to exit keeps the server serving, emits watcher_error, and still tears down cleanly", async () => {
    const { repoRoot } = copyFixtureRepo();
    const controller = new AbortController();
    const stdoutLines: string[] = [];

    // §8-sanctioned mechanism: capture the real, unmodified controller instance
    // and force its worker to exit ungracefully via Worker.terminate() — the
    // Node analog of "kill -9 the worker" for a worker_threads.Worker. This
    // produces the real exit event recordFatal already handles.
    let captured: mcpModule.ConcurrentRefreshController | null = null;
    const realStart = mcpModule.ConcurrentRefreshController.start;
    vi.spyOn(mcpModule.ConcurrentRefreshController, "start").mockImplementation(
      async (...args: Parameters<typeof mcpModule.ConcurrentRefreshController.start>) => {
        const controllerInstance = await realStart.apply(mcpModule.ConcurrentRefreshController, args);
        captured = controllerInstance;
        return controllerInstance;
      }
    );

    // Capture the live Fastify instance so we can attach an in-process WS
    // client via @fastify/websocket's injectWS helper — no `ws` module
    // specifier (the cli package does not declare it), mirroring the server
    // package's own ws.test.ts.
    let capturedApp: ServerApp | null = null;
    const realCreate = serverModule.createServerApp;
    vi.spyOn(serverModule, "createServerApp").mockImplementation(async (options) => {
      const instance = await realCreate(options);
      capturedApp = instance;
      return instance;
    });

    const runPromise = runServe([repoRoot, "--port", "0", "--no-open"], {
      openBrowser: async () => undefined,
      signal: controller.signal,
      stdout: (text) => stdoutLines.push(text),
      stderr: () => undefined
    });

    const url = await waitFor(() => {
      const match = stdoutLines.join("").match(/URL:\s+(http:\/\/127\.0\.0\.1:\d+\/)/);
      return match ? match[1] : null;
    });
    const controllerInstance = await waitFor(() => captured);
    const app = await waitFor(() => capturedApp);

    const beforeCrashResponse = await fetch(`${url}api/v1/snapshot`);
    expect(beforeCrashResponse.status).toBe(200);
    const beforeCrash = (await beforeCrashResponse.json()) as { context: { snapshotId: number } };

    // Open a WS client subscribed to the refresh channel BEFORE the crash.
    const socket = await app.injectWS("/api/v1/ws");
    const wsEvents: Array<{ type: string; message?: string }> = [];
    socket.on("message", (raw: Buffer) => {
      try {
        wsEvents.push(JSON.parse(raw.toString("utf8")));
      } catch {
        // ignore
      }
    });
    socket.send(JSON.stringify({ type: "subscribe", channels: ["refresh"] }));
    await delay(300);

    // Force the worker to die (bypassing the graceful stop path). §8 permits
    // reaching the private worker for this adversarial test only.
    await (controllerInstance as unknown as { worker: { terminate(): Promise<number> } }).worker.terminate();

    // (i) HTTP still serves the last valid snapshot, now flagged stale.
    let sawStale = false;
    const staleDeadline = Date.now() + 15_000;
    while (Date.now() < staleDeadline) {
      const response = await fetch(`${url}api/v1/snapshot`);
      if (response.status === 200) {
        const body = (await response.json()) as {
          context: { snapshotId: number; stale: boolean };
        };
        if (body.context.stale === true) {
          expect(body.context.snapshotId).toBe(beforeCrash.context.snapshotId);
          sawStale = true;
          break;
        }
      }
      await delay(100);
    }
    expect(sawStale).toBe(true);

    // (ii) the WS client observes a watcher_error frame.
    await waitFor(() => (wsEvents.some((event) => event.type === "watcher_error") ? true : null), 15_000);
    expect(wsEvents.some((event) => event.type === "watcher_error")).toBe(true);

    socket.terminate();

    // (iii) a subsequent SIGINT (abort) still exits 0 — refresh.stop() is
    // idempotent even with the worker already gone.
    controller.abort();
    expect(await runPromise).toBe(0);
  }, 40_000);
});
