import type Graph from "graphology";
import type { ApiNode, NodeKind } from "../api/types.ts";
import { convexHull, type Point } from "../graph/convexHull.ts";
import type { AtlasEdgePattern } from "../graph/atlasVisuals.ts";
import { truncate } from "../graph/expansion.ts";
import { depthOffsetForLevel, type AbstractionLevel } from "../render/depthBinding.ts";

/**
 * The 3D Atlas reads exactly the graph Plan draws: the same graphology nodes
 * and edges, the same served layout x/y, and the same style attributes
 * (colour, edge pattern, selection, filter and Story dimming) that
 * `applyAtlasGraphStyles` and friends write. Nothing here invents a position or
 * a relation. The only added dimension is height, and height is the node's
 * abstraction level through `depthBinding.ts`.
 *
 * World axes: the ground is the XZ plane and Y is up. Layout y grows up the
 * screen in Plan, so it maps to -Z, which is "away from" the default camera.
 */

/** The larger side of the rendered layout, in world units. */
export const WORLD_SPAN = 100;
/** Height of one abstraction level, in world units. */
export const LEVEL_HEIGHT = 9;
/** Thickness of a package's stone slab. */
export const PLATE_THICKNESS = 1.2;
/** Stone kept around an expanded package's members. */
const PLATE_PADDING = 3;
const LABEL_MAX = 24;

export type Vec3 = readonly [number, number, number];

export interface SceneNode {
  /** The graphology key, which is what every map action takes. */
  key: string;
  entityKey: string;
  kind: NodeKind;
  level: AbstractionLevel;
  label: string;
  /** Ground point under the node. */
  ground: Vec3;
  /** Centre of the node's base on its level (the ground for a package). */
  base: Vec3;
  /** Top centre: where edges meet the node and its label hangs. */
  anchor: Vec3;
  /** Width, height, depth of the node's block. */
  size: Vec3;
  color: string;
  selected: boolean;
  dimmed: boolean;
}

export interface ScenePlate {
  /** The package node's graph key. */
  key: string;
  /** Slab footprint on the ground, counter-clockwise in world X/Z. */
  outline: Point[];
  color: string;
  selected: boolean;
  dimmed: boolean;
}

export interface SceneEdge {
  key: string;
  from: Vec3;
  to: Vec3;
  pattern: AtlasEdgePattern;
  color: string;
  dimmed: boolean;
}

export interface AtlasSceneModel {
  nodes: SceneNode[];
  plates: ScenePlate[];
  edges: SceneEdge[];
}

type Attributes = Readonly<Record<string, unknown>>;

/**
 * The abstraction level a rendered node was fetched at. Expansion marks what it
 * adds: `expandedFromFile` for the symbol-level request, `expandedFrom` for the
 * file-level one. Everything else came from the package-level request.
 */
export function nodeAbstractionLevel(attrs: Attributes): AbstractionLevel {
  if (typeof attrs.expandedFromFile === "string") return "symbol";
  if (typeof attrs.expandedFrom === "string") return "file";
  return "package";
}

/** Block dimensions per level, grown with the size Plan gives the node. */
function blockSize(level: AbstractionLevel, baseSize: number): Vec3 {
  if (level === "package") {
    const side = 5 * (baseSize / 13);
    return [side, PLATE_THICKNESS, side];
  }
  if (level === "file") {
    const scale = baseSize / 11;
    return [1.9 * scale, 2.6 * scale, 0.5 * scale];
  }
  const side = 1.3 * (baseSize / 9);
  return [side, side, side];
}

function padOutline(points: readonly Point[], padding: number): Point[] {
  const centre = {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length
  };
  return points.map((point) => {
    const dx = point.x - centre.x;
    const dy = point.y - centre.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: point.x + (dx / length) * padding, y: point.y + (dy / length) * padding };
  });
}

function circleOutline(centre: Point, radius: number, sides: number): Point[] {
  return Array.from({ length: sides }, (_, index) => {
    const angle = (index / sides) * Math.PI * 2 + Math.PI / sides;
    return { x: centre.x + Math.cos(angle) * radius, y: centre.y + Math.sin(angle) * radius };
  });
}

