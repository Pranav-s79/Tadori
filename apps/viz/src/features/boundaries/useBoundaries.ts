import { useCallback, useEffect, useState } from "react";
import { fetchAllFileLayout, fetchAllFileNodes } from "../../api/client.ts";
import type { ApiNode, LayoutPositionDto } from "../../api/types.ts";
import { fetchBoundaries, type BoundariesResponse } from "./boundariesApi.ts";

export interface UseBoundariesResult {
  data: BoundariesResponse | null;
  /**
   * Repo-wide file nodes, fetched ONLY when there is at least one violation (a
   * clean or rules-less repo pays for no file-graph fetch). Used to resolve a
   * violation's `file:<path>` to a node entityKey. Empty until that fetch lands.
   */
  fileNodes: ApiNode[];
  /** Repo-wide file-level layout positions, fetched alongside `fileNodes`. */
  filePositions: LayoutPositionDto[];
  loading: boolean;
  /** Non-null only when the fetch failed (e.g. a malformed rules file → bad_rules). */
  error: Error | null;
  refetch: () => void;
}

/**
 * Loads boundary violations for the active snapshot from GET /api/v1/boundaries,
 * plus (only when violations exist) the repo-wide file nodes + file-level layout
 * so the overlay can place each violation at its file's deterministic coordinate.
 * Keeps the previously loaded data across a refetch (last-known-good, same as
 * usePackageGraph). `refetch` is bumped by the caller after a snapshot rotation.
 */
export function useBoundaries(): UseBoundariesResult {
  const [data, setData] = useState<BoundariesResponse | null>(null);
  const [fileNodes, setFileNodes] = useState<ApiNode[]>([]);
  const [filePositions, setFilePositions] = useState<LayoutPositionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchBoundaries()
      .then(async (body) => {
        if (cancelled) {
          return;
        }
        setData(body);
        setError(null);
        // Only pay for the file graph when we actually have something to place.
        if (body.violations.length > 0) {
          const [nodes, positions] = await Promise.all([fetchAllFileNodes(), fetchAllFileLayout()]);
          if (!cancelled) {
            setFileNodes(nodes);
            setFilePositions(positions);
          }
        } else if (!cancelled) {
          setFileNodes([]);
          setFilePositions([]);
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

  return { data, fileNodes, filePositions, loading, error, refetch };
}
