import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { AnalysisPanel, diagnosticSeveritySummary } from "./features/analysis/AnalysisPanel.tsx";
import { useAnalysis } from "./hooks/useAnalysis.ts";
import { CapabilityPanel } from "./features/analysis/CapabilityPanel.tsx";
import { useCapabilities } from "./hooks/useCapabilities.ts";
import { OverviewPanel } from "./features/overview/OverviewPanel.tsx";
import { InterviewPanel } from "./features/interview/InterviewPanel.tsx";
import { BoundaryBadgeOverlay } from "./features/boundaries/BoundaryBadgeOverlay.tsx";
import { useBoundaries } from "./features/boundaries/useBoundaries.ts";
import { InspectionPanel } from "./features/inspect/InspectionPanel.tsx";
import { useInspectionStore } from "./features/inspect/useInspectionStore.ts";
import { ExploreTabs } from "./features/explore/ExploreTabs.tsx";
import { StoryView, type StoryPlaybackState } from "./features/story/StoryView.tsx";
import { AccessibleGraphTable } from "./features/a11y/AccessibleGraphTable.tsx";
import { DiffBadgeOverlay } from "./features/review/DiffBadgeOverlay.tsx";
import { ObservationOverlayBadges } from "./features/review/ObservationOverlayBadges.tsx";
import { ReviewDiffView } from "./features/review/ReviewDiffView.tsx";
import { useReviewDiffStore } from "./features/review/useReviewDiffStore.ts";
import { SearchPanel } from "./features/search/SearchPanel.tsx";
import { fetchSearch } from "./features/search/searchApi.ts";
import { defaultFilters, type SearchFilters } from "./features/search/filterState.ts";
import { PackageMapCanvas, type RenderedGraphSnapshot, type StoryMapEmphasis, type ViewportPosition } from "./graph/PackageMapCanvas.tsx";
import { usePackageGraph } from "./hooks/usePackageGraph.ts";
import { useRegions } from "./hooks/useRegions.ts";
import { useRoutes } from "./hooks/useRoutes.ts";
import { useCoupling } from "./hooks/useCoupling.ts";
import { useRefreshStatus } from "./hooks/useRefreshStatus.ts";
import { useSnapshot } from "./hooks/useSnapshot.ts";
import { ProvenanceLegend } from "./legend/ProvenanceLegend.tsx";
import { ModeTabs, type WorkspaceMode } from "./shell/ModeTabs.tsx";
import { SpatialProjectionToggle, type SpatialProjection } from "./shell/SpatialProjectionToggle.tsx";
import { LensButton } from "./shell/LensButton.tsx";
import { useNavigationFocus } from "./shell/useNavigationFocus.ts";
import { readUrlState, writeUrlState, type UrlState } from "./shell/urlState.ts";
import { LoadingState, RefreshingBanner, StaleState } from "./states/EmptyLoadingStale.tsx";
import { ReliefStage } from "./graph/relief/ReliefStage.tsx";

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

const NAVIGATION_DRAWER_QUERY = "(max-width: 860px)";
const FORCED_COLORS_QUERY = "(forced-colors: active)";
const EMPTY_VIEWPORT_POSITIONS: ReadonlyMap<string, ViewportPosition> = new Map();

function currentNavigationDrawerMode(): boolean {
  return window.matchMedia?.(NAVIGATION_DRAWER_QUERY).matches ?? false;
}

