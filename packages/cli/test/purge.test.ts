import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  confinedRealPath,
  PURGE_EXIT_CLEAN,
  PURGE_EXIT_CONFINEMENT_VIOLATION,
  PURGE_EXIT_UNSUPPORTED_REPOSITORY,
  runPurge
} from "../src/purge.js";

const dirs: string[] = [];

/** A minimal supported repo (has package.json) with an optional .tadori dir. */
function makeRepo(withData: boolean): string {
  const root = mkdtempSync(path.join(tmpdir(), "tadori-purge-"));
  dirs.push(root);
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "x" }));
  if (withData) {
    mkdirSync(path.join(root, ".tadori"));
    writeFileSync(path.join(root, ".tadori", "tadori.sqlite"), "db-bytes");
  }
  return root;
}

function silentDeps(): {
  out: string[];
  err: string[];
  deps: { stdout(t: string): void; stderr(t: string): void };
} {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, deps: { stdout: (t) => out.push(t), stderr: (t) => err.push(t) } };
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("runPurge", () => {
  it("deletes the .tadori data directory and exits clean", () => {
    const root = makeRepo(true);
    const { deps } = silentDeps();
    const code = runPurge([root], deps);
    expect(code).toBe(PURGE_EXIT_CLEAN);
    expect(existsSync(path.join(root, ".tadori"))).toBe(false);
    // The repository itself and its source are untouched.
    expect(existsSync(path.join(root, "package.json"))).toBe(true);
  });

  it("is idempotent: a repo with no .tadori reports nothing to purge, exits clean", () => {
    const root = makeRepo(false);
    const { out, deps } = silentDeps();
    const code = runPurge([root], deps);
    expect(code).toBe(PURGE_EXIT_CLEAN);
    expect(out.join("")).toMatch(/nothing to purge/i);
  });

  it("rejects a missing target argument", () => {
    const { deps } = silentDeps();
    expect(runPurge([], deps)).toBe(PURGE_EXIT_UNSUPPORTED_REPOSITORY);
  });

  it("rejects an unsupported repository (no package.json/tsconfig.json)", () => {
    const empty = mkdtempSync(path.join(tmpdir(), "tadori-empty-"));
    dirs.push(empty);
    const { deps } = silentDeps();
    expect(runPurge([empty], deps)).toBe(PURGE_EXIT_UNSUPPORTED_REPOSITORY);
  });

  it("SECURITY: refuses to delete through a .tadori symlink escaping the repo root", () => {
    const root = makeRepo(false);
    // An "outside" directory with a sentinel that MUST survive.
    const outside = mkdtempSync(path.join(tmpdir(), "tadori-outside-"));
    dirs.push(outside);
    const sentinel = path.join(outside, "keep.txt");
    writeFileSync(sentinel, "must-not-be-deleted");

    // Plant .tadori as a symlink to the outside directory. Skip if the platform
    // forbids symlink creation (e.g. unprivileged Windows) — never a false fail.
    try {
      symlinkSync(outside, path.join(root, ".tadori"), "dir");
    } catch {
      return;
    }

    const { err, deps } = silentDeps();
    const code = runPurge([root], deps);
    expect(code).toBe(PURGE_EXIT_CONFINEMENT_VIOLATION);
    expect(err.join("")).toMatch(/refusing to purge/i);
    // The outside sentinel survives — nothing outside the repo was deleted.
    expect(existsSync(sentinel)).toBe(true);
  });
});

describe("confinedRealPath", () => {
  it("accepts a real descendant of the root", () => {
    const root = makeRepo(true);
    const confined = confinedRealPath(path.join(root, ".tadori"), root);
    expect(confined).not.toBeNull();
  });

  it("rejects the root itself and a non-existent target", () => {
    const root = makeRepo(false);
    expect(confinedRealPath(root, root)).toBeNull();
    expect(confinedRealPath(path.join(root, "nope"), root)).toBeNull();
  });

  it("rejects a path outside the root", () => {
    const root = makeRepo(false);
    const outside = mkdtempSync(path.join(tmpdir(), "tadori-outside-"));
    dirs.push(outside);
    expect(confinedRealPath(outside, root)).toBeNull();
  });
});
