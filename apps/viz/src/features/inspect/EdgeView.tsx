import type * as React from "react";
import { EvidenceList } from "./EvidenceList.tsx";
import type { ToolEdge } from "./inspectApi.ts";

interface EdgeViewProps {
  edge: ToolEdge;
  repoRoot: string | null;
  /** Pivot the panel to the src or dst endpoint node. */
  onPivot(entityKey: string, entityType: "node" | "edge"): void;
}

/**
 * Edge inspection view. The provenance triple (origin, confidence, resolution)
 * comes from the non-optional `ToolEdge` fields, so an edge can never render
 * without all three badges (completion-proof cut). Src/dst are clickable to
 * pivot the panel to that endpoint node. Evidence + freshness are shown as for
 * nodes.
 */
export function EdgeView({ edge, repoRoot, onPivot }: EdgeViewProps): React.ReactElement {
  return (
    <div className="inspect-edge">
      <header>
        <h3>{edge.relation}</h3>
        <ul className="inspect-badges" aria-label="Provenance">
          <li className="badge badge-origin">{`origin: ${edge.origin}`}</li>
          <li className="badge badge-confidence">{`confidence: ${edge.confidence}`}</li>
          <li className="badge badge-resolution">{`resolution: ${edge.resolution}`}</li>
        </ul>
        <dl className="inspect-meta">
          <div>
            <dt>From</dt>
            <dd>
              <button type="button" onClick={() => onPivot(edge.srcEntityKey, "node")}>
                {edge.srcQualifiedName}
              </button>
            </dd>
          </div>
          <div>
            <dt>To</dt>
            <dd>
              <button type="button" onClick={() => onPivot(edge.dstEntityKey, "node")}>
                {edge.dstQualifiedName}
              </button>
            </dd>
          </div>
          <div>
            <dt>Freshness</dt>
            <dd>{edge.stale ? `stale (${edge.staleReason ?? "unknown"})` : edge.freshness}</dd>
          </div>
        </dl>
      </header>

      <EvidenceList evidence={edge.evidence} omittedCount={edge.evidenceOmittedCount} repoRoot={repoRoot} />
    </div>
  );
}
