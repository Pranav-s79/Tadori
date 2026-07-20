import { useCallback, useEffect, useState } from "react";
import { fetchEdges, fetchLayout, fetchNodes } from "../api/client.ts";
import type { ApiEdge, ApiNode, LayoutPositionDto } from "../api/types.ts";

export interface PackageGraphData {
  nodes: ApiNode[];
  edges: ApiEdge[];
  positions: LayoutPositionDto[];
  layoutVersion: number;
}

export interface UsePackageGraphResult {
  data: PackageGraphData | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Loads the package-level graph: nodes (kind==="package"), the edges
 * between them, and their layout positions. Keeps the previously loaded
 * `data` in place across a refetch so the UI can show "last-known-good"
 * while a refresh is in flight (see states/EmptyLoadingStale.tsx).
 */
export function usePackageGraph(): UsePackageGraphResult {
  const [data, setData] = useState<PackageGraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchNodes({ level: "package" }), fetchEdges(), fetchLayout("package")])
      .then(([nodes, edges, layout]) => {
        if (!cancelled) {
          const packageNodes = nodes.filter((n) => n.kind === "package");
          setData({ nodes: packageNodes, edges, positions: layout.positions, layoutVersion: layout.layoutVersion });
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [generation]);

  const refetch = useCallback(() => setGeneration((g) => g + 1), []);

  return { data, loading, error, refetch };
}
