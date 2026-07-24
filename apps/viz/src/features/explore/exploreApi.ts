import type { Confidence, NodeKind, Origin, Resolution } from "../../api/types.ts";

const API_BASE = "/api/v1";

/**
 * The tool-node shape served by /path, /routes, /tests, /docs (mcp ToolNode,
 * re-declared here because the app cannot import @tadori/* — same idiom as
 * searchApi/boundariesApi). Only the fields these displays render are typed;
 * the server may carry more, which we pass through untouched.
 */
export interface ExploreNode {
  entityKey: string;
  kind: NodeKind;
  qualifiedName: string;
  displayName: string;
  file: string | null;
  signature?: string | null;
  lineStart?: number | null;
  lineEnd?: number | null;
  exported?: boolean;
  [key: string]: unknown;
}

/** The tool-edge shape served alongside path results (mcp ToolEdge). */
export interface ExploreEdge {
  entityKey: string;
  srcEntityKey: string;
  relation: string;
  dstEntityKey: string;
  origin: Origin;
  confidence: Confidence;
  resolution: Resolution;
  [key: string]: unknown;
}

/** One found path: an ordered node/edge sequence (mirrors the path-tool graphPath). */
export interface PathSequence {
  nodes: ExploreNode[];
  edges: ExploreEdge[];
}

/**
 * GET /api/v1/path response — the FULL path-tool output (08-07 parity). `status`
 * distinguishes ok / not_found / ambiguous / no_path / search_limit;
 * `nearestApproach` is populated ONLY when no path was found; `from/to`
 * Candidates carry the options for an ambiguous endpoint. Mirrors the frozen
 * pathOutputSchema (extra tool fields like `context` are ignored here).
 */
export interface PathResult {
  status: "ok" | "not_found" | "ambiguous" | "no_path" | "search_limit";
  from: ExploreNode | null;
  to: ExploreNode | null;
  fromCandidates: ExploreNode[];
  toCandidates: ExploreNode[];
  paths: PathSequence[];
  nearestApproach: ExploreNode[];
  message: string;
}

/**
 * One route with the origin of its path (mirrors server RouteRow).
 * `pathSourceOrigin` is null when the route has no `routes_to` edge.
 */
export interface RouteRow {
  node: ExploreNode;
  pathSourceOrigin: Origin | null;
}

/** GET /api/v1/routes response (server RoutesDto). */
export interface RoutesResult {
  routes: RouteRow[];
}

/**
 * How a test links to the queried target (mirrors server TestLinkage). A
 * static/heuristic/git link is NEVER a runtime-coverage claim.
 */
export type TestLinkage =
  | "statically_linked"
  | "naming_associated"
  | "package_associated"
  | "historically_associated"
  | "evidence_associated";

/** One likely-relevant test; `linkage` is null when the query had no target. */
export interface TestLink {
  node: ExploreNode;
  linkage: TestLinkage | null;
  edge: ExploreEdge | null;
}

/**
 * GET /api/v1/tests response (server TestsDto). `observed:false` +
 * `note:"not observed inspected"` are frozen honesty fields: a static/heuristic
 * link is never a claim the test was run. When queried with a target, each test
 * carries its linkage kind; the whole-snapshot listing has linkage:null.
 */
export interface TestsResult {
  target: ExploreNode | null;
  tests: TestLink[];
  observed: false;
  note: string;
}

/** One doc/ADR with its body and the `documents` edges it grounds (mirrors server DocEntry). */
export interface DocEntry {
  node: ExploreNode;
  body: string | null;
  documents: ExploreEdge[];
}

/** GET /api/v1/docs response (server DocsDto). */
export interface DocsResult {
  docs: DocEntry[];
}

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status}`);
  }
  return response.json();
}

/**
 * Find paths between two entities. `from`/`to` are entity keys or names the
 * server resolves. Returns the full path-tool output — its `status` field
 * distinguishes an unresolved endpoint (`not_found`), an ambiguous one
 * (`ambiguous`, with candidates), no path (`no_path`, with a nearestApproach
 * hint), a safety-limited search (`search_limit`), and success (`ok`). Optional
 * `relations` (comma-joined by the server default) and `k` refine the search.
 */
export async function fetchPath(
  from: string,
  to: string,
  options?: { relations?: string[]; k?: number }
): Promise<PathResult> {
  const params = new URLSearchParams({ from, to });
  if (options?.relations !== undefined && options.relations.length > 0) {
    params.set("relations", options.relations.join(","));
  }
  if (options?.k !== undefined) {
    params.set("k", String(options.k));
  }
  const response = await fetch(`${API_BASE}/path?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`path failed: ${response.status}`);
  }
  return (await response.json()) as PathResult;
}

export async function fetchRoutes(): Promise<RoutesResult> {
  return (await getJson("/routes")) as RoutesResult;
}

export async function fetchLikelyTests(forEntity?: string): Promise<TestsResult> {
  const query =
    forEntity !== undefined && forEntity.length > 0 ? `?for=${encodeURIComponent(forEntity)}` : "";
  return (await getJson(`/tests${query}`)) as TestsResult;
}

export async function fetchDocs(forEntity?: string): Promise<DocsResult> {
  const query =
    forEntity !== undefined && forEntity.length > 0 ? `?for=${encodeURIComponent(forEntity)}` : "";
  return (await getJson(`/docs${query}`)) as DocsResult;
}
