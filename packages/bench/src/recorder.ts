import { benchRunResultSchema, type BenchRunMetrics, type BenchRunResult } from "./metrics.js";

/**
 * Deterministic seeded PRNG (mulberry32) — reproducible seeds are a named
 * 11-01 requirement. A seed STRING is hashed to a 32-bit state, so the same
 * seed always yields the same sequence. Used for any randomized choice a task
 * run makes (e.g. sampling), so a run is reproducible from its seed alone.
 */
export class SeededRandom {
  private state: number;

  constructor(seed: string) {
    // FNV-1a 32-bit hash of the seed string → initial state (deterministic).
    let h = 0x811c9dc5;
    for (let i = 0; i < seed.length; i += 1) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    this.state = h >>> 0;
  }

  /** Next float in [0, 1). Deterministic for a given seed + call count. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** A deterministic integer in [0, max). */
  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }
}

/**
 * Accumulates one benchmark run's raw log and metrics, then emits a validated,
 * reproducible `BenchRunResult`. The recorder captures the raw log VERBATIM (in
 * order, never summarized — it is the audit trail) and validates the final
 * metrics against the frozen schema, so a malformed metric can never enter the
 * result set. Its `random` is seeded from the run's seed for reproducibility.
 */
export class RunRecorder {
  private readonly log: string[] = [];
  readonly random: SeededRandom;

  constructor(
    readonly taskId: string,
    readonly seed: string
  ) {
    if (taskId.length === 0) {
      throw new Error("RunRecorder requires a non-empty taskId");
    }
    if (seed.length === 0) {
      throw new Error("RunRecorder requires a non-empty seed");
    }
    this.random = new SeededRandom(seed);
  }

  /** Append one raw log line, captured verbatim in order. */
  record(line: string): void {
    this.log.push(line);
  }

  /** The raw log so far, as a defensive copy. */
  rawLog(): string[] {
    return [...this.log];
  }

  /**
   * Finalize the run into a validated result. Throws (via the schema) if any
   * metric is out of contract — a benchmark result is never allowed to be
   * silently malformed.
   */
  finalize(metrics: BenchRunMetrics): BenchRunResult {
    return benchRunResultSchema.parse({
      taskId: this.taskId,
      seed: this.seed,
      metrics,
      rawLog: [...this.log]
    });
  }
}
