import Graph from "graphology";
import Sigma from "sigma";
import { useEffect, useRef, useState } from "react";
import type { ApiEdge, ApiNode, LayoutPositionDto, NodeKind } from "../api/types.ts";
import { usePackageExpansion } from "../hooks/usePackageExpansion.ts";
import { useFileExpansion } from "../hooks/useFileExpansion.ts";
import { buildGraphologyGraph } from "./buildGraphologyGraph.ts";
import {
  applyCollapse,
  applyExpansion,
  applySymbolCollapse,
  applySymbolExpansion,
  diffExpandedNodes,
  truncate
} from "./expansion.ts";
import { convexHull, type Point } from "./convexHull.ts";
import { defaultFilters, edgeMatchesFilters, nodeMatchesFilters, type SearchFilters } from "../features/search/filterState.ts";
import { ATLAS_NODE_PROGRAMS } from "./AtlasNodeProgram.ts";
import { ATLAS_EDGE_PROGRAMS } from "./ProvenanceEdgeProgram.ts";
import { atlasEdgeVisual, atlasNodeVisual } from "./atlasVisuals.ts";
import { visibleLabelEntityKeys } from "../lod/budgets.ts";

const LABEL_MAX_LENGTH = 24;
const NO_FILTERS = defaultFilters();

interface CameraLike {
  animate(state: Partial<CameraState>, options: { duration: number }): void;
  setState(state: Partial<CameraState>): void;
  getState(): CameraState;
  on?(event: "updated", listener: () => void): void;
  off?(event: "updated", listener: () => void): void;
}

interface RendererWithCamera {
  getCamera(): CameraLike;
  getNodeDisplayData(entityKey: string): { x: number; y: number } | undefined;
}

interface CameraState {
  x: number;
  y: number;
  ratio: number;
  angle: number;
}

interface ViewportProjector extends RendererWithCamera {
  graphToViewport(point: { x: number; y: number }): { x: number; y: number };
}

export interface ViewportPosition {
  x: number;
  y: number;
}

export interface RenderedGraphSnapshot {
  nodes: ApiNode[];
  edges: ApiEdge[];
  positions: LayoutPositionDto[];
  packageKeyByEntityKey: Readonly<Record<string, string>>;
  selectedEntityKey: string | null;
  lodLevel: "repository" | "file" | "symbol";
  breadcrumb: readonly string[];
}

export interface StoryMapTransition {
  fromEntityKey: string;
  toEntityKey: string | null;
  relation: string;
}

export interface StoryMapEmphasis {
  pathEntityKeys: readonly string[];
  transitions: readonly StoryMapTransition[];
  activeEntityKey: string | null;
  unresolvedFromEntityKey: string | null;
}

export interface PackagePlate {
  packageEntityKey: string;
  label: string;
  attribution: "repository-derived package boundary";
  shape: ReturnType<typeof convexHull>;
  labelPosition: ViewportPosition;
}


function apiNode(graph: Graph, graphKey: string): ApiNode {
  const value = graph.getNodeAttribute(graphKey, "apiNode") as ApiNode | undefined;
  if (value === undefined) throw new Error(`Rendered graph node ${JSON.stringify(graphKey)} has no API node backing`);
  return value;
}

