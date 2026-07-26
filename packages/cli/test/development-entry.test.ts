import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
const tsxCli = path.join(workspaceRoot, "node_modules", "tsx", "dist", "cli.mjs");
const developmentEntry = path.join(workspaceRoot, "scripts", "tadori.mts");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("workspace tadori command", () => {
  it("dispatches purge with the same behavior as the packaged CLI", () => {
    const repository = mkdtempSync(path.join(tmpdir(), "tadori-development-entry-"));
    temporaryDirectories.push(repository);
    writeFileSync(path.join(repository, "package.json"), JSON.stringify({ name: "test-repo" }));
    mkdirSync(path.join(repository, ".tadori"));
    writeFileSync(path.join(repository, ".tadori", "tadori.sqlite"), "local-index");

    const completed = spawnSync(
      process.execPath,
      [tsxCli, developmentEntry, "purge", repository],
      { encoding: "utf8", cwd: workspaceRoot, windowsHide: true }
    );

    expect(completed.status, completed.stderr).toBe(0);
    expect(completed.stdout).toContain("Purged .tadori data");
    expect(existsSync(path.join(repository, ".tadori"))).toBe(false);
    expect(existsSync(path.join(repository, "package.json"))).toBe(true);
  });
});
