import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadServeConfig } from "../src/config.js";

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("loadServeConfig", () => {
  it("parses a valid tadori.rules.json into rules", () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "tadori-config-"));
    writeFileSync(path.join(tempDir, "tadori.rules.json"), JSON.stringify({ boundaries: [] }));
    const config = loadServeConfig(tempDir);
    expect(config.rules).toEqual({ boundaries: [] });
  });

  it("returns rules: null when tadori.rules.json is absent", () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "tadori-config-"));
    const config = loadServeConfig(tempDir);
    expect(config.rules).toBeNull();
  });

  it("throws the exact documented error message on malformed JSON", () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "tadori-config-"));
    writeFileSync(path.join(tempDir, "tadori.rules.json"), "{not json");
    expect(() => loadServeConfig(tempDir as string)).toThrow(/^Failed to parse tadori\.rules\.json: /);
  });

  it("reflects actual .gitignore/.tadoriignore presence", () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "tadori-config-"));
    writeFileSync(path.join(tempDir, ".gitignore"), "node_modules\n");
    const config = loadServeConfig(tempDir);
    expect(config.hasGitignore).toBe(true);
    expect(config.hasTadoriignore).toBe(false);
  });
});
