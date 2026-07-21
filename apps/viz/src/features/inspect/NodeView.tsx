import { useEffect, useState, type ReactElement } from "react";
import { EvidenceList } from "./EvidenceList.tsx";
import {
  fetchLinkedDoc,
  fetchNodeDetail,
  fetchSource,
  type LinkedDoc,
  type NodeDetailResult,
  type SourceSliceResult
} from "./inspectApi.ts";
import { SourceView } from "./SourceView.tsx";

/** The exact frozen fallback string; rendered verbatim when no ADR resolves. */
export const NO_DECISION_FALLBACK = "No documented design decision found.";

interface NodeViewProps {
  entityKey: string;
  repoRoot: string | null;
  /** Pivot to inspect an edge endpoint / linked entity. */
  onPivot(entityKey: string, entityType: "node" | "edge"): void;
}

/**
 * Node inspection view: header (kind, names, file:line, freshness badge,
 * fan-in), evidence list, root-confined source slice, and a single ADR/design-
 * rationale body — or the exact {@link NO_DECISION_FALLBACK} string when the
 * entity has no single resolved doc link. Renders defined non-crashing states
 * for the 404/409 node-detail cases.
 */
export function NodeView({ entityKey, repoRoot, onPivot }: NodeViewProps): ReactElement {
  const [detail, setDetail] = useState<NodeDetailResult | null>(null);
  const [source, setSource] = useState<SourceSliceResult | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [doc, setDoc] = useState<LinkedDoc | null>(null);

  useEffect(() => {
    let live = true;
    setDetail(null);
    setSource(null);
    setDoc(null);
    void fetchNodeDetail(entityKey).then((res) => {
      if (!live) {
        return;
      }
      setDetail(res);
      if (res.status === "ok" && res.node.file !== null) {
        setSourceLoading(true);
        void fetchSource(res.node.file, res.node.lineStart, res.node.lineEnd).then((s) => {
          if (live) {
            setSource(s);
            setSourceLoading(false);
          }
        });
      }
    });
    void fetchLinkedDoc(entityKey).then((d) => {
      if (live) {
        setDoc(d);
      }
    });
    return () => {
      live = false;
    };
  }, [entityKey]);

  if (detail === null) {
    return <p>Loading…</p>;
  }
  if (detail.status === "not_found") {
    return <p role="alert">This entity is not in the current snapshot.</p>;
  }
  if (detail.status === "ambiguous") {
    return <p role="alert">This identifier matches multiple entities — select a specific one.</p>;
  }
  if (detail.status === "error") {
    return <p role="alert">{`Could not load this entity: ${detail.message}`}</p>;
  }

  const node = detail.node;
  const location = node.file === null ? "no file" : `${node.file}${node.lineStart === null ? "" : `:${node.lineStart}`}`;

  return (
    <div className="inspect-node">
      <header>
        <h3>{node.displayName}</h3>
        <dl className="inspect-meta">
          <div><dt>Kind</dt><dd>{node.kind}</dd></div>
          <div><dt>Qualified name</dt><dd>{node.qualifiedName}</dd></div>
          <div><dt>Location</dt><dd>{location}</dd></div>
          <div><dt>Exported</dt><dd>{node.exported ? "yes" : "no"}</dd></div>
          <div><dt>Fan-in</dt><dd>{node.fanIn}</dd></div>
          <div><dt>Freshness</dt><dd>{node.stale ? `stale (${node.staleReason ?? "unknown"})` : node.freshness}</dd></div>
        </dl>
      </header>

      <EvidenceList evidence={node.evidence} omittedCount={node.evidenceOmittedCount} repoRoot={repoRoot} />

      <SourceView result={source} loading={sourceLoading} />

      <section aria-label="Design rationale" className="inspect-rationale">
        <h4>Design rationale</h4>
        {doc === null || doc.body === null ? (
          <p>{NO_DECISION_FALLBACK}</p>
        ) : (
          <article>{doc.body}</article>
        )}
      </section>

      <section aria-label="Connections" className="inspect-connections">
        <h4>Connections</h4>
        <p>{`${node.outEdges.length} outgoing · ${node.inEdges.length} incoming`}</p>
        <ul>
          {node.outEdges.slice(0, 20).map((edge) => (
            <li key={edge.entityKey}>
              <button type="button" onClick={() => onPivot(edge.entityKey, "edge")}>
                {`${edge.relation} → ${edge.dstQualifiedName}`}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
