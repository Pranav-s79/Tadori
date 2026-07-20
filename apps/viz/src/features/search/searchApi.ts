import type { NodeKind } from "../../api/types.ts";
import type { SearchFilters } from "./filterState.ts";

const API_BASE = "/api/v1";

const MAX_LIMIT = 100;
const MIN_LIMIT = 1;
const MAX_OFFSET = 1_000_000;

/**
 * ASSUMPTION (deviation from blueprint §10 SearchResultRow): the live search
 * row (packages/store FtsMatchRow, served verbatim by GET /api/v1/search) does
 * NOT carry `fanIn`, `freshness`, or `stale`. The blueprint's historical §10
 * hint listed them, but the frozen store contract's FtsMatchRow does not
 * expose them — search is an FTS query over name/signature/path only. We map
 * ONLY fields that exist and omit fanIn/freshness/stale badges for search
 * results. (Full node metadata incl. freshness is reachable via the node/
 * inspection endpoints, out of scope here.)
 */
export interface SearchResultRow {
  entityKey: string;
  kind: NodeKind;
  displayName: string;
  qualifiedName: string;
  file: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  exported: boolean;
  exactMatch: boolean; // from FtsMatchRow.exact_match (0|1)
}

export interface SearchApiResult {
  generation: number;
  rows: SearchResultRow[];
  total: number;
  offset: number;
  limit: number;
}

/** Wire shape of GET /api/v1/search (FtsSearchResult, matches served verbatim). */
interface FtsMatchRowWire {
  node_id: number;
  entity_key: string;
  kind: NodeKind;
  qualified_name: string;
  display_name: string;
  signature: string | null;
  file_path: string | null;
  line_start: number | null;
  line_end: number | null;
  exported: number; // 0|1
  rank: number;
  exact_match: number; // 0|1
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return MIN_LIMIT;
  }
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.trunc(limit)));
}

function clampOffset(offset: number): number {
  if (!Number.isFinite(offset)) {
    return 0;
  }
  return Math.min(MAX_OFFSET, Math.max(0, Math.trunc(offset)));
}

function mapRow(row: FtsMatchRowWire): SearchResultRow {
  return {
    entityKey: row.entity_key,
    kind: row.kind,
    displayName: row.display_name,
    qualifiedName: row.qualified_name,
    file: row.file_path,
    lineStart: row.line_start,
    lineEnd: row.line_end,
    exported: row.exported === 1,
    exactMatch: row.exact_match === 1
  };
}

/**
 * The sole fetch wrapper for GET /api/v1/search. Owns client-side limit/offset
 * clamping (defense in depth — the server 400s out-of-range, but the store's
 * RangeError path must never be reachable through the UI, blueprint §8) and
 * echoes back the `generation` it was given so the caller's monotonic guard can
 * discard stale responses (blueprint §8/§11 step 2 — the guard is the caller's
 * job; this function always resolves with the generation it received).
 *
 * `kind` param rule (blueprint §10): the server's search `kind` is singular. We
 * send it ONLY when exactly one kind filter is active; with 0 or >1 kinds we
 * send no kind param and the multi-kind narrowing is applied client-side to the
 * returned rows by the caller. This keeps exactly one server contract in play.
 */
export async function fetchSearch(
  query: string,
  filters: SearchFilters,
  page: { limit: number; offset: number },
  generation: number
): Promise<SearchApiResult> {
  const limit = clampLimit(page.limit);
  const offset = clampOffset(page.offset);

  const params = new URLSearchParams();
  params.set("q", query);
  const soleKind = filters.kinds.length === 1 ? filters.kinds[0] : undefined;
  if (soleKind !== undefined) {
    params.set("kind", soleKind);
  }
  params.set("limit", String(limit));
  params.set("offset", String(offset));

  const response = await fetch(`${API_BASE}/search?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`search failed: ${response.status}`);
  }
  const body: unknown = await response.json();
  if (body === null || typeof body !== "object" || !Array.isArray((body as { matches?: unknown }).matches)) {
    throw new Error("unexpected search response shape");
  }
  const wire = body as { matches: FtsMatchRowWire[]; total: number };
  let rows = wire.matches.map(mapRow);

  // Multi-kind narrowing is client-side (server kind param is singular).
  // Order is preserved verbatim from the server — filter() keeps server order,
  // never re-sorts (blueprint §14 acceptance: UI never re-sorts).
  if (filters.kinds.length > 1) {
    const kindSet = new Set(filters.kinds);
    rows = rows.filter((row) => kindSet.has(row.kind));
  }

  return {
    generation,
    rows,
    total: typeof wire.total === "number" ? wire.total : rows.length,
    offset,
    limit
  };
}
