import { useEffect, useState, type ReactElement } from "react";
import {
  fetchObservationOverlay,
  type FileObservationOverlay,
  type ReviewObservationsOverlay
} from "./observationOverlayApi.ts";

interface ObservationOverlayBadgesProps {
  /** Bump to refetch after a snapshot rotation (same pattern as the diff store). */
  generation?: number;
  onInspectFile?: (file: string) => boolean | Promise<boolean>;
}

type OverlayState =
  | { status: "loading" }
  | { status: "ready"; overlay: ReviewObservationsOverlay }
  | { status: "error"; message: string };

/** The honest risk flags for a file, most-severe first; empty when none apply. */
function riskFlags(f: FileObservationOverlay): string[] {
  const flags: string[] = [];
  if (f.modifiedButNotRetrieved) {
    flags.push("changed without being read");
  }
  if (f.modifiedNotPlanned) {
    flags.push("changed outside the plan");
  }
  if (f.plannedNotModified) {
    flags.push("planned but not changed");
  }
  return flags;
}

/**
 * Agent-change review overlay (09-05): per-file indicators correlating what the
 * agent planned/read/modified with what the diff actually changed. Renders only
 * files carrying a risk flag (blind edit / scope drift) — each flag is exactly
 * what the server's observation+diff data supports, never an inference about
 * intent. Files with no risk are not listed (a clean file needs no callout).
 */
export function ObservationOverlayBadges({
  generation = 0,
  onInspectFile
}: ObservationOverlayBadgesProps): ReactElement | null {
  const [state, setState] = useState<OverlayState>({ status: "loading" });
  const [inspectionError, setInspectionError] = useState<string | null>(null);

  const inspectFile = async (file: string): Promise<void> => {
    if (onInspectFile === undefined) return;
    setInspectionError(null);
    try {
      if (!(await onInspectFile(file))) {
        setInspectionError(`No indexed entity was found for ${file}.`);
      }
    } catch (error: unknown) {
      setInspectionError(
        `Could not inspect ${file}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchObservationOverlay()
      .then((overlay) => {
        if (!cancelled) {
          setState({ status: "ready", overlay });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [generation]);

  if (state.status === "loading") {
    return null;
  }
  if (state.status === "error") {
    return (
      <div className="observation-overlay" role="alert">
        {`Agent-change overlay unavailable: ${state.message}`}
      </div>
    );
  }
  if (!state.overlay.taskPresent) {
    return null; // No agent observations for this session — nothing to overlay.
  }

  const flagged = state.overlay.files
    .map((overlay) => ({ path: overlay.file, flags: riskFlags(overlay) }))
    .filter((row) => row.flags.length > 0);

  return (
    <section className="observation-overlay" aria-label="Agent-change review overlay">
      <h3>Agent-change review</h3>
      {inspectionError !== null && <p role="alert">{inspectionError}</p>}
      {flagged.length === 0 ? (
        <p role="status" className="observation-overlay-clean">
          Every changed file was planned and read before the change.
        </p>
      ) : (
        <ul>
          {flagged.map(({ path, flags }) => (
            <li key={path} className="observation-overlay-file">
              {onInspectFile === undefined ? (
                <span>{path}</span>
              ) : (
                <button type="button" onClick={() => void inspectFile(path)}>{path}</button>
              )}
              {flags.map((flag) => (
                <span key={flag} className="observation-overlay-flag">
                  {flag}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
