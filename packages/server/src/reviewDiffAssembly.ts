import type { EdgeDiffRow } from "@tadori/store";
import type { ToolNode } from "@tadori/mcp";

/**
 * Pagination + omission accounting for a review diff. A review diff is three
 * parallel lists (added nodes, removed nodes, changed edges); a single cursor
 * paginates over their concatenation in a fixed order (addedNodes, then
 * removedNodes, then edges) so that a multi-page fetch reconstructs the whole
 * diff with zero duplicate or missing rows. Each page reports how many rows of
 * EACH list were NOT included on this page (omitted), never silently dropping
 * them.
 */

export interface ReviewDiffPageInput {
  nodesAdded: ToolNode[];
  nodesRemoved: ToolNode[];
  edges: EdgeDiffRow[];
}

export interface ReviewDiffPage {
  nodesAdded: ToolNode[];
  nodesRemoved: ToolNode[];
  edges: EdgeDiffRow[];
  /** Rows of each list beyond this page's window (not yet returned). */
  nodesAddedOmitted: number;
  nodesRemovedOmitted: number;
  edgesOmitted: number;
  /** Opaque offset cursor for the next page, or null when the diff is exhausted. */
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

/** Parse a `?cursor=` value: absent → 0, a non-negative integer string → its value, else null (invalid). */
export function parseReviewCursor(raw: string | undefined): number | null {
  if (raw === undefined) {
    return 0;
  }
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  return Number(raw);
}

/** Parse a `?limit=` value: absent → default, 1..MAX integer → its value, else null (invalid). */
export function parseReviewLimit(raw: string | undefined): number | null {
  if (raw === undefined) {
    return DEFAULT_LIMIT;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    return null;
  }
  return value;
}

/**
 * Take a single page of `limit` rows starting at `offset` across the combined
 * (addedNodes ++ removedNodes ++ edges) sequence. Rows are assigned to the page
 * in that fixed order; the omitted counts report, per list, how many of that
 * list's rows are NOT on this page (i.e. before `offset` or after the window).
 * `nextCursor` is the next offset as a string, or null when the page reaches
 * the end of the combined sequence.
 */
export function paginateReviewDiff(
  input: ReviewDiffPageInput,
  offset: number,
  limit: number
): ReviewDiffPage {
  const addedLen = input.nodesAdded.length;
  const removedLen = input.nodesRemoved.length;
  const edgesLen = input.edges.length;
  const total = addedLen + removedLen + edgesLen;

  const end = Math.min(offset + limit, total);

  // Boundaries of each list within the combined sequence.
  const removedStart = addedLen;
  const edgesStart = addedLen + removedLen;

  const pageAdded = input.nodesAdded.slice(clamp(offset, 0, addedLen), clamp(end, 0, addedLen));
  const pageRemoved = input.nodesRemoved.slice(
    clamp(offset - removedStart, 0, removedLen),
    clamp(end - removedStart, 0, removedLen)
  );
  const pageEdges = input.edges.slice(
    clamp(offset - edgesStart, 0, edgesLen),
    clamp(end - edgesStart, 0, edgesLen)
  );

  return {
    nodesAdded: pageAdded,
    nodesRemoved: pageRemoved,
    edges: pageEdges,
    nodesAddedOmitted: addedLen - pageAdded.length,
    nodesRemovedOmitted: removedLen - pageRemoved.length,
    edgesOmitted: edgesLen - pageEdges.length,
    nextCursor: end < total ? String(end) : null
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
