import { useState, type FormEvent, type ReactElement } from "react";
import { fetchPath, type ExploreNode, type PathResult } from "./exploreApi.ts";

interface PathFinderProps {
  /** Open an entity in the existing inspection panel. */
  onInspect?: (entityKey: string) => void;
}

type PathState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; result: PathResult }
  | { status: "error"; message: string };

/**
 * Path display: resolve a `from`/`to` pair and render the full path-tool result.
 * The result's own `status` drives distinct honest UI: `ok` shows the found
 * path(s); `no_path` shows the nearestApproach proximity hint (never rendered
 * next to real paths); `ambiguous` lists the endpoint candidates to pick from;
 * `not_found` says the reference resolved to nothing; `search_limit` says the
 * search stopped at a safety limit. This runs the same path tool the MCP agent
 * sees (structural parity), so the visual answer never disagrees with the tool.
 */
export function PathFinder({ onInspect }: PathFinderProps): ReactElement {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [state, setState] = useState<PathState>({ status: "idle" });

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (from.trim().length === 0 || to.trim().length === 0) {
      return;
    }
    setState({ status: "loading" });
    try {
      const result = await fetchPath(from.trim(), to.trim());
      setState({ status: "ready", result });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  function renderNodeButton(node: ExploreNode): ReactElement {
    return (
      <button type="button" onClick={() => onInspect?.(node.entityKey)}>
        {node.displayName}
      </button>
    );
  }

  return (
    <div className="explore-path" aria-label="Path finder">
      <form onSubmit={(e) => void onSubmit(e)}>
        <label>
          From
          <input type="text" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="entity key or name" />
        </label>
        <label>
          To
          <input type="text" value={to} onChange={(e) => setTo(e.target.value)} placeholder="entity key or name" />
        </label>
        <button type="submit" disabled={state.status === "loading"}>
          Find path
        </button>
      </form>

      {state.status === "loading" && <p role="status">Searching…</p>}
      {state.status === "error" && (
        <p role="alert" className="explore-path-error">{`Path search failed: ${state.message}`}</p>
      )}
      {state.status === "ready" && (
        <PathResultView result={state.result} onInspect={onInspect} renderNodeButton={renderNodeButton} />
      )}
    </div>
  );
}

function PathResultView({
  result,
  onInspect,
  renderNodeButton
}: {
  result: PathResult;
  onInspect?: (entityKey: string) => void;
  renderNodeButton: (node: ExploreNode) => ReactElement;
}): ReactElement {
  if (result.status === "not_found") {
    return (
      <p role="status" className="explore-path-notfound">{`No entity matched: ${result.message}`}</p>
    );
  }
  if (result.status === "ambiguous") {
    return (
      <div role="status" className="explore-path-ambiguous">
        <p>{`Ambiguous endpoint — pick a specific entity: ${result.message}`}</p>
        <ul>
          {[...result.fromCandidates, ...result.toCandidates].map((node) => (
            <li key={node.entityKey}>
              <button type="button" onClick={() => onInspect?.(node.entityKey)}>
                {node.qualifiedName}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (result.status === "search_limit") {
    return (
      <p role="status" className="explore-path-limit">
        Search stopped at a safety limit — narrow the query (fewer relations, smaller k).
      </p>
    );
  }
  if (result.status === "no_path" || result.paths.length === 0) {
    // nearestApproach is populated ONLY when no path was found — a best-effort
    // proximity hint, explicitly labelled as NOT a path.
    return (
      <div role="status" className="explore-path-none">
        <p>No path found between these two entities.</p>
        {result.nearestApproach.length > 0 && (
          <div className="explore-path-nearest">
            <p>Nearest the search could get (not a path):</p>
            <ul>
              {result.nearestApproach.map((node) => (
                <li key={node.entityKey}>{renderNodeButton(node)}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }
  // status === "ok": render each found path as an ordered node/edge sequence.
  return (
    <div className="explore-path-results" aria-label="Found paths">
      {result.paths.map((sequence, pathIndex) => (
        <ol key={`path-${pathIndex}`} className="explore-path-steps" aria-label={`Path ${pathIndex + 1}`}>
          {sequence.nodes.map((node, index) => {
            const edge = index > 0 ? sequence.edges[index - 1] : null;
            return (
              <li key={node.entityKey}>
                {edge !== null && edge !== undefined && (
                  <span className="explore-path-relation" aria-hidden="true">{`—${edge.relation}→`}</span>
                )}
                {renderNodeButton(node)}
              </li>
            );
          })}
        </ol>
      ))}
    </div>
  );
}
