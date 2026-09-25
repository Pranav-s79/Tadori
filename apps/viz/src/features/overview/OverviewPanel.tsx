import { Children, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { ClaimBadge } from "../../design/ClaimBadge.tsx";
import { buildOverview, type OverviewInput } from "./overviewModel.ts";
import "./overview.css";

export interface OverviewPanelProps extends OverviewInput {
  loading: boolean;
  error: Error | null;
  onSelectEntity(entityKey: string): void;
  /** Further strata, set after the served claims (diagnostics, declared support). */
  children?: ReactNode;
}

interface OverviewStratumProps {
  id: string;
  heading: string;
  question: string;
  children: ReactNode;
}

/**
 * One numbered stratum of the Overview. Focusable so a control elsewhere (the
 * header's diagnostics chip) can bring the reader straight to it.
 */
export function OverviewStratum({ id, heading, question, children }: OverviewStratumProps): ReactElement {
  return (
    <section id={`overview-section-${id}`} className="overview-section" aria-labelledby={`overview-${id}`} tabIndex={-1}>
      <div className="overview-plate orientation-plate">
        <h3 id={`overview-${id}`}>{heading}</h3>
        <p className="overview-question">{question}</p>
        {children}
      </div>
    </section>
  );
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
  children,
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
  const plates = sections.length + Children.toArray(children).length;
  return (
    <div className="overview-panel">
      <header className="overview-intro orientation-intro">
        <div>
          <h2>Understanding this repository</h2>
          <p>
            Every statement below carries how it is supported. Assembled from the
            served snapshot — <code>/api/v1/overview</code> is not implemented, so
            nothing here is a served summary and nothing is inferred silently.
          </p>
        </div>
        {/* The shape of this page: one plate per question, first on top. It
            counts sections and nothing else — no plate is thicker or higher
            because its answer matters more or is more certain. */}
        <div className="orientation-model" aria-hidden="true">
          <div className="orientation-stack">
            {Array.from({ length: plates }, (_, index) => (
              <span key={index} style={{ "--z": plates - 1 - index } as CSSProperties} />
            ))}
          </div>
        </div>
      </header>
      {sections.map((section) => (
        <OverviewStratum key={section.id} id={section.id} heading={section.heading} question={section.question}>
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
        </OverviewStratum>
      ))}
      {children}
    </div>
  );
}
