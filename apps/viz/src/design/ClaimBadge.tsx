import type { ReactElement } from "react";

/**
 * How a statement in the interface is supported. This is the product's central
 * honesty rule made into a type: every claim the user reads carries one of
 * these, and inferred reasoning is never allowed to look like documented fact.
 *
 * - observed:   directly supported by extracted code or repository evidence
 * - documented: stated in README, comments, ADRs, or other project material
 * - inferred:   a reasoned interpretation, explicitly not established fact
 * - unknown:    not enough evidence to make a responsible claim
 */
export type ClaimBasis = "observed" | "documented" | "inferred" | "unknown";

const LABEL: Readonly<Record<ClaimBasis, string>> = {
  observed: "Observed",
  documented: "Documented",
  inferred: "Inferred",
  unknown: "Unknown"
};

const MEANING: Readonly<Record<ClaimBasis, string>> = {
  observed: "Directly supported by extracted code or repository evidence",
  documented: "Stated in project material such as a README, comment or ADR",
  inferred: "A reasoned interpretation, not something the repository states",
  unknown: "Not enough evidence in this snapshot to make a responsible claim"
};

/**
 * The basis is carried as text and as a `data-basis` hook, never by colour
 * alone, so it survives forced-colors and greyscale. `inferred` and `unknown`
 * read as weaker on purpose: a reader skimming must not mistake either for
 * something the repository actually states.
 */
export function ClaimBadge({ basis }: { basis: ClaimBasis }): ReactElement {
  return (
    <span className="claim-badge" data-basis={basis} title={MEANING[basis]}>
      {LABEL[basis]}
    </span>
  );
}

/** Screen-reader sentence pairing a claim with how it is supported. */
export function claimDescription(basis: ClaimBasis): string {
  return `${LABEL[basis]}: ${MEANING[basis]}`;
}
