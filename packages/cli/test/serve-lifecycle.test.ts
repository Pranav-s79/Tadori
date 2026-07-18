import { cpSync, mkdtempSync, rmSync } from "node:fs";
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
  tempDir = mkdtempSync(path.join(tmpdir(), "tadori-cli-lifecycle-"));
  const repoRoot = path.join(tempDir, "repo");
  cpSync(FIXTURE_REPO_ROOT, repoRoot, { recursive: true });
  return repoRoot;
}

describe("runServe lifecycle", () => {
  it("completes steps 1-7 and serves /api/v1/snapshot over the live server", async () => {
    const repoRoot = copyFixtureRepo();
    const controller = new AbortController();
    const openBrowser = vi.fn(async () => undefined);
    const stdoutLines: string[] = [];

    const runPromise = runServe([repoRoot, "--port", "0"], {
      openBrowser,
      signal: controller.signal,
      stdout: (text) => stdoutLines.push(text),
      stderr: () => undefined
    });

    // Poll stdout for the URL line rather than a fixed timeout.
    const url = await waitFor(() => {
      const printed = stdoutLines.join("");
      const match = printed.match(/URL:\s+(http:\/\/127\.0\.0\.1:\d+\/)/);
      return match ? match[1] : null;
    });

    expect(openBrowser).toHaveBeenCalledWith(url);

    const response = await fetch(`${url}api/v1/snapshot`);
    expect(response.status).toBe(200);

    const statusPageResponse = await fetch(url as string);
    const statusPageHtml = await statusPageResponse.text();
    expect(statusPageHtml).toContain(path.resolve(repoRoot));
    expect(statusPageHtml.toLowerCase()).not.toContain("dashboard");
    expect(statusPageHtml).toContain("not yet built");

    controller.abort();
    const exitCode = await runPromise;
    expect(exitCode).toBe(0);
  });

  it("--reindex forces a full rebuild before serving", async () => {
    const repoRoot = copyFixtureRepo();
    const controller = new AbortController();
    const stdoutLines: string[] = [];

    const runPromise = runServe([repoRoot, "--port", "0", "--reindex"], {
      openBrowser: async () => undefined,
      signal: controller.signal,
      stdout: (text) => stdoutLines.push(text),
      stderr: () => undefined
    });

    await waitFor(() => (stdoutLines.join("").includes("URL:") ? true : null));
    expect(stdoutLines.join("")).toContain("(rebuilt)");

    controller.abort();
    const exitCode = await runPromise;
    expect(exitCode).toBe(0);
  });

  it("a stubbed open() failure does not throw and does not set a non-zero exit code", async () => {
    const repoRoot = copyFixtureRepo();
    const controller = new AbortController();
    const stderrLines: string[] = [];
    const stdoutLines: string[] = [];

    const runPromise = runServe([repoRoot, "--port", "0"], {
      openBrowser: async () => {
        throw new Error("no display available");
      },
      signal: controller.signal,
      stdout: (text) => stdoutLines.push(text),
      stderr: (text) => stderrLines.push(text)
    });

    await waitFor(() => (stdoutLines.join("").includes("URL:") ? true : null));
    expect(stderrLines.join("")).toMatch(/Could not open a browser automatically\. Open .* manually\./);

    controller.abort();
    const exitCode = await runPromise;
    expect(exitCode).toBe(0);
  });

  it("--mode 2.5d returns exit code 1 without ever invoking createServerApp", async () => {
    const repoRoot = copyFixtureRepo();
    const spy = vi.spyOn(serverModule, "createServerApp");
    const stderrLines: string[] = [];
    const stdoutLines: string[] = [];

    const exitCode = await runServe([repoRoot, "--mode", "2.5d"], {
      openBrowser: async () => undefined,
      stderr: (text) => stderrLines.push(text),
      stdout: (text) => stdoutLines.push(text)
    });

    expect(exitCode).toBe(1);
    expect(stderrLines.join("")).toContain("not implemented until Phase 10");
    expect(stderrLines.join("")).toContain("10-01");
    expect(spy).not.toHaveBeenCalled();
    // No startup facts (which would only print after a listening server) were emitted.
    expect(stdoutLines.join("")).not.toContain("URL:");
  });

  it("--mode 3d-experiment returns exit code 1 citing 10-02", async () => {
    const repoRoot = copyFixtureRepo();
    const stderrLines: string[] = [];

    const exitCode = await runServe([repoRoot, "--mode", "3d-experiment"], {
      openBrowser: async () => undefined,
      stderr: (text) => stderrLines.push(text),
      stdout: () => undefined
    });

    expect(exitCode).toBe(1);
    expect(stderrLines.join("")).toContain("10-02");
  });

  it("an unsupported repository path exits 2 with the exact error string", async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "tadori-cli-lifecycle-empty-"));
    const stderrLines: string[] = [];

    const exitCode = await runServe([tempDir], {
      openBrowser: async () => undefined,
      stderr: (text) => stderrLines.push(text),
      stdout: () => undefined
    });

    expect(exitCode).toBe(2);
    expect(stderrLines.join("")).toContain("is not a supported TypeScript/JavaScript repository");
  });

  it("an invalid/nonexistent --snapshot id exits 3 naming the id", async () => {
    const repoRoot = copyFixtureRepo();
    const stderrLines: string[] = [];

    const exitCode = await runServe([repoRoot, "--snapshot", "999999"], {
      openBrowser: async () => undefined,
      stderr: (text) => stderrLines.push(text),
      stdout: () => undefined
    });

    expect(exitCode).toBe(3);
    expect(stderrLines.join("")).toContain("999999");
  });
});

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
