import type { ReactNode } from "react";

export function LoadingState() {
  return <div role="status">Loading package map…</div>;
}

export function StaleState({ staleReason }: { staleReason: string | null }) {
  return (
    <div role="status">
      Data may be out of date: {staleReason ?? "unknown reason"}
    </div>
  );
}

/**
 * Renders a "refreshing" banner ABOVE whatever last-known-good content the
 * caller passes as `children` — the graph underneath stays mounted and
 * visible while a refresh is in flight, it is never replaced by a loading
 * placeholder.
 */
export function RefreshingBanner({ children }: { children: ReactNode }) {
  return (
    <div>
      <div role="status">Refreshing…</div>
      {children}
    </div>
  );
}
