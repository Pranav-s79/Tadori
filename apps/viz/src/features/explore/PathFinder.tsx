import { useState, type FormEvent, type ReactElement } from "react";
import { fetchPath, type PathResult } from "./exploreApi.ts";

interface PathFinderProps {
  /** Open an entity in the existing inspection panel. */
  onInspect?: (entityKey: string) => void;
}

type PathState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "found"; result: PathResult }
  | { status: "no_path" }
  | { status: "unresolved" }
  | { status: "error"; message: string };

/**
 * Path display: resolve a `from`/`to` pair and render the single BFS path the
 * server returns. Honest about the four distinct outcomes — a path was found,
 * no path exists between resolvable nodes, a reference did not resolve to any
 * node, or the request failed — rather than collapsing them into one "no
 * result" state. (The server's narrow /path shape yields one path, not the
 * multi-path/nearest-approach mcp-tool output; see exploreApi.)
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
      if (result === "unresolved") {
        setState({ status: "unresolved" });
      } else if (result.found) {
        setState({ status: "found", result });
      } else {
        setState({ status: "no_path" });
      }
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="explore-path" aria-label="Path finder">
      <form onSubmit={(e) => void onSubmit(e)}>
        <label>
          From
          <input
            type="text"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="entity key or name"
          />
        </label>
        <label>
          To
          <input
            type="text"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="entity key or name"
          />
        </label>
        <button type="submit" disabled={state.status === "loading"}>
          Find path
        </button>
      </form>

      {state.status === "loading" && <p role="status">Searching…</p>}
      {state.status === "unresolved" && (
        <p role="status" className="explore-path-unresolved">
          One or both endpoints did not resolve to a node. Check the entity key or name.
        </p>
      )}
      {state.status === "no_path" && (
        <p role="status" className="explore-path-none">
          No path found between these two entities (within the search depth).
        </p>
      )}
      {state.status === "error" && (
        <p role="alert" className="explore-path-error">{`Path search failed: ${state.message}`}</p>
      )}
      {state.status === "found" && (
        <ol className="explore-path-steps" aria-label="Path steps">
          {state.result.nodes.map((node, index) => {
            const edge = index > 0 ? state.result.edges[index - 1] : null;
            return (
              <li key={node.entityKey}>
                {edge !== null && edge !== undefined && (
                  <span className="explore-path-relation" aria-hidden="true">{`—${edge.relation}→`}</span>
                )}
                <button type="button" onClick={() => onInspect?.(node.entityKey)}>
                  {node.displayName}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
