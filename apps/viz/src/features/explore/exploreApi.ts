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

/**
 * GET /api/v1/path response (server PathResultDto). NOTE: the live server today
 * returns the NARROW shape — a single BFS path as `{nodes, edges, found}`, not
 * the richer mcp `path`-tool output (status enum / multiple paths /
 * nearestApproach). These displays render exactly what the server sends; the
 * richer parity engine is a documented follow-up, not faked here.
 */
export interface PathResult {
  nodes: ExploreNode[];
  edges: ExploreEdge[];
  found: boolean;
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

/** GET /api/v1/docs response (server DocsDto). */
export interface DocsResult {
  docs: { node: ExploreNode; body: string | null }[];
}

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status}`);
  }
  return response.json();
}

/**
 * Find a path between two entities. `from`/`to` are entity keys or names the
 * server resolves. The server returns 404 (unknown_endpoint) when a reference
 * does not resolve; we surface that as a distinct "unresolved" result rather
 * than a generic error, so the UI can tell "no path" apart from "no such node".
 */
export async function fetchPath(
  from: string,
  to: string,
  maxDepth?: number
): Promise<PathResult | "unresolved"> {
  const params = new URLSearchParams({ from, to });
  if (maxDepth !== undefined) {
    params.set("maxDepth", String(maxDepth));
  }
  const response = await fetch(`${API_BASE}/path?${params.toString()}`);
  if (response.status === 404) {
    return "unresolved";
  }
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
