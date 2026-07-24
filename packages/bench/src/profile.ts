import { z } from "zod";

/**
 * The competitor/subject profiles the benchmark compares (11-03). A closed enum
 * so a typo can never silently create an uncounted profile. `tadori_mcp` and
 * `tadori_visual` are the two Tadori configurations; the rest are baselines.
 */
export const PROFILE_KINDS = [
  "plain_claude_code",
  "codebase_memory_mcp",
  "codegraph",
  "tadori_mcp",
  "tadori_visual"
] as const;
export const profileKindSchema = z.enum(PROFILE_KINDS);
export type ProfileKind = (typeof PROFILE_KINDS)[number];

/**
 * A profile's availability. "failures documented not guessed" (BACKLOG 11-03)
 * is enforced by the schema: a profile that is not `available` MUST carry a
 * `statusReason` documenting WHY — an install failure or unavailability is
 * recorded verbatim, never inferred and never silently treated as available.
 */
export const PROFILE_STATUSES = ["available", "install_failed", "unavailable"] as const;
export const profileStatusSchema = z.enum(PROFILE_STATUSES);
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];

/**
 * One isolated competitor profile: its identity, the reproducible install steps,
 * how it is invoked per task, and its availability. `isolation` documents how the
 * profile is kept from contaminating others (e.g. a fresh container/home per run)
 * — profiles must be isolated so one profile's state never leaks into another's
 * measurements.
 */
export const benchProfileSchema = z
  .object({
    id: z.string().min(1),
    kind: profileKindSchema,
    /** Reproducible install steps, in order — the recipe R-02 documents. */
    installSteps: z.array(z.string().min(1)),
    /** How the profile is invoked to run a task (a command template). */
    invocation: z.string().min(1),
    /** How this profile is isolated from the others (e.g. "fresh container per run"). */
    isolation: z.string().min(1),
    status: profileStatusSchema,
    /** Required WHEN not available — the documented reason, never guessed. */
    statusReason: z.string().min(1).optional()
  })
  .strict()
  .refine((p) => p.status === "available" || p.statusReason !== undefined, {
    message: "a non-available profile must document its statusReason"
  });

export type BenchProfile = z.infer<typeof benchProfileSchema>;

/**
 * Parse and validate a profile from untrusted input. Throws on any contract
 * violation — a profile missing its documented failure reason, or with an
 * unknown kind, never enters the benchmark.
 */
export function parseProfile(input: unknown): BenchProfile {
  return benchProfileSchema.parse(input);
}

/** The profiles that are actually runnable (status === "available"). */
export function availableProfiles(profiles: readonly BenchProfile[]): BenchProfile[] {
  return profiles.filter((p) => p.status === "available");
}
