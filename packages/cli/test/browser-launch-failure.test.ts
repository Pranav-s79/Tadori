import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  tempDir = mkdtempSync(path.join(tmpdir(), "tadori-cli-browserfail-"));
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

describe("browser-launch failure is non-fatal (§8/§10)", () => {
  it("a rejecting openBrowser injection does not change the exit code and reports the exact URL message", async () => {
    const repoRoot = copyFixtureRepo();
    const controller = new AbortController();
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    // Simulates a corrupted/unavailable launcher: the injected opener always rejects.
    const openBrowser = vi.fn(async () => {
      throw new Error("simulated corrupt browser launcher");
    });

    const runPromise = runServe([repoRoot, "--port", "0"], {
      openBrowser,
      signal: controller.signal,
      stdout: (text) => stdoutLines.push(text),
      stderr: (text) => stderrLines.push(text)
    });

    const url = await waitFor(() => {
      const match = stdoutLines.join("").match(/URL:\s+(http:\/\/127\.0\.0\.1:\d+\/)/);
      return match ? match[1] : null;
    });

    // The rejection was attempted (not silently skipped) and reported exactly.
    expect(openBrowser).toHaveBeenCalledWith(url);
    expect(stderrLines.join("")).toBe(
      `Could not open a browser automatically. Open ${url} manually.\n`
    );

    // The rejection never propagated as a fatal error: a clean SIGINT exits 0.
    controller.abort();
    expect(await runPromise).toBe(0);
  });
});
