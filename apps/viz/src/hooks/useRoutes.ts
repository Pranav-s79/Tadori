import { useEffect, useState } from "react";
import { fetchRoutes } from "../features/explore/exploreApi.ts";
import type { RoutesState } from "../features/overview/overviewModel.ts";

/**
 * Registered entry points for the whole snapshot.
 *
 * The rendered graph is level-of-detail bounded — the landing view holds a
 * single repository node — so anything that asks "is this a route?" or "does
 * this repository have entry points?" must ask the snapshot, not the view.
 * Deriving either from the rendered node set reports "none" for a repository
 * that plainly has them.
 */
export function useRoutes(): RoutesState {
  const [state, setState] = useState<RoutesState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchRoutes()
      .then((body) => { if (!cancelled) setState({ status: "ready", routes: body.routes }); })
      .catch(() => { if (!cancelled) setState({ status: "error" }); });
    return () => { cancelled = true; };
  }, []);

  return state;
}
