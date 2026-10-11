import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

export const LONG_PRESS_MS = 450;
/** Movement past this many px cancels the hold, so a scroll that starts on the target still scrolls. */
export const LONG_PRESS_TOLERANCE_PX = 8;

export interface LongPressOptions {
  onLongPress: () => void;
  delay?: number;
  tolerance?: number;
  disabled?: boolean;
}

export interface LongPressBind {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onClickCapture: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  'data-holding'?: 'true';
}

/**
 * Long-press (and right-click) detection on a target that stays tappable.
 *
 * - The hold fires after `delay` ms without moving more than `tolerance` px.
 * - While a touch or pen is down the bind sets `data-holding`, and the CSS turns off
 *   `-webkit-touch-callout` and text selection on it, so iOS doesn't show its link
 *   callout or the selection loupe instead of our menu.
 * - The click that follows a hold is swallowed, so the card underneath doesn't open too.
 * - Right-click (`contextmenu`) opens it at once. Android Chrome also fires `contextmenu`
 *   on a long-press; opening twice is a no-op for the caller.
 */
export function useLongPress({
  onLongPress,
  delay = LONG_PRESS_MS,
  tolerance = LONG_PRESS_TOLERANCE_PX,
  disabled = false,
}: LongPressOptions): LongPressBind {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);
  const callbackRef = useRef(onLongPress);
  callbackRef.current = onLongPress;
  const [holding, setHolding] = useState(false);

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    startRef.current = null;
    setHolding(false);
  }, []);

  useEffect(() => clear, [clear]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled || e.button !== 0) return;
      firedRef.current = false;
      startRef.current = { x: e.clientX, y: e.clientY };
      if (e.pointerType !== 'mouse') setHolding(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        firedRef.current = true;
        setHolding(false);
        callbackRef.current();
      }, delay);
    },
    [delay, disabled],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const start = startRef.current;
      if (!start || !timerRef.current) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > tolerance) clear();
    },
    [clear, tolerance],
  );

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (!firedRef.current) return;
    firedRef.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      e.preventDefault();
      clear();
      firedRef.current = false;
      callbackRef.current();
    },
    [clear, disabled],
  );

  const onPointerUp = useCallback(() => {
    clear();
    // The click that follows this pointerup is the one to swallow. If it never comes
    // (the menu's overlay took it), forget the hold so a later click isn't eaten.
    if (firedRef.current) {
      setTimeout(() => {
        firedRef.current = false;
      }, 350);
    }
  }, [clear]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: clear,
    onClickCapture,
    onContextMenu,
    ...(holding ? { 'data-holding': 'true' as const } : {}),
  };
}
