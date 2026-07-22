import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchReviewDiff,
  ReviewDiffError,
  type EdgeDiffRow,
  type ReviewDiffKind,
  type ReviewDiffNode,
  type ReviewDiffPage
} from "./reviewDiffApi.ts";

export type ReviewDiffStatus =
  | "idle"
  | "loading"
  | "ok"
  | "empty"
  | "partial"
  | "unsupported"
  | "failed";

/** Accumulated rows across cursor pages, plus the first page's context/base/head. */
export interface AccumulatedDiff {
  context: ReviewDiffPage["context"];
  base: ReviewDiffPage["base"];
  head: ReviewDiffPage["head"];
  nodesAdded: ReviewDiffNode[];
  nodesRemoved: ReviewDiffNode[];
  edges: EdgeDiffRow[];
  nodesAddedOmitted: number;
  nodesRemovedOmitted: number;
  edgesOmitted: number;
  presentation: ReviewDiffPage["presentation"];
  /** Present only when the coalesced presentation was requested and succeeded. */
  coalesced: ReviewDiffPage["coalesced"];
  ambiguousGroups: ReviewDiffPage["ambiguousGroups"];
}

export interface ReviewDiffState {
  kind: ReviewDiffKind;
  coalesced: boolean;
  page: AccumulatedDiff | null;
  status: ReviewDiffStatus;
  errorCode: string | null;
  nextCursor: string | null;
}

export interface ReviewDiffStore extends ReviewDiffState {
  setKind(kind: ReviewDiffKind): void;
  /** Toggle the coalesced (rename/move) presentation and refetch. */
  setCoalesced(coalesced: boolean): void;
  loadMore(): void;
}

const DEFAULT_LIMIT = 50;

/** 501 codes that mean "this comparison can't be produced here" (honest, not a failure). */
const UNSUPPORTED_CODES = new Set(["coalesced_unsupported", "git_unavailable"]);

/** Stable id for a node row (per side): entityKey is unique within added/removed. */
function nodeId(node: ReviewDiffNode): string {
  return node.entityKey;
}

/**
 * Stable id for an edge row. The wire `EdgeDiffRow` carries qualifiedNames
 * (`source`/`destination`), NOT the edge entityKey, so two distinct edges whose
 * endpoints share a qualifiedName but differ by node kind (e.g. `interface Foo`
 * vs `class Foo`) could otherwise collide. We fold in the before/after
 * provenance triples to shrink that window; a fully-correct key needs the edge
 * entityKey on the wire (server-contract gap, tracked separately).
 */
function edgeId(edge: EdgeDiffRow): string {
  return [
    edge.change_kind,
    edge.source,
    edge.relation,
    edge.destination,
    edge.before_origin,
    edge.before_confidence,
    edge.before_resolution,
    edge.after_origin,
    edge.after_confidence,
    edge.after_resolution
  ].join("|");
}

function appendUnique<T>(existing: T[], incoming: T[], id: (row: T) => string): T[] {
  if (incoming.length === 0) {
    return existing;
  }
  const seen = new Set(existing.map(id));
  const merged = existing.slice();
  for (const row of incoming) {
    const key = id(row);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(row);
    }
  }
  return merged;
}

/**
 * The server's per-page omitted count is `listTotal - thisPageSliceLen` — i.e.
 * every row of that list NOT on THIS page, including rows already shown on
 * earlier pages (see packages/server reviewDiffAssembly.paginateReviewDiff). So
 * `listTotal = serverOmittedThisPage + thisPageSliceLen`, and the honest count
 * of rows still NOT shown after accumulating is `listTotal - accumulatedShown`.
 * When the diff is fully paged this is 0 — never a stuck "N not shown".
 */
function remainingOmitted(
  serverOmittedThisPage: number,
  thisPageSliceLen: number,
  accumulatedShown: number
): number {
  const listTotal = serverOmittedThisPage + thisPageSliceLen;
  return Math.max(0, listTotal - accumulatedShown);
}

function mergePage(prev: AccumulatedDiff | null, next: ReviewDiffPage): AccumulatedDiff {
  const nodesAdded =
    prev === null ? next.nodesAdded : appendUnique(prev.nodesAdded, next.nodesAdded, nodeId);
  const nodesRemoved =
    prev === null ? next.nodesRemoved : appendUnique(prev.nodesRemoved, next.nodesRemoved, nodeId);
  const edges = prev === null ? next.edges : appendUnique(prev.edges, next.edges, edgeId);
  return {
    context: prev?.context ?? next.context,
    base: prev?.base ?? next.base,
    head: prev?.head ?? next.head,
    nodesAdded,
    nodesRemoved,
    edges,
    // Honest cross-page omission: rows of each list still not accumulated.
    nodesAddedOmitted: remainingOmitted(next.nodesAddedOmitted, next.nodesAdded.length, nodesAdded.length),
    nodesRemovedOmitted: remainingOmitted(
      next.nodesRemovedOmitted,
      next.nodesRemoved.length,
      nodesRemoved.length
    ),
    edgesOmitted: remainingOmitted(next.edgesOmitted, next.edges.length, edges.length),
    // Coalesced view is computed server-side over the full diff (not paginated),
    // so keep the first page's arrays; later pages carry the same presentation.
    presentation: prev?.presentation ?? next.presentation,
    coalesced: prev?.coalesced ?? next.coalesced,
    ambiguousGroups: prev?.ambiguousGroups ?? next.ambiguousGroups
  };
}

function hasRows(page: AccumulatedDiff): boolean {
  return page.nodesAdded.length > 0 || page.nodesRemoved.length > 0 || page.edges.length > 0;
}

