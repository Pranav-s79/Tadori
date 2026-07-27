import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { isDirectExecution } from "../src/cli.js";

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
  it("recognizes a canonical entry reached through a filesystem path alias", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "tadori-entry-alias-"));
    temporaryDirectories.push(directory);
    const entry = path.join(directory, "entry.mjs");
    writeFileSync(entry, "export {};\n");

    const nested = path.join(directory, "nested");
    mkdirSync(nested);
    expect(isDirectExecution(pathToFileURL(entry).href, path.join(nested, "..", "entry.mjs"))).toBe(
      true
    );

    if (process.platform !== "win32") {
      const alias = path.join(directory, "entry-alias.mjs");
      symlinkSync(entry, alias);
      expect(isDirectExecution(pathToFileURL(entry).href, alias)).toBe(true);
    }
  });

  it("rejects a different or missing executable path", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "tadori-entry-other-"));
    temporaryDirectories.push(directory);
    const entry = path.join(directory, "entry.mjs");
    const other = path.join(directory, "other.mjs");
    writeFileSync(entry, "export {};\n");
    writeFileSync(other, "export {};\n");

    expect(isDirectExecution(pathToFileURL(entry).href, other)).toBe(false);
    expect(isDirectExecution(pathToFileURL(entry).href, path.join(directory, "missing.mjs"))).toBe(
      false
    );
  });

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
