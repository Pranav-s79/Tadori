import { fetchSnapshot } from "../../api/client.ts";
import type { ApiContext, NodeKind } from "../../api/types.ts";

const API_BASE = "/api/v1";

/** Which two things are being compared. Mirrors the server's `kind` param. */
export type ReviewDiffKind = "snapshot" | "working_tree" | "staged";

/**
 * A ToolNode served verbatim by the review-diff endpoint (camelCase). Re-declared
 * here (the app cannot import @tadori/*); mirrors the wire contract for the
 * added/removed node lists. `body`/`representation` from the inspection ToolNode
 * are NOT part of the diff row contract, so they are intentionally absent.
 */
export interface ReviewDiffNode {
  entityKey: string;
  kind: NodeKind;
  qualifiedName: string;
  displayName: string;
  file: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  signature: string | null;
  exported: boolean;
  fanIn: number;
  evidence: ReviewDiffEvidence[];
  evidenceOmittedCount: number;
  freshness: "fresh" | "stale" | "unknown";
  stale: boolean;
  staleReason: string | null;
}

/** One evidence anchor on a diff node (ToolEvidence, served verbatim). */
export interface ReviewDiffEvidence {
  file: string;
  kind: string;
  lineStart: number;
  lineEnd: number;
  columnStart: number | null;
  columnEnd: number | null;
  commitSha: string | null;
  excerptHash: string | null;
}

/**
 * A changed edge (EdgeDiffRow), snake_case FROM the store, served as-is. We keep
 * the snake_case wire keys verbatim (no re-mapping) — the diff is a store view,
 * and re-casing would invent a second contract for zero benefit.
 */
export interface EdgeDiffRow {
  change_kind: "added" | "removed" | "resolution_or_provenance_changed";
  source: string;
  relation: string;
  destination: string;
  before_origin: string | null;
  before_confidence: string | null;
  before_resolution: string | null;
  after_origin: string | null;
  after_confidence: string | null;
  after_resolution: string | null;
}

/** Snapshot descriptor for base/head, served verbatim. */
export interface SnapshotRow {
  id: number;
  kind: string;
  label: string;
  baseCommitSha: string | null;
  workspaceHash: string | null;
  pinned: boolean;
  status: string;
  createdAt: string | null;
}

/**
 * One coalesced rename/move row (09-02), served verbatim. `rawRowIndexes` point
 * into the same `edges` array, so the UI expands back to raw with zero refetch.
 * Always "likely" — never certain.
 */
export interface CoalescedChange {
  kind: "rename" | "move";
  fromKey: string | null;
  toKey: string | null;
  rawRowIndexes: number[];
}

/** A group of nodes that could not be disambiguated → honest raw fallback. */
export interface AmbiguousNodeGroup {
  candidateKeys: string[];
  reason: string;
}

/** One page of a review diff, plus the generation the caller handed us. */
export interface ReviewDiffPage {
  context: ApiContext;
  base: SnapshotRow;
  head: SnapshotRow;
  nodesAdded: ReviewDiffNode[];
  nodesRemoved: ReviewDiffNode[];
  edges: EdgeDiffRow[];
  nodesAddedOmitted: number;
  nodesRemovedOmitted: number;
  edgesOmitted: number;
  nextCursor: string | null;
  /** "raw" or "coalesced"; "coalesced" only when the request asked for it. */
  presentation: "raw" | "coalesced";
  /** Present only for presentation === "coalesced" (additive over `edges`). */
  coalesced?: CoalescedChange[];
  ambiguousGroups?: AmbiguousNodeGroup[];
  generation: number;
}

export interface ReviewDiffParams {
  kind: ReviewDiffKind;
  base?: string;
  head?: string;
  cursor?: string;
  limit?: number;
  /** When true, request the coalesced (rename/move) presentation. */
  coalesce?: boolean;
}

/**
 * A structured backend error. Carries the server's error `code` (e.g.
 * `git_unavailable`, `not_a_git_repository`) so the store can map it to the
 * right honest state instead of silently falling back to snapshot mode.
 */
export class ReviewDiffError extends Error {
  readonly code: string | null;
  readonly detail: string | null;
  readonly status: number;

