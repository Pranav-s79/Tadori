import { useEffect, useState, type ReactElement } from "react";
import { fetchRoutes, type RouteRow } from "./exploreApi.ts";
import { deriveMethodLabel, pathSourceLabel } from "./routeLabels.ts";

interface RouteTableProps {
  onInspect?: (entityKey: string) => void;
  /** Open the behavior story for a route (routes are the story trigger). */
  onShowStory?: (entityKey: string) => void;
}

type RoutesState =
  | { status: "loading" }
  | { status: "ready"; routes: RouteRow[] }
  | { status: "error"; message: string };

/**
 * Route table: every `route`-kind node, with a best-effort HTTP method label and
 * its path-source origin — read from the route's `routes_to` edge (compiler =
 * direct/literal path, heuristic = derived). A route with no such edge shows an
 * explicit "no route-registration edge" cell, never a guessed source.
 */
export function RouteTable({ onInspect, onShowStory }: RouteTableProps): ReactElement {
  const [state, setState] = useState<RoutesState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchRoutes()
      .then((body) => {
        if (!cancelled) {
          setState({ status: "ready", routes: body.routes });
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
    return <p role="status">Loading routes…</p>;
  }
  if (state.status === "error") {
    return <p role="alert">{`Routes failed to load: ${state.message}`}</p>;
  }
  if (state.routes.length === 0) {
    return <p role="status">No routes in this snapshot.</p>;
  }

  return (
    <table className="explore-routes" aria-label="Routes">
      <thead>
        <tr>
          <th scope="col">Method</th>
          <th scope="col">Route</th>
          <th scope="col">File</th>
          <th scope="col">Path source</th>
          <th scope="col">Story</th>
        </tr>
      </thead>
      <tbody>
        {state.routes.map(({ node, pathSourceOrigin }) => (
          <tr key={node.entityKey}>
            <td>{deriveMethodLabel(node)}</td>
            <td>
              <button type="button" onClick={() => onInspect?.(node.entityKey)}>
                {node.displayName}
              </button>
            </td>
            <td>{node.file ?? "—"}</td>
            <td>
              {pathSourceOrigin !== null ? (
                pathSourceLabel(pathSourceOrigin)
              ) : (
                <span className="explore-routes-source-none">no route-registration edge</span>
              )}
            </td>
            <td>
              <button
                type="button"
                className="explore-routes-story"
                onClick={() => onShowStory?.(node.entityKey)}
              >
                Story
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
