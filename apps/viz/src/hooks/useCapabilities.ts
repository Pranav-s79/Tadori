import { useCallback, useEffect, useState } from "react";
import { fetchCapabilities } from "../api/client.ts";
import type { CapabilityMatrixDto } from "../api/types.ts";

export interface UseCapabilitiesResult {
  data: CapabilityMatrixDto | null;
  loading: boolean;
  error: Error | null;
  refetch(): void;
}

/**
 * Loads the declared product capability contract. This is a static contract
 * bundled with the CLI, not a property of the served snapshot, so it does not
 * refresh on snapshot rotation.
 */
export function useCapabilities(): UseCapabilitiesResult {
  const [data, setData] = useState<CapabilityMatrixDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchCapabilities()
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
