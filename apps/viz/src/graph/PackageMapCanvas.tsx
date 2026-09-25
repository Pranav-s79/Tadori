import Graph from "graphology";
import Sigma from "sigma";
import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
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
import { convexHull, nearestPoint, partitionOutliers, type Point } from "./convexHull.ts";
import { defaultFilters, edgeMatchesFilters, nodeMatchesFilters, type SearchFilters } from "../features/search/filterState.ts";
import { ATLAS_NODE_PROGRAMS } from "./AtlasNodeProgram.ts";
import { ATLAS_EDGE_PROGRAMS } from "./ProvenanceEdgeProgram.ts";
import { atlasEdgeVisual, atlasNodeVisual } from "./atlasVisuals.ts";
import { visibleLabelEntityKeys } from "../lod/budgets.ts";
import { createCollisionCulledLabels } from "../lod/labelCollisions.ts";
import { probeWebglSupport } from "../render/webglCapability.ts";
import type { Atlas3DHandle, Atlas3DStageProps } from "../atlas3d/Atlas3DStage.tsx";
import "../atlas3d/atlas3d.css";

const LABEL_MAX_LENGTH = 24;
/** Breathing room around a fitted graph, as a multiple of its own extent. */
const FIT_PADDING = 1.15;
const NO_FILTERS = defaultFilters();
/** Same face and fallbacks as --tadori-font-label. */
const MAP_LABEL_FONT = '"IBM Plex Sans Condensed", "Arial Narrow", sans-serif';

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
  /** The boundary around the package's core members. */
  shape: ReturnType<typeof convexHull>;
  labelPosition: ViewportPosition;
  /**
   * Members served far from the rest, left outside the drawn boundary so one
   * of them cannot stretch it into a spike. Each is tethered to its nearest
   * boundary point: still a member, never moved.
   */
  tethers: { from: ViewportPosition; to: ViewportPosition }[];
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
    const { core, outliers } = partitionOutliers(memberPoints);
    const shape = convexHull(core);
    // Hung under the boundary, not at its centre: a compact boundary's centre
    // is where its members' own labels are.
    const labelPosition = shape.kind === "circle"
      ? { x: shape.center.x, y: shape.center.y + Math.max(12, shape.radius) + 14 }
      : {
          x: shape.points.reduce((sum, point) => sum + point.x, 0) / shape.points.length,
          y: Math.max(...shape.points.map((point) => point.y)) + 14
        };
    const packageNode = apiNode(graph, packageKey);
    plates.push({
      packageEntityKey: packageNode.entityKey,
      label: packageNode.displayName,
      attribution: "repository-derived package boundary",
      shape,
      labelPosition,
      tethers: outliers.map((from) => ({
        from,
        to: shape.kind === "hull" ? nearestPoint(shape.points, from) ?? from : shape.center
      }))
    });
  }
  return plates;
}

