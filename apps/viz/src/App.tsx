import { useCallback, useMemo } from "react";
import { InspectionPanel } from "./features/inspect/InspectionPanel.tsx";
import { useInspectionStore } from "./features/inspect/useInspectionStore.ts";
import { DiffBadgeOverlay, type BadgePosition } from "./features/review/DiffBadgeOverlay.tsx";
import { ReviewDiffView } from "./features/review/ReviewDiffView.tsx";
import { useReviewDiffStore } from "./features/review/useReviewDiffStore.ts";
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
  // One review-diff store shared between the list view and the badge overlay so
  // a single kind switch / page load drives both (no duplicate fetch).
  const reviewStore = useReviewDiffStore();

  const openInspectionPanel = useCallback(
    (entityKey: string) => {
      inspection.openEntity({ entityKey, entityType: "node" });
    },
    [inspection]
  );

  // The overlay reuses the EXISTING package-level layout coordinates verbatim
  // (data.positions from usePackageGraph → fetchLayout). No layout is recomputed.
  const badgePositions = useMemo<ReadonlyMap<string, BadgePosition>>(() => {
    const map = new Map<string, BadgePosition>();
    for (const pos of data?.positions ?? []) {
      map.set(pos.entityKey, { x: pos.x, y: pos.y });
    }
    return map;
  }, [data?.positions]);

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
      <div className="app-graph-stage" style={{ position: "relative" }}>
        {isRefreshing ? <RefreshingBanner>{graphView}</RefreshingBanner> : graphView}
        {/* Non-moving diff badges over the existing package layout coordinates —
            zero layout recomputation (positions come from usePackageGraph). */}
        <DiffBadgeOverlay
          page={reviewStore.page}
          positions={badgePositions}
          onInspect={openInspectionPanel}
        />
      </div>
      <ReviewDiffView store={reviewStore} onInspect={openInspectionPanel} />
      <ProvenanceLegend />
      <InspectionPanel store={inspection} repoRoot={null} />
    </div>
  );
}
