import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { AnalysisPanel, diagnosticSeveritySummary } from "./features/analysis/AnalysisPanel.tsx";
import { useAnalysis } from "./hooks/useAnalysis.ts";
import { CapabilityPanel } from "./features/analysis/CapabilityPanel.tsx";
import { useCapabilities } from "./hooks/useCapabilities.ts";
import { OverviewPanel, OverviewStratum } from "./features/overview/OverviewPanel.tsx";
import { InterviewPanel } from "./features/interview/InterviewPanel.tsx";
import { BoundaryBadgeOverlay } from "./features/boundaries/BoundaryBadgeOverlay.tsx";
import { useBoundaries } from "./features/boundaries/useBoundaries.ts";
import { InspectionPanel } from "./features/inspect/InspectionPanel.tsx";
import { useInspectionStore } from "./features/inspect/useInspectionStore.ts";
import { PathFinder } from "./features/explore/PathFinder.tsx";
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
import { ModeTabs, WORKSPACE_MODES, type WorkspaceMode } from "./shell/ModeTabs.tsx";
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

/** Below this the header keeps only the brand, a search button and a view menu. */
const COMPACT_LAYOUT_QUERY = "(max-width: 860px)";
/** Below this the search field gives way to a search button, to fit the views. */
const COMPACT_SEARCH_QUERY = "(max-width: 1100px)";
const FORCED_COLORS_QUERY = "(forced-colors: active)";
const EMPTY_VIEWPORT_POSITIONS: ReadonlyMap<string, ViewportPosition> = new Map();

function matchesMedia(media: string): boolean {
  return window.matchMedia?.(media).matches ?? false;
}

