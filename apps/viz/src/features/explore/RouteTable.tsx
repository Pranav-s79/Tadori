import { useEffect, useState, type ReactElement } from "react";
import { fetchRoutes, type ExploreNode } from "./exploreApi.ts";
import { deriveMethodLabel } from "./routeLabels.ts";

interface RouteTableProps {
  onInspect?: (entityKey: string) => void;
  /** Open the behavior story for a route (routes are the story trigger). */
  onShowStory?: (entityKey: string) => void;
}

type RoutesState =
  | { status: "loading" }
  | { status: "ready"; routes: ExploreNode[] }
  | { status: "error"; message: string };

/**
 * Route table: every `route`-kind node, with a best-effort HTTP method label.
 *
 * Path-source honesty note: the live /routes endpoint returns only the route
 * nodes, NOT their `routes_to` edge origin, so this table cannot yet show the
 * direct-vs-derived path-source label the way the blueprint envisions — it says
 * "unavailable from this endpoint" rather than guessing. Wiring the edge origin
 * through /routes is the documented follow-up.
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
        {state.routes.map((route) => (
          <tr key={route.entityKey}>
            <td>{deriveMethodLabel(route)}</td>
            <td>
              <button type="button" onClick={() => onInspect?.(route.entityKey)}>
                {route.displayName}
              </button>
            </td>
            <td>{route.file ?? "—"}</td>
            <td className="explore-routes-source-unavailable">unavailable from this endpoint</td>
            <td>
              <button
                type="button"
                className="explore-routes-story"
                onClick={() => onShowStory?.(route.entityKey)}
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
