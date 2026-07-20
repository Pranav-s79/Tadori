import Graph from "graphology";
import Sigma from "sigma";
import { useEffect, useRef } from "react";
import type { ApiEdge, ApiNode, LayoutPositionDto } from "../api/types.ts";
import { edgeVisualStyle } from "../legend.ts";
import { buildGraphologyGraph } from "./buildGraphologyGraph.ts";
import { convexHull, type Point } from "./convexHull.ts";

const LABEL_MAX_LENGTH = 24;

/** Truncates a package label at EXACTLY 24 chars, appending an ellipsis. */
export function truncateLabel(label: string): string {
  if (label.length <= LABEL_MAX_LENGTH) {
    return label;
  }
  return `${label.slice(0, LABEL_MAX_LENGTH)}…`;
}

export interface PackageMapCanvasProps {
  nodes: ApiNode[];
  edges: ApiEdge[];
  positions: LayoutPositionDto[];
}

/**
 * Mounts a Sigma instance over the package-level graphology graph. Node
 * labels are truncated to 24 chars; edges get the origin/confidence/
 * resolution-driven dash + muted styling from ../legend.ts (same function
 * ProvenanceLegend uses, so the canvas and the legend never disagree).
 *
 * Package "membership" hulls (grouping a package's member nodes) aren't
 * applicable at the package level itself (each node IS a package, not a
 * member of one) — convexHull is exercised here for a package's own node
 * cluster only when multiple layout points share a package (defensive; at
 * level=package today each package is a single point). The hull renderer
 * is wired through so file-level zoom (a later milestone) can reuse it
 * without a second implementation.
 */
export function PackageMapCanvas({ nodes, edges, positions }: PackageMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);

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

    graph.forEachEdge((key, attrs, source, target) => {
      const style = edgeVisualStyle(attrs.origin, attrs.confidence, attrs.resolution);
      graph.mergeEdgeAttributes(key, {
        size: 1,
        color: style.muted ? "#b2bec3" : "#636e72",
        type: style.dash === null ? "line" : "dashed"
      });
      void source;
      void target;
    });

    const renderer = new Sigma(graph, container);
    sigmaRef.current = renderer;

    return () => {
      renderer.kill();
      sigmaRef.current = null;
    };
  }, [nodes, edges, positions]);

  return <div ref={containerRef} className="package-map-canvas" style={{ width: "100%", height: "100%" }} />;
}

/** Exposed for reuse by future semantic-zoom levels; see convexHull.ts. */
export function hullForPoints(points: readonly Point[]) {
  return convexHull(points);
}
