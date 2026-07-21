import { useCallback } from "react";
import { InspectionPanel } from "./features/inspect/InspectionPanel.tsx";
import { useInspectionStore } from "./features/inspect/useInspectionStore.ts";
import { SearchPanel } from "./features/search/SearchPanel.tsx";
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
  const inspection = useInspectionStore();

  const openInspectionPanel = useCallback(
    (entityKey: string) => {
      inspection.openEntity({ entityKey, entityType: "node" });
    },
    [inspection]
  );

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
      {/* Search results now open the 08-06 inspection panel. focusEntity (camera
          pan/zoom) is still 08-02's surface and remains a no-op until wired.
          ASSUMPTION: no absolute repo root is exposed client-side (snapshot has
          only the repository name), so deep links are disabled (repoRoot=null)
          until a root is surfaced by the server context. */}
      <SearchPanel openInspectionPanel={openInspectionPanel} />
      {isRefreshing ? <RefreshingBanner>{graphView}</RefreshingBanner> : graphView}
      <ProvenanceLegend />
      <InspectionPanel store={inspection} repoRoot={null} />
    </div>
  );
}
