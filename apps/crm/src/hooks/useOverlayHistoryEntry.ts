import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/** React Router's index for the current history slot (`history.state.idx`). Internal to the
 *  router but stable across v6/v7, and the only slot identity that survives a REPLACE: the
 *  location key changes on every replace, the index doesn't. */
function currentSlot(): number | null {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === 'number' ? idx : null;
}

/**
 * Gives an in-page overlay (drawer, full-screen panel) its own history entry, so Back
 * (the browser button, the iOS edge swipe, Android's back) closes it instead of leaving
 * the page underneath it.
 *
 * - Opening pushes a copy of the CURRENT URL. `window.location`, not `useLocation()`: a
 *   sibling effect may have just replaced the query in this same commit and the
 *   render-time location would push it back stale.
 * - Back past that entry calls `onClose`.
 * - Closing from the UI (X, overlay click) pops the entry, but only while it's still the
 *   current slot. Replaces in between keep the slot, so a filter change while the overlay
 *   is open still unwinds cleanly.
 * - Unmounting does nothing: if the user left the page with the overlay open, popping
 *   here would undo their navigation.
 *
 * `open` must be ONE boolean for everything the hook covers. Two overlays swapped in the
 * same commit (one closes, the other opens) keep it true and reuse the entry; a hook per
 * overlay would pop and push at once, and the async pop would close the new one.
 */
export function useOverlayHistoryEntry(open: boolean, onClose: () => void): void {
  const navigate = useNavigate();
  const location = useLocation();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  /** Slot index of the entry pushed for the overlay; null while none is pushed. */
  const slotRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open || slotRef.current !== null) return;
    const before = currentSlot();
    if (before === null) return;
    const { pathname, search, hash } = window.location;
    const usr = (window.history.state as { usr?: unknown } | null)?.usr;
    // Loader-less data router: the push lands in window.history synchronously.
    navigate(pathname + search + hash, { state: usr });
    const after = currentSlot();
    slotRef.current = after !== null && after > before ? after : null;
  }, [open, navigate]);

  useEffect(() => {
    const slot = slotRef.current;
    if (slot === null) return;
    const idx = currentSlot();
    if (idx !== null && idx < slot) {
      slotRef.current = null;
      onCloseRef.current();
    }
  }, [location.key]);

  useEffect(() => {
    if (open) return;
    const slot = slotRef.current;
    if (slot === null) return;
    slotRef.current = null;
    if (currentSlot() === slot) navigate(-1);
  }, [open, navigate]);
}
