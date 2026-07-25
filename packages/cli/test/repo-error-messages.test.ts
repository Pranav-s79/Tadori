import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runServe } from "../src/serve.js";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** The exact language-neutral resolveRepoRoot message unsupported roots produce. */
function expectedMessage(root: string): string {
  return `'${root}' does not contain any supported or structurally indexable files.`;
}

describe("unsupported repository error messages", () => {
  it("(a) an empty directory exits 2 with the exact resolveRepoRoot message", async () => {
    const root = makeTempDir("tadori-cli-empty-");
    const stderrLines: string[] = [];

    const exitCode = await runServe([root], {
      openBrowser: async () => undefined,
      stderr: (text) => stderrLines.push(text),
      stdout: () => undefined
    });

    expect(exitCode).toBe(2);
    expect(stderrLines.join("")).toBe(`${expectedMessage(path.resolve(root))}\n`);
  });

  it("(b) a directory with only unregistered files produces the identical message", async () => {
    const root = makeTempDir("tadori-cli-unsupported-");
    writeFileSync(path.join(root, "image.png"), Buffer.from([0, 1, 2]));
    const stderrLines: string[] = [];

    const exitCode = await runServe([root], {
      openBrowser: async () => undefined,
      stderr: (text) => stderrLines.push(text),
      stdout: () => undefined
    });

    expect(exitCode).toBe(2);
    expect(stderrLines.join("")).toBe(`${expectedMessage(path.resolve(root))}\n`);
  });
});
