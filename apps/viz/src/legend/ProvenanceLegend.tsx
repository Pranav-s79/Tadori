import type { Confidence, Origin, Resolution } from "../api/types.ts";
import { edgeVisualStyle } from "../legend.ts";

interface LegendRow {
  label: string;
  origin: Origin;
  confidence: Confidence;
  resolution: Resolution;
}

// One representative combo per visually distinct outcome. Each row calls
// the SAME edgeVisualStyle used by PackageMapCanvas.tsx — there is no
// second dash/muted mapping here.
const ROWS: LegendRow[] = [
  { label: "Solid — certain, resolved", origin: "compiler", confidence: "certain", resolution: "resolved" },
  { label: "Dashed — likely, resolved", origin: "compiler", confidence: "likely", resolution: "resolved" },
  { label: "Dotted — inferred or unresolved", origin: "heuristic", confidence: "inferred", resolution: "resolved" },
  { label: "Muted — doc origin", origin: "doc", confidence: "certain", resolution: "resolved" },
  { label: "Muted — git origin", origin: "git", confidence: "certain", resolution: "resolved" }
];

function dashArrayToCss(dash: number[] | null): string {
  return dash === null ? "none" : dash.join(",");
}

export function ProvenanceLegend() {
  return (
    <ul className="provenance-legend" aria-label="Edge provenance legend">
      {ROWS.map((row) => {
        const style = edgeVisualStyle(row.origin, row.confidence, row.resolution);
        return (
          <li key={row.label}>
            <svg width="32" height="8" aria-hidden="true">
              <line
                x1="0"
                y1="4"
                x2="32"
                y2="4"
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray={dashArrayToCss(style.dash)}
                opacity={style.muted ? 0.4 : 1}
              />
            </svg>
            <span>{row.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
