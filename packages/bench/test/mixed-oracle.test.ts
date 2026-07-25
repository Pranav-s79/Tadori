import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertMixedLanguageOracle, runMixedLanguageOracle } from "../src/mixedOracle.js";

const fixtureRoot = fileURLToPath(new URL("../fixtures/mixed-oracle", import.meta.url));

describe("mixed-language oracle", () => {
  it("indexes the complete fixture deterministically without mutation or unsupported claims", () => {
    const report = runMixedLanguageOracle(fixtureRoot);

    expect(() => assertMixedLanguageOracle(report)).not.toThrow();
    expect(report.fileCount).toBe(40);
    expect(report.subjectFileCount).toBe(38);
    expect(report.graphFileCount).toBeGreaterThan(0);
    expect(report.nodeCount).toBeGreaterThan(0);
    expect(report.edgeCount).toBeGreaterThan(0);
    expect(report.diagnosticFileCount).toBe(12);
  }, 120_000);
});
