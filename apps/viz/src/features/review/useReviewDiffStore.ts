import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchReviewDiff,
  resolveSnapshotPair,
  ReviewDiffError,
  type EdgeDiffRow,
  type NoEarlierSnapshotReason,
  type ReviewDiffKind,
  type ReviewDiffNode,
  type ReviewDiffPage,
  type SnapshotPair
} from "./reviewDiffApi.ts";

export type ReviewDiffStatus =
  | "idle"
  | "loading"
  | "ok"
  | "empty"
  | "partial"
  | "unsupported"
  // Snapshot chosen, and the listing proves there is nothing older to diff.
  | "no_earlier_snapshot"
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
  /** The persisted pair a Snapshot comparison diffs; null for other kinds. */
  snapshotPair: SnapshotPair | null;
  /**
   * Set when the snapshot listing proved there is no earlier snapshot: either
   * the opening load moved to Working tree on its own (kind is then
   * working_tree), or the user chose Snapshot (status no_earlier_snapshot).
   * Cleared when the user picks another kind.
   */
  noEarlierSnapshot: NoEarlierSnapshotReason | null;
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

/** The `base`/`head` query refs for a Snapshot pair (none for other kinds). */
function pairParams(pair: SnapshotPair | null): { base?: string; head?: string } {
  return pair === null ? {} : { base: String(pair.base), head: String(pair.head) };
}

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
  const [snapshotPair, setSnapshotPair] = useState<SnapshotPair | null>(null);
  const [noEarlierSnapshot, setNoEarlierSnapshot] = useState<NoEarlierSnapshotReason | null>(null);

  const generationRef = useRef(0);
  // The pair the current Snapshot load diffs, so loadMore pages the same pair.
  const pairRef = useRef<SnapshotPair | null>(null);
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
    (targetKind: ReviewDiffKind, targetCoalesced: boolean, switchIfNoEarlierSnapshot = false) => {
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
      setSnapshotPair(null);
      pairRef.current = null;
      loadingMoreRef.current = false;
      const request = (kindToFetch: ReviewDiffKind, pair: SnapshotPair | null): Promise<ReviewDiffPage> =>
        fetchReviewDiff({ kind: kindToFetch, limit: DEFAULT_LIMIT, coalesce: targetCoalesced, ...pairParams(pair) }, generation);
      // Snapshot diffs a real persisted pair: the served snapshot against the
      // newest retained one before it. Only a listing that proves there is none
      // moves the opening load to Working tree; a user's Snapshot then says so
      // without a request. Server refusals stay errors.
      const begin: Promise<ReviewDiffPage | null> = targetKind !== "snapshot"
        ? request(targetKind, null)
        : resolveSnapshotPair().then((pair) => {
          if (generation !== generationRef.current) {
            return null;
          }
          if (typeof pair !== "string") {
            setSnapshotPair(pair);
            pairRef.current = pair;
            setNoEarlierSnapshot(null);
            return request("snapshot", pair);
          }
          setNoEarlierSnapshot(pair);
          if (!switchIfNoEarlierSnapshot) {
            setStatus("no_earlier_snapshot");
            return null;
          }
          setKindState("working_tree");
          kindRef.current = "working_tree";
          return request("working_tree", null);
        });
      begin
        .then((result) => {
          if (result === null || result.generation !== generationRef.current) {
            return; // no request needed, or stale — a newer kind change superseded it
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
      // A kind the user picks is respected, Snapshot included: no second switch.
      setNoEarlierSnapshot(null);
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
      { kind: kindRef.current, cursor, limit: DEFAULT_LIMIT, coalesce: coalescedRef.current, ...pairParams(pairRef.current) },
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

  // Initial fetch: default kind = snapshot, once on mount, moving to Working
  // tree once if the listing proves there is no earlier snapshot. `load` is
  // stable (its only dep, applyError, is memoized), so depending on it is a
  // no-op — the effect still runs exactly once.
  useEffect(() => {
    load("snapshot", false, true);
  }, [load]);

  return {
    kind, coalesced, page, status, errorCode, nextCursor, snapshotPair, noEarlierSnapshot, setKind, setCoalesced, loadMore
  };
}
