import type { Database } from "@tadori/store";
import type { FileObservationOverlay, ReviewObservationsOverlayDto } from "./types.js";

/**
 * Agent-change review overlays (09-05): correlate this task's agent observations
 * (planned / retrieved / modified) with the files the review-diff ACTUALLY
 * changed, into honest per-file indicators — most importantly
 * `modifiedButNotRetrieved` (a file was changed without ever being read).
 *
 * Security / SWE contract (see blueprints/09-05):
 *  - Task scoping is the trust boundary: `taskId` is server-owned (never a
 *    client param), so cross-task/cross-repo observations are unreachable.
 *  - Parameterized SQL only — no value is ever interpolated into query text.
 *  - Least data crosses the boundary: only repo-relative paths + typed booleans.
 *    `agent_events.payload_json` (arbitrary agent free-text, a secret/PII
 *    surface) is NEVER read or returned here.
 *  - Read-only and deterministic (output sorted by path).
 */

/**
 * Repo-relative paths of files targeted by agent events of `eventType` in this
 * task, resolved against the served snapshot's file listing. Parameterized;
 * task-scoped. A target whose file is not in the served snapshot is simply
 * absent (no leakage, no error).
 */
function filesForEventType(
  db: Database,
  taskId: number,
  snapshotId: number,
  eventType: string
): Set<string> {
  const rows = db
    .prepare(
      `SELECT DISTINCT sf.normalized_path AS path
         FROM agent_events ae
         JOIN agent_event_targets aet ON aet.event_id = ae.id
         JOIN snapshot_files sf
           ON sf.file_id = aet.file_id AND sf.snapshot_id = ?
        WHERE ae.task_id = ?
          AND ae.event_type = ?
          AND aet.target_kind = 'file'
          AND aet.file_id IS NOT NULL`
    )
    .all(snapshotId, taskId, eventType) as Array<{ path: string }>;
  return new Set(rows.map((r) => r.path));
}

/**
 * Build the review-observations overlay. `changedFiles` is the set of files the
 * review-diff actually changed (distinct `.file` of the diff's added/removed
 * nodes) — computed by the caller from the SAME diff the /review/diff route
 * serves, so the overlay and the diff never disagree. Fails closed: with no
 * observations AND no changed files the result is `{ taskPresent:false, files:[] }`.
 */
export function computeReviewObservationsOverlay(
  db: Database,
  taskId: number,
  snapshotId: number,
  changedFiles: ReadonlySet<string>
): ReviewObservationsOverlayDto {
  const planned = filesForEventType(db, taskId, snapshotId, "plan_mentioned");
  const retrieved = filesForEventType(db, taskId, snapshotId, "file_read_observed");
  const modifiedObserved = filesForEventType(db, taskId, snapshotId, "modified");

  const taskPresent = planned.size + retrieved.size + modifiedObserved.size > 0;

  // Every file that is planned, retrieved, observed-modified, or actually
  // modified appears exactly once — union of all four sets, sorted.
  const allFiles = new Set<string>([...planned, ...retrieved, ...modifiedObserved, ...changedFiles]);

  const files: FileObservationOverlay[] = [...allFiles]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((file) => {
      const isPlanned = planned.has(file);
      const isRetrieved = retrieved.has(file);
      const isModifiedActual = changedFiles.has(file);
      return {
        file,
        planned: isPlanned,
        retrieved: isRetrieved,
        modifiedObserved: modifiedObserved.has(file),
        modifiedActual: isModifiedActual,
        // Derived risk indicators — each is exactly what the data supports.
        modifiedButNotRetrieved: isModifiedActual && !isRetrieved,
        plannedNotModified: isPlanned && !isModifiedActual,
        modifiedNotPlanned: isModifiedActual && !isPlanned
      };
    });

  return { taskPresent, files };
}
