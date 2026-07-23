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

  return (
    <ul className="explore-docs" aria-label="Documents">
      {state.result.docs.map(({ node, body }) => (
        <li key={node.entityKey}>
          <button type="button" onClick={() => onInspect?.(node.entityKey)}>
            {node.displayName}
          </button>
          {node.file !== null && <span className="explore-docs-file"> {node.file}</span>}
          {body !== null && <pre className="explore-docs-body">{body}</pre>}
        </li>
      ))}
    </ul>
  );
}
