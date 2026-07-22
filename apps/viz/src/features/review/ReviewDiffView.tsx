import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import type { EdgeDiffRow, ReviewDiffKind, ReviewDiffNode } from "./reviewDiffApi.ts";
import { useReviewDiffStore, type ReviewDiffStore } from "./useReviewDiffStore.ts";

/** A flattened, ordered row spanning the three diff sections (added/removed/edges). */
type DiffRow =
  | { rowType: "node"; side: "added" | "removed"; id: string; node: ReviewDiffNode }
  | { rowType: "edge"; id: string; edge: EdgeDiffRow };

const KIND_LABELS: Record<ReviewDiffKind, string> = {
  snapshot: "Snapshot",
  working_tree: "Working tree",
  staged: "Staged"
};

const KIND_ORDER: ReviewDiffKind[] = ["snapshot", "working_tree", "staged"];

interface ReviewDiffViewProps {
  /**
   * Optional external driver so App can share one store between the list and the
   * DiffBadgeOverlay. When omitted, the view owns its own store.
   */
  store?: ReviewDiffStore;
  /**
   * Open evidence/source for an entity through the EXISTING inspection store. For
   * an edge row there is no edge entityKey to inspect, so we inspect the
   * DESTINATION node (arbitrary but documented: the destination is the target of
   * the relationship change, the thing whose incoming provenance moved). Defaults
   * to a no-op so the list is usable standalone.
   */
  onInspect?: (entityKey: string, entityType: "node") => void;
}

function nodeRowLabel(side: "added" | "removed", node: ReviewDiffNode): string {
  const verb = side === "added" ? "added" : "removed";
  const loc = node.file === null ? null : node.lineStart === null ? node.file : `${node.file}:${node.lineStart}`;
  const parts = [`${verb} ${node.kind}: ${node.qualifiedName}`];
  if (loc !== null) {
    parts.push(loc);
  }
  if (node.stale) {
    parts.push(`stale (${node.staleReason ?? "unknown"})`);
  } else if (node.freshness !== "fresh") {
    parts.push(node.freshness);
  }
  return parts.join(", ");
}

function edgeRowLabel(edge: EdgeDiffRow): string {
  const before = edge.before_resolution ?? "—";
  const after = edge.after_resolution ?? "—";
  return `${edge.change_kind} edge: ${edge.source} --${edge.relation}--> ${edge.destination}, before ${before}, after ${after}`;
}

/** Flatten the accumulated diff into one ordered, keyboard-navigable row list. */
function flattenRows(store: ReviewDiffStore): DiffRow[] {
  const rows: DiffRow[] = [];
  const page = store.page;
  if (page === null) {
    return rows;
  }
  for (const node of page.nodesAdded) {
    rows.push({ rowType: "node", side: "added", id: `added:${node.entityKey}`, node });
  }
  for (const node of page.nodesRemoved) {
    rows.push({ rowType: "node", side: "removed", id: `removed:${node.entityKey}`, node });
  }
  for (const edge of page.edges) {
    rows.push({
      rowType: "edge",
      id: `edge:${edge.change_kind}:${edge.source}:${edge.relation}:${edge.destination}`,
      edge
    });
  }
  return rows;
}

export function ReviewDiffView({ store: externalStore, onInspect }: ReviewDiffViewProps): ReactElement {
  // When no external store is supplied the view owns one. The hook must NOT run
  // when an external store IS supplied, else it would fire a second mount fetch
  // (App shares one store between the list and the overlay — one fetch, not two).
  // Two components keep the hook-call count stable per render (rules of hooks).
  if (externalStore !== undefined) {
    return <ReviewDiffList store={externalStore} onInspect={onInspect} />;
  }
  return <ReviewDiffOwnStore onInspect={onInspect} />;
}

function ReviewDiffOwnStore({
  onInspect
}: {
  onInspect?: (entityKey: string, entityType: "node") => void;
}): ReactElement {
  const store = useReviewDiffStore();
  return <ReviewDiffList store={store} onInspect={onInspect} />;
}

