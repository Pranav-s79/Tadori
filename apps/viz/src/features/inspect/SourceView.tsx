import type * as React from "react";
import type { SourceSliceResult } from "./inspectApi.ts";

interface SourceViewProps {
  result: SourceSliceResult | null;
  loading: boolean;
}

/** Human-readable notice for each non-displayable source state. */
const STALE_NOTICE: Record<string, string> = {
  outside_repository: "Source is outside the repository root and cannot be shown.",
  not_in_snapshot: "This file is not part of the current snapshot.",
  content_changed: "The file changed since this snapshot — source is suppressed.",
  error: "Could not load source for this entity."
};

/**
 * Renders a root-confined source slice. Body text is shown ONLY when the slice
 * is `ok` AND `staleReason === "matches_snapshot"` AND `body !== null`. Any
 * other state (a stale reason, a null body, or a defensively-malformed response
 * that carries a non-null body with a non-matching staleReason) renders a
 * notice INSTEAD of any body text — a stale file is never shown as if current
 * (objective / completion-proof cut).
 */
export function SourceView({ result, loading }: SourceViewProps): React.ReactElement {
  if (loading) {
    return (
      <section aria-label="Source" className="inspect-source">
        <h4>Source</h4>
        <p>Loading source…</p>
      </section>
    );
  }
  if (result === null) {
    return (
      <section aria-label="Source" className="inspect-source">
        <h4>Source</h4>
        <p>No source available.</p>
      </section>
    );
  }

  let content: React.ReactElement;
  if (result.status !== "ok") {
    content = <p className="inspect-source-notice">{STALE_NOTICE[result.status] ?? "Source unavailable."}</p>;
  } else if (result.slice.staleReason !== "matches_snapshot" || result.slice.body === null) {
    // Defensive: even if a malformed ok-response carried a non-null body with a
    // non-matching staleReason, we never render that body.
    content = (
      <p className="inspect-source-notice">
        The file changed since this snapshot — source is suppressed.
      </p>
    );
  } else {
    content = <pre className="inspect-source-body">{result.slice.body}</pre>;
  }

  return (
    <section aria-label="Source" className="inspect-source">
      <h4>Source</h4>
      {content}
    </section>
  );
}
