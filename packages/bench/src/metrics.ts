import { z } from "zod";

/**
 * The metrics captured for a single benchmark task run (11-01, BACKLOG row).
 * Every field is an OBSERVED, non-negative measurement — nothing inferred.
 * `tokens` is nullable because token usage is only capturable "where
 * observable" (some agents/transports do not expose it); null means "not
 * observed", never zero. Counts are non-negative integers; wall time is ms.
 */
export const benchRunMetricsSchema = z
  .object({
    /** Did the run pass the task's held-out success criteria? */
    success: z.boolean(),
    /** Regressions introduced (e.g. tests that were passing and now fail). */
    regressions: z.number().int().min(0),
    /** Distinct files the agent inspected/read during the run. */
    filesInspected: z.number().int().min(0),
    /** Boundary-rule violations present in the produced change. */
    boundaryViolations: z.number().int().min(0),
    /** Claims the agent made that the evidence does not support. */
    unsupportedClaims: z.number().int().min(0),
    /** Tokens consumed, or null when the transport does not expose it. */
    tokens: z.number().int().min(0).nullable(),
    /** Wall-clock duration of the run in milliseconds. */
    wallTimeMs: z.number().min(0)
  })
  .strict();

export type BenchRunMetrics = z.infer<typeof benchRunMetricsSchema>;

/**
 * A complete, reproducible record of one benchmark run: the task, the seed that
 * made it reproducible, the validated metrics, and the raw per-run log lines
 * captured verbatim (never summarized — the raw log is the audit trail).
 */
export const benchRunResultSchema = z
  .object({
    taskId: z.string().min(1),
    /** The reproducible seed for this run — same seed + task ⇒ same run identity. */
    seed: z.string().min(1),
    metrics: benchRunMetricsSchema,
    /** Raw log lines, in capture order, verbatim. */
    rawLog: z.array(z.string())
  })
  .strict();

export type BenchRunResult = z.infer<typeof benchRunResultSchema>;
