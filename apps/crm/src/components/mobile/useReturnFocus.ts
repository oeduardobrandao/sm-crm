import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Focus return for controlled Radix dialogs. Radix only gives focus back to a
 * `DialogTrigger`; a sheet opened through `open`/`onOpenChange` from a plain button
 * drops focus to `<body>` on close. This remembers what had focus when the sheet
 * opened (or uses `returnFocusRef` when given) and hands it back from
 * `onCloseAutoFocus`.
 */
export function useReturnFocus(open: boolean, returnFocusRef?: RefObject<HTMLElement | null>) {
  const openerRef = useRef<HTMLElement | null>(null);

  // Layout effect: runs before Radix's FocusScope moves focus into the content.
  useLayoutEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
  }, [open]);

  return useCallback(
    (event: Event) => {
      const target = returnFocusRef?.current ?? openerRef.current;
      if (!target || !target.isConnected) return;
      event.preventDefault();
      target.focus();
    },
    [returnFocusRef],
  );
}
