import type Graph from "graphology";
import { depthOffsetForLevel, type AbstractionLevel } from "../render/depthBinding.ts";
import { applyFixedTilt } from "../render/fixedTiltProjection.ts";

type NodeAttributes = Readonly<Record<string, unknown>>;

/**
 * One abstraction level lifts a node by this share of the map's layout span.
 * Layout coordinates have no fixed unit (their spread grows with node count),
 * so a fixed graph-space depth unit would be a hair on one map and a cliff on
 * another; a share of the span reads the same at every size.
 */
const DEPTH_UNIT_SHARE = 0.08;

/**
 * The abstraction level a rendered node was fetched at. Expansion marks what it
 * adds: `expandedFromFile` for the symbol-level request, `expandedFrom` for the
 * file-level one. Everything else came from the package-level request.
 */
export function nodeAbstractionLevel(attrs: NodeAttributes): AbstractionLevel {
  if (typeof attrs.expandedFromFile === "string") return "symbol";
  if (typeof attrs.expandedFrom === "string") return "file";
  return "package";
}

/**
 * Put the graph in the Tilt or Plan projection by rewriting the `x`/`y` Sigma
 * reads. Sigma renders, labels and hit-tests from those same coordinates, so a
 * tilt applied here keeps every interaction exact, which a CSS transform on the
 * canvas would not.
 *
 * While tilted, the served layout position is kept verbatim in
 * `layoutX`/`layoutY` (the rendered-graph snapshot publishes those) and the
 * node's point on the ground plane in `groundY`. Plan removes all three, so a
 * graph that returns to Plan is attribute-for-attribute what it was.
 * Idempotent: call it after every mutation that can add nodes.
 */
export function applyAtlasProjection(graph: Graph, tilted: boolean): void {
  if (!tilted) {
    graph.forEachNode((key, attrs) => {
      if (typeof attrs.layoutX !== "number") return;
      graph.updateNodeAttributes(key, ({ layoutX, layoutY, groundY: _groundY, ...rest }) => ({
        ...rest,
        x: layoutX,
        y: layoutY
      }));
    });
    return;
  }

  const layoutOf = (attrs: NodeAttributes): { x: number; y: number } => typeof attrs.layoutX === "number"
    ? { x: attrs.layoutX, y: Number(attrs.layoutY) }
    : { x: Number(attrs.x), y: Number(attrs.y) };

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  graph.forEachNode((_key, attrs) => {
    const { x, y } = layoutOf(attrs);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  });
  const span = Math.max(maxX - minX, maxY - minY);
  const depthUnit = (Number.isFinite(span) && span > 0 ? span : 1) * DEPTH_UNIT_SHARE;

  graph.forEachNode((key, attrs) => {
    const layout = layoutOf(attrs);
    // The tilt is defined in screen space, where y grows downward; Sigma's graph
    // space grows upward, hence the two sign flips.
    const lifted = applyFixedTilt(layout.x, -layout.y, depthOffsetForLevel(nodeAbstractionLevel(attrs), depthUnit));
    const ground = applyFixedTilt(layout.x, -layout.y, 0);
    graph.mergeNodeAttributes(key, {
      layoutX: layout.x,
      layoutY: layout.y,
      groundY: -ground.screenY,
      x: lifted.screenX,
      y: -lifted.screenY
    });
  });
}