function useNavigationDrawerMode(): boolean {
  const [drawerMode, setDrawerMode] = useState(currentNavigationDrawerMode);
  useEffect(() => {
    const query = window.matchMedia?.(NAVIGATION_DRAWER_QUERY);
    if (query === undefined) return;
    const onChange = (event: MediaQueryListEvent): void => setDrawerMode(event.matches);
    setDrawerMode(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return drawerMode;
}

function useForcedColors(): boolean {
  const [active, setActive] = useState(() => window.matchMedia?.(FORCED_COLORS_QUERY).matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.(FORCED_COLORS_QUERY);
    if (query === undefined) return;
    const onChange = (event: MediaQueryListEvent): void => setActive(event.matches);
    setActive(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return active;
}

function wsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/v1/events`;
}

export function mapStoryPlaybackToGraph(
  playback: StoryPlaybackState | null,
  representativeByEntityKey: ReadonlyMap<string, string>
): StoryMapEmphasis | null {
  if (playback === null) return null;
  const { story, activeStep, activeTransition } = playback;
  const unresolved = activeStep?.entityKey === null && activeTransition?.resolution === "unresolved";
  const rawTarget = unresolved ? activeTransition?.from ?? null : activeStep?.entityKey ?? story.entryPoint;
  if (rawTarget === null) return null;

  const reverseTransitions: Array<{ from: string; to: string; relation: string }> = [];
  const rawPath = [rawTarget];
  const visited = new Set(rawPath);
  let cursor = rawTarget;
  while (cursor !== story.entryPoint) {
    const predecessor = story.transitions.find((transition) =>
      transition.resolved && transition.resolution !== "unresolved" && transition.to === cursor);
    if (predecessor === undefined || predecessor.to === null || visited.has(predecessor.from)) break;
    reverseTransitions.push({ from: predecessor.from, to: predecessor.to, relation: predecessor.relation });
    rawPath.push(predecessor.from);
    visited.add(predecessor.from);
    cursor = predecessor.from;
  }
  rawPath.reverse();
  reverseTransitions.reverse();

  const mappedPath = [...new Set(rawPath.flatMap((key) => {
    const representative = representativeByEntityKey.get(key);
    return representative === undefined ? [] : [representative];
  }))];
  const transitions = reverseTransitions.flatMap((transition) => {
    const fromEntityKey = representativeByEntityKey.get(transition.from);
    const toEntityKey = representativeByEntityKey.get(transition.to);
    return fromEntityKey === undefined || toEntityKey === undefined
      ? []
      : [{ fromEntityKey, toEntityKey, relation: transition.relation }];
  });
  const activeEntityKey = unresolved || activeStep?.entityKey === null || activeStep?.entityKey === undefined
    ? null : representativeByEntityKey.get(activeStep.entityKey) ?? null;
  const unresolvedFromEntityKey = unresolved && activeTransition !== null
    ? representativeByEntityKey.get(activeTransition.from) ?? null : null;
  if (mappedPath.length === 0 && activeEntityKey === null && unresolvedFromEntityKey === null) return null;
  return { pathEntityKeys: mappedPath, transitions, activeEntityKey, unresolvedFromEntityKey };
}

export function App(): ReactElement {
  const { snapshot, loading: snapshotLoading } = useSnapshot();
  const { data, loading: graphLoading, error: graphError, refetch: refetchGraph } = usePackageGraph();
  const regions = useRegions();
  const routes = useRoutes();
  const coupling = useCoupling();
  /** Entity the reader asked to focus that the current map view cannot show. */
  const [focusUnavailable, setFocusUnavailable] = useState<string | null>(null);
  const inspection = useInspectionStore();
  const reviewStore = useReviewDiffStore();
  const boundaries = useBoundaries();
  const analysis = useAnalysis();
  const capabilities = useCapabilities();
  const navigationDrawerMode = useNavigationDrawerMode();
  const forcedColorsActive = useForcedColors();
  // The address bar is the session's memory: a reload or a shared link reopens
  // the same reading. Defaults are captured once so the writer can omit them and
  // an untouched session keeps a clean URL.
  const [defaultUrlState] = useState<UrlState>(() => ({
    // Overview is the landing mode: a reader meeting an unfamiliar repository
    // should get oriented before being handed a graph.
    mode: "overview",
    projection: "plan",
    lenses: { ...DEFAULT_LENSES, boundaries: !currentNavigationDrawerMode() },
    storyEntityKey: null,
    selectedEntityKey: null
  }));
  const [initialUrlState] = useState<UrlState>(
    () => readUrlState(window.location.search, defaultUrlState)
  );
  const [mode, setMode] = useState<WorkspaceMode>(initialUrlState.mode);
  const [spatialProjection, setSpatialProjection] = useState<SpatialProjection>(
    initialUrlState.projection
  );
  const [rendererError, setRendererError] = useState(false);
  const [lenses, setLenses] = useState<LensState>(initialUrlState.lenses);
  const [navigationOpen, setNavigationOpen] = useState(() => !currentNavigationDrawerMode());
  const [storyEntityKey, setStoryEntityKey] = useState<string | null>(
    initialUrlState.storyEntityKey
  );
  const [searchFilters, setSearchFilters] = useState<SearchFilters>(defaultFilters);
  const [focusRequest, setFocusRequest] = useState<{ entityKey: string; requestId: number } | null>(null);
  const [renderedGraph, setRenderedGraph] = useState<RenderedGraphSnapshot | null>(null);
  const [viewportPositions, setViewportPositions] = useState<ReadonlyMap<string, ViewportPosition>>(EMPTY_VIEWPORT_POSITIONS);
  const [storyPlayback, setStoryPlayback] = useState<StoryPlaybackState | null>(null);
  const closeNavigation = useCallback(() => setNavigationOpen(false), []);
  const navigationFocus = useNavigationFocus(navigationOpen, closeNavigation, navigationDrawerMode);

  useEffect(() => {
    setNavigationOpen(!navigationDrawerMode);
  }, [navigationDrawerMode]);

  useEffect(() => {
    if (forcedColorsActive) setMode("table");
  }, [forcedColorsActive]);

  const inspectionOpenEntity = inspection.openEntity;
  // A `select=` link names an entity; the entity endpoint decides whether it
  // still exists, not the rendered graph. The rendered graph is level-of-detail
  // bounded — the landing view holds a single repository node — so gating the
  // restore on it silently dropped every link to a route, file or symbol. The
  // consumers resolve the key and say plainly when it cannot be found.
  useEffect(() => {
    const linked = initialUrlState.selectedEntityKey;
    if (linked === null) return;
    inspectionOpenEntity({ entityKey: linked, entityType: "node" });
  }, [initialUrlState.selectedEntityKey, inspectionOpenEntity]);

  const inspectedEntityKey = inspection.current?.entityKey ?? null;
  // Asked of the snapshot, not the rendered graph: the landing view holds one
  // repository node, so testing the rendered set would deny a behavior trace to
  // every route until the reader happened to descend to it.
  const inspectedIsRoute = useMemo(
    () => routes.status === "ready" && inspectedEntityKey !== null
      && routes.routes.some(({ node }) => node.entityKey === inspectedEntityKey),
    [routes, inspectedEntityKey]
  );
  useEffect(() => {
    const query = writeUrlState({
      mode,
      projection: spatialProjection,
      lenses,
      storyEntityKey,
      selectedEntityKey: inspectedEntityKey
    }, defaultUrlState);
    const { pathname, search, hash } = window.location;
    if (query === search) return;
    // replaceState, not pushState: these are view adjustments within one page,
    // so Back should leave the app rather than rewind lens toggles one by one.
    window.history.replaceState(null, "", `${pathname}${query}${hash}`);
  }, [mode, spatialProjection, lenses, storyEntityKey, inspectedEntityKey, defaultUrlState]);

  const openInspectionPanel = useCallback(
    (entityKey: string) => inspection.openEntity({ entityKey, entityType: "node" }),
    [inspection]
  );
  const inspectObservationFile = useCallback(async (file: string): Promise<boolean> => {
    const normalize = (value: string): string => value.replaceAll("\\", "/").replace(/^\.\//, "");
    const normalizedFile = normalize(file);
    const result = await fetchSearch(file, defaultFilters(), { limit: 100, offset: 0 }, 0);
    const match = result.rows.find((row) => row.file !== null && normalize(row.file) === normalizedFile);
    if (match === undefined) return false;
    inspection.openEntity({ entityKey: match.entityKey, entityType: "node" });
    return true;
  }, [inspection]);

  // The camera can only reach what the map is drawing, and the map is
  // level-of-detail bounded. A search hit or an Overview entry point usually
  // names something deeper than the current view, so this used to return
  // silently and the reader watched nothing happen. The entity is real and its
  // details are open in the inspector; only the camera move is impossible, and
  // that is what we say.
  const focusEntity = useCallback((entityKey: string) => {
    const representative = data?.representativeByEntityKey.get(entityKey);
    if (representative === undefined) {
      setFocusUnavailable(entityKey);
      return;
    }
    setFocusUnavailable(null);
    setFocusRequest((current) => ({ entityKey: representative, requestId: (current?.requestId ?? 0) + 1 }));
    setMode("atlas");
  }, [data?.representativeByEntityKey]);

  const languageOptions = useMemo(() => [...new Set((data?.nodes ?? []).flatMap((node) => node.aggregateLanguages ?? (node.language === undefined || node.language === null ? [] : [node.language])))].sort(), [data?.nodes]);

  const toggleLens = useCallback((lens: keyof LensState) => {
    setLenses((current) => ({ ...current, [lens]: !current[lens] }));
  }, []);

  const openStory = useCallback((entityKey: string) => {
    setStoryPlayback(null);
    setStoryEntityKey(entityKey);
    setMode("story");
  }, []);

  const refetchBoundaries = boundaries.refetch;
  const refetchRegions = regions.refetch;
  const refetchAnalysis = analysis.refetch;
  // Absent data is never a clean bill of health: unavailable, still loading and
  // "genuinely zero diagnostics" are three distinct states and must read as
  // three distinct sentences.
  const diagnosticsSummary = analysis.error !== null
    ? "Extraction diagnostics unavailable"
    : analysis.data === null
      ? "Loading extraction diagnostics…"
      : diagnosticSeveritySummary(analysis.data.diagnostics.bySeverity) === null
        ? "No extraction diagnostics"
        : `Extraction diagnostics: ${String(diagnosticSeveritySummary(analysis.data.diagnostics.bySeverity))}`;
  const storyMapEmphasis = useMemo(
    () => mapStoryPlaybackToGraph(storyPlayback, data?.representativeByEntityKey ?? new Map()),
    [data?.representativeByEntityKey, storyPlayback]
  );
  const onReconnected = useCallback(() => {
    refetchGraph();
    refetchBoundaries();
    refetchRegions();
    refetchAnalysis();
  }, [refetchGraph, refetchBoundaries, refetchRegions, refetchAnalysis]);
  const refreshStatus = useRefreshStatus(wsUrl(), onReconnected);

  if ((snapshotLoading && snapshot === null) || (graphLoading && data === null)) {
    return <LoadingState />;
  }

  const graphView = data === null ? null : (
    <PackageMapCanvas
      nodes={data.nodes}
      edges={data.edges}
      positions={data.positions}
      filters={searchFilters}
      focusRequest={focusRequest}
      active={mode !== "table" && mode !== "overview" && mode !== "interview"
        && spatialProjection === "plan"}
      onRendererError={() => {
        setRendererError(true);
        setMode("table");
      }}
      onInspect={openInspectionPanel}
      onRenderedGraphChange={setRenderedGraph}
      onViewportPositionsChange={setViewportPositions}
      storyEmphasis={mode === "story" ? storyMapEmphasis : null}
    />
  );
  const isRefreshing = refreshStatus?.phase === "refreshing";
  const showChanges = mode === "changes" || lenses.changes;
  const showBoundaries = lenses.boundaries;
  const visibleNodeCount = renderedGraph?.nodes.length ?? data?.nodes.length;
  const visibleEdgeCount = renderedGraph?.edges.length ?? data?.edges.length;

  const mapSurface = (
    <div className="app-graph-stage" role="region" aria-label="Repository atlas">
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
      ) : (
        <>
          <div className="atlas-plan-layer" hidden={spatialProjection !== "plan"}>
            {isRefreshing ? <RefreshingBanner>{graphView}</RefreshingBanner> : graphView}
          </div>
          {spatialProjection === "relief" && renderedGraph !== null && (
            <ReliefStage
              graph={renderedGraph}
              regions={regions.data}
              regionsLoading={regions.loading}
              regionsError={regions.error}
              filters={searchFilters}
              storyEmphasis={mode === "story" ? storyMapEmphasis : null}
              onInspect={openInspectionPanel}
              onViewportPositionsChange={setViewportPositions}
            />
          )}
          {spatialProjection === "relief" && renderedGraph === null && (
            <p className="bounded-notice" role="status">Preparing the graph-backed relief…</p>
          )}
        </>
      )}
      {showChanges && (
        <DiffBadgeOverlay page={reviewStore.page} positions={viewportPositions} onInspect={openInspectionPanel} />
      )}
      {showBoundaries && (
        <BoundaryBadgeOverlay
          violations={boundaries.data?.violations ?? []}
          nodes={renderedGraph?.nodes ?? []}
          positions={viewportPositions}
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
        <div className="atlas-brand">
          <h1>Tadori</h1>
          <small>Archaeological circuit atlas</small>
        </div>
        <div className="atlas-snapshot" role="group" aria-label="Served snapshot">
          <strong>{snapshot?.repository ?? "Repository"}</strong>
          <span>{snapshot === null ? "No active snapshot" : `#${snapshot.snapshotId} · ${snapshot.snapshotKind}`}</span>
          <span className={`freshness freshness-${snapshot?.freshness ?? "unknown"}`}>
            {snapshot?.freshness ?? "unknown"}
          </span>
          <span className="atlas-diagnostics-summary" role="status" aria-live="polite">
            {diagnosticsSummary}
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
        <ModeTabs
          active={mode}
          onChange={(nextMode) => {
            if (forcedColorsActive && nextMode !== "table") return;
            if (nextMode !== "table") setRendererError(false);
            setMode(nextMode);
          }}
        />
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
          <details className="navigation-section">
            <summary>Analysis and diagnostics</summary>
            <AnalysisPanel analysis={analysis} />
          </details>
          <details className="navigation-section">
            <summary>Declared language support</summary>
            <CapabilityPanel
              capabilities={capabilities}
              observedLanguageIds={(analysis.data?.languages ?? []).map((language) => language.id)}
            />
          </details>
          {lenses.observations && <ObservationOverlayBadges onInspectFile={inspectObservationFile} />}
        </aside>

        <main id="workspace-stage" className="atlas-main" tabIndex={-1}>
          <div className="atlas-context-bar">
            <span>{
              mode === "overview" ? "Repository overview"
                : mode === "interview" ? "Interview preparation"
                : mode === "atlas" ? (spatialProjection === "relief" ? "Repository relief" : "Repository map")
                : mode === "story" ? "Static behavior"
                : mode === "changes" ? "Change review"
                : "Structured graph"
            }</span>
            {mode !== "table" && <SpatialProjectionToggle active={spatialProjection} onChange={setSpatialProjection} />}
            <nav aria-label="Atlas location">
              <ol>
                {(renderedGraph?.breadcrumb ?? ["Repository"]).map((label, index, labels) => (
                  <li key={`${index}:${label}`} aria-current={index === labels.length - 1 ? "location" : undefined}>{label}</li>
                ))}
              </ol>
            </nav>
            <span>{`${renderedGraph?.lodLevel ?? "repository"} level`}</span>
            <span role="status" aria-live="polite" aria-atomic="true">{data === null ? "Graph unavailable" : `Showing ${visibleNodeCount} nodes and ${visibleEdgeCount} relations`}</span>
          </div>

          {focusUnavailable !== null && (
            <p className="focus-unavailable-notice" role="status" aria-live="polite">
              That entity is not shown at this level, so the map cannot move to
              it. Its details are open in the inspector. Expand a package to
              descend toward it.
              <button type="button" onClick={() => { setFocusUnavailable(null); }}>
                Dismiss
              </button>
            </p>
          )}

          <section
            id="workspace-mode-panel"
            className={`mode-panel mode-panel-${mode}`}
            role="tabpanel"
            aria-labelledby={`mode-tab-${mode}`}
          >
            {mode === "overview" && (
              <OverviewPanel
                context={snapshot}
                analysis={analysis.data}
                regions={regions.data}
                capabilities={capabilities.data}
                routes={routes}
                coupling={coupling}
                loading={analysis.loading}
                error={graphError}
                onSelectEntity={(entityKey) => {
                  openInspectionPanel(entityKey);
                  focusEntity(entityKey);
                }}
              />
            )}
            {mode === "interview" && (
              <InterviewPanel
                subjectEntityKey={inspectedEntityKey}
                routes={routes}
                analysis={analysis.data}
                onSelectEntity={openInspectionPanel}
              />
            )}
            <div
              className={`spatial-workspace spatial-workspace-${mode}`}
              hidden={mode === "table" || mode === "overview" || mode === "interview"}
            >
              {mapSurface}
              {mode === "story" && (
                <>
                <StoryView
                  entityKey={storyEntityKey}
                  repoRoot={snapshot?.repository ?? null}
                  onInspect={openInspectionPanel}
                  onPlaybackChange={(playback) => {
                    if (playback !== null) setStoryPlayback(playback);
                  }}
                  onClose={() => {
                    setStoryPlayback(null);
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
                </>
              )}
              {mode === "changes" && (
                <div className="changes-ledger">
                  <ReviewDiffView store={reviewStore} onInspect={openInspectionPanel} />
                </div>
              )}
            </div>
            {mode === "table" && data !== null && (
              <>
                {forcedColorsActive && (
                  <p className="bounded-notice" role="alert">
                    Forced-colors mode is active. Showing the structured graph because every visual state is named in text.
                  </p>
                )}
                {rendererError && (
                  <p className="bounded-notice" role="alert">
                    The repository map renderer is unavailable. Showing the structured graph instead.
                  </p>
                )}
                <AccessibleGraphTable
                  nodes={renderedGraph?.nodes ?? data.nodes}
                  edges={renderedGraph?.edges ?? data.edges}
                  filters={searchFilters}
                  onInspect={openInspectionPanel}
                  // Table is a peer, not a fallback: it receives the same story
                  // emphasis the spatial modes get. Re-testing `mode === "story"`
                  // here is dead — this branch only renders when mode is "table"
                  // — and silently starved the keyboard/AT surface of story state.
                  storyEmphasis={storyMapEmphasis}
                />
              </>
            )}
            {mode === "table" && data === null && (
              <div className="mode-empty-state"><h2>Structured graph unavailable</h2></div>
            )}
          </section>
        </main>

        <div className="atlas-inspector" hidden={inspection.current === null}>
          <InspectionPanel store={inspection} repoRoot={snapshot?.repository ?? null} />
          {inspectedEntityKey !== null && (
            <nav className="inspector-continuations" aria-label="Continue from this entity">
              {/* A story starts at a route. Offering the action on entities that
                  can only be refused would teach the reader to distrust it, so
                  it appears when the graph says it will resolve. */}
              {inspectedIsRoute && (
                <button type="button" onClick={() => { openStory(inspectedEntityKey); }}>
                  Trace execution flow
                </button>
              )}
              <button type="button" onClick={() => { setMode("interview"); }}>
                Prepare interview questions
              </button>
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}
