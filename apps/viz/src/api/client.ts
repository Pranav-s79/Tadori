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
