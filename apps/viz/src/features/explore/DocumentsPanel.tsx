import { useEffect, useState, type ReactElement } from "react";
import { fetchDocs, type DocsResult } from "./exploreApi.ts";

interface DocumentsPanelProps {
  /** The inspected entity: only docs whose `documents` edges cite it are listed. */
  forEntity: string;
  onInspect?: (entityKey: string) => void;
}

type DocsState =
  | { status: "loading" }
  | { status: "ready"; result: DocsResult }
  | { status: "error"; message: string };

/**
 * The docs and ADRs that cite the inspected entity through a `documents` edge
 * (`/docs?for=`). Each one pivots into the inspector, where its own source
 * slice is the body. An entity nothing cites says so; it is never padded with
 * docs that merely sit nearby.
 */
export function DocumentsPanel({ forEntity, onInspect }: DocumentsPanelProps): ReactElement {
  const [state, setState] = useState<DocsState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchDocs(forEntity)
      .then((result) => {
        if (!cancelled) setState({ status: "ready", result });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [forEntity]);

  return (
    <section className="explore-docs" aria-label="Documents">
      <h4>Documents</h4>
      {state.status === "loading" && <p>Loading documents…</p>}
      {state.status === "error" && <p role="alert">{`Documents failed to load: ${state.message}`}</p>}
      {state.status === "ready" && (state.result.docs.length === 0 ? (
        <p>No document or ADR in this snapshot cites this entity.</p>
      ) : (
        <ul>
          {state.result.docs.map(({ node }) => (
            <li key={node.entityKey}>
              <button type="button" onClick={() => onInspect?.(node.entityKey)}>
                {node.displayName}
              </button>
              {node.file !== null && <span className="explore-docs-file">{node.file}</span>}
            </li>
          ))}
        </ul>
      ))}
    </section>
  );
}
