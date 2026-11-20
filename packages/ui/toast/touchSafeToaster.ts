import { useEffect } from 'react';

const TOASTER = '[data-sonner-toaster]';

function inToaster(node: EventTarget | null): boolean {
  return node instanceof Element && node.closest(TOASTER) !== null;
}

/**
 * Keeps a tap from freezing sonner toasts on a touch screen.
 *
 * sonner pauses every toast while its list is "expanded", which it sets on mouseenter and
 * mousemove and clears only on mouseleave. On iOS a tap also fires those mouse events, so
 * one tap on a toast pauses it, and the pause lasts until a later tap elsewhere fires a
 * mouseleave. A scroll or a tap whose touchend calls preventDefault fires none, so the
 * toast stays on screen across pages until the user swipes it away.
 *
 * While the last pointer was a finger or a pen, the mouse events that would expand the
 * list are stopped before React sees them. A real mouse or trackpad (an iPad with one
 * included) still pauses on hover. Swiping and buttons use pointer and click events,
 * which pass. A pointercancel inside the list also ends sonner's "interacting" state,
 * which only a pointerup clears and which keeps the list expanded.
 *
 * Window listeners in the capture phase run before React's root listeners. React fires
 * onMouseEnter from the mouseout of the element the pointer leaves (relatedTarget = the
 * list), or from a mouseover when it comes from outside the page, so both are stopped.
 */
export function installTouchSafeToaster(target: Window = window): () => void {
  let lastPointerType = 'mouse';

  const onPointerDown = (e: PointerEvent) => {
    lastPointerType = e.pointerType || 'mouse';
  };
  const onMouse = (e: MouseEvent) => {
    if (lastPointerType === 'mouse') return;
    const entering =
      e.type === 'mouseout'
        ? inToaster(e.relatedTarget) && !inToaster(e.target)
        : inToaster(e.target);
    if (entering) e.stopPropagation();
  };
  const onPointerCancel = (e: PointerEvent) => {
    if (!inToaster(e.target) || typeof PointerEvent !== 'function') return;
    e.target!.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        pointerId: e.pointerId,
        pointerType: e.pointerType,
      }),
    );
  };

  const opts = { capture: true, passive: true } as const;
  target.addEventListener('pointerdown', onPointerDown, opts);
  target.addEventListener('pointercancel', onPointerCancel, opts);
  for (const type of ['mouseover', 'mouseout', 'mousemove'] as const) {
    target.addEventListener(type, onMouse, opts);
  }
  return () => {
    target.removeEventListener('pointerdown', onPointerDown, opts);
    target.removeEventListener('pointercancel', onPointerCancel, opts);
    for (const type of ['mouseover', 'mouseout', 'mousemove'] as const) {
      target.removeEventListener(type, onMouse, opts);
    }
  };
}

/** Installs {@link installTouchSafeToaster} for as long as the calling component is mounted. */
export function useTouchSafeToaster(): void {
  useEffect(() => installTouchSafeToaster(), []);
}
