import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveRepoRoot } from "../src/repoResolve.js";

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("resolveRepoRoot", () => {
  it("resolves ok for a directory with only package.json", () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "tadori-repo-resolve-"));
    writeFileSync(path.join(tempDir, "package.json"), "{}");
    const result = resolveRepoRoot(tempDir);
    expect(result).toEqual({ ok: true, root: path.resolve(tempDir) });
  });

  it("resolves ok for a directory with only tsconfig.json", () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "tadori-repo-resolve-"));
    writeFileSync(path.join(tempDir, "tsconfig.json"), "{}");
    const result = resolveRepoRoot(tempDir);
    expect(result).toEqual({ ok: true, root: path.resolve(tempDir) });
  });

  it("resolves ok for a mixed-language directory without JavaScript manifests", () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "tadori-repo-resolve-"));
    writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");
    writeFileSync(path.join(tempDir, "main.go"), "package main\n");
    const result = resolveRepoRoot(tempDir);
    expect(result).toEqual({ ok: true, root: path.resolve(tempDir) });
  });

  it("returns the exact unsupported-repository error for an empty directory", () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "tadori-repo-resolve-"));
    const resolved = path.resolve(tempDir);
    const result = resolveRepoRoot(tempDir);
    expect(result).toEqual({
      ok: false,
      error: `'${resolved}' does not contain any supported or structurally indexable files.`
    });
  });

  it("returns a distinct error for a path that does not exist", () => {
    const missing = path.join(tmpdir(), "tadori-repo-resolve-does-not-exist-12345");
    const result = resolveRepoRoot(missing);
    expect(result.ok).toBe(false);
    expect(result.ok || result.error).not.toContain("is not a supported");
    expect(result.ok || result.error).toContain("does not exist");
  });
});
