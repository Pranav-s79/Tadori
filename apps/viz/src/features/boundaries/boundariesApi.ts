const API_BASE = "/api/v1";

/** Severity of a boundary rule, mirrored from the store's BoundarySeverity. */
export type BoundarySeverity = "warning" | "error";

/**
 * One boundary evidence anchor, served verbatim from the edge that violated the
 * rule (GraphEdge["evidence"] entries). Re-declared here because the app cannot
 * import @tadori/* — same idiom as reviewDiffApi's ReviewDiffEvidence.
 */
export interface BoundaryEvidence {
  file: string;
  line: number;
  contains?: string;
  [key: string]: unknown;
}

/**
 * One detected boundary violation (09-03), served verbatim by
 * GET /api/v1/boundaries. `src`/`dst` are `file:<normalizedPath>` identities
 * (NOT entityKeys) — the path after the `file:` prefix is the violating file.
 */
export interface BoundaryViolation {
  ruleId: string;
  src: string;
  edgeRelation: "imports" | "calls";
  dst: string;
  severity: BoundarySeverity;
  evidence: BoundaryEvidence[];
}

/** The GET /api/v1/boundaries body (BoundariesDto). */
export interface BoundariesResponse {
  /** True when a repository-root tadori.rules.json was found and parsed. */
  rulesPresent: boolean;
  violations: BoundaryViolation[];
}

/** Strip the `file:` prefix from a violation endpoint to get the repo-relative path. */
export function violationFilePath(endpoint: string): string {
  return endpoint.startsWith("file:") ? endpoint.slice("file:".length) : endpoint;
}

/**
 * Fetch boundary violations for the active snapshot. A missing rules file is NOT
 * an error — the server returns `{ rulesPresent: false, violations: [] }`. A
 * malformed rules file is a 400 (`bad_rules`); we surface it as a thrown Error so
 * the UI shows an honest "rules file is broken" state rather than a silent empty
 * result that would hide a broken boundary policy.
 */
export async function fetchBoundaries(): Promise<BoundariesResponse> {
  const response = await fetch(`${API_BASE}/boundaries`);
  if (!response.ok) {
    let message = `boundaries failed: ${response.status}`;
    try {
      const body: unknown = await response.json();
      if (body !== null && typeof body === "object") {
        const rec = body as Record<string, unknown>;
        if (typeof rec.error === "string") {
          message = rec.error;
        }
      }
    } catch {
      // Non-JSON error body: keep the status-based message.
    }
    throw new Error(message);
  }
  return (await response.json()) as BoundariesResponse;
}
