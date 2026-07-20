import type {
  ApiEdge,
  ApiNode,
  Confidence,
  NodeKind,
  Origin,
  Resolution
} from "../../api/types.ts";

/**
 * Frozen filter vocabularies (mirror @tadori/core enums.ts — apps/viz may not
 * import @tadori/*; these are the exact frozen values per ARCHITECTURE.md §3
 * and blueprint 08-05 §4). NODE_KINDS/RELATIONS/ORIGINS/CONFIDENCES/RESOLUTIONS
 * live in src/api/types.ts as string-literal unions; the const arrays that back
 * the filter UI's checkbox rows live here since only this feature enumerates
 * them. Values must stay in lockstep with types.ts.
 */
export const NODE_KINDS: readonly NodeKind[] = [
  "package",
  "file",
  "function",
  "method",
  "class",
  "interface",
  "type",
  "route",
  "test",
  "adr",
  "doc_section",
  "external_dep",
  "unresolved"
];

export type Relation =
  | "imports"
  | "calls"
  | "extends"
  | "implements"
  | "references"
  | "contains"
  | "defines"
  | "tests"
  | "documents"
  | "routes"
  | "depends_on";

export const RELATIONS: readonly Relation[] = [
  "imports",
  "calls",
  "extends",
  "implements",
  "references",
  "contains",
  "defines",
  "tests",
  "documents",
  "routes",
  "depends_on"
];

export const ORIGINS: readonly Origin[] = ["compiler", "heuristic", "git", "doc", "human", "llm"];
export const CONFIDENCES: readonly Confidence[] = ["certain", "likely", "inferred"];
export const RESOLUTIONS: readonly Resolution[] = ["resolved", "partial", "unresolved"];

export interface SearchFilters {
  kinds: NodeKind[]; // subset of the 13 frozen NODE_KINDS; [] = no kind restriction
  relations: Relation[]; // subset of the 11 frozen RELATIONS; graph-render filter only
  origins: Origin[]; // subset of the 6 frozen ORIGINS; graph-render filter only
  confidences: Confidence[]; // subset of the 3 frozen CONFIDENCES
  resolutions: Resolution[]; // subset of the 3 frozen RESOLUTIONS
}

/**
 * A render overlay: the fetched graph plus a per-node/per-edge `visible` flag.
 * `applyFiltersToGraph` produces one of these WITHOUT mutating the input arrays
 * — filters change visibility only, never the underlying fetched data
 * (blueprint §8 "filters are a rendering overlay, never a data mutation").
 * `node`/`edge` are the SAME object references from the input (we never clone
 * or fabricate rows), so downstream code still reads the real ApiNode/ApiEdge.
 */
export interface RenderableGraph {
  nodes: ApiNode[];
  edges: ApiEdge[];
}

export interface RenderableNode {
  node: ApiNode;
  visible: boolean;
}

export interface RenderableEdge {
  edge: ApiEdge;
  visible: boolean;
}

export interface FilteredGraph {
  nodes: RenderableNode[];
  edges: RenderableEdge[];
}

export function defaultFilters(): SearchFilters {
  return { kinds: [], relations: [], origins: [], confidences: [], resolutions: [] };
}

export function filtersActive(filters: SearchFilters): boolean {
  return (
    filters.kinds.length > 0 ||
    filters.relations.length > 0 ||
    filters.origins.length > 0 ||
    filters.confidences.length > 0 ||
    filters.resolutions.length > 0
  );
}

/**
 * Pure. Returns a NEW FilteredGraph; never mutates `graph`. Intersection
 * semantics across categories: a node is visible only if it satisfies every
 * active node-applicable category (kind). An edge is visible only if it
 * satisfies every active edge-applicable category (relation/origin/confidence/
 * resolution). An empty category array means "no restriction from this
 * category". Non-matching items stay in the output marked `visible: false` —
 * they are dimmed/hidden by the renderer, never removed (never hides the
 * EXISTENCE of data, only its emphasis; blueprint §8 AD-final).
 */
export function applyFiltersToGraph(graph: RenderableGraph, filters: SearchFilters): FilteredGraph {
  const kindSet = new Set(filters.kinds);
  const relationSet = new Set<string>(filters.relations);
  const originSet = new Set(filters.origins);
  const confidenceSet = new Set(filters.confidences);
  const resolutionSet = new Set(filters.resolutions);

  const nodes: RenderableNode[] = graph.nodes.map((node) => ({
    node,
    visible: kindSet.size === 0 || kindSet.has(node.kind)
  }));

  const edges: RenderableEdge[] = graph.edges.map((edge) => ({
    edge,
    visible:
      (relationSet.size === 0 || relationSet.has(edge.relation)) &&
      (originSet.size === 0 || originSet.has(edge.origin)) &&
      (confidenceSet.size === 0 || confidenceSet.has(edge.confidence)) &&
      (resolutionSet.size === 0 || resolutionSet.has(edge.resolution))
  }));

  return { nodes, edges };
}
