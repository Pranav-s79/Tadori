import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as serverModule from "@tadori/server";
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
  tempDir = mkdtempSync(path.join(tmpdir(), "tadori-cli-portfallback-"));
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

function listenOnEphemeralPort(): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function portOf(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected an AddressInfo");
  }
  return address.port;
}

describe("port selection (§8/§10)", () => {
  it("(a) default (--port omitted) binds successfully on an OS-assigned nonzero port", async () => {
    const repoRoot = copyFixtureRepo();
    const controller = new AbortController();
    const stdoutLines: string[] = [];

    const runPromise = runServe([repoRoot], {
      openBrowser: async () => undefined,
      signal: controller.signal,
      stdout: (text) => stdoutLines.push(text),
      stderr: () => undefined
    });

    const port = await waitFor(() => {
      const match = stdoutLines.join("").match(/URL:\s+http:\/\/127\.0\.0\.1:(\d+)\//);
      return match ? Number(match[1]) : null;
    });
    expect(port).toBeGreaterThan(0);

    controller.abort();
    expect(await runPromise).toBe(0);
  });

  it("(b) explicit free port binds and reports exactly that port", async () => {
    const repoRoot = copyFixtureRepo();
    // Discover a currently-free port, release it, then ask runServe for it.
    const scout = await listenOnEphemeralPort();
    const freePort = portOf(scout);
    await new Promise<void>((resolve) => scout.close(() => resolve()));

    const controller = new AbortController();
    const stdoutLines: string[] = [];

    const runPromise = runServe([repoRoot, "--port", String(freePort)], {
      openBrowser: async () => undefined,
      signal: controller.signal,
      stdout: (text) => stdoutLines.push(text),
      stderr: () => undefined
    });

    const reportedPort = await waitFor(() => {
      const match = stdoutLines.join("").match(/URL:\s+http:\/\/127\.0\.0\.1:(\d+)\//);
      return match ? Number(match[1]) : null;
    });
    expect(reportedPort).toBe(freePort);

    controller.abort();
    expect(await runPromise).toBe(0);
  });

  it("(c) explicit occupied port exits 4 with the exact §10 message and never builds the server", async () => {
    const repoRoot = copyFixtureRepo();
    const occupied = await listenOnEphemeralPort();
    const port = portOf(occupied);
    const createSpy = vi.spyOn(serverModule, "createServerApp");
    const stderrLines: string[] = [];

    const exitCode = await runServe([repoRoot, "--port", String(port), "--no-open"], {
      openBrowser: async () => undefined,
      stderr: (text) => stderrLines.push(text),
      stdout: () => undefined
    });

    expect(exitCode).toBe(4);
    expect(stderrLines.join("")).toBe(
      `Port ${port} is already in use. Choose a different port with --port, ` +
        "or omit --port to let the OS pick one.\n"
    );
    // Acceptance (§14): no server routes registered on the conflict path.
    expect(createSpy).not.toHaveBeenCalled();

    // The occupying server is still the only listener; runServe left nothing bound.
    await new Promise<void>((resolve, reject) => {
      occupied.close((error) => (error ? reject(error) : resolve()));
    });
  });
});