function ReviewDiffList({
  store,
  onInspect
}: {
  store: ReviewDiffStore;
  onInspect?: (entityKey: string, entityType: "node") => void;
}): ReactElement {
  const rows = flattenRows(store);

  const [activeIndex, setActiveIndex] = useState(0);
  const optionRefs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    setActiveIndex((i) => (rows.length === 0 ? 0 : Math.min(i, rows.length - 1)));
  }, [rows.length]);

  const inspectRow = useCallback(
    (row: DiffRow) => {
      if (onInspect === undefined) {
        return;
      }
      if (row.rowType === "node") {
        onInspect(row.node.entityKey, "node");
      } else {
        // Edge has no node endpoint entityKey in the wire row; the destination
        // qualifiedName is the closest inspectable target. (documented choice)
        onInspect(row.edge.destination, "node");
      }
    },
    [onInspect]
  );

  const moveTo = useCallback(
    (index: number) => {
      if (rows.length === 0) {
        return;
      }
      const clamped = Math.max(0, Math.min(index, rows.length - 1));
      setActiveIndex(clamped);
      optionRefs.current[clamped]?.focus();
    },
    [rows.length]
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLUListElement>) => {
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          moveTo(activeIndex + 1);
          break;
        case "ArrowUp":
          event.preventDefault();
          moveTo(activeIndex - 1);
          break;
        case "Home":
          event.preventDefault();
          moveTo(0);
          break;
        case "End":
          event.preventDefault();
          moveTo(rows.length - 1);
          break;
        case "Enter":
        case " ": {
          event.preventDefault();
          const row = rows[activeIndex];
          if (row !== undefined) {
            inspectRow(row);
          }
          break;
        }
        default:
          break;
      }
    },
    [activeIndex, moveTo, rows, inspectRow]
  );

  return (
    <section className="review-diff" aria-label="Review diff">
      <KindSwitcher kind={store.kind} onChange={store.setKind} />

      <StatusRegion store={store} />

      {rows.length > 0 && (
        <ul role="listbox" aria-label="Review diff changes" className="review-diff-list" onKeyDown={onKeyDown}>
          {rows.map((row, index) => {
            const active = index === activeIndex;
            return (
              <li
                key={row.id}
                ref={(el) => {
                  optionRefs.current[index] = el;
                }}
                role="option"
                aria-selected={active}
                aria-label={row.rowType === "node" ? nodeRowLabel(row.side, row.node) : edgeRowLabel(row.edge)}
                tabIndex={active ? 0 : -1}
                className={
                  row.rowType === "node" ? `review-diff-node review-diff-${row.side}` : "review-diff-edge"
                }
                onClick={() => {
                  setActiveIndex(index);
                  inspectRow(row);
                }}
              >
                {row.rowType === "node" ? <NodeRow side={row.side} node={row.node} /> : <EdgeRow edge={row.edge} />}
              </li>
            );
          })}
        </ul>
      )}

      <OmissionNotes store={store} />

      {store.nextCursor !== null && (
        <button type="button" className="review-diff-load-more" onClick={store.loadMore}>
          Load more
        </button>
      )}
    </section>
  );
}

function KindSwitcher({
  kind,
  onChange
}: {
  kind: ReviewDiffKind;
  onChange: (kind: ReviewDiffKind) => void;
}): ReactElement {
  return (
    <div role="radiogroup" aria-label="Comparison kind" className="review-diff-kinds">
      {KIND_ORDER.map((option) => (
        <label key={option} className="review-diff-kind-option">
          <input
            type="radio"
            name="review-diff-kind"
            value={option}
            checked={kind === option}
            onChange={() => onChange(option)}
          />
          {KIND_LABELS[option]}
        </label>
      ))}
    </div>
  );
}

function StatusRegion({ store }: { store: ReviewDiffStore }): ReactElement | null {
  switch (store.status) {
    case "loading":
      return (
        <div role="status" className="review-diff-status">
          Loading diff…
        </div>
      );
    case "empty":
      return (
        <div role="status" className="review-diff-status">
          No changes in this comparison.
        </div>
      );
    case "unsupported":
      return (
        <div role="status" className="review-diff-status">
          {`This comparison is not available here${store.errorCode !== null ? ` (${store.errorCode})` : ""}.`}
        </div>
      );
    case "failed":
      return (
        <div role="alert" className="review-diff-status">
          {`Could not load the diff${store.errorCode !== null ? `: ${store.errorCode}` : "."}`}
        </div>
      );
    case "partial":
      return (
        <div role="status" className="review-diff-status">
          Showing a partial diff.
        </div>
      );
    default:
      return null;
  }
}

/** Honest omitted-count notes: what the server dropped that is not shown. */
function OmissionNotes({ store }: { store: ReviewDiffStore }): ReactElement | null {
  const page = store.page;
  if (page === null) {
    return null;
  }
  const notes: string[] = [];
  if (page.nodesAddedOmitted > 0) {
    notes.push(`+${page.nodesAddedOmitted} added nodes not shown`);
  }
  if (page.nodesRemovedOmitted > 0) {
    notes.push(`${page.nodesRemovedOmitted} removed nodes not shown`);
  }
  if (page.edgesOmitted > 0) {
    notes.push(`${page.edgesOmitted} changed edges not shown`);
  }
  if (notes.length === 0) {
    return null;
  }
  return (
    <p role="status" className="review-diff-omitted">
      {notes.join("; ")}
    </p>
  );
}

function NodeRow({ side, node }: { side: "added" | "removed"; node: ReviewDiffNode }): ReactElement {
  const loc = node.file === null ? null : node.lineStart === null ? node.file : `${node.file}:${node.lineStart}`;
  return (
    <>
      <span className="review-diff-marker" aria-hidden="true">
        {side === "added" ? "+" : "−"}
      </span>
      <span className="review-diff-kind-tag">{node.kind}</span>
      <span className="review-diff-name">{node.qualifiedName}</span>
      {loc !== null && <span className="review-diff-loc">{loc}</span>}
      {node.stale ? (
        <span className="review-diff-freshness" aria-hidden="true">
          stale
        </span>
      ) : node.freshness !== "fresh" ? (
        <span className="review-diff-freshness" aria-hidden="true">
          {node.freshness}
        </span>
      ) : null}
    </>
  );
}

function EdgeRow({ edge }: { edge: EdgeDiffRow }): ReactElement {
  return (
    <>
      <span className="review-diff-marker" aria-hidden="true">
        {edge.change_kind === "added" ? "+" : edge.change_kind === "removed" ? "−" : "~"}
      </span>
      <span className="review-diff-edge-endpoints">
        {`${edge.source} --${edge.relation}--> ${edge.destination}`}
      </span>
      {edge.change_kind === "resolution_or_provenance_changed" && (
        <span className="review-diff-edge-provenance">
          {`${edge.before_resolution ?? "—"} → ${edge.after_resolution ?? "—"}`}
        </span>
      )}
    </>
  );
}
