import { useEffect, useState } from "react";
import type { ApiNode } from "../api/types.ts";
import type { CouplingState } from "../features/overview/overviewModel.ts";

const API_BASE = "/api/v1";
/** Server caps symbol responses; this asks for the cap and takes what it gets. */
const SYMBOL_LIMIT = 1000;

/**
 * Symbol-level nodes for the whole snapshot, ranked elsewhere by fan-in.
 *
 * "What is technically important or fragile?" cannot be answered from the
 * rendered graph: it is level-of-detail bounded to a single repository node at
 * the landing view, whose fan-in is zero. Asking the snapshot is the only way
 * the question has a real answer.
 */
export function useCoupling(): CouplingState {
  const [state, setState] = useState<CouplingState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/nodes?level=symbol&limit=${String(SYMBOL_LIMIT)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`nodes ${String(response.status)}`);
        const body = (await response.json()) as { items?: ApiNode[] };
        if (!cancelled) setState({ status: "ready", nodes: body.items ?? [] });
      })
      .catch(() => { if (!cancelled) setState({ status: "error" }); });
    return () => { cancelled = true; };
  }, []);

  return state;
}
