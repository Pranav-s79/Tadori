import { useEffect, useState, type ReactElement } from "react";
import { fetchDocs, type DocsResult } from "./exploreApi.ts";

interface DocumentsPanelProps {
  onInspect?: (entityKey: string) => void;
}

type DocsState =
  | { status: "loading" }
  | { status: "ready"; result: DocsResult }
  | { status: "error"; message: string };

/**
 * Documents/ADR panel: every `adr`/`doc_section` node with its body. The live
 * /docs endpoint returns `{node, body}` per doc (no `documents`-edge grouping
 * yet), so this lists each doc with its inline body and a pivot into the
 * inspection panel for full evidence — grouping-by-documented-entity is the
 * documented follow-up once the endpoint carries the edges.
 */
export function DocumentsPanel({ onInspect }: DocumentsPanelProps): ReactElement {
  const [state, setState] = useState<DocsState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchDocs()
      .then((result) => {
        if (!cancelled) {
          setState({ status: "ready", result });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return <p role="status">Loading documents…</p>;
  }
  if (state.status === "error") {
    return <p role="alert">{`Documents failed to load: ${state.message}`}</p>;
  }
  if (state.result.docs.length === 0) {
    return <p role="status">No documents or ADRs in this snapshot.</p>;
  }

  // Grounded docs cite at least one entity via a `documents` edge; ungrounded
  // docs cite nothing. Both are shown — an ungrounded doc is never dropped.
  const grounded = state.result.docs.filter((d) => d.documents.length > 0);
  const ungrounded = state.result.docs.filter((d) => d.documents.length === 0);

  return (
    <div className="explore-docs" aria-label="Documents">
      {grounded.length > 0 && (
        <section aria-label="Documents that cite an entity">
          <ul>
            {grounded.map(({ node, body, documents }) => (
              <li key={node.entityKey}>
                <button type="button" onClick={() => onInspect?.(node.entityKey)}>
                  {node.displayName}
                </button>
                {node.file !== null && <span className="explore-docs-file"> {node.file}</span>}
                <span className="explore-docs-grounds">{` — documents ${documents.length} ${documents.length === 1 ? "entity" : "entities"}`}</span>
                {body !== null && <pre className="explore-docs-body">{body}</pre>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {ungrounded.length > 0 && (
        <section aria-label="Documents with no outgoing citation">
          <h4>{`Ungrounded (${ungrounded.length}) — no entity cited`}</h4>
          <ul>
            {ungrounded.map(({ node, body }) => (
              <li key={node.entityKey}>
                <button type="button" onClick={() => onInspect?.(node.entityKey)}>
                  {node.displayName}
                </button>
                {node.file !== null && <span className="explore-docs-file"> {node.file}</span>}
                {body !== null && <pre className="explore-docs-body">{body}</pre>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
