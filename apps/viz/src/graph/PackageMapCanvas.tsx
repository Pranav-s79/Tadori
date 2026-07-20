import Graph from "graphology";
import Sigma from "sigma";
import { useEffect, useRef } from "react";
import type { ApiEdge, ApiNode, LayoutPositionDto } from "../api/types.ts";
import { edgeVisualStyle } from "../legend.ts";
import { usePackageExpansion } from "../hooks/usePackageExpansion.ts";
import { buildGraphologyGraph } from "./buildGraphologyGraph.ts";
import { applyCollapse, applyExpansion, diffExpandedNodes, truncate } from "./expansion.ts";
import { convexHull, type Point } from "./convexHull.ts";

const LABEL_MAX_LENGTH = 24;

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
export function PackageMapCanvas({ nodes, edges, positions, onGraphReady }: PackageMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const prevExpandedRef = useRef<ReadonlySet<string>>(new Set());
  const { expandedPackages, fileData, expand, collapse } = usePackageExpansion();

  // Keep a ref of the current expanded set for the stable event handlers below.
  const expandedPackagesRef = useRef<ReadonlySet<string>>(expandedPackages);
  expandedPackagesRef.current = expandedPackages;

  // Build the base graph once per data input; expansion mutates it in place.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    const graph: Graph = buildGraphologyGraph(nodes, edges, positions);
    graph.forEachNode((key, attrs) => {
      graph.mergeNodeAttributes(key, {
        label: truncateLabel(String(attrs.displayName ?? key)),
        size: 6,
        color: "#4b7bec"
      });
    });
    graph.forEachEdge((key, attrs) => {
      const style = edgeVisualStyle(attrs.origin, attrs.confidence, attrs.resolution);
      graph.mergeEdgeAttributes(key, {
        size: 1,
        color: style.muted ? "#b2bec3" : "#636e72",
        type: style.dash === null ? "line" : "dashed"
      });
    });

    graphRef.current = graph;
    prevExpandedRef.current = new Set();
    const renderer = new Sigma(graph, container);
    sigmaRef.current = renderer;

    const activate = (nodeKey: string): void => {
      if (expandedPackagesRef.current.has(nodeKey)) {
        collapse(nodeKey);
      } else {
        void expand(nodeKey);
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

    return () => {
      container.removeEventListener("keydown", onKeyDown);
      renderer.kill();
      sigmaRef.current = null;
      graphRef.current = null;
    };
    // Rebuild only when the base data changes; expand/collapse are stable
    // (ref-backed) and are applied by the separate delta effect below.
  }, [nodes, edges, positions]);

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
    sigmaRef.current?.refresh();
    onGraphReady?.(graph);
  }, [expandedPackages, fileData, onGraphReady]);

  return (
    <div
      ref={containerRef}
      className="package-map-canvas"
      tabIndex={0}
      role="application"
      aria-label="Package map; activate a package to expand its files"
      style={{ width: "100%", height: "100%" }}
    />
  );
}

/** Exposed for reuse by future semantic-zoom levels; see convexHull.ts. */
export function hullForPoints(points: readonly Point[]) {
  return convexHull(points);
}
