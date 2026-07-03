// Core pointer-event surface for the canvas editor (docs/estudio-design.md §6.2/§6.3, plan
// T2.6/T2.7). Lives inside the canvas-box wrapper CanvasStage builds, as an absolutely-positioned
// sibling of SatoriPreview's SVG content, so a pointer event's position relative to THIS
// element's own bounding box feeds directly into `screenToCanvas` (divide by scale, no extra
// offset math) — see CanvasStage.tsx's header comment for why that wrapper exists.
//
// COMMIT-BOUNDARY DISCIPLINE (the most important correctness constraint here, docs/
// estudio-design.md §6.2/§6.3): drag/resize gestures buffer their transient delta in local
// component state (`gesture`), render a purely-visual CSS-transformed ghost via LayerHandles'
// outline + a translated preview box, and NEVER dispatch to the reducer mid-gesture — satori must
// not re-render on every pointermove. Exactly ONE `layer/update` dispatch fires on pointerup, with
// the final (possibly snapped) values. Getting this wrong (dispatching per-pointermove) is the
// single most important bug this file must avoid.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getLayerBBox,
  computeResizePatch,
  type LayerBBox,
  type ResizeHandle,
} from '../../lib/layerGeometry';
import type { CanvasPoint } from '../../hooks/useCanvasTransform';
import { useSelection } from '../../hooks/useSelection';
import { useSnapping } from '../../hooks/useSnapping';
import { LayerHandles } from './LayerHandles';
import type { GetTextHeight } from '../../lib/layerGeometry';
import type { NormalizedLayer } from '../../types';
import type { SnapLine } from '../../lib/snapMath';

export interface InteractionOverlayProps {
  layers: NormalizedLayer[];
  selection: string[];
  select: (selection: string[]) => void;
  onUpdateLayer: (layerId: string, patch: Partial<NormalizedLayer>) => void;
  getTextHeight: GetTextHeight;
  canvasWidth: number;
  canvasHeight: number;
  scale: number;
  screenToCanvas: (screenX: number, screenY: number) => CanvasPoint;
  canvasToScreen: (canvasX: number, canvasY: number) => CanvasPoint;
}

type Gesture =
  | {
      type: 'drag';
      layerId: string;
      startPointer: CanvasPoint;
      startBBox: LayerBBox;
      rotation: number;
      hasHeight: boolean;
    }
  | {
      type: 'resize';
      layerId: string;
      handle: ResizeHandle;
      startPointer: CanvasPoint;
      startBBox: LayerBBox;
      rotation: number;
      hasHeight: boolean;
    };

interface GhostState {
  bbox: LayerBBox;
  activeLines: SnapLine[];
}

function isTextLayer(layer: NormalizedLayer): boolean {
  return layer.type === 'text';
}

/** `setPointerCapture` isn't implemented in jsdom (and is missing in a handful of real
 * webview/embedded environments) — guarded so a gesture can still begin/complete without it; it's
 * a UX nicety (keeps receiving move/up events if the pointer leaves the element's bounds mid-
 * gesture), not a correctness requirement for this overlay's own state machine. */
function capturePointer(el: HTMLElement | null, pointerId: number): void {
  if (el && typeof el.setPointerCapture === 'function') {
    el.setPointerCapture(pointerId);
  }
}

