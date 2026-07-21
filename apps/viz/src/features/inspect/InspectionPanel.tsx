import { useCallback, useEffect, useRef, type KeyboardEvent, type ReactElement } from "react";
import { EdgeView } from "./EdgeView.tsx";
import type { ToolEdge } from "./inspectApi.ts";
import { NodeView } from "./NodeView.tsx";
import { useInspectionStore, type InspectionStore } from "./useInspectionStore.ts";

interface InspectionPanelProps {
  /** External driver: the store, so callers (search/graph) can open entities. */
  store: InspectionStore;
  /** Absolute repo root for deep links; null disables link construction. */
  repoRoot: string | null;
  /**
   * Edge objects the panel may need to render, keyed by edge entityKey. An edge
   * has no `/edges/:key` endpoint; it is opened from an already-fetched
   * ToolEdge (e.g. a node's connection list), so the opener registers it here.
   */
  edgesByKey?: ReadonlyMap<string, ToolEdge>;
}

/**
 * The single inspection panel. Exactly one panel root exists at a time: when a
 * new entity is opened the content is REPLACED, never stacked (completion-proof
 * cut — a second entity does not create a second panel DOM instance). Closed
 * when `store.current` is null. Dismissible via the close control and `Escape`;
 * focus moves into the panel on open.
 */
export function InspectionPanel({ store, repoRoot, edgesByKey }: InspectionPanelProps): ReactElement | null {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { current, previous, openEntity, goBack, close } = store;

  const onPivot = useCallback(
    (entityKey: string, entityType: "node" | "edge") => {
      openEntity({ entityKey, entityType });
    },
    [openEntity]
  );

  useEffect(() => {
    if (current !== null) {
      panelRef.current?.focus();
    }
  }, [current]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    },
    [close]
  );

  if (current === null) {
    return null;
  }

  return (
    <aside
      className="inspection-panel"
      role="dialog"
      aria-label="Inspection"
      aria-modal="false"
      tabIndex={-1}
      ref={panelRef}
      onKeyDown={onKeyDown}
    >
      <div className="inspection-panel-toolbar">
        {previous !== null && (
          <button type="button" onClick={goBack} aria-label="Back to previous entity">
            ← Back
          </button>
        )}
        <button type="button" onClick={close} aria-label="Close inspection panel">
          ✕
        </button>
      </div>

      {current.entityType === "node" ? (
        <NodeView entityKey={current.entityKey} repoRoot={repoRoot} onPivot={onPivot} />
      ) : (
        <EdgeContent edge={edgesByKey?.get(current.entityKey)} repoRoot={repoRoot} onPivot={onPivot} />
      )}
    </aside>
  );
}

function EdgeContent({
  edge,
  repoRoot,
  onPivot
}: {
  edge: ToolEdge | undefined;
  repoRoot: string | null;
  onPivot: (entityKey: string, entityType: "node" | "edge") => void;
}): ReactElement {
  if (edge === undefined) {
    return <p role="alert">Edge details are unavailable.</p>;
  }
  return <EdgeView edge={edge} repoRoot={repoRoot} onPivot={onPivot} />;
}

/** Convenience for `App`: builds and owns the store internally. */
export function useInspectionPanel(): InspectionStore {
  return useInspectionStore();
}
