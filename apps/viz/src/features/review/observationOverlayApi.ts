const API_BASE = "/api/v1";

/**
 * One file's agent-change overlay (09-05), mirrored from the server
 * FileObservationOverlay. Re-declared here because the app cannot import
 * @tadori/* (same idiom as reviewDiffApi). Every flag is exactly what the
 * server's observation/diff data supports — never an inference.
 */
export interface FileObservationOverlay {
  file: string;
  planned: boolean;
  retrieved: boolean;
  modifiedObserved: boolean;
  modifiedActual: boolean;
  modifiedButNotRetrieved: boolean;
  plannedNotModified: boolean;
  modifiedNotPlanned: boolean;
}

export interface ReviewObservationsOverlay {
  taskPresent: boolean;
  files: FileObservationOverlay[];
}

/**
 * Fetch the agent-change review overlay. Read-only; the server scopes it to the
 * current serve task (no client-supplied scope). A non-2xx is surfaced as a
 * thrown Error so the caller can show an honest failure rather than a blank
 * overlay that would hide a broken correlation.
 */
export async function fetchObservationOverlay(): Promise<ReviewObservationsOverlay> {
  const response = await fetch(`${API_BASE}/review/observations-overlay`);
  if (!response.ok) {
    throw new Error(`observations overlay failed: ${response.status}`);
  }
  return (await response.json()) as ReviewObservationsOverlay;
}