/**
 * The slab under a package. Collapsed, it is a square stone of the package's
 * own size. Expanded, it is the package's members' footprint (the same convex
 * hull Plan draws as its package boundary) plus the package's own point,
 * padded, so every file tablet stands over its package's stone.
 */
function plateOutline(packageNode: SceneNode, members: readonly SceneNode[]): Point[] {
  const own = { x: packageNode.ground[0], y: packageNode.ground[2] };
  if (members.length === 0) {
    const half = packageNode.size[0] / 2;
    return [
      { x: own.x - half, y: own.y - half },
      { x: own.x + half, y: own.y - half },
      { x: own.x + half, y: own.y + half },
      { x: own.x - half, y: own.y + half }
    ];
  }
  const shape = convexHull([own, ...members.map((member) => ({ x: member.ground[0], y: member.ground[2] }))]);
  if (shape.kind === "circle") return circleOutline(shape.center, shape.radius + PLATE_PADDING, 16);
  return padOutline(shape.points, PLATE_PADDING);
}

/**
 * Builds the scene from the live graph. Deterministic: nodes, plates and edges
 * come out in key order, so the same graph always yields the same scene.
 */
export function buildAtlasScene(graph: Graph): AtlasSceneModel {
  const keys = graph.nodes().sort();
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const key of keys) {
    const x = Number(graph.getNodeAttribute(key, "x"));
    const y = Number(graph.getNodeAttribute(key, "y"));
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const span = Math.max(maxX - minX, maxY - minY);
  // Layout units have no fixed meaning (their spread grows with node count),
  // so the rendered layout is scaled to a fixed world span, as Sigma frames it.
  const scale = Number.isFinite(span) && span > 0 ? WORLD_SPAN / span : 1;
  const centreX = keys.length === 0 ? 0 : (minX + maxX) / 2;
  const centreY = keys.length === 0 ? 0 : (minY + maxY) / 2;

  const nodes: SceneNode[] = keys.map((key) => {
    const attrs = graph.getNodeAttributes(key);
    const apiNode = attrs.apiNode as ApiNode | undefined;
    const level = nodeAbstractionLevel(attrs);
    const size = blockSize(level, Number(attrs.baseSize ?? attrs.size ?? 10));
    const x = (Number(attrs.x) - centreX) * scale;
    const z = -(Number(attrs.y) - centreY) * scale;
    const height = level === "package" ? 0 : depthOffsetForLevel(level, LEVEL_HEIGHT);
    return {
      key,
      entityKey: apiNode?.entityKey ?? key,
      kind: (attrs.kind as NodeKind | undefined) ?? "package",
      level,
      label: truncate(String(attrs.displayName ?? apiNode?.displayName ?? key), LABEL_MAX),
      ground: [x, 0, z],
      base: [x, height, z],
      anchor: [x, height + size[1], z],
      size,
      color: String(attrs.color ?? "#8f8777"),
      selected: attrs.selected === true,
      dimmed: attrs.filterDimmed === true || attrs.storyDimmed === true
    };
  });

  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const plates: ScenePlate[] = nodes
    .filter((node) => node.level === "package")
    .map((node) => ({
      key: node.key,
      outline: plateOutline(node, nodes.filter((member) =>
        graph.getNodeAttribute(member.key, "expandedFrom") === node.key)),
      color: node.color,
      selected: node.selected,
      dimmed: node.dimmed
    }));

  const edges: SceneEdge[] = [];
  for (const key of graph.edges().sort()) {
    const from = byKey.get(graph.source(key));
    const to = byKey.get(graph.target(key));
    if (from === undefined || to === undefined || from === to) continue;
    const attrs = graph.getEdgeAttributes(key);
    const type = attrs.type;
    edges.push({
      key,
      from: from.anchor,
      to: to.anchor,
      pattern: type === "dashed" || type === "dotted" ? type : "solid",
      color: String(attrs.color ?? "#7c4d27"),
      dimmed: attrs.filterDimmed === true || attrs.storyDimmed === true
    });
  }

  return { nodes, plates, edges };
}
