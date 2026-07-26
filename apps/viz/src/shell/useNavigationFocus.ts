import { useCallback, useEffect, useRef, type KeyboardEvent, type RefObject } from "react";

export interface NavigationFocusController {
  toggleRef: RefObject<HTMLButtonElement | null>;
  drawerRef: RefObject<HTMLElement | null>;
  onDrawerKeyDown(event: KeyboardEvent<HTMLElement>): void;
}

/** Transfers focus into an opened drawer and back to its toggle on close. */
export function useNavigationFocus(open: boolean, close: () => void): NavigationFocusController {
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const previousOpen = useRef(open);

  useEffect(() => {
    if (previousOpen.current === open) return;
    previousOpen.current = open;
    if (open) {
      const target = drawerRef.current?.querySelector<HTMLElement>(
        "input:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])"
      );
      (target ?? drawerRef.current)?.focus();
    } else {
      toggleRef.current?.focus();
    }
  }, [open]);

  const onDrawerKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }, [close]);

  return { toggleRef, drawerRef, onDrawerKeyDown };
}
