import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/** React Router's index for the current history slot (`history.state.idx`). Internal to the
 *  router but stable across v6/v7, and the only slot identity that survives a REPLACE: the
 *  location key changes on every replace, the index doesn't. */
function currentSlot(): number | null {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === 'number' ? idx : null;
}

/*
 * Coordination between hook instances (a dialog and the confirm stacked on it, a sheet
 * closing while another opens). Both maps are keyed by slot index.
 */
/** Slots that hold an entry pushed by a mounted hook, and the hook that owns each. */
const liveSlots = new Map<number, object>();
/** Slots whose UI pop (`navigate(-1)`) is still in flight. */
const poppingSlots = new Set<number>();

/** A pop issued by some overlay hasn't landed yet: pushing now would be undone by it. */
function popInFlight(): boolean {
  const idx = currentSlot();
  if (idx === null) return false;
  for (const slot of poppingSlots) {
    if (idx >= slot) return true;
    poppingSlots.delete(slot);
  }
  return false;
}

export interface OverlayHistoryOptions {
  /**
   * Pop the entry when the component unmounts while the overlay is open and its entry is
   * still the current one on the same path. For overlays whose parent closes them by
   * unmounting (`{x && <Dialog open />}`). A navigation from inside the overlay (a push, or
   * a replace to another path) is left alone.
   */
  popOnUnmount?: boolean;
  /**
   * After a Back-triggered `onClose`, re-push once the close has rendered if the overlay is
   * still open (the parent refused it). Skipped when `onClose` navigated. Without it only an
   * explicit `false` from `onClose` re-pushes.
   */
  repushIfStillOpen?: boolean;
}

function currentKey(): unknown {
  return (window.history.state as { key?: unknown } | null)?.key;
}

/**
 * Gives an in-page overlay (drawer, full-screen panel) its own history entry, so Back
 * (the browser button, the iOS edge swipe, Android's back) closes it instead of leaving
 * the page underneath it.
 *
 * - Opening pushes a copy of the CURRENT URL. `window.location`, not `useLocation()`: a
 *   sibling effect may have just replaced the query in this same commit and the
 *   render-time location would push it back stale.
 * - Back past that entry calls `onClose`. When the overlay is still open afterwards (the
 *   close was refused, e.g. an unsaved-changes prompt answered "Continuar editando"), the
 *   entry is pushed again, so the next Back doesn't leave the page. `onClose` returning
 *   `false` says so up front and re-pushes in the same tick, before anything the refusal
 *   opens (the prompt) pushes its own entry.
 * - Closing from the UI (X, overlay click) pops the entry, but only while it's still the
 *   current slot. Replaces in between keep the slot, and their URL is carried onto the
 *   entry below once the pop lands, so a filter change while the overlay is open sticks.
 *   When another overlay's entry sits above it (a confirm closing in the same commit),
 *   the pop waits for that one to land first.
 * - Opening while another overlay's pop is in flight waits for it, so the async pop can't
 *   land on the new entry and close the new overlay.
 * - Unmounting does nothing (unless `popOnUnmount`): if the user left the page with the
 *   overlay open, popping here would undo their navigation.
 *
 * `open` must be ONE boolean for everything the hook covers. Two overlays swapped in the
 * same commit (one closes, the other opens) keep it true and reuse the entry.
 */
