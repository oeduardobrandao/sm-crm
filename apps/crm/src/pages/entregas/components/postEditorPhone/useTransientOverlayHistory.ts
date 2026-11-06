import { useCallback, useEffect, useRef, useState } from 'react';
import { useSheetHistory } from '@/components/mobile/useSheetHistory';

/**
 * History entry for an overlay that is MOUNTED ONLY WHILE OPEN (`{x && <Dialog/>}`).
 * `useOverlayHistoryEntry` pops its entry on close but never on unmount, so calling the
 * parent's `onClose` straight away would unmount first and strand the entry. Here a UI
 * close pops the entry and calls `onClose` once the pop has landed; Back (the entry
 * already gone) calls `onClose` directly.
 *
 * `enabled` false (desktop): no entry, `dismiss` is `onClose`.
 */
export function useTransientOverlayHistory(enabled: boolean, onClose: () => void) {
  const [open, setOpen] = useState(true);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closingRef = useRef(false);
  const hide = useCallback(() => setOpen(false), []);
  const { closeThen } = useSheetHistory(enabled && open, hide);

  // Back / edge swipe: the hook popped the entry and called `hide`.
  useEffect(() => {
    if (enabled && !open && !closingRef.current) onCloseRef.current();
  }, [enabled, open]);

  const dismiss = useCallback(() => {
    if (!enabled) {
      onCloseRef.current();
      return;
    }
    if (closingRef.current) return;
    closingRef.current = true;
    closeThen(() => onCloseRef.current());
  }, [enabled, closeThen]);

  return { dismiss };
}
