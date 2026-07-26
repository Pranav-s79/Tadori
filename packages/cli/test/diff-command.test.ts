import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDiff } from "../src/diff.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("packaged diff command", () => {
  it("captures a repository and writes the canonical result shape", async () => {
    const repository = mkdtempSync(path.join(tmpdir(), "tadori-cli-diff-"));
    temporaryDirectories.push(repository);
    writeFileSync(path.join(repository, "package.json"), '{"name":"diff-command"}\n');
    writeFileSync(path.join(repository, "value.ts"), "export const value = 1;\n");
    const stdout: string[] = [];

    const exitCode = await runDiff([repository], {
      stdout: (text) => stdout.push(text),
      stderr: () => undefined
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.join(""))).toEqual({
      repoRoot: repository.split(path.sep).join("/"),
      baseSnapshotId: expect.any(Number),
      headSnapshotId: expect.any(Number),
      changed: expect.any(Boolean),
      edges: expect.any(Array)
    });
    expect(existsSync(path.join(repository, ".tadori", "tadori.sqlite"))).toBe(true);
  });

  it("rejects malformed arguments without creating a database", async () => {
    const stderr: string[] = [];
    const exitCode = await runDiff([], {
      stdout: () => undefined,
      stderr: (text) => stderr.push(text)
    });

    expect(exitCode).toBe(1);
    expect(stderr.join("")).toBe("Usage: tadori diff <repository> [--db <database>]\n");
  });
});
