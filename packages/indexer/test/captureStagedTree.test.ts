import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureStagedTree,
  GitUnavailableError,
  NotAGitRepositoryError
} from "../src/captureStagedTree.js";

let repo: string | null = null;
const disposers: Array<() => void> = [];

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** A fresh temp git repo with an identity configured (needed for commits). */
function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "tadori-staged-src-"));
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "t@example.com"]);
  git(dir, ["config", "user.name", "T"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  // Pin line-ending handling so checkout-index preserves LF on every platform
  // (a machine with core.autocrlf=true would otherwise materialize CRLF).
  git(dir, ["config", "core.autocrlf", "false"]);
  return dir;
}

function write(dir: string, rel: string, contents: string): void {
  writeFileSync(path.join(dir, rel), contents);
}

afterEach(() => {
  while (disposers.length > 0) {
    disposers.pop()?.();
  }
  if (repo) {
    rmSync(repo, { recursive: true, force: true });
    repo = null;
  }
  vi.restoreAllMocks();
});

describe("captureStagedTree", () => {
  it("captures a staged addition", async () => {
    repo = initRepo();
    write(repo, "added.ts", "export const a = 1;\n");
    git(repo, ["add", "added.ts"]);

    const capture = await captureStagedTree(repo);
    disposers.push(capture.dispose);
    expect(readFileSync(path.join(capture.dir, "added.ts"), "utf8")).toBe("export const a = 1;\n");
  });

  it("captures a staged modification", async () => {
    repo = initRepo();
    write(repo, "m.ts", "v1\n");
    git(repo, ["add", "m.ts"]);
    git(repo, ["commit", "-m", "init"]);
    write(repo, "m.ts", "v2\n");
    git(repo, ["add", "m.ts"]);

    const capture = await captureStagedTree(repo);
    disposers.push(capture.dispose);
    expect(readFileSync(path.join(capture.dir, "m.ts"), "utf8")).toBe("v2\n");
  });

  it("captures a staged deletion (the file is absent from the staged tree)", async () => {
    repo = initRepo();
    write(repo, "keep.ts", "keep\n");
    write(repo, "gone.ts", "gone\n");
    git(repo, ["add", "keep.ts", "gone.ts"]);
    git(repo, ["commit", "-m", "init"]);
    git(repo, ["rm", "gone.ts"]); // stages the deletion

    const capture = await captureStagedTree(repo);
    disposers.push(capture.dispose);
    expect(existsSync(path.join(capture.dir, "keep.ts"))).toBe(true);
    expect(existsSync(path.join(capture.dir, "gone.ts"))).toBe(false);
  });

  it("reflects the INDEX, not the working tree, for a partially staged file", async () => {
    repo = initRepo();
    write(repo, "p.ts", "base\n");
    git(repo, ["add", "p.ts"]);
    git(repo, ["commit", "-m", "init"]);
    // Stage "staged" content, then overwrite the working tree with different content.
    write(repo, "p.ts", "staged\n");
    git(repo, ["add", "p.ts"]);
    write(repo, "p.ts", "working-tree-only\n"); // NOT staged

    const capture = await captureStagedTree(repo);
    disposers.push(capture.dispose);
    // Must be the staged content, never the later unstaged working-tree edit.
    expect(readFileSync(path.join(capture.dir, "p.ts"), "utf8")).toBe("staged\n");
  });

  it("handles filenames containing spaces", async () => {
    repo = initRepo();
    write(repo, "a file.ts", "spaced\n");
    git(repo, ["add", "a file.ts"]);

    const capture = await captureStagedTree(repo);
    disposers.push(capture.dispose);
    expect(readFileSync(path.join(capture.dir, "a file.ts"), "utf8")).toBe("spaced\n");
  });

  it("cleans up the temp dir on success (after dispose)", async () => {
    repo = initRepo();
    write(repo, "x.ts", "x\n");
    git(repo, ["add", "x.ts"]);

    const capture = await captureStagedTree(repo);
    expect(existsSync(capture.dir)).toBe(true);
    capture.dispose();
    expect(existsSync(capture.dir)).toBe(false);
    // dispose is idempotent.
    expect(() => capture.dispose()).not.toThrow();
  });

  it("cleans up on failure / non-repo and reports an honest error (no leaked dir)", async () => {
    const notRepo = mkdtempSync(path.join(tmpdir(), "tadori-notrepo-"));
    try {
      await expect(captureStagedTree(notRepo)).rejects.toBeInstanceOf(NotAGitRepositoryError);
    } finally {
      rmSync(notRepo, { recursive: true, force: true });
    }
  });

  it("passes git arguments as an array with shell disabled (shell-safe)", async () => {
    // A filename crafted to be dangerous if ever interpolated into a shell.
    repo = initRepo();
    write(repo, "safe;rm -rf x.ts", "safe\n");
    git(repo, ["add", "safe;rm -rf x.ts"]);

    const capture = await captureStagedTree(repo);
    disposers.push(capture.dispose);
    // The file materializes literally; nothing was executed as a shell command.
    expect(readFileSync(path.join(capture.dir, "safe;rm -rf x.ts"), "utf8")).toBe("safe\n");
  });

  it("throws GitUnavailableError when git is not on PATH (Windows-compatible: PATH cleared)", async () => {
    repo = initRepo();
    write(repo, "y.ts", "y\n");
    git(repo, ["add", "y.ts"]);
    // Simulate git missing by clearing PATH so execFile("git") resolves ENOENT
    // on both POSIX and Windows.
    const originalPath = process.env.PATH;
    const originalWinPath = process.env.Path;
    try {
      process.env.PATH = "";
      if (originalWinPath !== undefined) {
        process.env.Path = "";
      }
      await expect(captureStagedTree(repo)).rejects.toBeInstanceOf(GitUnavailableError);
    } finally {
      process.env.PATH = originalPath;
      if (originalWinPath !== undefined) {
        process.env.Path = originalWinPath;
      }
    }
  });
});