  constructor(message: string, opts: { code: string | null; detail: string | null; status: number }) {
    super(message);
    this.name = "ReviewDiffError";
    this.code = opts.code;
    this.detail = opts.detail;
    this.status = opts.status;
  }
}

/** The two persisted snapshots a Snapshot comparison diffs: base → head. */
export interface SnapshotPair {
  base: number;
  head: number;
}

/**
 * Why there is no pair. `only_one`: the listing holds only the served
 * snapshot. `none_earlier`: nothing older than the served snapshot is still
 * retained (never indexed, or pruned — a pruned snapshot has no members left,
 * so diffing against it would report everything as added).
 */
export type NoEarlierSnapshotReason = "only_one" | "none_earlier";

/**
 * Head is the served snapshot; base is the newest ACTIVE snapshot older than
 * it. Pure, so the choice is tested without a server.
 */
export function pickSnapshotPair(rows: readonly SnapshotRow[], servedId: number): SnapshotPair | NoEarlierSnapshotReason {
  let base: number | null = null;
  for (const row of rows) {
    if (row.id < servedId && row.status === "active" && (base === null || row.id > base)) {
      base = row.id;
    }
  }
  if (base !== null) {
    return { base, head: servedId };
  }
  return rows.length === 1 && rows[0]?.id === servedId ? "only_one" : "none_earlier";
}

/** GET /api/v1/snapshots: every snapshot row of the served repository. */
export async function fetchSnapshots(): Promise<SnapshotRow[]> {
  const response = await fetch(`${API_BASE}/snapshots`);
  if (!response.ok) {
    throw new ReviewDiffError(`snapshots failed: ${response.status}`, { code: null, detail: null, status: response.status });
  }
  return (await response.json()) as SnapshotRow[];
}

/** The pair for a Snapshot comparison, read from the served id and the listing. */
export async function resolveSnapshotPair(): Promise<SnapshotPair | NoEarlierSnapshotReason> {
  const [served, rows] = await Promise.all([fetchSnapshot(), fetchSnapshots()]);
  return pickSnapshotPair(rows, served.snapshotId);
}

/**
 * The sole fetch wrapper for GET /api/v1/review/diff. Always sends `kind`;
 * sends `base`/`head` ONLY for `kind=snapshot` (the server ignores them for the
 * live-capture kinds, but we still don't send meaningless refs); always sends
 * `cursor`/`limit` when provided. On non-2xx it parses the structured JSON error
 * body `{ error, code, detail? }` and throws a {@link ReviewDiffError} — it never
 * silently degrades to snapshot mode. Rows are never re-sorted (deterministic:
 * server order is the render order). Echoes back `generation` so the caller's
 * monotonic guard can discard stale responses (same idiom as searchApi).
 */
export async function fetchReviewDiff(params: ReviewDiffParams, generation: number): Promise<ReviewDiffPage> {
  const query = new URLSearchParams();
  query.set("kind", params.kind);
  if (params.kind === "snapshot") {
    if (params.base !== undefined) {
      query.set("base", params.base);
    }
    if (params.head !== undefined) {
      query.set("head", params.head);
    }
  }
  if (params.cursor !== undefined) {
    query.set("cursor", params.cursor);
  }
  if (params.limit !== undefined) {
    query.set("limit", String(params.limit));
  }
  if (params.coalesce === true) {
    query.set("coalesce", "coalesced");
  }

  const response = await fetch(`${API_BASE}/review/diff?${query.toString()}`);
  if (!response.ok) {
    let code: string | null = null;
    let detail: string | null = null;
    let message = `review diff failed: ${response.status}`;
    try {
      const body: unknown = await response.json();
      if (body !== null && typeof body === "object") {
        const rec = body as Record<string, unknown>;
        if (typeof rec.code === "string") {
          code = rec.code;
        }
        if (typeof rec.detail === "string") {
          detail = rec.detail;
        }
        if (typeof rec.error === "string") {
          message = rec.error;
        }
      }
    } catch {
      // Non-JSON error body: keep the status-based message.
    }
    throw new ReviewDiffError(message, { code, detail, status: response.status });
  }

  const body = (await response.json()) as Omit<ReviewDiffPage, "generation">;
  return { ...body, generation };
}
