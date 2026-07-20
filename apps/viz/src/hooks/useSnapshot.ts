import { useCallback, useEffect, useState } from "react";
import { fetchSnapshot } from "../api/client.ts";
import type { ApiContext } from "../api/types.ts";

export interface UseSnapshotResult {
  snapshot: ApiContext | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

/** Loads the active snapshot's context (freshness/staleness/refresh state). */
export function useSnapshot(): UseSnapshotResult {
  const [snapshot, setSnapshot] = useState<ApiContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchSnapshot()
      .then((data) => {
        if (!cancelled) {
          setSnapshot(data);
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

  return { snapshot, loading, error, refetch };
}
