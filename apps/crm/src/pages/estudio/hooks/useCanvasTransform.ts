// Screen <-> canvas coordinate transform (docs/estudio-design.md §6.3). Scope for this PR: an
// auto-fit scale that keeps the doc's native canvas (1080-wide, per design-doc.ts's
// CANVAS_DIMENSIONS) visible inside whatever container it's mounted in, plus the conversion
// helpers everything else (hit-testing, drag/resize in T2.6/2.7) will build on. No pan/zoom
// interaction yet — that lands with the toolbar/gesture work in later PRs; for now the canvas is
// always centered and fit-to-container, never user-panned.
import { useCallback, useEffect, useRef, useState } from 'react';

const FIT_PADDING_PX = 32;

export interface CanvasPoint {
  x: number;
  y: number;
}

export function useCanvasTransform(canvasWidth: number, canvasHeight: number) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  const recomputeFit = useCallback(() => {
    const el = containerRef.current;
    if (!el || canvasWidth <= 0 || canvasHeight <= 0) return;
    const availableWidth = el.clientWidth - FIT_PADDING_PX * 2;
    const availableHeight = el.clientHeight - FIT_PADDING_PX * 2;
    if (availableWidth <= 0 || availableHeight <= 0) return;
    // Never upscale past 1:1 — a small canvas stays small rather than blowing up to fill a huge
    // viewport (matches every mainstream design tool's default fit behavior).
    const fitScale = Math.min(availableWidth / canvasWidth, availableHeight / canvasHeight, 1);
    setScale(fitScale > 0 ? fitScale : 1);
  }, [canvasWidth, canvasHeight]);

  useEffect(() => {
    recomputeFit();
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(recomputeFit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [recomputeFit]);

  const screenToCanvas = useCallback(
    (screenX: number, screenY: number): CanvasPoint => ({ x: screenX / scale, y: screenY / scale }),
    [scale],
  );
  const canvasToScreen = useCallback(
    (canvasX: number, canvasY: number): CanvasPoint => ({ x: canvasX * scale, y: canvasY * scale }),
    [scale],
  );

  return { containerRef, scale, screenToCanvas, canvasToScreen };
}
