import { useCallback, useState } from "react";

/** What the inspection panel currently targets: a node or an edge, by key. */
export interface InspectionTarget {
  entityKey: string;
  entityType: "node" | "edge";
}

export interface InspectionState {
  /** The currently inspected target, or null when the panel is closed. */
  current: InspectionTarget | null;
  /**
   * The single previous target for one-level "back" navigation. This is NOT a
   * full history stack (blueprint §9 / card slice A): only one level is
   * remembered, so opening C after B (with A previous) drops A.
   */
  previous: InspectionTarget | null;
}

export interface InspectionStore extends InspectionState {
  openEntity(target: InspectionTarget): void;
  goBack(): void;
  close(): void;
}

/**
 * View-state store for the single inspection panel. Opening a new entity while
 * one is open pushes exactly one level of back-history (the just-open target
 * becomes `previous`, replacing whatever was there — one level only). `goBack`
 * swaps current/previous; `close` clears both.
 *
 * Opening the same entity that is already current is a no-op (it does not
 * shift the current target into `previous`, which would make "back" a
 * confusing self-loop).
 */
export function useInspectionStore(): InspectionStore {
  const [state, setState] = useState<InspectionState>({ current: null, previous: null });

  const openEntity = useCallback((target: InspectionTarget): void => {
    setState((prev) => {
      if (
        prev.current !== null &&
        prev.current.entityKey === target.entityKey &&
        prev.current.entityType === target.entityType
      ) {
        return prev;
      }
      return { current: target, previous: prev.current };
    });
  }, []);

  const goBack = useCallback((): void => {
    setState((prev) => {
      if (prev.previous === null) {
        return prev;
      }
      return { current: prev.previous, previous: null };
    });
  }, []);

  const close = useCallback((): void => {
    setState({ current: null, previous: null });
  }, []);

  return { ...state, openEntity, goBack, close };
}