export function InteractionOverlay({
  layers,
  selection,
  select,
  onUpdateLayer,
  getTextHeight,
  canvasWidth,
  canvasHeight,
  scale,
  screenToCanvas,
  canvasToScreen,
}: InteractionOverlayProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [ghost, setGhost] = useState<GhostState | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const ghostRef = useRef<GhostState | null>(null);

  const { selectAtPoint, hitTest } = useSelection({ layers, getTextHeight, select });
  const { snap } = useSnapping({ layers, canvasWidth, canvasHeight, getTextHeight, scale });

  const selectedLayer =
    selection.length === 1 ? (layers.find((l) => l.id === selection[0]) ?? null) : null;

  const clientPointToCanvas = useCallback(
    (clientX: number, clientY: number): CanvasPoint => {
      const box = overlayRef.current?.getBoundingClientRect();
      const screenX = clientX - (box?.left ?? 0);
      const screenY = clientY - (box?.top ?? 0);
      return screenToCanvas(screenX, screenY);
    },
    [screenToCanvas],
  );

  const endGesture = useCallback(
    (commit: boolean) => {
      const activeGesture = gestureRef.current;
      const activeGhost = ghostRef.current;
      if (commit && activeGesture && activeGhost) {
        const patch: Partial<NormalizedLayer> = { x: activeGhost.bbox.x, y: activeGhost.bbox.y };
        if (activeGesture.type === 'resize') {
          patch.w = activeGhost.bbox.w;
          if (activeGesture.hasHeight) (patch as { h?: number }).h = activeGhost.bbox.h;
        }
        onUpdateLayer(activeGesture.layerId, patch);
      }
      gestureRef.current = null;
      ghostRef.current = null;
      setGesture(null);
      setGhost(null);
    },
    [onUpdateLayer],
  );

  const handleBackgroundPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Only the overlay element itself counts as "background" — a pointerdown that bubbled up
      // from a handle (LayerHandles) or the selected layer's own hit area is handled by their own
      // handlers, which call `e.stopPropagation()`.
      if (e.target !== overlayRef.current) return;
      const point = clientPointToCanvas(e.clientX, e.clientY);
      // Whether this hits a layer or empty background, one click only ever selects/deselects —
      // a drag begins on a SUBSEQUENT pointerdown, once the layer is already selected (see
      // `handleLayerBodyPointerDown` below), matching plan scope (click selects, doesn't drag).
      selectAtPoint(point);
    },
    [clientPointToCanvas, selectAtPoint],
  );

  const beginDrag = useCallback(
    (layer: NormalizedLayer, e: React.PointerEvent) => {
      e.stopPropagation();
      const point = clientPointToCanvas(e.clientX, e.clientY);
      const startBBox = getLayerBBox(layer, getTextHeight);
      const hasHeight = !isTextLayer(layer);
      const next: Gesture = {
        type: 'drag',
        layerId: layer.id,
        startPointer: point,
        startBBox,
        rotation: layer.rotation,
        hasHeight,
      };
      gestureRef.current = next;
      setGesture(next);
      const initialGhost: GhostState = { bbox: startBBox, activeLines: [] };
      ghostRef.current = initialGhost;
      setGhost(initialGhost);
      capturePointer(overlayRef.current, e.pointerId);
    },
    [clientPointToCanvas, getTextHeight],
  );

  const handleLayerBodyPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!selectedLayer) return;
      e.stopPropagation();
      const point = clientPointToCanvas(e.clientX, e.clientY);
      // Only start a drag if the pointerdown actually landed on the selected layer's own body —
      // re-hit-test rather than trusting the caller, since the layer-body hit area covers the
      // whole overlay when something is selected (see render() below).
      const hit = hitTest(point);
      if (!hit || hit.id !== selectedLayer.id) {
        // Clicked elsewhere (a different layer, or empty background) — treat as a normal select.
        selectAtPoint(point);
        return;
      }
      beginDrag(selectedLayer, e);
    },
    [selectedLayer, clientPointToCanvas, hitTest, selectAtPoint, beginDrag],
  );

  const handleResizePointerDown = useCallback(
    (handle: ResizeHandle, e: React.PointerEvent) => {
      if (!selectedLayer) return;
      e.stopPropagation();
      const point = clientPointToCanvas(e.clientX, e.clientY);
      const startBBox = getLayerBBox(selectedLayer, getTextHeight);
      const hasHeight = !isTextLayer(selectedLayer);
      const next: Gesture = {
        type: 'resize',
        layerId: selectedLayer.id,
        handle,
        startPointer: point,
        startBBox,
        rotation: selectedLayer.rotation,
        hasHeight,
      };
      gestureRef.current = next;
      setGesture(next);
      const initialGhost: GhostState = { bbox: startBBox, activeLines: [] };
      ghostRef.current = initialGhost;
      setGhost(initialGhost);
      capturePointer(overlayRef.current, e.pointerId);
    },
    [selectedLayer, clientPointToCanvas, getTextHeight],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const activeGesture = gestureRef.current;
      if (!activeGesture) return;
      const point = clientPointToCanvas(e.clientX, e.clientY);

      if (activeGesture.type === 'drag') {
        const dx = point.x - activeGesture.startPointer.x;
        const dy = point.y - activeGesture.startPointer.y;
        const proposed: LayerBBox = {
          x: activeGesture.startBBox.x + dx,
          y: activeGesture.startBBox.y + dy,
          w: activeGesture.startBBox.w,
          h: activeGesture.startBBox.h,
        };
        const result = snap(proposed, activeGesture.rotation, activeGesture.layerId);
        const next: GhostState = { bbox: result.bbox, activeLines: result.activeLines };
        ghostRef.current = next;
        setGhost(next);
      } else {
        const delta: CanvasPoint = {
          x: point.x - activeGesture.startPointer.x,
          y: point.y - activeGesture.startPointer.y,
        };
        const patch = computeResizePatch(
          activeGesture.handle,
          activeGesture.startBBox,
          activeGesture.rotation,
          delta,
          activeGesture.hasHeight,
        );
        const proposed: LayerBBox = {
          x: patch.x,
          y: patch.y,
          w: patch.w,
          h: patch.h ?? activeGesture.startBBox.h,
        };
        // Snapping resize edges is a reasonable UX nicety but adds real complexity (which edge(s)
        // of the box the active handle actually controls varies per-handle, and snapping would
        // need to preserve the anchor-corner invariant `computeResizePatch` already guarantees).
        // JUDGMENT CALL: skipped for this PR — resize does not snap, only drag does. Documented
        // here for reviewer visibility; a follow-up can add it if the UX gap is felt in practice.
        const next: GhostState = { bbox: proposed, activeLines: [] };
        ghostRef.current = next;
        setGhost(next);
      }
    },
    [clientPointToCanvas, snap],
  );

  const handlePointerUp = useCallback(() => {
    endGesture(true);
  }, [endGesture]);

  useEffect(() => {
    if (!gesture) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') endGesture(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [gesture, endGesture]);

  // Fallback for environments where `setPointerCapture` isn't supported (capturePointer() above
  // already guards the call itself, but without capture, releasing the pointer OUTSIDE this
  // overlay's bounds means neither `onPointerUp` nor `onPointerCancel` fires on it — the browser
  // hit-tests pointerup to whatever's actually under the cursor, not this element — leaving
  // `gesture`/`ghost` stuck with no recovery. A window-level listener catches that case. Commits
  // (not cancels) on release, matching ordinary drag-and-drop UX — releasing the pointer ends the
  // gesture at wherever it currently is, it doesn't discard it. Safe to double-fire alongside the
  // overlay's own onPointerUp for the normal in-bounds case: `endGesture` nulls out
  // gestureRef/ghostRef synchronously, so a second call (this listener, since window is outside
  // the bubble chain from the overlay's own React-delegated handler) is a no-op.
  useEffect(() => {
    if (!gesture) return;
    const onWindowPointerUp = () => endGesture(true);
    window.addEventListener('pointerup', onWindowPointerUp);
    return () => window.removeEventListener('pointerup', onWindowPointerUp);
  }, [gesture, endGesture]);

  const displayBBox =
    ghost?.bbox ?? (selectedLayer ? getLayerBBox(selectedLayer, getTextHeight) : null);

  return (
    <div
      ref={overlayRef}
      data-testid="interaction-overlay"
      style={{ position: 'absolute', inset: 0, cursor: selectedLayer ? 'move' : 'default' }}
      onPointerDown={selectedLayer ? handleLayerBodyPointerDown : handleBackgroundPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => endGesture(false)}
    >
      {ghost && gesture && (
        <div
          data-testid="gesture-ghost"
          style={{
            position: 'absolute',
            left: canvasToScreen(ghost.bbox.x, ghost.bbox.y).x,
            top: canvasToScreen(ghost.bbox.x, ghost.bbox.y).y,
            width: ghost.bbox.w * scale,
            height: ghost.bbox.h * scale,
            // Both Gesture variants carry the layer's own rotation now — without this, a rotated
            // layer's ghost renders as an axis-aligned box during the gesture while LayerHandles'
            // selection outline (still visible underneath/around it) stays correctly rotated,
            // visibly diverging from what the committed result will actually look like.
            transform: gesture.rotation ? `rotate(${gesture.rotation}deg)` : undefined,
            border: '1.5px dashed var(--primary-color, #eab308)',
            backgroundColor: 'rgba(234, 179, 8, 0.08)',
            pointerEvents: 'none',
          }}
        />
      )}
      {ghost?.activeLines.map((line, i) => {
        const isX = line.axis === 'x';
        const start = canvasToScreen(isX ? line.position : 0, isX ? 0 : line.position);
        return (
          <div
            key={`${line.axis}-${line.position}-${i}`}
            data-testid="snap-guide-line"
            style={{
              position: 'absolute',
              left: isX ? start.x : 0,
              top: isX ? 0 : start.y,
              width: isX ? 1 : '100%',
              height: isX ? '100%' : 1,
              backgroundColor: 'var(--primary-color, #eab308)',
              pointerEvents: 'none',
            }}
          />
        );
      })}
      {selectedLayer && displayBBox && (
        <LayerHandles
          bbox={displayBBox}
          rotation={selectedLayer.rotation}
          hasHeight={!isTextLayer(selectedLayer)}
          canvasToScreen={canvasToScreen}
          onResizePointerDown={handleResizePointerDown}
        />
      )}
    </div>
  );
}