function hasOmissions(page: AccumulatedDiff): boolean {
  return page.nodesAddedOmitted > 0 || page.nodesRemovedOmitted > 0 || page.edgesOmitted > 0;
}

function deriveStatus(page: AccumulatedDiff, nextCursor: string | null): ReviewDiffStatus {
  if (!hasRows(page)) {
    // No rows at all: empty even if the server reported omissions, since there
    // is nothing to page toward — but omissions with zero rows shouldn't happen;
    // treat rows-present as the gate for "partial".
    return hasOmissions(page) || nextCursor !== null ? "partial" : "empty";
  }
  if (nextCursor !== null || hasOmissions(page)) {
    return "partial";
  }
  return "ok";
}

/**
 * Review-diff view store. Owns the accumulated (paged) diff, the current
 * comparison kind, and the derived honest status.
 *
 * Stale suppression: every kind change (and the initial load) bumps a monotonic
 * generation ref; each fetch carries the generation it was issued under and is
 * discarded on resolve if the ref has since moved — identical to searchApi's
 * guard. So switching kind mid-flight can never let the old kind's late response
 * paint the view.
 *
 * Dedupe: loadMore appends the next cursor page with {@link appendUnique}, keyed
 * by a stable row id (entityKey per node side; change_kind+endpoints+relation for
 * edges), so an overlapping page never produces duplicate rows.
 */
export function useReviewDiffStore(
  callbacks: { onError?: (err: unknown) => void } = {}
): ReviewDiffStore {
  const [kind, setKindState] = useState<ReviewDiffKind>("snapshot");
  const [coalesced, setCoalescedState] = useState<boolean>(false);
  const [page, setPage] = useState<AccumulatedDiff | null>(null);
  const [status, setStatus] = useState<ReviewDiffStatus>("idle");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const generationRef = useRef(0);
  const coalescedRef = useRef<boolean>(false);
  coalescedRef.current = coalesced;
  // Live mirror of accumulated page/cursor so loadMore reads them without
  // re-creating the callback on every append (stable identity like search's).
  const pageRef = useRef<AccumulatedDiff | null>(null);
  pageRef.current = page;
  const cursorRef = useRef<string | null>(null);
  cursorRef.current = nextCursor;
  const kindRef = useRef<ReviewDiffKind>(kind);
  kindRef.current = kind;
  const loadingMoreRef = useRef(false);
  // Callbacks live in a ref so the default `{}` (a fresh object every render)
  // can't destabilize load/applyError and re-fire the mount effect.
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const applyError = useCallback((err: unknown) => {
    const code = err instanceof ReviewDiffError ? err.code : null;
    setErrorCode(code);
    setStatus(code !== null && UNSUPPORTED_CODES.has(code) ? "unsupported" : "failed");
    callbacksRef.current.onError?.(err);
  }, []);

  const load = useCallback(
    (targetKind: ReviewDiffKind, targetCoalesced: boolean) => {
      const generation = ++generationRef.current;
      setKindState(targetKind);
      setCoalescedState(targetCoalesced);
      coalescedRef.current = targetCoalesced;
      setPage(null);
      pageRef.current = null;
      setNextCursor(null);
      cursorRef.current = null;
      setErrorCode(null);
      setStatus("loading");
      loadingMoreRef.current = false;
      fetchReviewDiff({ kind: targetKind, limit: DEFAULT_LIMIT, coalesce: targetCoalesced }, generation)
        .then((result) => {
          if (result.generation !== generationRef.current) {
            return; // stale — a newer kind change superseded this request
          }
          const merged = mergePage(null, result);
          setPage(merged);
          pageRef.current = merged;
          setNextCursor(result.nextCursor);
          cursorRef.current = result.nextCursor;
          setStatus(deriveStatus(merged, result.nextCursor));
        })
        .catch((err: unknown) => {
          if (generation !== generationRef.current) {
            return;
          }
          applyError(err);
        });
    },
    [applyError]
  );

  const setKind = useCallback(
    (next: ReviewDiffKind) => {
      load(next, coalescedRef.current);
    },
    [load]
  );

  const setCoalesced = useCallback(
    (next: boolean) => {
      load(kindRef.current, next);
    },
    [load]
  );

  const loadMore = useCallback(() => {
    const cursor = cursorRef.current;
    if (cursor === null || loadingMoreRef.current) {
      return; // nothing more to load, or a load is already in flight
    }
    loadingMoreRef.current = true;
    const generation = generationRef.current; // same generation — appending to current kind
    fetchReviewDiff(
      { kind: kindRef.current, cursor, limit: DEFAULT_LIMIT, coalesce: coalescedRef.current },
      generation
    )
      .then((result) => {
        loadingMoreRef.current = false;
        if (result.generation !== generationRef.current) {
          return; // a kind change happened mid-page — discard
        }
        const merged = mergePage(pageRef.current, result);
        setPage(merged);
        pageRef.current = merged;
        setNextCursor(result.nextCursor);
        cursorRef.current = result.nextCursor;
        setStatus(deriveStatus(merged, result.nextCursor));
      })
      .catch((err: unknown) => {
        loadingMoreRef.current = false;
        if (generation !== generationRef.current) {
          return;
        }
        applyError(err);
      });
  }, [applyError]);

  // Initial fetch: default kind = snapshot, once on mount. `load` is stable
  // (its only dep, applyError, is memoized), so depending on it is a no-op —
  // the effect still runs exactly once.
  useEffect(() => {
    load("snapshot", false);
  }, [load]);

  return { kind, coalesced, page, status, errorCode, nextCursor, setKind, setCoalesced, loadMore };
}
