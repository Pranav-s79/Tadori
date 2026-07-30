import { useCallback, useEffect, useState } from "react";
import { fetchLayout, fetchPackageEdgesPage, fetchPackageNodesPage, type ProjectionAccounting } from "../api/client.ts";
import type { ApiEdge, ApiNode, LayoutPositionDto } from "../api/types.ts";

export interface PackageGraphData {
  nodes: ApiNode[];
  edges: ApiEdge[];
  positions: LayoutPositionDto[];
  layoutVersion: number;
  representativeByEntityKey: ReadonlyMap<string, string>;
  bounded: {
    nodeTotal: number | null;
    edgeTotal: number | null;
    omittedNodes: number;
    omittedEdges: number;
    projection: ProjectionAccounting | null;
  };
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
    Promise.all([fetchPackageNodesPage(), fetchPackageEdgesPage(), fetchLayout("package")])
      .then(([nodePage, edgePage, layout]) => {
        if (!cancelled) {
          const nodes = nodePage.items;
          const edges = edgePage.items;
          setData({
            nodes,
            edges,
            positions: layout.positions,
            layoutVersion: layout.layoutVersion,
            representativeByEntityKey: new Map(nodes.map((node) => [node.entityKey, node.entityKey])),
            bounded: {
              nodeTotal: nodePage.total,
              edgeTotal: edgePage.total,
              omittedNodes: nodePage.omittedCount,
              omittedEdges: edgePage.omittedCount,
              projection: edgePage.projection ?? nodePage.projection
            }
          });
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
