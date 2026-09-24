import { describe, expect, it } from "vitest";
import { LEVEL_DEPTH_ORDER, depthOffsetForLevel } from "../src/render/depthBinding.ts";

describe("depthOffsetForLevel", () => {
  it("binds depth to the abstraction level and nothing else", () => {
    // The same enum layout_positions.abstraction_level is CHECK-constrained to.
    expect(LEVEL_DEPTH_ORDER).toEqual({ package: 0, file: 1, symbol: 2 });
  });

  it("orders package below file below symbol", () => {
    expect(depthOffsetForLevel("package")).toBe(0);
    expect(depthOffsetForLevel("file")).toBeGreaterThan(depthOffsetForLevel("package"));
    expect(depthOffsetForLevel("symbol")).toBeGreaterThan(depthOffsetForLevel("file"));
  });

  it("scales linearly with the depth unit, 40 by default", () => {
    expect(depthOffsetForLevel("file")).toBe(40);
    expect(depthOffsetForLevel("symbol")).toBe(80);
    expect(depthOffsetForLevel("symbol", 2.5)).toBe(5);
    expect(depthOffsetForLevel("package", 1000)).toBe(0);
  });
});
