import { useCallback } from "react";
import { PackageMapCanvas } from "./graph/PackageMapCanvas.tsx";
import { usePackageGraph } from "./hooks/usePackageGraph.ts";
import { useRefreshStatus } from "./hooks/useRefreshStatus.ts";
import { useSnapshot } from "./hooks/useSnapshot.ts";
import { ProvenanceLegend } from "./legend/ProvenanceLegend.tsx";
import { LoadingState, RefreshingBanner, StaleState } from "./states/EmptyLoadingStale.tsx";

function wsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/v1/events`;
}

export function App() {
  const { snapshot, loading: snapshotLoading } = useSnapshot();
  const { data, loading: graphLoading, refetch: refetchGraph } = usePackageGraph();

  const onReconnected = useCallback(() => {
    refetchGraph();
  }, [refetchGraph]);
  const refreshStatus = useRefreshStatus(wsUrl(), onReconnected);

  if (snapshotLoading || graphLoading) {
    return <LoadingState />;
  }

  const graphView = data === null ? null : (
    <PackageMapCanvas nodes={data.nodes} edges={data.edges} positions={data.positions} />
  );

  const isRefreshing = refreshStatus?.phase === "refreshing";

  return (
    <div className="app-shell">
      {snapshot?.stale === true && <StaleState staleReason={snapshot.staleReason} />}
      {isRefreshing ? <RefreshingBanner>{graphView}</RefreshingBanner> : graphView}
      <ProvenanceLegend />
    </div>
  );
}
