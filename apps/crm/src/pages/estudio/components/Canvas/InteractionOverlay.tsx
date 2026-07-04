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
  angleFromPointer,
  snapAngle,
  type LayerBBox,
  type ResizeHandle,
} from '../../lib/layerGeometry';
import type { CanvasPoint } from '../../hooks/useCanvasTransform';
import { useSelection } from '../../hooks/useSelection';
import { useSnapping } from '../../hooks/useSnapping';
import { LayerHandles } from './LayerHandles';
import { TextEditOverlay } from './TextEditOverlay';
import type { GetTextHeight } from '../../lib/layerGeometry';
import type { NormalizedLayer, NormalizedRun, NormalizedTextLayer } from '../../types';
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
  /** Notified whenever this overlay enters/exits text-edit mode for some layer — lets
   * `EstudioEditorShell` gate things that shouldn't run while a text layer is being typed into
   * (e.g. `LeftToolDock`'s window-level paste-to-insert listener, per T2.9's `pasteEnabled` prop).
   * Optional: tests/callers that don't care about this signal simply omit it. */
  onEditingChange?: (isEditing: boolean) => void;
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
    }
  | {
      type: 'rotate';
      layerId: string;
      /** Canvas-space box center — the pivot the pointer angle is measured around. */
      center: CanvasPoint;
      startBBox: LayerBBox;
      rotation: number;
      hasHeight: boolean;
    };

