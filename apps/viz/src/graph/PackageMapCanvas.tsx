import Graph from "graphology";
import Sigma from "sigma";
import { useEffect, useRef } from "react";
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
  animate(state: { x: number; y: number; ratio: number }, options: { duration: number }): void;
  setState(state: { x: number; y: number; ratio: number }): void;
}

interface RendererWithCamera {
  getCamera(): CameraLike;
}

export function focusGraphEntity(
  renderer: RendererWithCamera,
  graph: Graph,
  entityKey: string,
  reducedMotion: boolean
): boolean {
  if (!graph.hasNode(entityKey)) return false;
  const x = Number(graph.getNodeAttribute(entityKey, "x"));
  const y = Number(graph.getNodeAttribute(entityKey, "y"));
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
  filters?: SearchFilters;
  focusRequest?: { entityKey: string; requestId: number } | null;
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
export function PackageMapCanvas({ nodes, edges, positions, onGraphReady, filters = NO_FILTERS, focusRequest = null }: PackageMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const prevExpandedRef = useRef<ReadonlySet<string>>(new Set());
  const prevExpandedFilesRef = useRef<ReadonlySet<string>>(new Set());
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

  // Build the base graph once per data input; expansion mutates it in place.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    const graph: Graph = buildGraphologyGraph(nodes, edges, positions);
    applyAtlasGraphStyles(graph);

    graphRef.current = graph;
    prevExpandedRef.current = new Set();
    prevExpandedFilesRef.current = new Set();
    const renderer = new Sigma(graph, container, {
      nodeProgramClasses: { ...ATLAS_NODE_PROGRAMS },
      nodeHoverProgramClasses: { ...ATLAS_NODE_PROGRAMS },
      edgeProgramClasses: { ...ATLAS_EDGE_PROGRAMS }
    });
    sigmaRef.current = renderer;

    const activate = (nodeKey: string): void => {
      selectGraphEntity(graph, nodeKey);
      applyFiltersToCanvasGraph(graph, filtersRef.current);
      container.dataset.focusedNode = nodeKey;
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
        return;
      }
      if (expandedPackagesRef.current.has(nodeKey)) {
        collapse(nodeKey);
      } else {
        const packageName = graph.getNodeAttribute(nodeKey, "qualifiedName");
        if (typeof packageName === "string" && packageName.length > 0) {
          void expand(nodeKey, packageName);
        }
      }
    };
    renderer.on("clickNode", ({ node }) => activate(node));
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      const focused = container.dataset.focusedNode;
      if (focused !== undefined && focused !== "") {
        event.preventDefault();
        activate(focused);
      }
    };
    container.addEventListener("keydown", onKeyDown);

    onGraphReady?.(graph);
    applyFiltersToCanvasGraph(graph, filters);
    renderer.refresh();

    return () => {
      container.removeEventListener("keydown", onKeyDown);
      renderer.kill();
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
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (focusGraphEntity(renderer, graph, focusRequest.entityKey, reduced)) {
      selectGraphEntity(graph, focusRequest.entityKey);
      applyFiltersToCanvasGraph(graph, filtersRef.current);
      renderer.refresh();
      if (containerRef.current !== null) containerRef.current.dataset.focusedNode = focusRequest.entityKey;
    }
  }, [focusRequest]);

  useEffect(() => {
    const graph = graphRef.current;
    if (graph === null) return;
    applyFiltersToCanvasGraph(graph, filters);
    sigmaRef.current?.refresh();
    onGraphReady?.(graph);
  }, [filters, onGraphReady]);

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
    sigmaRef.current?.refresh();
    onGraphReady?.(graph);
  }, [expandedPackages, fileData, filters, onGraphReady]);

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
    sigmaRef.current?.refresh();
    onGraphReady?.(graph);
  }, [expandedFiles, symbolData, filters, onGraphReady]);

  const partialScopes = [
    ...[...expandedPackages].flatMap((key) => fileData.get(key)?.partial ? [fileData.get(key)!.partial!] : []),
    ...[...expandedFiles].flatMap((key) => symbolData.get(key)?.partial ? [symbolData.get(key)!.partial!] : [])
  ];
  return (
    <>
      <PartialLodNotice scopes={partialScopes} />
      <div
        ref={containerRef}
        className="package-map-canvas"
        tabIndex={0}
        role="application"
        aria-label="Package map; activate a package to expand its files, or a file to expand its symbols"
        style={{ width: "100%", height: "100%" }}
      />
    </>
  );
}

/** Exposed for reuse by future semantic-zoom levels; see convexHull.ts. */
export function hullForPoints(points: readonly Point[]) {
  return convexHull(points);
}
