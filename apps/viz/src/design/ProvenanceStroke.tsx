import type { Confidence, Origin, Resolution } from "../api/types.ts";
import { edgeVisualStyle } from "../legend.ts";

function dashArrayToCss(dash: readonly number[] | null): string | undefined {
  return dash === null ? undefined : dash.join(" ");
}

export interface ProvenanceStrokeProps {
  origin: Origin;
  confidence: Confidence;
  resolution: Resolution;
  label?: string;
}

/** Uses the same frozen provenance mapping as the graph and its legend. */
export function ProvenanceStroke({
  origin,
  confidence,
  resolution,
  label
}: ProvenanceStrokeProps) {
  const style = edgeVisualStyle(origin, confidence, resolution);
  const resolutionLabel = resolution === "resolved" ? "resolved" : resolution;
  const accessibleLabel = label ?? `${confidence}, ${resolutionLabel}, ${origin} provenance`;
  return (
    <span className="tadori-provenance-stroke" aria-label={accessibleLabel}>
      <svg width="36" height="12" viewBox="0 0 36 12" aria-hidden="true">
        <line
          x1="1"
          y1="6"
          x2="35"
          y2="6"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray={dashArrayToCss(style.dash)}
          opacity={style.muted ? 0.45 : 1}
        />
      </svg>
      <span>{accessibleLabel}</span>
    </span>
  );
}