function plateDescription(plate: PackagePlate): string {
  const far = plate.tethers.length;
  return `${plate.attribution}: ${plate.label}${far === 0 ? ""
    : `; ${far === 1 ? "1 member is" : `${String(far)} members are`} served far from the rest and tethered to it`}`;
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

/**
 * The nearest node in an arrow's direction. Positions default to the graph's
 * own x/y; the 3D map passes where each node sits on screen instead, so the
 * arrows follow what the reader sees from any camera angle.
 */
export function directionalNeighbor(
  graph: Graph,
  fromKey: string,
  direction: ArrowDirection,
  positionOf: (key: string) => { x: number; y: number } | undefined = (key) => ({
    x: Number(graph.getNodeAttribute(key, "x")),
    y: Number(graph.getNodeAttribute(key, "y"))
  })
): string | null {
  if (!graph.hasNode(fromKey)) return null;
  const from = positionOf(fromKey);
  if (from === undefined) return null;
  const candidates: Array<{ key: string; distance: number }> = [];
  graph.forEachNode((key) => {
    if (key === fromKey) return;
    const position = positionOf(key);
    if (position === undefined) return;
    const dx = position.x - from.x;
    const dy = position.y - from.y;
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

/**
 * Frame every visible node.
 *
 * Expansion adds nodes at their persisted layout positions, which can sit far
 * outside the current view: expanding the fixture's repository node put a test
 * file so far from the rest that the cluster occupied a corner and roughly
 * three quarters of the canvas stayed empty. Worse, Sigma suppresses a label
 * below a rendered size threshold, so an unfitted camera also leaves most nodes
 * unlabelled — the "only 3 of 14 labels" symptom and the "empty canvas" symptom
 * are the same defect.
 *
 * Works in the same normalized framed-graph space `focusGraphEntity` uses, not
 * raw layout coordinates. Returns false when there is nothing visible to frame,
 * so the caller leaves the camera alone rather than jumping to the origin.
 */
export function fitCameraToVisibleNodes(
  renderer: RendererWithCamera,
  graph: Graph,
  reducedMotion: boolean
): boolean {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let seen = 0;

  graph.forEachNode((key, attrs) => {
    if (attrs.hidden === true) return;
    const display = renderer.getNodeDisplayData(key);
    const x = Number(display?.x);
    const y = Number(display?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    seen += 1;
  });

  if (seen === 0) return false;

  // A single node has no extent, so a span-derived zoom would divide the view
  // down to nothing. Fall back to the same close ratio a focus request uses.
  const span = Math.max(maxX - minX, maxY - minY);
  const ratio = span <= 0 ? 0.2 : Math.min(1, Math.max(0.05, span * FIT_PADDING));
  const state = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, ratio };
  if (reducedMotion) renderer.getCamera().setState(state);
  else renderer.getCamera().animate(state, { duration: 280 });
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
      radiusPx: Number(attrs.size ?? 0),
      pinned: attrs.selected === true
    }))
  ));
  graph.forEachNode((key, attrs) => {
    const visible = visibleLabels.has(key);
    graph.mergeNodeAttributes(key, {
      label: visible ? labelTextByKey.get(key) ?? null : null,
      // Forced past Sigma's size threshold and first in the collision cull, so
      // the selected node is always named even where neighbours crowd it.
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

/**
 * The one package worth opening on landing: the root level holds exactly one
 * package the file-level request can scope (it has a qualified name). Any other
 * shape (several packages, none, or one that cannot be expanded) returns null.
 */
export function soleExpandablePackage(nodes: readonly ApiNode[]): ApiNode | null {
  const expandable = nodes.filter((node) => node.kind === "package" && node.qualifiedName.length > 0);
  return expandable.length === 1 ? expandable[0]! : null;
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
  /**
   * Draw this same graph as a three.js scene, height bound to abstraction
   * level. Selection, expansion and the keyboard stay here, so switching keeps
   * both. Without WebGL the map stays flat and says so.
   */
  view3d?: boolean;
}

type Stage3D = ComponentType<Atlas3DStageProps>;

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
  storyEmphasis = null,
  view3d = false
}: PackageMapCanvasProps) {
  // Probed once, the first time 3D is asked for, so three.js is never fetched
  // for a browser that cannot draw it.
  const webglRef = useRef<boolean | null>(null);
  if (view3d && webglRef.current === null) webglRef.current = probeWebglSupport() !== null;
  const [stage3dFailure, setStage3dFailure] = useState<string | null>(null);
  const [Stage3DComponent, setStage3DComponent] = useState<Stage3D | null>(null);
  const [liveGraph, setLiveGraph] = useState<Graph | null>(null);
  const wants3d = view3d && webglRef.current === true && stage3dFailure === null;
  const threeD = wants3d && Stage3DComponent !== null && liveGraph !== null;
  const threeDRef = useRef(threeD);
  threeDRef.current = threeD;
  const view3dRef = useRef<Atlas3DHandle | null>(null);
  const stageActionsRef = useRef<{ pick(key: string): void; activate(key: string): boolean } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const prevExpandedRef = useRef<ReadonlySet<string>>(new Set());
  const prevExpandedFilesRef = useRef<ReadonlySet<string>>(new Set());
  const carriedSelectionRef = useRef<string | null>(null);
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

  // A repository with one package lands as one node in an empty field, with
  // nothing on screen to act on. Open that package once, on the first data the
  // map receives: a view-state default, not a rule. Escape (or Enter on the
  // package) climbs back out, and a later refetch never re-opens what the
  // reader closed. A failed fetch leaves the repository level showing, which is
  // exactly what the map then says.
  const landingDecidedRef = useRef(false);
  useEffect(() => {
    if (landingDecidedRef.current || nodes.length === 0) return;
    landingDecidedRef.current = true;
    const soleOpen = soleExpandablePackage(nodes);
    if (soleOpen !== null) expand(soleOpen.entityKey, soleOpen.qualifiedName).catch(() => undefined);
  }, [nodes, expand]);

  // three.js lives in its own chunk, fetched the first time 3D is shown.
  useEffect(() => {
    if (!wants3d || Stage3DComponent !== null) return;
    let cancelled = false;
    import("../atlas3d/Atlas3DStage.tsx")
      .then((module) => {
        if (!cancelled) setStage3DComponent(() => module.Atlas3DStage);
      })
      .catch((error: unknown) => {
        if (!cancelled) setStage3dFailure(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [wants3d, Stage3DComponent]);

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
    // A refetch rebuilds the graph; the reader's selection survives it, as
    // their expansions do, whenever the selected entity is still served.
    const carried = carriedSelectionRef.current;
    if (carried !== null && graph.hasNode(carried)) graph.setNodeAttribute(carried, "selected", true);
    applyAtlasGraphStyles(graph);

    graphRef.current = graph;
    prevExpandedRef.current = restoredPackages;
    prevExpandedFilesRef.current = restoredFiles;
    let renderer: Sigma;
    const labels = createCollisionCulledLabels({
      haloColor: getComputedStyle(container).getPropertyValue("--tadori-panel").trim() || undefined,
      // Every drawn glyph, in the same viewport pixels Sigma hands the label
      // drawer, so a label never prints over a neighbouring node.
      obstacles: () => graph.nodes().flatMap((key) => {
        const display = renderer.getNodeDisplayData(key);
        if (display === undefined || display.hidden) return [];
        const centre = renderer.framedGraphToViewport(display);
        const radius = renderer.scaleSize(display.size);
        return [{ key, box: { x: centre.x - radius, y: centre.y - radius, width: 2 * radius, height: 2 * radius } }];
      })
    });
    try {
      renderer = new Sigma(graph, container, {
        allowInvalidContainer: true,
        defaultDrawNodeLabel: labels.draw,
        // The app's label face; only its 600 weight is self-hosted.
        labelFont: MAP_LABEL_FONT,
        labelWeight: "600",
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
    // Canvas text does not wait for a web font: labels drawn before it loads
    // stay in the fallback until the next frame, so redraw once it is ready.
    let alive = true;
    void document.fonts?.load(`600 12px ${MAP_LABEL_FONT}`).then(() => {
      if (alive) renderer.refresh();
    }, () => undefined);
    renderer.on("beforeRender", labels.reset);
    renderer.on("afterRender", labels.flush);

    const publish = (): void => {
      // The container is focusable as soon as it mounts, but the Sigma graph is
      // populated a tick later. In that window an arrow key is delivered to a
      // focused canvas, finds `graph.nodes()` empty, falls through to pan, and
      // sets no focused node — the keyboard silently does nothing. Publishing
      // readiness lets a caller wait for the real thing instead of inferring it
      // from a painted canvas.
      container.dataset.graphReady = graph.order > 0 ? "true" : "false";
      callbacksRef.current.onGraphReady?.(graph);
      callbacksRef.current.onRenderedGraphChange?.(renderedGraphSnapshot(graph));
      // In 3D the stage reports its own projection; Sigma's hidden one would
      // put every overlay badge in the wrong place.
      if (!threeDRef.current) {
        callbacksRef.current.onViewportPositionsChange?.(projectRenderedNodePositions(renderer, graph));
      }
      setPackagePlates(projectedPackagePlates(renderer, graph));
    };
    publishRef.current = publish;

    const select = (nodeKey: string): boolean => {
      if (!selectGraphEntity(graph, nodeKey)) return false;
      applyFiltersToCanvasGraph(graph, filtersRef.current);
      applyStoryGraphEmphasis(graph, storyEmphasisRef.current);
      container.dataset.focusedNode = nodeKey;
      setFocusAnnouncement(graphFocusAnnouncement(graph, nodeKey) ?? "");
      renderer.refresh();
      publish();
      return true;
    };

    const selectAndFocus = (nodeKey: string): void => {
      if (!select(nodeKey)) return;
      focusGraphEntity(renderer, graph, nodeKey, prefersReducedMotion());
      view3dRef.current?.focus(nodeKey);
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

    // The 3D stage's pointer: a click selects and inspects, a double-click
    // expands or collapses, through exactly the paths Plan uses.
    stageActionsRef.current = {
      pick: (nodeKey) => {
        inspect(nodeKey);
        select(nodeKey);
      },
      activate
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
        const stage = view3dRef.current;
        const target = focused === undefined || focused === "" || !graph.hasNode(focused)
          ? first
          : stage === null
            ? directionalNeighbor(graph, focused, direction)
            : directionalNeighbor(graph, focused, direction, (key) => stage.screenPosition(key));
        if (target !== undefined && target !== null) selectAndFocus(target);
        else if (stage === null) pan(direction);
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
      const stage = view3dRef.current;
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        const current = renderer.getCamera().getState();
        if (stage !== null) stage.zoom(0.75);
        else updateCamera({ ratio: Math.max(0.02, current.ratio * 0.75) });
        return;
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        const current = renderer.getCamera().getState();
        if (stage !== null) stage.zoom(1 / 0.75);
        else updateCamera({ ratio: Math.min(10, current.ratio / 0.75) });
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        if (stage !== null) stage.reset();
        else updateCamera({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
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
    setLiveGraph(graph);

    return () => {
      alive = false;
      carriedSelectionRef.current = graph.findNode((_key, attrs) => attrs.selected === true) ?? null;
      setLiveGraph(null);
      stageActionsRef.current = null;
      container.removeEventListener("keydown", onKeyDown);
      camera.off?.("updated", publish);
      renderer.off("resize", publish);
      renderer.off("beforeRender", labels.reset);
      renderer.off("afterRender", labels.flush);
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
      view3dRef.current?.focus(focusRequest.entityKey);
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
    const renderer = sigmaRef.current;
    renderer?.refresh();
    // Only when the descent actually revealed something. Refitting on collapse
    // would yank the view while the reader is climbing back out, and refitting
    // on an unrelated filter change would undo a pan they chose.
    if (added.length > 0 && renderer !== null && renderer !== undefined) {
      fitCameraToVisibleNodes(renderer, graph, prefersReducedMotion());
    }
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
    const renderer = sigmaRef.current;
    renderer?.refresh();
    if (added.length > 0 && renderer !== null && renderer !== undefined) {
      fitCameraToVisibleNodes(renderer, graph, prefersReducedMotion());
    }
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
      view3dRef.current?.focus(focusKey);
      if (containerRef.current !== null) containerRef.current.dataset.focusedNode = focusKey;
      setFocusAnnouncement(graphFocusAnnouncement(graph, focusKey) ?? "");
    }
    renderer.refresh();
    publishRef.current?.();
  }, [storyEmphasis]);

  // Back from 3D, the overlays read Sigma's projection again.
  useEffect(() => {
    if (!threeD) publishRef.current?.();
  }, [threeD]);

  useEffect(() => {
    const renderer = sigmaRef.current;
    if (!active || renderer === null) return;
    renderer.resize(true);
    renderer.refresh();
    publishRef.current?.();
  }, [active]);

  // The keyboard contract (+, -, 0) has always existed and is announced in the
  // application element's accessible name, but the landing map is one node in
  // an otherwise empty field with no visible affordance that it can be moved
  // at all. These are the same three operations, reachable by pointer. The
  // arithmetic mirrors the key handlers exactly so the two cannot drift.
  const nudgeCamera = useCallback((state: Partial<CameraState>): void => {
    const renderer = sigmaRef.current;
    if (renderer === null) return;
    const camera = renderer.getCamera();
    if (prefersReducedMotion()) camera.setState(state);
    else camera.animate(state, { duration: 180 });
  }, []);

  const zoomIn = useCallback(() => {
    if (view3dRef.current !== null) return view3dRef.current.zoom(0.75);
    const current = sigmaRef.current?.getCamera().getState();
    if (current !== undefined) nudgeCamera({ ratio: Math.max(0.02, current.ratio * 0.75) });
  }, [nudgeCamera]);

  const zoomOut = useCallback(() => {
    if (view3dRef.current !== null) return view3dRef.current.zoom(1 / 0.75);
    const current = sigmaRef.current?.getCamera().getState();
    if (current !== undefined) nudgeCamera({ ratio: Math.min(10, current.ratio / 0.75) });
  }, [nudgeCamera]);

  // Fit, not reset. A blind reset to the centre at ratio 1 is only the right
  // view when the graph happens to fill the framed space; after a descent it
  // put the reader back to the same empty field they pressed the button to
  // escape. Falls back to reset when there is nothing visible to frame. In 3D
  // the fitted isometric three-quarter view is the reset.
  const fitToContent = useCallback(() => {
    if (view3dRef.current !== null) return view3dRef.current.reset();
    const renderer = sigmaRef.current;
    const graph = graphRef.current;
    if (renderer !== null && graph !== null
      && fitCameraToVisibleNodes(renderer, graph, prefersReducedMotion())) return;
    nudgeCamera({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
  }, [nudgeCamera]);

  const partialScopes = [
    ...[...expandedPackages].flatMap((key) => fileData.get(key)?.partial ? [fileData.get(key)!.partial!] : []),
    ...[...expandedFiles].flatMap((key) => symbolData.get(key)?.partial ? [symbolData.get(key)!.partial!] : [])
  ];
  const notice3d = !view3d || threeD ? null
    : webglRef.current === false ? "3D needs WebGL, which this browser does not provide. Showing the flat plan."
      : stage3dFailure !== null ? `The 3D map could not start (${stage3dFailure}). Showing the flat plan.`
        : "Loading the 3D map…";
  return (
    <>
      <PartialLodNotice scopes={partialScopes} />
      {notice3d !== null && <p className="atlas3d-notice" role="status">{notice3d}</p>}
      {!threeD && <svg
        className="package-plate-overlay"
        role="img"
        aria-label="Repository-derived package boundaries"
      >
        {packagePlates.map((plate) => (
          <g key={plate.packageEntityKey} role="group" aria-label={plateDescription(plate)}>
            <title>{plateDescription(plate)}</title>
            {plate.tethers.map((tether) => (
              <line
                key={`${tether.from.x},${tether.from.y}`}
                className="package-plate-tether"
                x1={tether.from.x}
                y1={tether.from.y}
                x2={tether.to.x}
                y2={tether.to.y}
                style={{ stroke: "color-mix(in srgb, var(--tadori-copper) 58%, var(--tadori-panel))", strokeWidth: 1.25, strokeDasharray: "2 4" }}
              />
            ))}
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
      </svg>}
      {storyEmphasis?.unresolvedFromEntityKey !== null && storyEmphasis?.unresolvedFromEntityKey !== undefined && (
        <p className="story-map-status" role="status">
          {`Unresolved termination from ${storyEmphasis.unresolvedFromEntityKey}; destination unknown.`}
        </p>
      )}
      <p className="tadori-visually-hidden" aria-live="polite" aria-atomic="true">
        {focusAnnouncement}
      </p>
      <div className="atlas-controls" role="group" aria-label="Map controls">
        <button type="button" onClick={zoomIn}>
          <span aria-hidden="true">+</span>
          <span className="tadori-visually-hidden">Zoom in</span>
        </button>
        <button type="button" onClick={zoomOut}>
          <span aria-hidden="true">−</span>
          <span className="tadori-visually-hidden">Zoom out</span>
        </button>
        <button type="button" onClick={fitToContent}>
          <span aria-hidden="true">⤢</span>
          <span className="tadori-visually-hidden">{threeD ? "Reset view" : "Fit the map to its content"}</span>
        </button>
      </div>
      {/* In 3D this element stays the keyboard target, under the stage that
          draws the scene; the stage must follow it directly for the focus ring. */}
      <div
        ref={containerRef}
        className="package-map-canvas"
        data-projection={threeD ? "3d" : "plan"}
        tabIndex={0}
        role="application"
        aria-label={threeD
          ? "3D package map, height shows package, file or symbol level; arrows move focus, Enter expands or collapses, Escape ascends, plus and minus zoom, zero resets the view; drag to orbit"
          : "Package map; arrows move focus or pan, Enter descends or inspects, Escape ascends, plus and minus zoom, zero resets"}
        style={{ width: "100%", height: "100%" }}
      />
      {wants3d && Stage3DComponent !== null && liveGraph !== null && (
        <Stage3DComponent
          graph={liveGraph}
          active={active}
          handleRef={view3dRef}
          onSelect={(key) => stageActionsRef.current?.pick(key)}
          onActivate={(key) => stageActionsRef.current?.activate(key)}
          onPointerDown={() => containerRef.current?.focus({ preventScroll: true })}
          onViewportPositionsChange={(positions) => callbacksRef.current.onViewportPositionsChange?.(positions)}
          onError={(error) => setStage3dFailure(error.message)}
        />
      )}
    </>
  );
}

/** Exposed for reuse by future semantic-zoom levels; see convexHull.ts. */
export function hullForPoints(points: readonly Point[]) {
  return convexHull(points);
}
