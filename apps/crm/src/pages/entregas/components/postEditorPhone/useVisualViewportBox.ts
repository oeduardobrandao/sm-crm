import { useEffect, useState } from 'react';

export interface ViewportBox {
  /** Distance from the top of the layout viewport to the visible area. */
  top: number;
  /** Height of the visible area (above the software keyboard). */
  height: number;
  /** How much of the layout viewport the keyboard covers at the bottom. */
  keyboardInset: number;
}

function read(): ViewportBox | null {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (!vv) return null;
  const layoutHeight = document.documentElement.clientHeight || window.innerHeight;
  return {
    top: Math.max(0, vv.offsetTop),
    height: vv.height,
    keyboardInset: Math.max(0, Math.round(layoutHeight - (vv.height + vv.offsetTop))),
  };
}

/**
 * The visible part of the screen while `active`, from `visualViewport`. A full-screen
 * text editor pinned to this box keeps its header on screen and its formatting bar right
 * above the keyboard under all three keyboard models the app meets:
 *
 * - iOS app (Capacitor `Keyboard.resize: 'native'`) and Chrome Android
 *   (`interactive-widget=resizes-content`): the layout viewport itself shrinks, so the
 *   box equals the viewport (top 0, inset 0) and nothing moves.
 * - Mobile Safari: the keyboard overlays the page and Safari may scroll the layout
 *   viewport to the caret; the visual viewport reports both, and the box follows.
 *
 * Null while inactive or where `visualViewport` doesn't exist (callers fall back to
 * `inset: 0`).
 */
export function useVisualViewportBox(active: boolean): ViewportBox | null {
  const [box, setBox] = useState<ViewportBox | null>(null);
  useEffect(() => {
    if (!active) {
      setBox(null);
      return;
    }
    const vv = window.visualViewport;
    if (!vv) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setBox(read()));
    };
    setBox(read());
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [active]);
  return box;
}
