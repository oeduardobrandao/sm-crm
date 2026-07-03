// Screen <-> canvas coordinate transform + view state (docs/estudio-design.md §6.3, zoom/pan
// re-anchored into PR 2.D). The model keeps CanvasStage's "canvas box" contract intact: the box
// is always sized `canvas * scale` and every inner consumer (InteractionOverlay, LayerHandles,
// TextEditOverlay, SafeZoneGuides) measures pointer positions relative to the BOX's own
// getBoundingClientRect — so `screenToCanvas`/`canvasToScreen` stay pure scale conversions and
// zooming/panning is implemented entirely by resizing/translating the box, never by changing
// the conversion math underneath the overlays.
//
// View state = `fitScale` (auto-fit to container, ResizeObserver-driven, never upscaling past
// 1:1) × `zoom` (user multiplier, 1 = fit) + `offset` (pan, screen px, applied as a CSS
// translate on the box). Ctrl/Cmd+wheel — which is also how browsers deliver trackpad pinch —
// zooms about the cursor; plain wheel pans (two-finger scroll); the TopToolbar's percentage
// button calls `resetView`. Wheel listeners are bound non-passively so the browser's own
// page-zoom/scroll never fights the canvas.
import { useCallback, useEffect, useRef, useState } from 'react';

const FIT_PADDING_PX = 32;
/** Effective-scale clamp: 5%–400% of the native 1080-wide canvas. */
const MIN_EFFECTIVE_SCALE = 0.05;
const MAX_EFFECTIVE_SCALE = 4;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasViewOffset {
  x: number;
  y: number;
}

export function useCanvasTransform(canvasWidth: number, canvasHeight: number) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [fitScale, setFitScale] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<CanvasViewOffset>({ x: 0, y: 0 });

  const scale = fitScale * zoom;

  // Refs mirror the state the wheel handler needs — it's bound once, non-passively, and must
  // never read stale closures.
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const fitScaleRef = useRef(fitScale);
  fitScaleRef.current = fitScale;
  const offsetRef = useRef(offset);
  offsetRef.current = offset;

  const recomputeFit = useCallback(() => {
    const el = containerRef.current;
    if (!el || canvasWidth <= 0 || canvasHeight <= 0) return;
    const availableWidth = el.clientWidth - FIT_PADDING_PX * 2;
    const availableHeight = el.clientHeight - FIT_PADDING_PX * 2;
    if (availableWidth <= 0 || availableHeight <= 0) return;
    // Never upscale past 1:1 — a small canvas stays small rather than blowing up to fill a huge
    // viewport (matches every mainstream design tool's default fit behavior).
    const nextFit = Math.min(availableWidth / canvasWidth, availableHeight / canvasHeight, 1);
    setFitScale(nextFit > 0 ? nextFit : 1);
  }, [canvasWidth, canvasHeight]);

  useEffect(() => {
    recomputeFit();
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(recomputeFit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [recomputeFit]);

  /** Multiplies the effective scale by `factor`, keeping the canvas point under the client
   * coordinates stationary on screen. The box is flex-CENTERED in the container and then
   * translated by `offset`, so its top-left is
   * `containerTopLeft + (containerSize - canvasSize*scale)/2 + offset` per axis — solving that
   * for the new offset keeps the anchor point fixed through the size change. */
  const zoomAtPoint = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const el = containerRef.current;
      if (!el) return;
      const oldScale = scaleRef.current;
      const newScale = Math.min(
        MAX_EFFECTIVE_SCALE,
        Math.max(MIN_EFFECTIVE_SCALE, oldScale * factor),
      );
      if (newScale === oldScale) return;

      const rect = el.getBoundingClientRect();
      const oldOffset = offsetRef.current;
      const boxLeft = rect.left + (rect.width - canvasWidth * oldScale) / 2 + oldOffset.x;
      const boxTop = rect.top + (rect.height - canvasHeight * oldScale) / 2 + oldOffset.y;
      const anchor = {
        x: (clientX - boxLeft) / oldScale,
        y: (clientY - boxTop) / oldScale,
      };

      setZoom(newScale / fitScaleRef.current);
      setOffset({
        x: clientX - rect.left - (rect.width - canvasWidth * newScale) / 2 - anchor.x * newScale,
        y: clientY - rect.top - (rect.height - canvasHeight * newScale) / 2 - anchor.y * newScale,
      });
    },
    [canvasWidth, canvasHeight],
  );

  const panBy = useCallback((dx: number, dy: number) => {
    setOffset((o) => ({ x: o.x + dx, y: o.y + dy }));
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  // Non-passive wheel binding (React's synthetic onWheel can't preventDefault reliably).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomAtPoint(e.clientX, e.clientY, Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY));
      } else {
        e.preventDefault();
        setOffset((o) => ({ x: o.x - e.deltaX, y: o.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAtPoint]);

  const screenToCanvas = useCallback(
    (screenX: number, screenY: number): CanvasPoint => ({ x: screenX / scale, y: screenY / scale }),
    [scale],
  );
  const canvasToScreen = useCallback(
    (canvasX: number, canvasY: number): CanvasPoint => ({ x: canvasX * scale, y: canvasY * scale }),
    [scale],
  );

  return {
    containerRef,
    scale,
    offset,
    /** True when the view is at the default fit (zoom untouched, no pan). */
    isFitView: zoom === 1 && offset.x === 0 && offset.y === 0,
    screenToCanvas,
    canvasToScreen,
    zoomAtPoint,
    panBy,
    resetView,
  };
}
