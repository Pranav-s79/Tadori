import type { ApiContext, ApiEdge, ApiNode, LayoutPositionDto, RegionProjectionDto } from "./types.ts";
import {
  assertLodResponseWithinBudget,
  clampLodRequestLimit,
  type LodLevel
} from "../lod/budgets.ts";

const API_BASE = "/api/v1";

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    throw new Error(`GET ${path} failed: ${response.status}`);
  }
  return response.json();
}

interface PageEnvelope<T> {
  items: T[];
  nextCursor: string | null;
  total: number | null;
  omittedCount: number;
  projection: ProjectionAccounting | null;
  scope: ScopeAccounting | null;
}

export interface ProjectionAccounting {
  candidateEdgeCount: number;
  projectedEdgeCount: number;
  omittedEdgeCount: number;
  ambiguousEntityCount: number;
  unownedEntityCount: number;
}

export interface ScopeAccounting {
  totalNodeCount: number;
  boundedNodeCount: number;
  omittedNodeCount: number;
  omittedEdgeCount: number;
}

export type LodPage<T> = PageEnvelope<T>;

async function getLodPage<T>(
  path: string,
  flatKey: string,
  level: LodLevel,
  kind: "nodes" | "edges",
  requestedLimit?: number
): Promise<LodPage<T>> {
  const limit = clampLodRequestLimit(level, kind, requestedLimit);
  const separator = path.includes("?") ? "&" : "?";
  const body = await getJson(`${path}${separator}limit=${String(limit)}`);
  const page = pageEnvelope<T>(body);
  const items = page?.items ?? unwrapList<T>(body, flatKey);
  assertLodResponseWithinBudget(level, kind, items.length);
  return page ?? { items, nextCursor: null, total: items.length, omittedCount: 0, projection: null, scope: null };
}

function pageEnvelope<T>(body: unknown): PageEnvelope<T> | null {
  if (body === null || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.items)) return null;
  if (record.nextCursor !== null && typeof record.nextCursor !== "string") {
    throw new Error("unexpected paginated response cursor");
  }
  if (record.total !== null && typeof record.total !== "number") {
    throw new Error("unexpected paginated response total");
  }
  if (record.omittedCount !== undefined && (!Number.isInteger(record.omittedCount) || (record.omittedCount as number) < 0)) {
    throw new Error("unexpected paginated response omission count");
  }
  return {
    items: record.items as T[],
    nextCursor: record.nextCursor as string | null,
    total: record.total as number | null,
    omittedCount: record.omittedCount as number | undefined
      ?? Math.max(0, ((record.total as number | null) ?? record.items.length) - record.items.length),
    projection: record.projection as ProjectionAccounting | undefined ?? null,
    scope: record.scope as ScopeAccounting | undefined ?? null
  };
}

