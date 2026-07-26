import { useCallback, useMemo, useState, type ReactElement } from "react";
import { BoundaryBadgeOverlay, type BadgePosition as BoundaryBadgePosition } from "./features/boundaries/BoundaryBadgeOverlay.tsx";
import { useBoundaries } from "./features/boundaries/useBoundaries.ts";
import { InspectionPanel } from "./features/inspect/InspectionPanel.tsx";
import { useInspectionStore } from "./features/inspect/useInspectionStore.ts";
import { ExploreTabs } from "./features/explore/ExploreTabs.tsx";
import { StoryView } from "./features/story/StoryView.tsx";
import { AccessibleGraphTable } from "./features/a11y/AccessibleGraphTable.tsx";
import { DiffBadgeOverlay, type BadgePosition } from "./features/review/DiffBadgeOverlay.tsx";
import { ObservationOverlayBadges } from "./features/review/ObservationOverlayBadges.tsx";
import { ReviewDiffView } from "./features/review/ReviewDiffView.tsx";
import { useReviewDiffStore } from "./features/review/useReviewDiffStore.ts";
import { SearchPanel } from "./features/search/SearchPanel.tsx";
import { defaultFilters, type SearchFilters } from "./features/search/filterState.ts";
import { PackageMapCanvas } from "./graph/PackageMapCanvas.tsx";
import { usePackageGraph } from "./hooks/usePackageGraph.ts";
import { useRefreshStatus } from "./hooks/useRefreshStatus.ts";
import { useSnapshot } from "./hooks/useSnapshot.ts";
import { ProvenanceLegend } from "./legend/ProvenanceLegend.tsx";
import { ModeTabs, type WorkspaceMode } from "./shell/ModeTabs.tsx";
import { LensButton } from "./shell/LensButton.tsx";
import { useNavigationFocus } from "./shell/useNavigationFocus.ts";
import { LoadingState, RefreshingBanner, StaleState } from "./states/EmptyLoadingStale.tsx";

interface LensState {
  boundaries: boolean;
  changes: boolean;
  observations: boolean;
  provenance: boolean;
}

const DEFAULT_LENSES: LensState = {
  boundaries: true,
  changes: false,
  observations: false,
  provenance: true
};

function wsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/v1/events`;
}

export function App(): ReactElement {
  const { snapshot, loading: snapshotLoading } = useSnapshot();
  const { data, loading: graphLoading, error: graphError, refetch: refetchGraph } = usePackageGraph();
  const inspection = useInspectionStore();
  const reviewStore = useReviewDiffStore();
  const boundaries = useBoundaries();
  const [mode, setMode] = useState<WorkspaceMode>("atlas");
  const [lenses, setLenses] = useState<LensState>(DEFAULT_LENSES);
  const [navigationOpen, setNavigationOpen] = useState(true);
  const [storyEntityKey, setStoryEntityKey] = useState<string | null>(null);
  const [searchFilters, setSearchFilters] = useState<SearchFilters>(defaultFilters);
  const [focusRequest, setFocusRequest] = useState<{ entityKey: string; requestId: number } | null>(null);
  const closeNavigation = useCallback(() => setNavigationOpen(false), []);
  const navigationFocus = useNavigationFocus(navigationOpen, closeNavigation);

  const openInspectionPanel = useCallback(
    (entityKey: string) => inspection.openEntity({ entityKey, entityType: "node" }),
    [inspection]
  );

  const focusEntity = useCallback((entityKey: string) => {
    const representative = data?.representativeByEntityKey.get(entityKey);
    if (representative === undefined) return;
    setFocusRequest((current) => ({ entityKey: representative, requestId: (current?.requestId ?? 0) + 1 }));
    setMode("atlas");
  }, [data?.representativeByEntityKey]);

  const languageOptions = useMemo(() => [...new Set((data?.nodes ?? []).flatMap((node) => node.aggregateLanguages ?? (node.language === undefined || node.language === null ? [] : [node.language])))].sort(), [data?.nodes]);

  const toggleLens = useCallback((lens: keyof LensState) => {
    setLenses((current) => ({ ...current, [lens]: !current[lens] }));
  }, []);

  const openStory = useCallback((entityKey: string) => {
    setStoryEntityKey(entityKey);
    setMode("story");
  }, []);

  const badgePositions = useMemo<ReadonlyMap<string, BadgePosition>>(() => {
    const map = new Map<string, BadgePosition>();
    for (const position of data?.positions ?? []) {
      map.set(position.entityKey, { x: position.x, y: position.y });
    }
    return map;
  }, [data?.positions]);

  const boundaryPositions = useMemo<ReadonlyMap<string, BoundaryBadgePosition>>(() => {
    const map = new Map<string, BoundaryBadgePosition>();
    for (const position of boundaries.filePositions) {
      map.set(position.entityKey, { x: position.x, y: position.y });
    }
    return map;
  }, [boundaries.filePositions]);

  const refetchBoundaries = boundaries.refetch;
  const onReconnected = useCallback(() => {
    refetchGraph();
    refetchBoundaries();
  }, [refetchGraph, refetchBoundaries]);
  const refreshStatus = useRefreshStatus(wsUrl(), onReconnected);

  if (snapshotLoading || graphLoading) {
    return <LoadingState />;
  }

  const graphView = data === null ? null : (
    <PackageMapCanvas nodes={data.nodes} edges={data.edges} positions={data.positions} filters={searchFilters} focusRequest={focusRequest} />
  );
  const isRefreshing = refreshStatus?.phase === "refreshing";
  const showChanges = mode === "changes" || lenses.changes;
  const showBoundaries = lenses.boundaries;

  const mapSurface = (
    <div className="app-graph-stage" aria-label="Repository atlas">
      <div className="atlas-ground" aria-hidden="true" />
      {data?.bounded !== undefined && (data.bounded.omittedNodes > 0 || data.bounded.omittedEdges > 0) && (
        <p className="bounded-notice" role="status">
          Bounded package view: {data.bounded.omittedNodes} nodes and {data.bounded.omittedEdges} relations omitted.
        </p>
      )}
      {graphError !== null ? (
        <div className="mode-empty-state" role="alert">
          <h2>Repository map unavailable</h2>
          <p>{graphError.message}</p>
          <button type="button" onClick={refetchGraph}>Retry graph</button>
        </div>
      ) : isRefreshing ? (
        <RefreshingBanner>{graphView}</RefreshingBanner>
      ) : (
        graphView
      )}
      {showChanges && (
        <DiffBadgeOverlay page={reviewStore.page} positions={badgePositions} onInspect={openInspectionPanel} />
      )}
      {showBoundaries && (
        <BoundaryBadgeOverlay
          violations={boundaries.data?.violations ?? []}
          nodes={boundaries.fileNodes}
          positions={boundaryPositions}
          rulesPresent={boundaries.data?.rulesPresent ?? false}
          error={boundaries.error}
          onInspect={openInspectionPanel}
        />
      )}
      {lenses.provenance && (
        <div className="atlas-legend-cartouche">
          <p>Evidence paths</p>
          <ProvenanceLegend />
        </div>
      )}
    </div>
  );

  return (
    <div className={`app-shell${inspection.current === null ? "" : " has-inspector"}`}>
      <a className="skip-link" href="#workspace-stage">Skip to repository view</a>
      <header className="atlas-header">
        <div className="atlas-brand" aria-label="Tadori archaeological circuit atlas">
          <h1>Tadori</h1>
          <small>Archaeological circuit atlas</small>
        </div>
        <div className="atlas-snapshot" aria-label="Served snapshot">
          <strong>{snapshot?.repository ?? "Repository"}</strong>
          <span>{snapshot === null ? "No active snapshot" : `#${snapshot.snapshotId} · ${snapshot.snapshotKind}`}</span>
          <span className={`freshness freshness-${snapshot?.freshness ?? "unknown"}`}>
            {snapshot?.freshness ?? "unknown"}
          </span>
        </div>
        <button
          ref={navigationFocus.toggleRef}
          type="button"
          className="navigation-toggle"
          aria-expanded={navigationOpen}
          aria-controls="atlas-navigation"
          onClick={() => setNavigationOpen((open) => !open)}
        >
          Explore
        </button>
        <ModeTabs active={mode} onChange={setMode} />
      </header>

      {snapshot?.stale === true && <StaleState staleReason={snapshot.staleReason} />}

      <div className="atlas-workspace">
        <nav className="lens-rail" aria-label="Map lenses">
          <LensButton active={lenses.boundaries} label="Boundaries" symbol="B" onClick={() => toggleLens("boundaries")} disabledReason={mode === "table" ? "Available in map-based views, not Table mode." : undefined} />
          <LensButton active={lenses.changes} label="Changes" symbol="Δ" onClick={() => toggleLens("changes")} disabledReason={mode === "table" ? "Available in map-based views, not Table mode." : undefined} />
          <LensButton active={lenses.observations} label="Agent review" symbol="A" onClick={() => toggleLens("observations")} />
          <LensButton active={lenses.provenance} label="Provenance" symbol="P" onClick={() => toggleLens("provenance")} disabledReason={mode === "table" ? "Available in map-based views, not Table mode." : undefined} />
        </nav>

        <aside ref={navigationFocus.drawerRef} id="atlas-navigation" className="atlas-navigation" data-open={navigationOpen} aria-label="Repository navigation" aria-hidden={!navigationOpen} inert={!navigationOpen} tabIndex={-1} onKeyDown={navigationFocus.onDrawerKeyDown}>
          <div className="navigation-heading">
            <p>Survey tools</p>
            <span>{data === null ? "No graph" : `${data.nodes.length} sites · ${data.edges.length} paths`}</span>
          </div>
          <details className="navigation-section" open>
            <summary>Search and filter</summary>
            <SearchPanel
              openInspectionPanel={openInspectionPanel}
              focusEntity={focusEntity}
              filters={searchFilters}
              onFiltersChange={setSearchFilters}
              languageOptions={languageOptions}
            />
          </details>
          <details className="navigation-section" open>
            <summary>Explore evidence</summary>
            <ExploreTabs onInspect={openInspectionPanel} onShowStory={openStory} />
          </details>
          {lenses.observations && <ObservationOverlayBadges />}
        </aside>

        <main id="workspace-stage" className="atlas-main" tabIndex={-1}>
          <div className="atlas-context-bar" role="status" aria-live="polite" aria-atomic="true">
            <span>{mode === "atlas" ? "Repository map" : mode === "story" ? "Static behavior" : mode === "changes" ? "Change review" : "Structured graph"}</span>
            <span>{data === null ? "Graph unavailable" : `Showing ${data.nodes.length} nodes and ${data.edges.length} relations`}</span>
          </div>

          <section
            id="workspace-mode-panel"
            className={`mode-panel mode-panel-${mode}`}
            role="tabpanel"
            aria-labelledby={`mode-tab-${mode}`}
          >
            {mode === "atlas" && mapSurface}
            {mode === "story" && (
              <div className="story-workspace">
                <StoryView
                  entityKey={storyEntityKey}
                  onInspect={openInspectionPanel}
                  onClose={() => {
                    setStoryEntityKey(null);
                    setMode("atlas");
                  }}
                />
                {storyEntityKey === null && (
                  <div className="mode-empty-state">
                    <span className="empty-state-mark" aria-hidden="true">◇</span>
                    <h2>Select a registered route</h2>
                    <p>Open Routes under Explore evidence to trace a static, evidence-backed behavior path.</p>
                  </div>
                )}
                {mapSurface}
              </div>
            )}
            {mode === "changes" && (
              <div className="changes-workspace">
                {mapSurface}
                <div className="changes-ledger">
                  <ReviewDiffView store={reviewStore} onInspect={openInspectionPanel} />
                </div>
              </div>
            )}
            {mode === "table" && data !== null && (
              <AccessibleGraphTable nodes={data.nodes} edges={data.edges} filters={searchFilters} onInspect={openInspectionPanel} />
            )}
            {mode === "table" && data === null && (
              <div className="mode-empty-state"><h2>Structured graph unavailable</h2></div>
            )}
          </section>
        </main>

        <div className="atlas-inspector" hidden={inspection.current === null}>
          <InspectionPanel store={inspection} repoRoot={null} />
        </div>
      </div>
    </div>
  );
}
