import { z } from "zod";

/**
 * A seeded trap's category — the kind of mistake the task is designed to catch
 * an agent making. A non-trap task has `trapKind` undefined. These are the trap
 * classes the corpus authors seed (11-02); the enum is closed so a typo can
 * never silently create a new, uncounted category.
 */
export const TRAP_KINDS = [
  "boundary_violation",
  "unsupported_claim",
  "missing_dependency_edit",
  "wrong_symbol_same_name",
  "hidden_dynamic_dispatch",
  "stale_doc_drift"
] as const;
export const trapKindSchema = z.enum(TRAP_KINDS);
export type TrapKind = (typeof TRAP_KINDS)[number];

/**
 * One benchmark task (11-02). `successCommand` is the held-out check that
 * DEFINES success — it is run after the agent's change and its exit code is the
 * verdict, so success is never self-reported by the agent. `isSeededTrap`
 * marks a task authored to expose a specific failure mode (`trapKind`).
 */
export const benchTaskSchema = z
  .object({
    id: z.string().min(1),
    /** The instruction given to the agent under test. */
    prompt: z.string().min(1),
    /** Which corpus repo this task runs against. */
    corpus: z.string().min(1),
    /**
     * The held-out success check — a shell command run after the change whose
     * exit code 0 means success. This is the objective verdict; the agent never
     * scores itself.
     */
    successCommand: z.string().min(1),
    isSeededTrap: z.boolean(),
    trapKind: trapKindSchema.optional()
  })
  .strict()
  .refine((t) => t.isSeededTrap === (t.trapKind !== undefined), {
    message: "trapKind must be present iff isSeededTrap is true"
  });

export type BenchTask = z.infer<typeof benchTaskSchema>;

/** A named set of tasks (a corpus's task suite). */
export const benchTaskSetSchema = z
  .object({
    name: z.string().min(1),
    tasks: z.array(benchTaskSchema).min(1)
  })
  .strict()
  .refine((s) => new Set(s.tasks.map((t) => t.id)).size === s.tasks.length, {
    message: "task ids must be unique within a set"
  });

export type BenchTaskSet = z.infer<typeof benchTaskSetSchema>;

/**
 * Parse and validate a task set from untrusted input (e.g. a JSON file). Throws
 * a ZodError on any contract violation — a malformed task set never enters the
 * benchmark. Returns the validated, typed set.
 */
export function parseTaskSet(input: unknown): BenchTaskSet {
  return benchTaskSetSchema.parse(input);
}

/** The seeded-trap tasks in a set (the subset that probes a specific failure mode). */
export function seededTraps(set: BenchTaskSet): BenchTask[] {
  return set.tasks.filter((t) => t.isSeededTrap);
}
