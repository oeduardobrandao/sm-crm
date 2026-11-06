import * as React from 'react';
import { useOverlayHistoryEntry } from '@/hooks/useOverlayHistoryEntry';

/**
 * Shared plumbing for the phone faces of `ui/dialog` and `ui/alert-dialog` (iOS plan F0c).
 * Both primitives render as kit sheets only inside the phone shell (`usePhoneLayout()`),
 * so nothing here runs on desktop, on tablets or in tests that render a dialog alone.
 */

/** Open state of the surrounding `Dialog` / `AlertDialog` root, for its content. */
export interface OverlayRootState {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Root state for content that only knows Radix's controlled/uncontrolled props. */
export function useOverlayRootState(
  openProp: boolean | undefined,
  defaultOpen: boolean | undefined,
  onOpenChange: ((open: boolean) => void) | undefined,
): OverlayRootState {
  const [uncontrolled, setUncontrolled] = React.useState(defaultOpen ?? false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : uncontrolled;
  const onOpenChangeRef = React.useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!controlled) setUncontrolled(next);
      onOpenChangeRef.current?.(next);
    },
    [controlled],
  );
  return React.useMemo(() => ({ open, onOpenChange: handleOpenChange }), [open, handleOpenChange]);
}

export function composeRefs<T>(...refs: Array<React.Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as React.MutableRefObject<T | null>).current = node;
    }
  };
}

/**
 * The phone dialog's history entry: Back closes it through `onBack`, which goes the same
 * way as the close button (so a dirty form still asks). `onBack` returns `false` when the
 * close was intercepted, and the entry is pushed again at once; a close the parent ignores
 * re-pushes after it renders. Rendered only while the phone face is in use: the hook needs
 * a router, which tests rendering a dialog alone don't have.
 */
export function PhoneOverlayHistory({
  open,
  onBack,
}: {
  open: boolean;
  onBack: () => void | boolean;
}) {
  useOverlayHistoryEntry(open, onBack, { popOnUnmount: true, repushIfStillOpen: true });
  return null;
}

/** Drag distance (px) past which releasing dismisses, and the flick speed (px/ms) that does. */
const DISMISS_DISTANCE = 110;
const DISMISS_VELOCITY = 0.6;

/**
 * Swipe down to dismiss on a sheet's top strip (the kit `BottomSheet`'s gesture, without
 * detents). `onDismiss` decides whether the sheet really closes; the sheet springs back
 * either way, so an intercepted close (unsaved changes) leaves it where it was.
 */
export function useSheetDismissDrag(onDismiss: () => void) {
  const [dragY, setDragY] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);
  const dragRef = React.useRef<{
    pointerId: number;
    startY: number;
    lastY: number;
    lastT: number;
    velocity: number;
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    dragRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      lastY: e.clientY,
      lastT: e.timeStamp,
      velocity: 0,
    };
    const el = e.currentTarget;
    if (typeof el.setPointerCapture === 'function') el.setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dt = Math.max(1, e.timeStamp - drag.lastT);
    drag.velocity = (e.clientY - drag.lastY) / dt;
    drag.lastY = e.clientY;
    drag.lastT = e.timeStamp;
    const dy = e.clientY - drag.startY;
    setDragY(dy > 0 ? dy : dy / 4);
  };

  const endDrag = (e: React.PointerEvent<HTMLElement>, cancelled: boolean) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    const el = e.currentTarget;
    if (typeof el.releasePointerCapture === 'function' && el.hasPointerCapture?.(e.pointerId)) {
      el.releasePointerCapture(e.pointerId);
    }
    const dy = e.clientY - drag.startY;
    setDragging(false);
    setDragY(0);
    if (!cancelled && (dy > DISMISS_DISTANCE || drag.velocity > DISMISS_VELOCITY)) onDismiss();
  };

  return {
    dragY,
    dragging,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (e: React.PointerEvent<HTMLElement>) => endDrag(e, false),
      onPointerCancel: (e: React.PointerEvent<HTMLElement>) => endDrag(e, true),
    },
  };
}