export function renderedGraphSnapshot(graph: Graph): RenderedGraphSnapshot {
  const nodeByCanonicalKey = new Map<string, ApiNode>();
  const positionByCanonicalKey = new Map<string, LayoutPositionDto>();
  const packageKeyByEntityKey: Record<string, string> = {};
  const selectedCanonicalKeys = new Set<string>();
  for (const graphKey of graph.nodes().sort()) {
    const node = apiNode(graph, graphKey);
    if (!nodeByCanonicalKey.has(node.entityKey)) {
      nodeByCanonicalKey.set(node.entityKey, { ...node });
      const attrs = graph.getNodeAttributes(graphKey);
      positionByCanonicalKey.set(node.entityKey, {
        entityKey: node.entityKey,
        x: Number(attrs.x),
        y: Number(attrs.y),
        z: Number(attrs.z ?? 0),
        pinned: attrs.pinned === true
      });
      if (node.kind === "package") {
        packageKeyByEntityKey[node.entityKey] = node.entityKey;
      } else {
        const expandedFrom = attrs.expandedFrom;
        const expandedFromFile = attrs.expandedFromFile;
        const packageGraphKey = typeof expandedFrom === "string"
          ? expandedFrom
          : typeof expandedFromFile === "string" && graph.hasNode(expandedFromFile)
            ? graph.getNodeAttribute(expandedFromFile, "expandedFrom")
            : undefined;
        if (typeof packageGraphKey === "string" && graph.hasNode(packageGraphKey)) {
          packageKeyByEntityKey[node.entityKey] = apiNode(graph, packageGraphKey).entityKey;
        }
      }
    }
    if (graph.getNodeAttribute(graphKey, "selected") === true) selectedCanonicalKeys.add(node.entityKey);
  }
  const edgeByCanonicalKey = new Map<string, ApiEdge>();
  for (const graphKey of graph.edges().sort()) {
    const value = graph.getEdgeAttribute(graphKey, "apiEdge") as ApiEdge | undefined;
    if (value === undefined) throw new Error(`Rendered graph edge ${JSON.stringify(graphKey)} has no API edge backing`);
    if (
      !edgeByCanonicalKey.has(value.entityKey)
      && nodeByCanonicalKey.has(value.srcEntityKey)
      && nodeByCanonicalKey.has(value.dstEntityKey)
    ) {
      edgeByCanonicalKey.set(value.entityKey, { ...value });
    }
  }
  const nodes = [...nodeByCanonicalKey.values()].sort((a, b) => a.entityKey.localeCompare(b.entityKey));
  const edges = [...edgeByCanonicalKey.values()].sort((a, b) => a.entityKey.localeCompare(b.entityKey));
  const positions = nodes.flatMap((node) => {
    const position = positionByCanonicalKey.get(node.entityKey);
    return position === undefined ? [] : [position];
  });
  const expandedPackageLabels = graph.nodes()
    .filter((graphKey) => graph.getNodeAttribute(graphKey, "kind") === "package"
      && graph.someNode((_key, attrs) => attrs.expandedFrom === graphKey))
    .map((graphKey) => apiNode(graph, graphKey).displayName)
    .sort();
  const expandedFileLabels = graph.nodes()
    .filter((graphKey) => graph.getNodeAttribute(graphKey, "kind") === "file"
      && graph.someNode((_key, attrs) => attrs.expandedFromFile === graphKey))
    .map((graphKey) => apiNode(graph, graphKey).displayName)
    .sort();
  const summarizeLevel = (labels: readonly string[], plural: string): string | null =>
    labels.length === 0 ? null : labels.length === 1 ? labels[0]! : `${labels.length} ${plural}`;
  const expandedPackage = summarizeLevel(expandedPackageLabels, "packages");
  const expandedFile = summarizeLevel(expandedFileLabels, "files");
  const lodLevel = expandedFile !== null ? "symbol" : expandedPackage !== null ? "file" : "repository";
  return {
    nodes,
    edges,
    positions,
    packageKeyByEntityKey,
    selectedEntityKey: [...selectedCanonicalKeys].sort()[0] ?? null,
    lodLevel,
    breadcrumb: ["Repository", expandedPackage, expandedFile].filter((label): label is string => label !== null)
  };
}

export function graphFocusAnnouncement(graph: Graph, graphKey: string): string | null {
  if (!graph.hasNode(graphKey)) return null;
  const node = apiNode(graph, graphKey);
  const visual = atlasNodeVisual(node, graph.getNodeAttribute(graphKey, "selected") === true);
  return `${node.displayName}. ${node.kind}. ${visual.formLabel}. ${visual.materialLabel}. Capability: ${visual.capabilityLabel}.`;
}

export function projectRenderedNodePositions(
  renderer: Pick<ViewportProjector, "graphToViewport">,
  graph: Graph
): ReadonlyMap<string, ViewportPosition> {
  const positions = new Map<string, ViewportPosition>();
  for (const graphKey of graph.nodes().sort()) {
    const canonicalKey = apiNode(graph, graphKey).entityKey;
    if (positions.has(canonicalKey)) continue;
    const attrs = graph.getNodeAttributes(graphKey);
    const point = renderer.graphToViewport({ x: Number(attrs.x), y: Number(attrs.y) });
    if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
      positions.set(canonicalKey, point);
    }
  }
  return positions;
}