interface GhostState {
  bbox: LayerBBox;
  activeLines: SnapLine[];
  /** Live rotation during a rotate gesture (degrees) — absent for drag/resize (they keep the
   * layer's committed rotation). */
  rotation?: number;
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
  onEditingChange,
}: InteractionOverlayProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [ghost, setGhost] = useState<GhostState | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const ghostRef = useRef<GhostState | null>(null);
  // Which layer (if any) is currently in TextEditOverlay's modal text-edit takeover — set by a
  // double-click on the selected text layer's body, cleared on commit/cancel. While set, the
  // normal drag hit-area/LayerHandles for THAT layer render nothing; TextEditOverlay renders
  // instead (see render() below) so no drag/resize gesture can be started on it mid-edit.
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);

  const { selectAtPoint, hitTest } = useSelection({ layers, getTextHeight, select });
  const { snap } = useSnapping({ layers, canvasWidth, canvasHeight, getTextHeight, scale });

  const selectedLayer =
    selection.length === 1 ? (layers.find((l) => l.id === selection[0]) ?? null) : null;

  const editingLayer =
    editingLayerId != null
      ? ((layers.find((l) => l.id === editingLayerId) ?? null) as NormalizedTextLayer | null)
      : null;

  // Defensive cleanup mirroring the reducer's own selection-pruning-on-removal behavior (see
  // designDocState.ts's mutating-action branch: "Drop any selected id that no longer exists"): if
  // the layer being edited gets deselected or removed from OUTSIDE this component (e.g. undo,
  // another user's dispatch, the layer/remove action pruning selection), exit edit mode rather
  // than continuing to render a TextEditOverlay for a layer that's no longer selected/present.
  useEffect(() => {
    if (!editingLayerId) return;
    const stillSelected = selection.length === 1 && selection[0] === editingLayerId;
    const stillExists = layers.some((l) => l.id === editingLayerId);
    if (!stillSelected || !stillExists) setEditingLayerId(null);
  }, [editingLayerId, selection, layers]);

  useEffect(() => {
    onEditingChange?.(editingLayerId != null);
  }, [editingLayerId, onEditingChange]);

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
        if (activeGesture.type === 'rotate') {
          // Rotation commits ONLY the angle — position/size are unchanged by a rotate gesture.
          onUpdateLayer(activeGesture.layerId, {
            rotation: activeGhost.rotation ?? activeGesture.rotation,
          } as Partial<NormalizedLayer>);
        } else {
          const patch: Partial<NormalizedLayer> = { x: activeGhost.bbox.x, y: activeGhost.bbox.y };
          if (activeGesture.type === 'resize') {
            patch.w = activeGhost.bbox.w;
            if (activeGesture.hasHeight) (patch as { h?: number }).h = activeGhost.bbox.h;
          }
          onUpdateLayer(activeGesture.layerId, patch);
        }
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
      // The selected layer is in TextEditOverlay's modal text-edit takeover — no drag gesture may
      // start on it (TextEditOverlay itself already renders INSTEAD of this hit-area/LayerHandles
      // while editing, per render() below, so this branch is defense-in-depth, not the only guard).
      if (editingLayerId === selectedLayer.id) return;
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
    [selectedLayer, editingLayerId, clientPointToCanvas, hitTest, selectAtPoint, beginDrag],
  );

  const handleLayerBodyDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!selectedLayer || selectedLayer.type !== 'text') return;
      e.stopPropagation();
      const point = clientPointToCanvas(e.clientX, e.clientY);
      const hit = hitTest(point);
      if (!hit || hit.id !== selectedLayer.id) return;
      // Entering edit mode ends any in-flight drag/resize gesture first (defensive — a double-
      // click fires after two full pointerdown/up cycles, so a gesture shouldn't normally still
      // be active here, but this keeps the invariant "never editing AND dragging at once" airtight
      // even under an unusual event ordering).
      endGesture(false);
      setEditingLayerId(selectedLayer.id);
    },
    [selectedLayer, clientPointToCanvas, hitTest, endGesture],
  );

  const handleTextEditCommit = useCallback(
    (patch: { text: string } | { runs: NormalizedRun[] }) => {
      if (!editingLayerId) return;
      onUpdateLayer(editingLayerId, patch as Partial<NormalizedLayer>);
      setEditingLayerId(null);
    },
    [editingLayerId, onUpdateLayer],
  );

  const handleTextEditCancel = useCallback(() => {
    setEditingLayerId(null);
  }, []);

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

  const handleRotatePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!selectedLayer) return;
      e.stopPropagation();
      const startBBox = getLayerBBox(selectedLayer, getTextHeight);
      const next: Gesture = {
        type: 'rotate',
        layerId: selectedLayer.id,
        center: { x: startBBox.x + startBBox.w / 2, y: startBBox.y + startBBox.h / 2 },
        startBBox,
        rotation: selectedLayer.rotation,
        hasHeight: !isTextLayer(selectedLayer),
      };
      gestureRef.current = next;
      setGesture(next);
      const initialGhost: GhostState = {
        bbox: startBBox,
        activeLines: [],
        rotation: selectedLayer.rotation,
      };
      ghostRef.current = initialGhost;
      setGhost(initialGhost);
      capturePointer(overlayRef.current, e.pointerId);
    },
    [selectedLayer, getTextHeight],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const activeGesture = gestureRef.current;
      if (!activeGesture) return;
      const point = clientPointToCanvas(e.clientX, e.clientY);

      if (activeGesture.type === 'rotate') {
        const raw = angleFromPointer(activeGesture.center, point);
        // Shift-held → always snap to the nearest 45° stop; otherwise snap only when within the
        // small default threshold (a gentle magnet, not a forced grid).
        const rotation = snapAngle(raw, 45, e.shiftKey ? Infinity : undefined);
        const next: GhostState = { bbox: activeGesture.startBBox, activeLines: [], rotation };
        ghostRef.current = next;
        setGhost(next);
        return;
      }

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
      onPointerDown={
        editingLayerId
          ? undefined
          : selectedLayer
            ? handleLayerBodyPointerDown
            : handleBackgroundPointerDown
      }
      onDoubleClick={editingLayerId ? undefined : handleLayerBodyDoubleClick}
      onPointerMove={editingLayerId ? undefined : handlePointerMove}
      onPointerUp={editingLayerId ? undefined : handlePointerUp}
      onPointerCancel={editingLayerId ? undefined : () => endGesture(false)}
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
            // Drag/resize carry the layer's committed rotation; a rotate gesture drives the LIVE
            // angle from the ghost so the ghost box spins with the pointer. Without this, a
            // rotated layer's ghost would render axis-aligned while the outline stays rotated,
            // visibly diverging from what the committed result will look like.
            transformOrigin: 'center',
            transform:
              (ghost.rotation ?? gesture.rotation)
                ? `rotate(${ghost.rotation ?? gesture.rotation}deg)`
                : undefined,
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
      {/* While a layer is being text-edited, TextEditOverlay renders INSTEAD OF the normal drag
          hit-area/LayerHandles for it — the gesture machinery above is already inert for it (see
          the `editingLayerId` guards on the pointer handlers/JSX above), and rendering
          LayerHandles underneath would just be a confusing, functionally-dead selection outline. */}
      {editingLayer && editingLayerId && (
        <TextEditOverlay
          layer={editingLayer}
          bbox={getLayerBBox(editingLayer, getTextHeight)}
          scale={scale}
          canvasToScreen={canvasToScreen}
          onCommit={handleTextEditCommit}
          onCancel={handleTextEditCancel}
        />
      )}
      {gesture?.type === 'rotate' && ghost?.rotation != null && (
        <div
          data-testid="rotation-angle-badge"
          style={{
            position: 'absolute',
            left: canvasToScreen(ghost.bbox.x + ghost.bbox.w / 2, ghost.bbox.y).x,
            top: canvasToScreen(ghost.bbox.x, ghost.bbox.y).y - 34,
            transform: 'translateX(-50%)',
            padding: '0.15rem 0.4rem',
            borderRadius: 6,
            background: 'var(--primary-color, #eab308)',
            color: '#12151a',
            fontSize: '0.7rem',
            fontWeight: 700,
            fontFamily: 'var(--font-mono, monospace)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {Math.round(ghost.rotation)}°
        </div>
      )}
      {selectedLayer && displayBBox && editingLayerId !== selectedLayer.id && (
        <LayerHandles
          bbox={displayBBox}
          // During a rotate gesture the outline spins with the live angle; otherwise the
          // committed rotation. Drag/resize keep the committed rotation (ghost.rotation is unset).
          rotation={ghost?.rotation ?? selectedLayer.rotation}
          hasHeight={!isTextLayer(selectedLayer)}
          canvasToScreen={canvasToScreen}
          onResizePointerDown={handleResizePointerDown}
          onRotatePointerDown={handleRotatePointerDown}
        />
      )}
    </div>
  );
}