export function useOverlayHistoryEntry(
  open: boolean,
  onClose: () => void | boolean,
  options: OverlayHistoryOptions = {},
): void {
  const navigate = useNavigate();
  const location = useLocation();
  const [owner] = useState(() => ({}));
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const openRef = useRef(open);
  openRef.current = open;
  const popOnUnmountRef = useRef(options.popOnUnmount === true);
  popOnUnmountRef.current = options.popOnUnmount === true;
  const repushRef = useRef(options.repushIfStillOpen === true);
  repushRef.current = options.repushIfStillOpen === true;
  /** History key right after a Back-triggered onClose that may have been refused. */
  const retryKeyRef = useRef<unknown>(undefined);
  /** Slot index of the entry pushed for the overlay; null while none is pushed. */
  const slotRef = useRef<number | null>(null);
  /** Path the entry was pushed on (for `popOnUnmount`). */
  const pushedPathRef = useRef<string | null>(null);
  /** A UI close popped the entry and the (async) popstate hasn't landed yet. Holds the
   *  URL the overlay's slot had at that moment, to carry onto the entry below. */
  const poppingRef = useRef<{ href: string; usr: unknown } | null>(null);
  /** Closed while another overlay's entry was above ours: pop once that one is gone. */
  const deferredPopRef = useRef(false);
  /** Opened while another overlay's pop was in flight: push once it lands. */
  const waitingPushRef = useRef(false);
  const mountedRef = useRef(false);
  /** Bumped after a Back-triggered close, to re-push if the overlay stayed open. */
  const [retry, setRetry] = useState(0);

  const releaseSlot = useCallback(
    (slot: number) => {
      if (liveSlots.get(slot) === owner) liveSlots.delete(slot);
    },
    [owner],
  );

  const pushEntry = useCallback(() => {
    if (popInFlight()) {
      waitingPushRef.current = true;
      return;
    }
    waitingPushRef.current = false;
    const before = currentSlot();
    if (before === null) return;
    const { pathname, search, hash } = window.location;
    const usr = (window.history.state as { usr?: unknown } | null)?.usr;
    // Loader-less data router: the push lands in window.history synchronously.
    navigate(pathname + search + hash, { state: usr });
    const after = currentSlot();
    if (after !== null && after > before) {
      slotRef.current = after;
      pushedPathRef.current = pathname;
      liveSlots.set(after, owner);
    } else {
      slotRef.current = null;
    }
  }, [navigate, owner]);

  /** Pops our entry, which must be the current slot. */
  const popEntry = useCallback(() => {
    const slot = slotRef.current;
    if (slot === null) return;
    const { pathname, search, hash } = window.location;
    const usr = (window.history.state as { usr?: unknown } | null)?.usr;
    poppingRef.current = { href: pathname + search + hash, usr };
    poppingSlots.add(slot);
    navigate(-1);
  }, [navigate]);

  // While a pop is in flight slotRef is still set, so a reopen waits for it (below)
  // instead of pushing an entry the pop would then remove.
  useEffect(() => {
    if (!open || slotRef.current !== null) return;
    if (retry > 0 && retryKeyRef.current !== undefined) {
      // Still open after a Back-triggered close: refused, unless onClose navigated (a
      // URL-driven overlay closes when that navigation renders).
      const key = retryKeyRef.current;
      retryKeyRef.current = undefined;
      if (currentKey() !== key) return;
    }
    pushEntry();
  }, [open, pushEntry, retry]);

  useEffect(() => {
    const slot = slotRef.current;
    if (slot === null) {
      if (waitingPushRef.current && openRef.current) pushEntry();
      return;
    }
    const idx = currentSlot();
    if (idx === null) return;
    if (idx === slot) {
      // The overlay above ours is gone; ours was closed meanwhile and can pop now.
      if (deferredPopRef.current && !poppingRef.current) {
        deferredPopRef.current = false;
        if (!openRef.current) popEntry();
      }
      return;
    }
    if (idx > slot) return;
    slotRef.current = null;
    releaseSlot(slot);
    poppingSlots.delete(slot);
    const popped = poppingRef.current;
    const deferred = deferredPopRef.current;
    deferredPopRef.current = false;
    if (popped) {
      // Our own pop landed on the entry below, which still holds the URL from before the
      // overlay opened. Anything replaced into the overlay's slot meanwhile (a filter
      // change syncing the query) must survive: the page's state already reflects it and
      // won't re-sync on its own. Reopened in the meantime: it needs an entry again.
      poppingRef.current = null;
      const { pathname, search, hash } = window.location;
      if (pathname + search + hash !== popped.href) {
        navigate(popped.href, { replace: true, state: popped.usr });
      }
      if (openRef.current) pushEntry();
    } else if (!deferred) {
      // Back past our entry. A refused close keeps the overlay open: re-push now when
      // onClose says so, otherwise once the close has rendered (retry effect above).
      if (onCloseRef.current() === false) {
        if (openRef.current) pushEntry();
      } else if (repushRef.current) {
        retryKeyRef.current = currentKey();
        setRetry((n) => n + 1);
      }
    }
  }, [location.key, navigate, pushEntry, popEntry, releaseSlot]);

  useEffect(() => {
    if (open) {
      deferredPopRef.current = false;
      return;
    }
    if (poppingRef.current) return;
    waitingPushRef.current = false;
    const slot = slotRef.current;
    if (slot === null) return;
    const idx = currentSlot();
    if (idx === slot) {
      popEntry();
    } else if (idx !== null && idx > slot && liveSlots.has(idx) && liveSlots.get(idx) !== owner) {
      // Another overlay's entry is above ours (a confirm closing in this same commit, its
      // pop not landed yet). Popping now would remove the wrong entry: wait for it.
      deferredPopRef.current = true;
    } else {
      slotRef.current = null;
      releaseSlot(slot);
    }
  }, [open, popEntry, owner, releaseSlot]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const slot = slotRef.current;
      if (slot === null) return;
      const wasOpen = openRef.current;
      const popping = poppingRef.current !== null;
      // A microtask, so a remount in the same tick (StrictMode's effect replay) keeps it.
      queueMicrotask(() => {
        if (mountedRef.current) return;
        releaseSlot(slot);
        if (!popOnUnmountRef.current || popping || !wasOpen) return;
        if (currentSlot() !== slot || window.location.pathname !== pushedPathRef.current) return;
        // Closed by unmounting: pop like a UI close would, and carry over any URL replaced
        // into our slot once the pop lands (no effect of ours will run by then).
        const { pathname, search, hash } = window.location;
        const href = pathname + search + hash;
        const usr = (window.history.state as { usr?: unknown } | null)?.usr;
        poppingSlots.add(slot);
        const onPop = () => {
          window.removeEventListener('popstate', onPop);
          poppingSlots.delete(slot);
          // After the router has handled the pop.
          setTimeout(() => {
            const now = window.location;
            if (now.pathname + now.search + now.hash !== href) {
              navigate(href, { replace: true, state: usr });
            }
          }, 0);
        };
        window.addEventListener('popstate', onPop);
        navigate(-1);
      });
    };
    // Mount/unmount only: everything the cleanup reads is a ref or stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