function useMediaQuery(media: string): boolean {
  const [matches, setMatches] = useState(() => matchesMedia(media));
  useEffect(() => {
    const query = window.matchMedia?.(media);
    if (query === undefined) return;
    const onChange = (event: MediaQueryListEvent): void => setMatches(event.matches);
    setMatches(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [media]);
  return matches;
}

/** "1 nodes and 0 relations" and "1 entities" were the shell's own copy defects. */
function countLabel(count: number | undefined, noun: string, plural = `${noun}s`): string {
  const value = count ?? 0;
  return `${String(value)} ${value === 1 ? noun : plural}`;
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
  const compactLayout = useMediaQuery(COMPACT_LAYOUT_QUERY);
  const compactSearch = useMediaQuery(COMPACT_SEARCH_QUERY);
  const forcedColorsActive = useMediaQuery(FORCED_COLORS_QUERY);
  // The address bar is the session's memory: a reload or a shared link reopens
  // the same reading. Defaults are captured once so the writer can omit them and
  // an untouched session keeps a clean URL.
  const [defaultUrlState] = useState<UrlState>(() => ({
    // Overview is the landing mode: a reader meeting an unfamiliar repository
    // should get oriented before being handed a graph.
    mode: "overview",
    projection: "plan",
    lenses: { ...DEFAULT_LENSES, boundaries: !matchesMedia(COMPACT_LAYOUT_QUERY) },
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
  const [storyEntityKey, setStoryEntityKey] = useState<string | null>(
    initialUrlState.storyEntityKey
  );
  const [searchFilters, setSearchFilters] = useState<SearchFilters>(defaultFilters);
  const [focusRequest, setFocusRequest] = useState<{ entityKey: string; requestId: number } | null>(null);
  const [renderedGraph, setRenderedGraph] = useState<RenderedGraphSnapshot | null>(null);
  const [viewportPositions, setViewportPositions] = useState<ReadonlyMap<string, ViewportPosition>>(EMPTY_VIEWPORT_POSITIONS);
  const [storyPlayback, setStoryPlayback] = useState<StoryPlaybackState | null>(null);
  // On a narrow screen the header keeps only the brand, a search button and a
  // mode menu; each of the last two opens its own panel. On a wide screen both
  // are always shown and these stay false.
  const [searchOpen, setSearchOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const closeModeMenu = useCallback(() => setModeMenuOpen(false), []);
  const searchFocus = useNavigationFocus(searchOpen, closeSearch, compactSearch);
  const modeMenuFocus = useNavigationFocus(modeMenuOpen, closeModeMenu, compactLayout);
  const [pathOpen, setPathOpen] = useState(false);
  const pathToggleRef = useRef<HTMLButtonElement | null>(null);
  const [diagnosticsRequest, setDiagnosticsRequest] = useState(0);

  useEffect(() => {
    setSearchOpen(false);
    setModeMenuOpen(false);
  }, [compactLayout, compactSearch]);

  // A menu closes when the reader presses anywhere else, as a menu does.
  useEffect(() => {
    if (!modeMenuOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (modeMenuFocus.drawerRef.current?.contains(target) === true) return;
      if (modeMenuFocus.toggleRef.current?.contains(target) === true) return;
      setModeMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [modeMenuOpen, modeMenuFocus.drawerRef, modeMenuFocus.toggleRef]);

  // The header's diagnostics chip opens Overview at its diagnostics stratum.
  useEffect(() => {
    if (diagnosticsRequest > 0) document.getElementById("overview-section-diagnostics")?.focus();
  }, [diagnosticsRequest]);

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
  // A path is found from the inspected entity, so a result for one entity is
  // never left standing under another.
  useEffect(() => { setPathOpen(false); }, [inspectedEntityKey]);
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
    ? "Diagnostics unavailable"
    : analysis.data === null
      ? "Loading diagnostics…"
      : diagnosticSeveritySummary(analysis.data.diagnostics.bySeverity) === null
        ? "No diagnostics"
        : `Diagnostics: ${String(diagnosticSeveritySummary(analysis.data.diagnostics.bySeverity))}`;
  const changeMode = useCallback((nextMode: WorkspaceMode) => {
    if (forcedColorsActive && nextMode !== "table") return;
    if (nextMode !== "table") setRendererError(false);
    setMode(nextMode);
  }, [forcedColorsActive]);
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
        && spatialProjection !== "relief"}
      tilt={spatialProjection === "tilt"}
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
  // The toolbar describes a map: Atlas, Story and Changes draw one, and Table
  // lists the same rendered graph. Lenses and the projection belong to the
  // drawn map only.
  const mapChrome = mode !== "overview" && mode !== "interview";
  const drawsMap = mapChrome && mode !== "table";
  const lodLevel = renderedGraph?.lodLevel ?? "repository";
  const graphCount = (
    <span role="status" aria-live="polite" aria-atomic="true" className={mapChrome ? "atlas-count" : "tadori-visually-hidden"}>
      {data === null ? "Graph unavailable" : `Showing ${countLabel(visibleNodeCount, "node")} and ${countLabel(visibleEdgeCount, "relation")}`}
    </span>
  );

  const mapSurface = (
    <div className="app-graph-stage" role="region" aria-label="Repository atlas">
      <div className="atlas-ground" aria-hidden="true" />
      {data?.bounded !== undefined && (data.bounded.omittedNodes > 0 || data.bounded.omittedEdges > 0) && (
        <p className="bounded-notice" role="status">
          {`Bounded package view: ${countLabel(data.bounded.omittedNodes, "node")} and ${countLabel(data.bounded.omittedEdges, "relation")} omitted.`}
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
          <div className="atlas-plan-layer" hidden={spatialProjection === "relief"}>
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
      {/* A five-entry stroke legend rendered over an empty landing map, where
          no edge is drawn, explains nothing and occupies the corner the reader
          needs. It appears once there is a relation to read. */}
      {lenses.provenance && (renderedGraph?.edges.length ?? 0) > 0 && (
        <div className="atlas-legend-cartouche">
          <p>Evidence paths</p>
          <ProvenanceLegend />
        </div>
      )}
      {lenses.observations && <ObservationOverlayBadges onInspectFile={inspectObservationFile} />}
    </div>
  );

  return (
    <div className={`app-shell${inspection.current === null ? "" : " has-inspector"}`}>
      <a className="skip-link" href="#workspace-stage">Skip to repository view</a>
      <header className="atlas-header">
        <div className="atlas-brand">
          <h1>Tadori</h1>
        </div>
        {/* The repository identity was the full absolute path, which consumed
            the header and then truncated mid-token — "C:/Users/…/c--SideProj…"
            — so the one thing the reader needs to know first, which repository
            is loaded, was the one thing they could not read. The name leads;
            the full path stays available on hover. */}
        <div className="atlas-snapshot" role="group" aria-label="Served snapshot">
          <strong title={snapshot?.repository ?? undefined}>
            {snapshot === null
              ? "Repository"
              : /[^/\\]+$/.exec(snapshot.repository)?.[0] ?? snapshot.repository}
          </strong>
          <span className="atlas-snapshot-id">{snapshot === null ? "No active snapshot" : `#${snapshot.snapshotId} · ${snapshot.snapshotKind}`}</span>
          <span className={`freshness freshness-${snapshot?.freshness ?? "unknown"}`}>
            {snapshot?.freshness ?? "unknown"}
          </span>
          {/* A live region as well as a control: the sentence is announced
              when extraction settles, and pressing it opens the full record. */}
          <button
            type="button"
            className="diagnostics-chip"
            aria-live="polite"
            title="Open the extraction diagnostics in Overview"
            onClick={() => {
              changeMode("overview");
              setDiagnosticsRequest((count) => count + 1);
            }}
          >
            {diagnosticsSummary}
          </button>
        </div>
        <div
          ref={searchFocus.drawerRef}
          id="atlas-search"
          className="atlas-search"
          data-open={searchOpen}
          onKeyDown={searchFocus.onDrawerKeyDown}
        >
          <SearchPanel
            openInspectionPanel={openInspectionPanel}
            focusEntity={focusEntity}
            filters={searchFilters}
            onFiltersChange={setSearchFilters}
            languageOptions={languageOptions}
          />
        </div>
        <button
          ref={searchFocus.toggleRef}
          type="button"
          className="header-menu-toggle search-toggle"
          aria-expanded={searchOpen}
          aria-controls="atlas-search"
          onClick={() => setSearchOpen((open) => !open)}
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="7.5" cy="7.5" r="5.5" />
            <path d="M11.5 11.5 16 16" strokeLinecap="round" />
          </svg>
          <span className="tadori-visually-hidden">Search</span>
        </button>
        <button
          ref={modeMenuFocus.toggleRef}
          type="button"
          className="header-menu-toggle mode-menu-toggle"
          aria-expanded={modeMenuOpen}
          aria-controls="mode-menu"
          onClick={() => setModeMenuOpen((open) => !open)}
        >
          <span className="tadori-visually-hidden">View:</span>{" "}
          {WORKSPACE_MODES.find((entry) => entry.id === mode)?.label}
          <span aria-hidden="true" className="mode-menu-caret">▾</span>
        </button>
        {/* Choosing a view closes the narrow-screen menu; arrow keys only move
            within it, since they choose as they go. */}
        <div
          ref={modeMenuFocus.drawerRef}
          id="mode-menu"
          className="mode-menu"
          data-open={modeMenuOpen}
          onKeyDown={modeMenuFocus.onDrawerKeyDown}
          onClick={closeModeMenu}
        >
          <ModeTabs active={mode} onChange={changeMode} />
        </div>
      </header>

      {snapshot?.stale === true && <StaleState staleReason={snapshot.staleReason} />}

      <div className="atlas-workspace">
        <main id="workspace-stage" className="atlas-main" tabIndex={-1}>
          {/* The map's own toolbar. The level is shown only below the
              repository: there it names what the breadcrumb does not, while at
              the top the bar read "Repository" and "Repository level" side by
              side. */}
          {mapChrome && (
            <div className="atlas-context-bar">
              {drawsMap && <SpatialProjectionToggle active={spatialProjection} onChange={setSpatialProjection} />}
              {drawsMap && (
                <div className="lens-group" role="group" aria-label="Map lenses">
                  <LensButton active={lenses.boundaries} label="Boundaries" onClick={() => toggleLens("boundaries")} />
                  {/* Change review always draws its changes; there the lens would be a key that does nothing. */}
                  {mode !== "changes" && <LensButton active={lenses.changes} label="Changes" onClick={() => toggleLens("changes")} />}
                  <LensButton active={lenses.observations} label="Agent review" onClick={() => toggleLens("observations")} />
                  <LensButton active={lenses.provenance} label="Provenance" onClick={() => toggleLens("provenance")} />
                </div>
              )}
              <nav aria-label="Atlas location">
                <ol>
                  {(renderedGraph?.breadcrumb ?? ["Repository"]).map((label, index, labels) => (
                    <li key={`${index}:${label}`} aria-current={index === labels.length - 1 ? "location" : undefined}>{label}</li>
                  ))}
                </ol>
              </nav>
              {lodLevel !== "repository" && <span>{`${lodLevel} level`}</span>}
              {graphCount}
            </div>
          )}
          {/* Off the map the count is not drawn, but it stays in the
              accessibility tree as the live region that announces graph
              refreshes: silencing it in the landing mode would take that
              announcement away from exactly the reader who arrives while
              indexing is still settling. */}
          {!mapChrome && graphCount}

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
              >
                <OverviewStratum
                  id="diagnostics"
                  heading="Analysis and diagnostics"
                  question="What did extraction observe, and what did it record going wrong?"
                >
                  <AnalysisPanel analysis={analysis} />
                </OverviewStratum>
                <OverviewStratum
                  id="capabilities"
                  heading="Declared language support"
                  question="What does this build of Tadori claim to read?"
                >
                  <CapabilityPanel
                    capabilities={capabilities}
                    observedLanguageIds={(analysis.data?.languages ?? []).map((language) => language.id)}
                  />
                </OverviewStratum>
              </OverviewPanel>
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
                <StoryView
                  entityKey={storyEntityKey}
                  repoRoot={snapshot?.repository ?? null}
                  onInspect={openInspectionPanel}
                  onSelectRoute={openStory}
                  onPlaybackChange={(playback) => {
                    if (playback !== null) setStoryPlayback(playback);
                  }}
                  onClose={() => {
                    setStoryPlayback(null);
                    setStoryEntityKey(null);
                    setMode("atlas");
                  }}
                />
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
          <InspectionPanel
            store={inspection}
            repoRoot={snapshot?.repository ?? null}
            actions={inspectedEntityKey !== null && (
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
                {inspection.current?.entityType === "node" && (
                  <button
                    ref={pathToggleRef}
                    type="button"
                    aria-expanded={pathOpen}
                    onClick={() => setPathOpen((open) => !open)}
                  >
                    Find path from here…
                  </button>
                )}
                {pathOpen && (
                  <div
                    className="inspector-path"
                    onKeyDown={(event) => {
                      if (event.key !== "Escape") return;
                      // Closes the path finder only, not the whole inspector.
                      event.stopPropagation();
                      setPathOpen(false);
                      pathToggleRef.current?.focus();
                    }}
                  >
                    <PathFinder from={inspectedEntityKey} onInspect={openInspectionPanel} />
                  </div>
                )}
              </nav>
            )}
          />
        </div>
      </div>
    </div>
  );
}