async function getAllPages<T>(
  path: string,
  flatKey: string,
  pageLimit: number
): Promise<T[]> {
  const separator = path.includes("?") ? "&" : "?";
  const items: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let expectedTotal: number | null = null;
  do {
    const suffix = `${separator}limit=${String(pageLimit)}${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
    const body = await getJson(`${path}${suffix}`);
    const page = pageEnvelope<T>(body);
    if (page === null) {
      if (cursor !== null) throw new Error(`pagination ended with a non-page response for "${flatKey}"`);
      return unwrapList<T>(body, flatKey);
    }
    items.push(...page.items);
    if (expectedTotal === null) expectedTotal = page.total;
    else if (page.total !== expectedTotal) throw new Error(`pagination total changed for "${flatKey}"`);
    cursor = page.nextCursor;
    if (cursor !== null && seenCursors.has(cursor)) throw new Error(`pagination cursor repeated for "${flatKey}"`);
    if (cursor !== null) seenCursors.add(cursor);
  } while (cursor !== null);
  if (expectedTotal !== null && items.length !== expectedTotal) {
    throw new Error(`paginated response for "${flatKey}" omitted ${String(expectedTotal - items.length)} item(s)`);
  }
  return items;
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
  const body = await getJson("/snapshot");
  if (body !== null && typeof body === "object" && "context" in body) {
    return (body as { context: ApiContext }).context;
  }
  return body as ApiContext;
}

export async function fetchRegions(): Promise<RegionProjectionDto> {
  return await getJson("/regions") as RegionProjectionDto;
}

export async function fetchNodes(params?: {
  level?: LodLevel;
  packageName?: string;
  file?: string;
  limit?: number;
}): Promise<ApiNode[]> {
  const query = new URLSearchParams();
  if (params?.level !== undefined) query.set("level", params.level);
  if (params?.packageName !== undefined) query.set("packageName", params.packageName);
  if (params?.file !== undefined) query.set("file", params.file);
  const suffix = query.size === 0 ? "" : `?${query.toString()}`;
  if (params?.level !== undefined) {
    return (await getLodPage<ApiNode>(`/nodes${suffix}`, "nodes", params.level, "nodes", params.limit)).items;
  }
  return getAllPages<ApiNode>(`/nodes${suffix}`, "nodes", 500);
}

export async function fetchEdges(params?: {
  level?: LodLevel;
  relation?: string;
  packageName?: string;
  file?: string;
  limit?: number;
}): Promise<ApiEdge[]> {
  const query = new URLSearchParams();
  if (params?.level !== undefined) query.set("level", params.level);
  if (params?.relation !== undefined) query.set("relation", params.relation);
  if (params?.packageName !== undefined) query.set("packageName", params.packageName);
  if (params?.file !== undefined) query.set("file", params.file);
  const suffix = query.size === 0 ? "" : `?${query.toString()}`;
  if (params?.level !== undefined) {
    return (await getLodPage<ApiEdge>(`/edges${suffix}`, "edges", params.level, "edges", params.limit)).items;
  }
  return getAllPages<ApiEdge>("/edges", "edges", 1000);
}

export async function fetchPackageNodes(limit?: number): Promise<ApiNode[]> {
  return (await fetchPackageNodesPage(limit)).items;
}

export async function fetchPackageNodesPage(limit?: number): Promise<LodPage<ApiNode>> {
  return getLodPage<ApiNode>("/nodes?level=package", "nodes", "package", "nodes", limit);
}

export async function fetchPackageEdges(limit?: number): Promise<ApiEdge[]> {
  return (await fetchPackageEdgesPage(limit)).items;
}

export async function fetchPackageEdgesPage(limit?: number): Promise<LodPage<ApiEdge>> {
  return getLodPage<ApiEdge>("/edges?level=package", "edges", "package", "edges", limit);
}

export async function fetchLayout(level: string): Promise<{ positions: LayoutPositionDto[]; layoutVersion: number }> {
  const body = await getJson(`/layout?level=${encodeURIComponent(level)}`);
  const record = body as Record<string, unknown>;
  return {
    positions: unwrapList<LayoutPositionDto>(body, "positions"),
    layoutVersion: typeof record.layoutVersion === "number" ? record.layoutVersion : 0
  };
}

// Bounded repo-wide file-level fetches for boundary placement. The overlay
// reuses server positions verbatim; violations outside the LOD response remain
// in the textual unplaced list instead of receiving fabricated coordinates.
export async function fetchAllFileNodes(): Promise<ApiNode[]> {
  return fetchNodes({ level: "file" });
}

export async function fetchAllFileLayout(): Promise<LayoutPositionDto[]> {
  const body = await getJson("/layout?level=file");
  return unwrapList<LayoutPositionDto>(body, "positions");
}

// File-level semantic zoom, scoped and bounded by the server to one package.
export async function fetchFileNodes(packageName: string): Promise<ApiNode[]> {
  return (await fetchFileNodesPage(packageName)).items;
}

export async function fetchFileNodesPage(packageName: string): Promise<LodPage<ApiNode>> {
  return getLodPage<ApiNode>(`/nodes?level=file&packageName=${encodeURIComponent(packageName)}`, "nodes", "file", "nodes");
}

export async function fetchFileEdges(packageName: string): Promise<ApiEdge[]> {
  return (await fetchFileEdgesPage(packageName)).items;
}

export async function fetchFileEdgesPage(packageName: string): Promise<LodPage<ApiEdge>> {
  return getLodPage<ApiEdge>(`/edges?level=file&packageName=${encodeURIComponent(packageName)}`, "edges", "file", "edges");
}

export async function fetchFileLayout(packageName: string): Promise<LayoutPositionDto[]> {
  const body = await getJson(`/layout?level=file&packageName=${encodeURIComponent(packageName)}`);
  return unwrapList<LayoutPositionDto>(body, "positions");
}

// Symbol-level semantic zoom, scoped and bounded by the server to one file.
export async function fetchSymbolNodes(file: string): Promise<ApiNode[]> {
  return (await fetchSymbolNodesPage(file)).items;
}

export async function fetchSymbolNodesPage(file: string): Promise<LodPage<ApiNode>> {
  return getLodPage<ApiNode>(`/nodes?level=symbol&file=${encodeURIComponent(file)}`, "nodes", "symbol", "nodes");
}

export async function fetchSymbolEdges(file: string): Promise<ApiEdge[]> {
  return (await fetchSymbolEdgesPage(file)).items;
}

export async function fetchSymbolEdgesPage(file: string): Promise<LodPage<ApiEdge>> {
  return getLodPage<ApiEdge>(`/edges?level=symbol&file=${encodeURIComponent(file)}`, "edges", "symbol", "edges");
}

export async function fetchSymbolLayout(file: string): Promise<LayoutPositionDto[]> {
  const body = await getJson(`/layout?level=symbol&file=${encodeURIComponent(file)}`);
  return unwrapList<LayoutPositionDto>(body, "positions");
}
