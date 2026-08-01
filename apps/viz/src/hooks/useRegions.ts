import { useCallback, useEffect, useState } from "react";
import { fetchRegions } from "../api/client.ts";
import type { RegionProjectionDto } from "../api/types.ts";

export interface UseRegionsResult {
  data: RegionProjectionDto | null;
  loading: boolean;
  error: Error | null;
  refetch(): void;
}

/** Loads attributed functional regions without blocking the canonical graph. */
export function useRegions(): UseRegionsResult {
  const [data, setData] = useState<RegionProjectionDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchRegions()
      .then((next) => {
        if (cancelled) return;
        setData(next);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason : new Error(String(reason)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [generation]);

  const refetch = useCallback(() => setGeneration((current) => current + 1), []);
  return { data, loading, error, refetch };
}
