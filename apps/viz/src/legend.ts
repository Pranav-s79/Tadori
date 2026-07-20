import type { Confidence, Origin, Resolution } from "./api/types.ts";

export interface EdgeVisualStyle {
  dash: number[] | null;
  muted: boolean;
}

const DOTTED: number[] = [1, 2];
const DASHED: number[] = [4, 2];

/**
 * Maps edge provenance to a visual style. Precedence (exact, per spec):
 * dotted if the edge is inferred or not fully resolved (that check wins
 * over "likely"); else dashed if confidence is "likely"; else solid.
 * `muted` is a separate, independent flag for doc/git-origin edges.
 */
export function edgeVisualStyle(
  origin: Origin,
  confidence: Confidence,
  resolution: Resolution
): EdgeVisualStyle {
  const muted = origin === "doc" || origin === "git";

  if (confidence === "inferred" || resolution !== "resolved") {
    return { dash: DOTTED, muted };
  }
  if (confidence === "likely") {
    return { dash: DASHED, muted };
  }
  return { dash: null, muted };
}
