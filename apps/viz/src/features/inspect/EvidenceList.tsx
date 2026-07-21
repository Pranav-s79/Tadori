import type * as React from "react";
import { buildDeepLink } from "./deepLink.ts";
import type { Evidence } from "./inspectApi.ts";

interface EvidenceListProps {
  evidence: Evidence[];
  /** Number of anchors the server omitted beyond the returned cap. */
  omittedCount: number;
  /** Absolute repo root for deep-link construction; null disables links. */
  repoRoot: string | null;
}

/**
 * Renders each evidence anchor as file:kind:line-range, with a `vscode://`
 * deep link ONLY when the anchor's path is root-confined (buildDeepLink returns
 * null otherwise → no link element at all, never a dangerous href). When
 * `omittedCount > 0` an explicit "+N more" note is rendered; when 0, no note is
 * rendered (not "+0 more") — honesty non-negotiable: the omitted count is never
 * silently dropped, and never fabricated.
 */
export function EvidenceList({ evidence, omittedCount, repoRoot }: EvidenceListProps): React.ReactElement {
  return (
    <section aria-label="Evidence" className="inspect-evidence">
      <h4>Evidence</h4>
      {evidence.length === 0 ? (
        <p className="inspect-evidence-empty">No evidence anchors.</p>
      ) : (
        <ul>
          {evidence.map((anchor, index) => {
            const range =
              anchor.lineStart === anchor.lineEnd
                ? `${anchor.lineStart}`
                : `${anchor.lineStart}–${anchor.lineEnd}`;
            const label = `${anchor.file} · ${anchor.kind} · line ${range}`;
            const href = repoRoot === null ? null : buildDeepLink(repoRoot, anchor.file, anchor.lineStart);
            return (
              <li key={`${anchor.file}:${anchor.lineStart}:${index}`}>
                {href === null ? (
                  <span>{label}</span>
                ) : (
                  <a href={href}>{label}</a>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {omittedCount > 0 && (
        <p className="inspect-evidence-omitted">{`+${omittedCount} more`}</p>
      )}
    </section>
  );
}
