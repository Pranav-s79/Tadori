import { useCallback, useEffect, useState } from "react";
import { fetchAnalysis } from "../api/client.ts";
import type { SnapshotAnalysisDto } from "../api/types.ts";

export interface UseAnalysisResult {
  data: SnapshotAnalysisDto | null;
  loading: boolean;
  error: Error | null;
  refetch(): void;
}

/**
 * Loads the active snapshot's observed languages and bounded extraction
 * diagnostics without blocking the canonical graph. The response is served
 * facts only — this hook never infers a language's declared support level from
 * what the snapshot happened to observe.
 */
export function useAnalysis(): UseAnalysisResult {
  const [data, setData] = useState<SnapshotAnalysisDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchAnalysis()
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
