import type {
  ApiEdge,
  ApiNode,
  Confidence,
  NodeKind,
  Origin,
  Resolution
} from "../../api/types.ts";
import type { ExtractionCapability, ExtractionDerivation } from "../../api/types.ts";
import { attributedProvenance } from "../../api/types.ts";

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
  | "contains"
  | "imports"
  | "exports"
  | "references"
  | "calls"
  | "implements"
  | "extends"
  | "tests"
  | "documents"
  | "routes_to"
  | "changed_with";

export const RELATIONS: readonly Relation[] = [
  "contains",
  "imports",
  "exports",
  "references",
  "calls",
  "implements",
  "extends",
  "tests",
  "documents",
  "routes_to",
  "changed_with"
];

export const ORIGINS: readonly Origin[] = ["compiler", "heuristic", "git", "doc", "human", "llm"];
export const CONFIDENCES: readonly Confidence[] = ["certain", "likely", "inferred"];
export const RESOLUTIONS: readonly Resolution[] = ["resolved", "partial", "unresolved"];
export const CAPABILITIES: readonly ExtractionCapability[] = ["semantic", "structural", "repository"];
export const DERIVATIONS: readonly ExtractionDerivation[] = ["compiler-resolved", "parser-derived", "convention-derived", "repository-derived", "inferred"];

export interface SearchFilters {
  kinds: NodeKind[]; // subset of the 13 frozen NODE_KINDS; [] = no kind restriction
  relations: Relation[]; // subset of the 11 frozen RELATIONS; graph-render filter only
  origins: Origin[]; // subset of the 6 frozen ORIGINS; graph-render filter only
  confidences: Confidence[]; // subset of the 3 frozen CONFIDENCES
  resolutions: Resolution[]; // subset of the 3 frozen RESOLUTIONS
  languages: string[];
  capabilities: ExtractionCapability[];
  derivations: ExtractionDerivation[];
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
  return { kinds: [], relations: [], origins: [], confidences: [], resolutions: [], languages: [], capabilities: [], derivations: [] };
}

/**
 * How many individual filter values are selected across every group.
 *
 * The filter groups now live behind a collapsed disclosure, so this is what the
 * summary shows: a collapsed filter set must never be able to constrain the
 * results silently. The reader has to be able to see that a filter is on
 * without opening the panel.
 */
export function activeFilterCount(filters: SearchFilters): number {
  return (
    filters.kinds.length +
    filters.relations.length +
    filters.origins.length +
    filters.confidences.length +
    filters.resolutions.length +
    filters.languages.length +
    filters.capabilities.length +
    filters.derivations.length
  );
}

export function filtersActive(filters: SearchFilters): boolean {
  return activeFilterCount(filters) > 0;
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
  const nodes: RenderableNode[] = graph.nodes.map((node) => ({
    node,
    visible: nodeMatchesFilters(node, filters)
  }));

  const edges: RenderableEdge[] = graph.edges.map((edge) => ({
    edge,
    visible: edgeMatchesFilters(edge, filters)
  }));

  return { nodes, edges };
}

export function edgeMatchesFilters(edge: ApiEdge, filters: SearchFilters): boolean {
  const provenanceBuckets = edge.aggregateProvenance !== undefined && edge.aggregateProvenance.length > 0
    ? edge.aggregateProvenance : (edge.origin !== undefined
    && edge.confidence !== undefined && edge.resolution !== undefined
    ? [{ origin: edge.origin, confidence: edge.confidence, resolution: edge.resolution, count: 1 }]
    : []);
  // An unattributed edge has no origin/confidence/resolution, so it cannot
  // satisfy one of those filters -- but with none of them active it must stay
  // visible rather than being hidden for lacking a value nobody asked about.
  const provenanceFilterActive = filters.origins.length > 0
    || filters.confidences.length > 0
    || filters.resolutions.length > 0;
  const provenanceMatches = !provenanceFilterActive
    || attributedProvenance(provenanceBuckets).some((bucket) =>
      (filters.origins.length === 0 || filters.origins.includes(bucket.origin))
      && (filters.confidences.length === 0 || filters.confidences.includes(bucket.confidence))
      && (filters.resolutions.length === 0 || filters.resolutions.includes(bucket.resolution)));
  const languages = edge.aggregateLanguages !== undefined && edge.aggregateLanguages.length > 0
    ? edge.aggregateLanguages : edge.language ? [edge.language] : [];
  const capabilities = edge.aggregateCapabilities !== undefined && edge.aggregateCapabilities.length > 0
    ? edge.aggregateCapabilities : edge.provenance ? [edge.provenance.capability] : [];
  const derivations = edge.aggregateDerivations !== undefined && edge.aggregateDerivations.length > 0
    ? edge.aggregateDerivations : edge.provenance ? [edge.provenance.derivation] : [];
  return (filters.relations.length === 0 || filters.relations.includes(edge.relation as Relation)) &&
    ((filters.origins.length === 0 && filters.confidences.length === 0 && filters.resolutions.length === 0) || provenanceMatches) &&
    (filters.languages.length === 0 || filters.languages.some((value) => languages.includes(value))) &&
    (filters.capabilities.length === 0 || filters.capabilities.some((value) => capabilities.includes(value))) &&
    (filters.derivations.length === 0 || filters.derivations.some((value) => derivations.includes(value)));
}

export function nodeMatchesFilters(node: ApiNode, filters: SearchFilters): boolean {
  const languages = node.aggregateLanguages ?? (node.language === undefined || node.language === null ? [] : [node.language]);
  const capabilities = node.aggregateCapabilities ?? (node.provenance === undefined || node.provenance === null ? [] : [node.provenance.capability]);
  const derivations = node.aggregateDerivations ?? (node.provenance === undefined || node.provenance === null ? [] : [node.provenance.derivation]);
  return (filters.kinds.length === 0 || filters.kinds.includes(node.kind)) &&
    (filters.languages.length === 0 || filters.languages.some((value) => languages.includes(value))) &&
    (filters.capabilities.length === 0 || filters.capabilities.some((value) => capabilities.includes(value))) &&
    (filters.derivations.length === 0 || filters.derivations.some((value) => derivations.includes(value)));
}
