import { describe, expect, it } from "vitest";
import {
  benchRunMetricsSchema,
  RunRecorder,
  SeededRandom,
  summarizeRuns,
  type BenchRunMetrics,
  type BenchRunResult
} from "../src/index.js";

function metrics(over: Partial<BenchRunMetrics> = {}): BenchRunMetrics {
  return {
    success: true,
    regressions: 0,
    filesInspected: 3,
    boundaryViolations: 0,
    unsupportedClaims: 0,
    tokens: 100,
    wallTimeMs: 500,
    ...over
  };
}

describe("benchRunMetricsSchema", () => {
  it("accepts well-formed metrics and rejects a negative count", () => {
    expect(() => benchRunMetricsSchema.parse(metrics())).not.toThrow();
    expect(() => benchRunMetricsSchema.parse(metrics({ regressions: -1 }))).toThrow();
  });

  it("allows tokens to be null (not observable) but not fractional", () => {
    expect(() => benchRunMetricsSchema.parse(metrics({ tokens: null }))).not.toThrow();
    expect(() => benchRunMetricsSchema.parse(metrics({ tokens: 1.5 }))).toThrow();
  });

  it("rejects unknown extra fields (strict)", () => {
    expect(() => benchRunMetricsSchema.parse({ ...metrics(), sneaky: 1 })).toThrow();
  });
});

describe("SeededRandom", () => {
  it("is reproducible: same seed yields the same sequence", () => {
    const a = new SeededRandom("seed-1");
    const b = new SeededRandom("seed-1");
    const seqA = [a.next(), a.next(), a.next()];
    const seqB = [b.next(), b.next(), b.next()];
    expect(seqA).toEqual(seqB);
  });

  it("different seeds yield different sequences", () => {
    const a = new SeededRandom("seed-1");
    const b = new SeededRandom("seed-2");
    expect(a.next()).not.toBe(b.next());
  });

  it("nextInt stays within [0, max)", () => {
    const r = new SeededRandom("x");
    for (let i = 0; i < 100; i += 1) {
      const v = r.nextInt(10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});

describe("RunRecorder", () => {
  it("captures the raw log verbatim in order and finalizes a validated result", () => {
    const rec = new RunRecorder("task-1", "seed-1");
    rec.record("line a");
    rec.record("line b");
    const result = rec.finalize(metrics());
    expect(result.taskId).toBe("task-1");
    expect(result.seed).toBe("seed-1");
    expect(result.rawLog).toEqual(["line a", "line b"]);
  });

  it("rejects an empty taskId or seed", () => {
    expect(() => new RunRecorder("", "s")).toThrow();
    expect(() => new RunRecorder("t", "")).toThrow();
  });

  it("finalize throws on out-of-contract metrics (never silently malformed)", () => {
    const rec = new RunRecorder("t", "s");
    expect(() => rec.finalize(metrics({ wallTimeMs: -1 }))).toThrow();
  });
});

describe("summarizeRuns", () => {
  function result(over: Partial<BenchRunMetrics>): BenchRunResult {
    return { taskId: "t", seed: "s", metrics: metrics(over), rawLog: [] };
  }

  it("computes success rate and sums counts", () => {
    const summary = summarizeRuns([
      result({ success: true, regressions: 1, filesInspected: 2 }),
      result({ success: false, regressions: 0, filesInspected: 3 })
    ]);
    expect(summary.totalRuns).toBe(2);
    expect(summary.successes).toBe(1);
    expect(summary.successRate).toBe(0.5);
    expect(summary.regressions).toBe(1);
    expect(summary.filesInspected).toBe(5);
  });

  it("poisons tokensTotal to null when any run did not observe tokens", () => {
    const summary = summarizeRuns([result({ tokens: 100 }), result({ tokens: null })]);
    expect(summary.tokensTotal).toBeNull();
  });

  it("sums tokens when all runs observed them", () => {
    const summary = summarizeRuns([result({ tokens: 100 }), result({ tokens: 50 })]);
    expect(summary.tokensTotal).toBe(150);
  });

  it("an empty set yields a zeroed summary, never NaN", () => {
    const summary = summarizeRuns([]);
    expect(summary.successRate).toBe(0);
    expect(summary.meanWallTimeMs).toBe(0);
    expect(Number.isNaN(summary.successRate)).toBe(false);
  });
});
