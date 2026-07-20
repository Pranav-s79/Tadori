import { useCallback, useEffect, useRef, useState } from "react";
import { defaultFilters, type SearchFilters } from "./filterState.ts";
import { fetchSearch, type SearchApiResult } from "./searchApi.ts";

export type SearchStatus = "idle" | "loading" | "ok" | "empty" | "ambiguous_adjacent" | "error";

export interface SearchState {
  query: string;
  filters: SearchFilters;
  results: SearchApiResult | null;
  status: SearchStatus;
  errorMessage: string | null;
}

const DEBOUNCE_MS = 250;
const DEFAULT_PAGE = { limit: 20, offset: 0 } as const;

/**
 * ASSUMPTION (stubbed 08-02 camera-focus + 08-06 panel-open APIs): neither the
 * camera-focus method (08-02's Sigma stage) nor the inspection-panel-open API
 * (08-06) exists in this checkout. `selectResult` calls them through injected
 * callbacks with these expected signatures, so 08-06 can wire the real ones by
 * passing them into `useSearchStore(...)`:
 *   focusEntity(entityKey: string): void        // pan/zoom camera to layout pos
 *   openInspectionPanel(entityKey: string): void // open the one inspection panel
 * When omitted, `selectResult` is a no-op (idle stub) — this blueprint builds
 * neither a real camera animation nor a panel (out of scope, blueprint §5/§6).
 * Reduced-motion is 08-02's camera API concern (blueprint §19), passed through
 * there, not re-implemented here.
 */
export interface SearchStoreCallbacks {
  focusEntity?: (entityKey: string) => void;
  openInspectionPanel?: (entityKey: string) => void;
}

function deriveStatus(result: SearchApiResult): SearchStatus {
  if (result.total === 0) {
    return "empty";
  }
  const [first, second] = result.rows;
  if (result.rows.length >= 2 && first?.exactMatch === true && second?.exactMatch === true) {
    return "ambiguous_adjacent";
  }
  return "ok";
}

export function useSearchStore(callbacks: SearchStoreCallbacks = {}): SearchState & {
  setQuery(q: string): void;
  setFilters(f: SearchFilters): void;
  selectResult(entityKey: string): void;
} {
  const [query, setQueryState] = useState("");
  const [filters, setFiltersState] = useState<SearchFilters>(defaultFilters);
  const [results, setResults] = useState<SearchApiResult | null>(null);
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Monotonic generation guard: only the response whose generation matches the
  // latest issued request is applied — stale/out-of-order responses are
  // discarded so a slower earlier query never overwrites a newer one
  // (blueprint §8/§11 step 3). This is the correctness backstop, independent of
  // any AbortController optimization.
  const generationRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the latest filters readable inside the debounced closure without
  // re-arming the timer on every filter toggle (a filter toggle must NOT issue
  // a search fetch on its own — blueprint §14; it only affects graph rendering
  // and the next query's kind param).
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const runSearch = useCallback((q: string, activeFilters: SearchFilters) => {
    const generation = ++generationRef.current;
    setStatus("loading");
    setErrorMessage(null);
    fetchSearch(q, activeFilters, DEFAULT_PAGE, generation)
      .then((result) => {
        if (result.generation !== generationRef.current) {
          return; // stale response — a newer query supersedes it
        }
        setResults(result);
        setStatus(deriveStatus(result));
      })
      .catch((err: unknown) => {
        if (generation !== generationRef.current) {
          return;
        }
        setStatus("error");
        setErrorMessage(err instanceof Error ? err.message : "Search failed");
      });
  }, []);

  const setQuery = useCallback(
    (q: string) => {
      setQueryState(q);
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (q.trim() === "") {
        // Blank query: never issue a request (matches store toFtsQuery -> null
        // / server 400 empty_query). Bump generation so any in-flight response
        // is discarded, and return to idle.
        generationRef.current += 1;
        setResults(null);
        setStatus("idle");
        setErrorMessage(null);
        return;
      }
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        runSearch(q, filtersRef.current);
      }, DEBOUNCE_MS);
    },
    [runSearch]
  );

  const setFilters = useCallback((f: SearchFilters) => {
    // Render-overlay only: updating filters does NOT re-issue a search here.
    // The kind param takes effect on the NEXT query the user types.
    setFiltersState(f);
  }, []);

  const selectResult = useCallback(
    (entityKey: string) => {
      callbacks.focusEntity?.(entityKey);
      callbacks.openInspectionPanel?.(entityKey);
    },
    [callbacks]
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return { query, filters, results, status, errorMessage, setQuery, setFilters, selectResult };
}
