import type { ReactElement } from "react";
import { ClaimBadge } from "../../design/ClaimBadge.tsx";
import { buildOverview, type OverviewInput } from "./overviewModel.ts";

export interface OverviewPanelProps extends OverviewInput {
  loading: boolean;
  error: Error | null;
  onSelectEntity(entityKey: string): void;
}

/**
 * The landing workspace: the questions someone studying an unfamiliar
 * repository asks first, answered only from served evidence.
 *
 * The server's own `/overview` reports `available: false`, so this is assembled
 * from endpoints that do carry evidence. Each claim shows how it is supported
 * and what to open to check it, and anything unsupported says so rather than
 * being filled in with a plausible guess.
 */
export function OverviewPanel({
  loading,
  error,
  onSelectEntity,
  ...input
}: OverviewPanelProps): ReactElement {
  if (error !== null) {
    return (
      <div className="mode-empty-state" role="alert">
        <h2>Overview unavailable</h2>
        <p>{error.message}</p>
      </div>
    );
  }
  if (loading && input.context === null) {
    return (
      <div className="mode-empty-state" role="status">
        <h2>Reading the repository…</h2>
        <p>Composing the overview from the served snapshot.</p>
      </div>
    );
  }

  const sections = buildOverview(input);
  return (
    <div className="overview-panel">
      <header className="overview-intro">
        <h2>Understanding this repository</h2>
        <p>
          Every statement below carries how it is supported. Assembled from the
          served snapshot — <code>/api/v1/overview</code> is not implemented, so
          nothing here is a served summary and nothing is inferred silently.
        </p>
      </header>
      {sections.map((section) => (
        <section
          key={section.id}
          className="overview-section"
          aria-labelledby={`overview-${section.id}`}
        >
          <h3 id={`overview-${section.id}`}>{section.heading}</h3>
          <p className="overview-question">{section.question}</p>
          <ul className="overview-claims">
            {section.claims.map((claim, index) => (
              <li key={`${section.id}:${claim.label}:${String(index)}`}>
                <div className="overview-claim-head">
                  {claim.entityKey === undefined ? (
                    <strong>{claim.label}</strong>
                  ) : (
                    <button
                      type="button"
                      className="overview-claim-link"
                      onClick={() => { onSelectEntity(claim.entityKey ?? ""); }}
                    >
                      {claim.label}
                    </button>
                  )}
                  <ClaimBadge basis={claim.basis} />
                </div>
                <p className="overview-claim-value">{claim.value}</p>
                {claim.evidence.length > 0 && (
                  <p className="overview-claim-evidence">
                    Evidence: {claim.evidence.map((item) => <code key={item}>{item}</code>)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