export function projectedPackagePlates(
  renderer: Pick<ViewportProjector, "graphToViewport">,
  graph: Graph
): PackagePlate[] {
  const plates: PackagePlate[] = [];
  for (const packageKey of graph.nodes().sort()) {
    if (graph.getNodeAttribute(packageKey, "kind") !== "package"
      || graph.getNodeAttribute(packageKey, "packageMembershipKnown") !== true) continue;
    const memberPoints = graph.nodes()
      .filter((nodeKey) => graph.getNodeAttribute(nodeKey, "expandedFrom") === packageKey)
      .sort()
      .map((nodeKey) => graph.getNodeAttributes(nodeKey))
      .map((attrs) => renderer.graphToViewport({ x: Number(attrs.x), y: Number(attrs.y) }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (memberPoints.length === 0) continue;
    const shape = convexHull(memberPoints);
    const labelPosition = shape.kind === "circle"
      ? shape.center
      : {
          x: shape.points.reduce((sum, point) => sum + point.x, 0) / shape.points.length,
          y: shape.points.reduce((sum, point) => sum + point.y, 0) / shape.points.length
        };
    const packageNode = apiNode(graph, packageKey);
    plates.push({
      packageEntityKey: packageNode.entityKey,
      label: packageNode.displayName,
      attribution: "repository-derived package boundary",
      shape,
      labelPosition
    });
  }
  return plates;
}

export function applyStoryGraphEmphasis(graph: Graph, emphasis: StoryMapEmphasis | null): void {
  if (emphasis === null) {
    graph.forEachNode((key) => graph.mergeNodeAttributes(key, { storyDimmed: false, storyActive: false }));
    graph.forEachEdge((key) => graph.mergeEdgeAttributes(key, { storyDimmed: false, storyActive: false }));
    return;
  }
  const path = new Set(emphasis.pathEntityKeys);
  const transitions = new Set(emphasis.transitions
    .filter((transition) => transition.toEntityKey !== null)
    .map((transition) => `${transition.fromEntityKey}\u0000${transition.relation}\u0000${transition.toEntityKey}`));
  graph.forEachNode((key, attrs) => {
    const canonicalKey = apiNode(graph, key).entityKey;
    const inPath = path.has(canonicalKey);
    const active = canonicalKey === emphasis.activeEntityKey
      || canonicalKey === emphasis.unresolvedFromEntityKey;
    const baseSize = Number(attrs.baseSize ?? attrs.size ?? 4);
    graph.mergeNodeAttributes(key, {
      storyDimmed: !inPath,
      storyActive: active,
      color: inPath ? (active ? "#9a4f22" : "#b87333") : "#d6d0c3",
      size: inPath ? baseSize + (active ? 3 : 1) : Math.max(0.75, baseSize * 0.45)
    });
  });
  graph.forEachEdge((key, attrs, source, target) => {
    const sourceKey = apiNode(graph, source).entityKey;
    const targetKey = apiNode(graph, target).entityKey;
    const inPath = transitions.has(`${sourceKey}\u0000${String(attrs.relation ?? "")}\u0000${targetKey}`);
    const baseSize = Number(attrs.baseSize ?? attrs.size ?? 1);
    graph.mergeEdgeAttributes(key, {
      storyDimmed: !inPath,
      storyActive: inPath,
      color: inPath ? "#b87333" : "#ddd8cf",
      size: inPath ? Math.max(2.5, baseSize + 1) : Math.max(0.25, baseSize * 0.4)
    });
  });
}

type ArrowDirection = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

export function directionalNeighbor(graph: Graph, fromKey: string, direction: ArrowDirection): string | null {
  if (!graph.hasNode(fromKey)) return null;
  const fromX = Number(graph.getNodeAttribute(fromKey, "x"));
  const fromY = Number(graph.getNodeAttribute(fromKey, "y"));
  const candidates: Array<{ key: string; distance: number }> = [];
  graph.forEachNode((key, attrs) => {
    if (key === fromKey) return;
    const dx = Number(attrs.x) - fromX;
    const dy = Number(attrs.y) - fromY;
    const inDirection = direction === "ArrowLeft" ? dx < 0
      : direction === "ArrowRight" ? dx > 0
      : direction === "ArrowUp" ? dy < 0
      : dy > 0;
    if (inDirection) candidates.push({ key, distance: (dx * dx) + (dy * dy) });
  });
  candidates.sort((a, b) => a.distance - b.distance || a.key.localeCompare(b.key));
  return candidates[0]?.key ?? null;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function focusGraphEntity(
  renderer: RendererWithCamera,
  graph: Graph,
  entityKey: string,
  reducedMotion: boolean
): boolean {
  if (!graph.hasNode(entityKey)) return false;
  // Sigma's camera uses normalized framed-graph coordinates, not the raw
  // server layout coordinates stored on graphology nodes. Raw coordinates can
  // move the camera completely outside the graph after semantic expansion.
  const displayData = renderer.getNodeDisplayData(entityKey);
  const x = Number(displayData?.x);
  const y = Number(displayData?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const state = { x, y, ratio: 0.2 };
  if (reducedMotion) renderer.getCamera().setState(state);
  else renderer.getCamera().animate(state, { duration: 350 });
  return true;
}

export function applyFiltersToCanvasGraph(graph: Graph, filters: SearchFilters): void {
  graph.forEachNode((key, attrs) => {
    const visible = nodeMatchesFilters({
      entityKey: key,
      kind: attrs.kind,
      qualifiedName: String(attrs.qualifiedName ?? key),
      displayName: String(attrs.displayName ?? key),
      file: typeof attrs.file === "string" ? attrs.file : null,
      exported: attrs.exported === true,
      fanIn: Number(attrs.fanIn ?? 0),
      language: typeof attrs.language === "string" ? attrs.language : null,
      provenance: attrs.provenance ?? null,
      aggregateLanguages: Array.isArray(attrs.aggregateLanguages) ? attrs.aggregateLanguages : [],
      aggregateCapabilities: Array.isArray(attrs.aggregateCapabilities) ? attrs.aggregateCapabilities : [],
      aggregateDerivations: Array.isArray(attrs.aggregateDerivations) ? attrs.aggregateDerivations : []
    }, filters);
    const baseColor = String(attrs.baseColor ?? attrs.color ?? "#4b7bec");
    const baseSize = Number(attrs.baseSize ?? attrs.size ?? 6);
    graph.mergeNodeAttributes(key, {
      baseColor,
      baseSize,
      filterDimmed: !visible,
      hidden: false,
      color: visible ? baseColor : "#c7c7c7",
      size: visible ? baseSize : Math.max(0.75, baseSize * 0.45)
    });
  });
  graph.forEachEdge((key, attrs) => {
    const visible = edgeMatchesFilters({
      entityKey: key,
      srcEntityKey: graph.source(key),
      relation: String(attrs.relation ?? ""),
      dstEntityKey: graph.target(key),
      origin: attrs.origin,
      confidence: attrs.confidence,
      resolution: attrs.resolution,
      language: typeof attrs.language === "string" ? attrs.language : null,
      provenance: attrs.provenance ?? null,
      aggregateProvenance: Array.isArray(attrs.aggregateProvenance) ? attrs.aggregateProvenance : [],
      aggregateLanguages: Array.isArray(attrs.aggregateLanguages) ? attrs.aggregateLanguages : [],
      aggregateCapabilities: Array.isArray(attrs.aggregateCapabilities) ? attrs.aggregateCapabilities : [],
      aggregateDerivations: Array.isArray(attrs.aggregateDerivations) ? attrs.aggregateDerivations : []
    }, filters);
    const baseColor = String(attrs.baseColor ?? attrs.color ?? "#636e72");
    const baseSize = Number(attrs.baseSize ?? attrs.size ?? 1);
    graph.mergeEdgeAttributes(key, {
      baseColor,
      baseSize,
      filterDimmed: !visible,
      hidden: false,
      color: visible ? baseColor : "#dedede",
      size: visible ? baseSize : Math.max(0.25, baseSize * 0.5)
    });
  });
}

/** Applies data-backed 2D Atlas marks without changing layout or graph topology. */
export function applyAtlasGraphStyles(graph: Graph): void {
  const labelTextByKey = new Map<string, string>();
  graph.forEachNode((key, attrs) => {
    const visual = atlasNodeVisual({
      kind: attrs.kind as NodeKind,
      fanIn: Number(attrs.fanIn ?? 0),
      provenance: attrs.provenance ?? null,
      aggregateCapabilities: Array.isArray(attrs.aggregateCapabilities)
        ? attrs.aggregateCapabilities
        : []
    }, attrs.selected === true);
    const label = typeof attrs.label === "string"
      ? attrs.label
      : truncateLabel(String(attrs.displayName ?? key));
    labelTextByKey.set(key, label);
    graph.mergeNodeAttributes(key, {
      type: visual.type,
      baseColor: visual.color,
      color: visual.color,
      baseSize: visual.size,
      size: visual.size,
      atlasForm: visual.formLabel,
      capabilityLabel: visual.capabilityLabel
    });
  });
  const visibleLabels = new Set(visibleLabelEntityKeys(
    graph.mapNodes((entityKey, attrs) => ({
      entityKey,
      radiusPx: Number(attrs.size ?? 0)
    }))
  ));
  graph.forEachNode((key, attrs) => {
    const visible = visibleLabels.has(key);
    graph.mergeNodeAttributes(key, {
      label: visible ? labelTextByKey.get(key) ?? null : null,
      forceLabel: visible && attrs.selected === true
    });
  });
  graph.forEachEdge((key, attrs) => {
    const visual = atlasEdgeVisual(attrs);
    graph.mergeEdgeAttributes(key, {
      type: visual.type,
      baseColor: visual.color,
      color: visual.color,
      baseSize: visual.size,
      size: visual.size,
      provenanceLabel: visual.provenanceLabel
    });
  });
}

export function selectGraphEntity(graph: Graph, entityKey: string): boolean {
  if (!graph.hasNode(entityKey)) return false;
  graph.forEachNode((key) => graph.setNodeAttribute(key, "selected", key === entityKey));
  applyAtlasGraphStyles(graph);
  return true;
}

/** Truncates a package label at EXACTLY 24 chars, appending an ellipsis. */
export function truncateLabel(label: string): string {
  return truncate(label, LABEL_MAX_LENGTH);
}

export interface PackageMapCanvasProps {
  nodes: ApiNode[];
  edges: ApiEdge[];
  positions: LayoutPositionDto[];
  /** Test seam: receives the live graphology graph after mount + each mutation. */
  onGraphReady?: (graph: Graph) => void;
  /** Immutable DTO snapshot of exactly the entities currently rendered. */
  onRenderedGraphChange?: (snapshot: RenderedGraphSnapshot) => void;
  /** Current Sigma camera projection for exactly the rendered node set. */
  onViewportPositionsChange?: (positions: ReadonlyMap<string, ViewportPosition>) => void;
  /** Opens the canonical entity in the shared inspector. */
  onInspect?: (entityKey: string) => void;
  /** Reports an unavailable WebGL renderer so the shell can expose Table mode. */
  onRendererError?: (error: Error) => void;
  filters?: SearchFilters;
  focusRequest?: { entityKey: string; requestId: number } | null;
  /** False while the persistent canvas is hidden behind Table mode. */
  active?: boolean;
  /** Evidence-backed Story path mapped to currently rendered representatives. */
  storyEmphasis?: StoryMapEmphasis | null;
}

export function PartialLodNotice({
  scopes
}: {
  scopes: readonly { omittedNodes: number; omittedEdges: number }[];
}) {
  if (scopes.length === 0) return null;
  const omittedNodes = scopes.reduce((sum, partial) => sum + partial.omittedNodes, 0);
  const omittedEdges = scopes.reduce((sum, partial) => sum + partial.omittedEdges, 0);
  return (
    <p className="bounded-notice" role="status">
      Partial expanded view: {omittedNodes} nodes and {omittedEdges} relations omitted by LOD budgets.
    </p>
  );
}

/**
 * Mounts a Sigma instance over the package-level graphology graph. The base
 * graph is built ONCE per (nodes/edges/positions) input and kept in a ref;
 * semantic-zoom expand/collapse then mutate that same graph additively
 * (addNode/addEdge on expand, dropNode/dropEdge on collapse) so no other
 * package's node position is ever recomputed — collapse restores the exact
 * prior graph. Edges use the shared edgeVisualStyle (same function
 * ProvenanceLegend uses). Clicking or keyboard-activating (Enter/Space) a
 * package node toggles its expansion.
 */
export function PackageMapCanvas({
  nodes,
  edges,
  positions,
  onGraphReady,
  onRenderedGraphChange,
  onViewportPositionsChange,
  onInspect,
  onRendererError,
  filters = NO_FILTERS,
  focusRequest = null,
  active = true,
  storyEmphasis = null
}: PackageMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const prevExpandedRef = useRef<ReadonlySet<string>>(new Set());
  const prevExpandedFilesRef = useRef<ReadonlySet<string>>(new Set());
  const publishRef = useRef<(() => void) | null>(null);
  const [packagePlates, setPackagePlates] = useState<PackagePlate[]>([]);
  const [focusAnnouncement, setFocusAnnouncement] = useState("");
  const callbacksRef = useRef({ onGraphReady, onRenderedGraphChange, onViewportPositionsChange, onInspect, onRendererError });
  callbacksRef.current = { onGraphReady, onRenderedGraphChange, onViewportPositionsChange, onInspect, onRendererError };
  const { expandedPackages, fileData, expand, collapse } = usePackageExpansion();
  const {
    expandedFiles,
    symbolData,
    expand: expandFile,
    collapse: collapseFile
  } = useFileExpansion();

  // Keep refs of the current expanded sets for the stable event handlers below.
  const expandedPackagesRef = useRef<ReadonlySet<string>>(expandedPackages);
  expandedPackagesRef.current = expandedPackages;
  const expandedFilesRef = useRef<ReadonlySet<string>>(expandedFiles);
  expandedFilesRef.current = expandedFiles;
  const filtersRef = useRef<SearchFilters>(filters);
  filtersRef.current = filters;
  const storyEmphasisRef = useRef<StoryMapEmphasis | null>(storyEmphasis);
  storyEmphasisRef.current = storyEmphasis;

  // Build the base graph once per data input; expansion mutates it in place.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    const graph: Graph = buildGraphologyGraph(nodes, edges, positions);
    const restoredPackages = new Set<string>();
    for (const packageKey of expandedPackagesRef.current) {
      const expansionData = fileData.get(packageKey);
      if (expansionData === undefined) continue;
      applyExpansion(graph, packageKey, expansionData);
      restoredPackages.add(packageKey);
    }
    const restoredFiles = new Set<string>();
    for (const fileKey of expandedFilesRef.current) {
      const expansionData = symbolData.get(fileKey);
      if (expansionData === undefined || !graph.hasNode(fileKey)) continue;
      applySymbolExpansion(graph, fileKey, expansionData);
      restoredFiles.add(fileKey);
    }
    applyAtlasGraphStyles(graph);

    graphRef.current = graph;
    prevExpandedRef.current = restoredPackages;
    prevExpandedFilesRef.current = restoredFiles;
    let renderer: Sigma;
    try {
      renderer = new Sigma(graph, container, {
        allowInvalidContainer: true,
        nodeProgramClasses: { ...ATLAS_NODE_PROGRAMS },
        nodeHoverProgramClasses: { ...ATLAS_NODE_PROGRAMS },
        edgeProgramClasses: { ...ATLAS_EDGE_PROGRAMS }
      });
    } catch (error) {
      graphRef.current = null;
      callbacksRef.current.onRendererError?.(
        error instanceof Error ? error : new Error(String(error))
      );
      return;
    }
    sigmaRef.current = renderer;

    const publish = (): void => {
      callbacksRef.current.onGraphReady?.(graph);
      callbacksRef.current.onRenderedGraphChange?.(renderedGraphSnapshot(graph));
      callbacksRef.current.onViewportPositionsChange?.(projectRenderedNodePositions(renderer, graph));
      setPackagePlates(projectedPackagePlates(renderer, graph));
    };
    publishRef.current = publish;

    const selectAndFocus = (nodeKey: string): void => {
      if (!selectGraphEntity(graph, nodeKey)) return;
      applyFiltersToCanvasGraph(graph, filtersRef.current);
      applyStoryGraphEmphasis(graph, storyEmphasisRef.current);
      container.dataset.focusedNode = nodeKey;
      setFocusAnnouncement(graphFocusAnnouncement(graph, nodeKey) ?? "");
      focusGraphEntity(renderer, graph, nodeKey, prefersReducedMotion());
      renderer.refresh();
      publish();
    };

    const inspect = (nodeKey: string): void => {
      if (!graph.hasNode(nodeKey)) return;
      callbacksRef.current.onInspect?.(apiNode(graph, nodeKey).entityKey);
    };

    const activate = (nodeKey: string): boolean => {
      if (!graph.hasNode(nodeKey)) return false;
      selectGraphEntity(graph, nodeKey);
      applyFiltersToCanvasGraph(graph, filtersRef.current);
      applyStoryGraphEmphasis(graph, storyEmphasisRef.current);
      container.dataset.focusedNode = nodeKey;
      setFocusAnnouncement(graphFocusAnnouncement(graph, nodeKey) ?? "");
      renderer.refresh();
      // A file node (surfaced by a package expansion) toggles the THIRD zoom
      // level — its exported symbols. Any other node is a package node and
      // toggles the file level. The file's repo-relative path scopes the
      // symbol fetch; a file with no path cannot be symbol-expanded.
      const kind = graph.hasNode(nodeKey) ? graph.getNodeAttribute(nodeKey, "kind") : undefined;
      if (kind === "file") {
        if (expandedFilesRef.current.has(nodeKey)) {
          collapseFile(nodeKey);
        } else {
          const filePath = graph.getNodeAttribute(nodeKey, "file");
          if (typeof filePath === "string" && filePath.length > 0) {
            void expandFile(nodeKey, filePath);
          }
        }
        publish();
        return true;
      }
      if (kind !== "package") return false;
      if (expandedPackagesRef.current.has(nodeKey)) {
        collapse(nodeKey);
      } else {
        const packageName = graph.getNodeAttribute(nodeKey, "qualifiedName");
        if (typeof packageName === "string" && packageName.length > 0) {
          void expand(nodeKey, packageName);
        }
      }
      publish();
      return true;
    };

    const ascend = (nodeKey: string): boolean => {
      if (!graph.hasNode(nodeKey)) return false;
      const expandedFromFile = graph.getNodeAttribute(nodeKey, "expandedFromFile");
      if (typeof expandedFromFile === "string") {
        collapseFile(expandedFromFile);
        container.dataset.focusedNode = expandedFromFile;
        return true;
      }
      const kind = graph.getNodeAttribute(nodeKey, "kind");
      if (kind === "file" && expandedFilesRef.current.has(nodeKey)) {
        collapseFile(nodeKey);
        return true;
      }
      const expandedFrom = graph.getNodeAttribute(nodeKey, "expandedFrom");
      if (typeof expandedFrom === "string") {
        collapse(expandedFrom);
        container.dataset.focusedNode = expandedFrom;
        return true;
      }
      if (expandedPackagesRef.current.has(nodeKey)) {
        collapse(nodeKey);
        return true;
      }
      return false;
    };

    const updateCamera = (state: Partial<CameraState>): void => {
      const camera = renderer.getCamera();
      if (prefersReducedMotion()) camera.setState(state);
      else camera.animate(state, { duration: 180 });
    };

    const pan = (direction: ArrowDirection): void => {
      const current = renderer.getCamera().getState();
      const delta = 0.12 * current.ratio;
      updateCamera({
        x: current.x + (direction === "ArrowLeft" ? -delta : direction === "ArrowRight" ? delta : 0),
        y: current.y + (direction === "ArrowUp" ? -delta : direction === "ArrowDown" ? delta : 0)
      });
    };

    renderer.on("clickNode", ({ node }) => {
      inspect(node);
      activate(node);
    });
    const onKeyDown = (event: KeyboardEvent): void => {
      const focused = container.dataset.focusedNode;
      if (event.key.startsWith("Arrow")) {
        event.preventDefault();
        const direction = event.key as ArrowDirection;
        const first = graph.nodes().sort()[0];
        const target = focused === undefined || focused === "" || !graph.hasNode(focused)
          ? first
          : directionalNeighbor(graph, focused, direction);
        if (target === undefined || target === null) pan(direction);
        else selectAndFocus(target);
        return;
      }
      if (event.key === "Enter" && focused !== undefined && focused !== "") {
        event.preventDefault();
        if (!activate(focused)) inspect(focused);
        return;
      }
      if (event.key === " " && focused !== undefined && focused !== "") {
        event.preventDefault();
        inspect(focused);
        return;
      }
      if (event.key === "Escape" && focused !== undefined && focused !== "") {
        if (ascend(focused)) event.preventDefault();
        return;
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        const current = renderer.getCamera().getState();
        updateCamera({ ratio: Math.max(0.02, current.ratio * 0.75) });
        return;
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        const current = renderer.getCamera().getState();
        updateCamera({ ratio: Math.min(10, current.ratio / 0.75) });
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        updateCamera({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
      }
    };
    container.addEventListener("keydown", onKeyDown);

    const camera = renderer.getCamera();
    camera.on?.("updated", publish);
    renderer.on("resize", publish);

    applyFiltersToCanvasGraph(graph, filters);
    applyStoryGraphEmphasis(graph, storyEmphasisRef.current);
    renderer.refresh();
    publish();

    return () => {
      container.removeEventListener("keydown", onKeyDown);
      camera.off?.("updated", publish);
      renderer.off("resize", publish);
      renderer.kill();
      publishRef.current = null;
      sigmaRef.current = null;
      graphRef.current = null;
    };
    // Rebuild only when the base data changes; expand/collapse are stable
    // (ref-backed) and are applied by the separate delta effect below.
  }, [nodes, edges, positions]);

  useEffect(() => {
    const graph = graphRef.current;
    const renderer = sigmaRef.current;
    if (graph === null || renderer === null || focusRequest === null) return;
    const reduced = prefersReducedMotion();
    if (focusGraphEntity(renderer, graph, focusRequest.entityKey, reduced)) {
      selectGraphEntity(graph, focusRequest.entityKey);
      applyFiltersToCanvasGraph(graph, filtersRef.current);
      applyStoryGraphEmphasis(graph, storyEmphasisRef.current);
      renderer.refresh();
      if (containerRef.current !== null) containerRef.current.dataset.focusedNode = focusRequest.entityKey;
      setFocusAnnouncement(graphFocusAnnouncement(graph, focusRequest.entityKey) ?? "");
      publishRef.current?.();
    }
  }, [focusRequest]);

  useEffect(() => {
    const graph = graphRef.current;
    if (graph === null) return;
    applyFiltersToCanvasGraph(graph, filters);
    applyStoryGraphEmphasis(graph, storyEmphasisRef.current);
    sigmaRef.current?.refresh();
    publishRef.current?.();
  }, [filters]);

  // Apply only the delta between the previous and current expanded sets.
  useEffect(() => {
    const graph = graphRef.current;
    if (graph === null) {
      return;
    }
    const { added, removed } = diffExpandedNodes(prevExpandedRef.current, expandedPackages);
    for (const pkg of removed) {
      const data = fileData.get(pkg);
      if (data !== undefined) {
        applyCollapse(graph, pkg, data);
      }
    }
    for (const pkg of added) {
      const data = fileData.get(pkg);
      if (data !== undefined) {
        applyExpansion(graph, pkg, data);
      }
    }
    prevExpandedRef.current = expandedPackages;
    applyAtlasGraphStyles(graph);
    applyFiltersToCanvasGraph(graph, filters);
    applyStoryGraphEmphasis(graph, storyEmphasisRef.current);
    sigmaRef.current?.refresh();
    publishRef.current?.();
  }, [expandedPackages, fileData, filters]);

  // Apply only the delta between the previous and current expanded-FILE sets
  // (the third zoom level). Same additive-mutation contract as the package
  // effect above — untouched nodes keep their exact positions.
  useEffect(() => {
    const graph = graphRef.current;
    if (graph === null) {
      return;
    }
    const { added, removed } = diffExpandedNodes(prevExpandedFilesRef.current, expandedFiles);
    for (const fileKey of removed) {
      const data = symbolData.get(fileKey);
      if (data !== undefined) {
        applySymbolCollapse(graph, fileKey, data);
      }
    }
    for (const fileKey of added) {
      const data = symbolData.get(fileKey);
      if (data !== undefined) {
        applySymbolExpansion(graph, fileKey, data);
      }
    }
    prevExpandedFilesRef.current = expandedFiles;
    applyAtlasGraphStyles(graph);
    applyFiltersToCanvasGraph(graph, filters);
    applyStoryGraphEmphasis(graph, storyEmphasisRef.current);
    sigmaRef.current?.refresh();
    publishRef.current?.();
  }, [expandedFiles, symbolData, filters]);

  useEffect(() => {
    const graph = graphRef.current;
    const renderer = sigmaRef.current;
    if (graph === null || renderer === null) return;
    applyAtlasGraphStyles(graph);
    applyFiltersToCanvasGraph(graph, filtersRef.current);
    applyStoryGraphEmphasis(graph, storyEmphasis);
    const focusKey = storyEmphasis?.activeEntityKey ?? storyEmphasis?.unresolvedFromEntityKey ?? null;
    if (focusKey !== null && graph.hasNode(focusKey)) {
      focusGraphEntity(renderer, graph, focusKey, prefersReducedMotion());
      if (containerRef.current !== null) containerRef.current.dataset.focusedNode = focusKey;
      setFocusAnnouncement(graphFocusAnnouncement(graph, focusKey) ?? "");
    }
    renderer.refresh();
    publishRef.current?.();
  }, [storyEmphasis]);

  useEffect(() => {
    const renderer = sigmaRef.current;
    if (!active || renderer === null) return;
    renderer.resize(true);
    renderer.refresh();
    publishRef.current?.();
  }, [active]);

  const partialScopes = [
    ...[...expandedPackages].flatMap((key) => fileData.get(key)?.partial ? [fileData.get(key)!.partial!] : []),
    ...[...expandedFiles].flatMap((key) => symbolData.get(key)?.partial ? [symbolData.get(key)!.partial!] : [])
  ];
  return (
    <>
      <PartialLodNotice scopes={partialScopes} />
      <svg className="package-plate-overlay" role="img" aria-label="Repository-derived package boundaries">
        {packagePlates.map((plate) => (
          <g key={plate.packageEntityKey} role="group" aria-label={`${plate.attribution}: ${plate.label}`}>
            <title>{`${plate.attribution}: ${plate.label}`}</title>
            {plate.shape.kind === "hull" ? (
              <polygon points={plate.shape.points.map((point) => `${point.x},${point.y}`).join(" ")} />
            ) : (
              <circle cx={plate.shape.center.x} cy={plate.shape.center.y} r={Math.max(12, plate.shape.radius)} />
            )}
            <text x={plate.labelPosition.x} y={plate.labelPosition.y}>{plate.label}</text>
            <text className="package-plate-attribution" x={plate.labelPosition.x} y={plate.labelPosition.y + 13}>
              repository-derived package boundary
            </text>
          </g>
        ))}
      </svg>
      {storyEmphasis?.unresolvedFromEntityKey !== null && storyEmphasis?.unresolvedFromEntityKey !== undefined && (
        <p className="story-map-status" role="status">
          {`Unresolved termination from ${storyEmphasis.unresolvedFromEntityKey}; destination unknown.`}
        </p>
      )}
      <p className="tadori-visually-hidden" aria-live="polite" aria-atomic="true">
        {focusAnnouncement}
      </p>
      <div
        ref={containerRef}
        className="package-map-canvas"
        tabIndex={0}
        role="application"
        aria-label="Package map; arrows move focus or pan, Enter descends or inspects, Escape ascends, plus and minus zoom, zero resets"
        style={{ width: "100%", height: "100%" }}
      />
    </>
  );
}

/** Exposed for reuse by future semantic-zoom levels; see convexHull.ts. */
export function hullForPoints(points: readonly Point[]) {
  return convexHull(points);
}
