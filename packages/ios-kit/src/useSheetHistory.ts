import { useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useOverlayHistoryEntry } from './useOverlayHistoryEntry';

/** Same slot identity `useOverlayHistoryEntry` uses (`history.state.idx`). */
function currentSlot(): number | null {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === 'number' ? idx : null;
}

/**
 * `useOverlayHistoryEntry` for the phone sheets and menus, plus `closeThen`.
 *
 * Opening pushes a history entry, so Back (iOS edge swipe, Android back, the browser
 * button) closes one layer. The catch is an action that navigates from inside the sheet
 * (a Mais row, a notification link): pushing the new route on top of the sheet's entry
 * leaves a dead entry behind it, and the first Back after that seems to do nothing.
 * `closeThen(fn)` closes first and runs `fn` only once the sheet's entry has been popped,
 * so the new route replaces the sheet in history instead of stacking on it.
 *
 * Where no entry was pushed (a MemoryRouter in tests, or the entry is no longer the
 * current one), `closeThen` closes and runs `fn` right away.
 */
export function useSheetHistory(open: boolean, onClose: () => void) {
  useOverlayHistoryEntry(open, onClose);
  const location = useLocation();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  /** History index while the sheet is closed: tells whether opening really pushed. */
  const beforeRef = useRef<number | null>(currentSlot());
  /** Index of the entry pushed for the sheet, null when none is known. */
  const slotRef = useRef<number | null>(null);
  const pendingRef = useRef<(() => void) | null>(null);
  const wasOpenRef = useRef(open);

  // Declared after useOverlayHistoryEntry, so on the opening commit its push (synchronous
  // with a data router) has already landed when this runs.
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      const now = currentSlot();
      const before = beforeRef.current;
      slotRef.current = now !== null && before !== null && now > before ? now : null;
    }
    wasOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) beforeRef.current = currentSlot();
  }, [open, location.key]);

  useEffect(() => {
    const slot = slotRef.current;
    if (slot === null) return;
    const idx = currentSlot();
    if (idx === null || idx >= slot) return;
    slotRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = null;
    pending?.();
  }, [location.key]);

  const closeThen = useCallback((fn: () => void) => {
    const slot = slotRef.current;
    if (slot !== null && currentSlot() === slot) {
      pendingRef.current = fn;
      onCloseRef.current();
      return;
    }
    onCloseRef.current();
    fn();
  }, []);

  return { closeThen };
}
