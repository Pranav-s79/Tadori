import { useCallback, useEffect, useRef, type KeyboardEvent, type RefObject } from "react";

export interface NavigationFocusController {
  toggleRef: RefObject<HTMLButtonElement | null>;
  drawerRef: RefObject<HTMLDivElement | null>;
  onDrawerKeyDown(event: KeyboardEvent<HTMLElement>): void;
}

/**
 * Transfers focus into an opened drawer and back to its toggle on close. Focus
 * goes to the first control a Tab would reach, so a tab list lands on its
 * selected tab. It returns to the toggle only if it was inside the drawer (or
 * lost with it): a reader who closed it by pressing another control keeps
 * focus there.
 */
export function useNavigationFocus(
  open: boolean,
  close: () => void,
  drawerMode = true
): NavigationFocusController {
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const previousOpen = useRef(open);

  useEffect(() => {
    if (previousOpen.current === open) return;
    previousOpen.current = open;
    if (!drawerMode) return;
    if (open) {
      const target = drawerRef.current?.querySelector<HTMLElement>(
        "input:not([disabled]), button:not([disabled]):not([tabindex='-1']), a[href], [tabindex]:not([tabindex='-1'])"
      );
      (target ?? drawerRef.current)?.focus();
      return;
    }
    const active = document.activeElement;
    if (active === null || active === document.body || drawerRef.current?.contains(active) === true) {
      toggleRef.current?.focus();
    }
  }, [drawerMode, open]);

  const onDrawerKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || !drawerMode) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }, [close, drawerMode]);

  return { toggleRef, drawerRef, onDrawerKeyDown };
}
