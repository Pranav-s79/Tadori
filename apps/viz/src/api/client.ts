import type { ApiContext, ApiEdge, ApiNode, LayoutPositionDto } from "./types.ts";

const API_BASE = "/api/v1";

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    throw new Error(`GET ${path} failed: ${response.status}`);
  }
  return response.json();
}

/**
 * The real server wraps list endpoints in a paginated envelope
 * (`{ items, nextCursor, total }`, see packages/server/src/routes/graph.ts)
 * but a mock or a future flat-shaped server might reply with the bare
 * array under a shape-specific key. Reading `.items` first and falling
 * back to the named key keeps this client working against either.
 */
function unwrapList<T>(body: unknown, flatKey: string): T[] {
  if (body !== null && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (Array.isArray(record.items)) {
      return record.items as T[];
    }
    if (Array.isArray(record[flatKey])) {
      return record[flatKey] as T[];
    }
  }
  if (Array.isArray(body)) {
    return body as T[];
  }
  throw new Error(`unexpected list response shape for "${flatKey}"`);
}

export async function fetchSnapshot(): Promise<ApiContext> {
  return (await getJson("/snapshot")) as ApiContext;
}

export async function fetchNodes(params?: { level?: string }): Promise<ApiNode[]> {
  const query = params?.level !== undefined ? `?level=${encodeURIComponent(params.level)}` : "";
  const body = await getJson(`/nodes${query}`);
  return unwrapList<ApiNode>(body, "nodes");
}

export async function fetchEdges(): Promise<ApiEdge[]> {
  const body = await getJson("/edges");
  return unwrapList<ApiEdge>(body, "edges");
}

export async function fetchLayout(level: string): Promise<{ positions: LayoutPositionDto[]; layoutVersion: number }> {
  const body = await getJson(`/layout?level=${encodeURIComponent(level)}`);
  const record = body as Record<string, unknown>;
  return {
    positions: unwrapList<LayoutPositionDto>(body, "positions"),
    layoutVersion: typeof record.layoutVersion === "number" ? record.layoutVersion : 0
  };
}

// Repo-wide file-level fetches (09-03 boundary placement). The layout engine
// already materializes a deterministic file-level layout (level=file); boundary
// badges reuse those coordinates verbatim rather than recomputing anything. No
// packageName scoping — one fetch covers every file so a violation in any file
// can be placed whether or not its package is expanded.
export async function fetchAllFileNodes(): Promise<ApiNode[]> {
  const body = await getJson("/nodes?level=file");
  return unwrapList<ApiNode>(body, "nodes");
}

export async function fetchAllFileLayout(): Promise<LayoutPositionDto[]> {
  const body = await getJson("/layout?level=file");
  return unwrapList<LayoutPositionDto>(body, "positions");
}

// File-level fetches for semantic zoom (08-03), scoped to one package via the
// server's `level=file&packageName=<key>` query (see
// packages/server/src/routes/graph.ts). The `/edges` route does not itself take
// `packageName`, so `fetchFileEdges` passes it for the mock and the real server
// tolerates the extra key; the caller keeps only edges touching the package.
// ponytail: client-side edge scoping; add a server-side packageName filter to
// /edges if per-package edge volume ever matters.
export async function fetchFileNodes(packageName: string): Promise<ApiNode[]> {
  const body = await getJson(`/nodes?level=file&packageName=${encodeURIComponent(packageName)}`);
  return unwrapList<ApiNode>(body, "nodes");
}

export async function fetchFileEdges(packageName: string): Promise<ApiEdge[]> {
  const body = await getJson(`/edges?level=file&packageName=${encodeURIComponent(packageName)}`);
  return unwrapList<ApiEdge>(body, "edges");
}

export async function fetchFileLayout(packageName: string): Promise<LayoutPositionDto[]> {
  const body = await getJson(`/layout?level=file&packageName=${encodeURIComponent(packageName)}`);
  return unwrapList<LayoutPositionDto>(body, "positions");
}
