import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compareFixtureBoundaries } from "../src/compareBoundaries.js";

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");

describe("compareFixtureBoundaries (seeded fixture-01/02 violations, un-deferred)", () => {
  it("every fixture with a tadori.rules.json matches its expectedBoundaryViolations exactly", () => {
    const results = compareFixtureBoundaries(repoRoot);
    // At least fixtures 01 and 02 ship rules.
    const withRules = results.map((r) => r.fixtureId);
    expect(withRules).toEqual(expect.arrayContaining(["core-symbols", "express-routes"]));
    for (const result of results) {
      expect(result.failures, `${result.fixtureId}: ${result.failures.join("; ")}`).toEqual([]);
      expect(result.ok).toBe(true);
      // Each seeded fixture declares exactly one violation.
      expect(result.expectedCount).toBe(1);
      expect(result.actualCount).toBe(1);
    }
  });
});
