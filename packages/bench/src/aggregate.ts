import type { BenchRunResult } from "./metrics.js";

/**
 * A suite-level rollup over many benchmark run results. Counts are exact sums;
 * `successRate` is successes / total. `tokensTotal` is null when ANY run did
 * not observe tokens — a partial sum would misrepresent cost, so the honest
 * aggregate is "not fully observed" (null), never a silent undercount.
 */
export interface BenchSuiteSummary {
  totalRuns: number;
  successes: number;
  successRate: number;
  regressions: number;
  boundaryViolations: number;
  unsupportedClaims: number;
  filesInspected: number;
  /** Total tokens, or null when any run did not observe token usage. */
  tokensTotal: number | null;
  meanWallTimeMs: number;
}

/**
 * Aggregate benchmark run results into a suite summary. Deterministic and
 * order-independent (all reductions are commutative sums / counts). An empty
 * set yields a zeroed summary with `successRate` 0 and `tokensTotal` 0 (nothing
 * unobserved), never NaN.
 */
export function summarizeRuns(results: readonly BenchRunResult[]): BenchSuiteSummary {
  const totalRuns = results.length;
  let successes = 0;
  let regressions = 0;
  let boundaryViolations = 0;
  let unsupportedClaims = 0;
  let filesInspected = 0;
  let wallTimeMsTotal = 0;
  let tokensTotal: number | null = 0;

  for (const { metrics } of results) {
    if (metrics.success) {
      successes += 1;
    }
    regressions += metrics.regressions;
    boundaryViolations += metrics.boundaryViolations;
    unsupportedClaims += metrics.unsupportedClaims;
    filesInspected += metrics.filesInspected;
    wallTimeMsTotal += metrics.wallTimeMs;
    // Any single unobserved token count poisons the total to null (honest).
    if (metrics.tokens === null) {
      tokensTotal = null;
    } else if (tokensTotal !== null) {
      tokensTotal += metrics.tokens;
    }
  }

  return {
    totalRuns,
    successes,
    successRate: totalRuns === 0 ? 0 : successes / totalRuns,
    regressions,
    boundaryViolations,
    unsupportedClaims,
    filesInspected,
    tokensTotal,
    meanWallTimeMs: totalRuns === 0 ? 0 : wallTimeMsTotal / totalRuns
  };
}
