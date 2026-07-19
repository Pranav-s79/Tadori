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

/** §8/§10: the exact resolveRepoRoot message both sub-cases must produce. */
function expectedMessage(root: string): string {
  return (
    `'${root}' is not a supported TypeScript/JavaScript repository ` +
    "(no package.json or tsconfig.json found at the repository root)."
  );
}

describe("empty vs non-TS repository error messages (§8/§11 step 6)", () => {
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

  it("(b) a directory with only non-TS files produces the IDENTICAL message (honest equivalence)", async () => {
    const root = makeTempDir("tadori-cli-nonts-");
    writeFileSync(path.join(root, "main.py"), "print('hello')\n");
    writeFileSync(path.join(root, "README.md"), "# not a JS/TS project\n");
    const stderrLines: string[] = [];

    const exitCode = await runServe([root], {
      openBrowser: async () => undefined,
      stderr: (text) => stderrLines.push(text),
      stdout: () => undefined
    });

    expect(exitCode).toBe(2);
    // Documents that Tadori cannot (and should not pretend to) distinguish
    // "empty" from "wrong language" without a package.json/tsconfig.json signal.
    expect(stderrLines.join("")).toBe(`${expectedMessage(path.resolve(root))}\n`);
  });
});
