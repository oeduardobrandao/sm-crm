// Rotation-aware selection outline + 8 resize handles + a rotation grip for the currently-
// selected layer (docs/estudio-design.md §6.2/§6.3, plan T2.6/T2.7/T7.1). The rotation grip sits
// on a short stem above the box's top edge and rotates with the layer.
//
// Positioned in SCREEN-space (relative to the canvas-box wrapper) via `canvasToScreen` — this
// component never touches canvas-space pixels directly except through that conversion, so it
// stays correct at any zoom/fit scale.
import type { CanvasPoint } from '../../hooks/useCanvasTransform';
import type { LayerBBox, ResizeHandle } from '../../lib/layerGeometry';
import { getRotatedCorners } from '../../lib/layerGeometry';

const HANDLE_VISUAL_SIZE = 9;
const HANDLE_HIT_SIZE = 20; // larger invisible pointer hit-area, per plan §6.2 usability note

const RESIZE_HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const HANDLE_CURSORS: Record<ResizeHandle, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
};

/** Canvas-space local position (fraction of w/h, centered at 0) of each handle, matching
 * `layerGeometry.ts`'s `HANDLE_AXES` compass convention. */
const HANDLE_LOCAL_FRACTION: Record<ResizeHandle, { fx: number; fy: number }> = {
  nw: { fx: -0.5, fy: -0.5 },
  n: { fx: 0, fy: -0.5 },
  ne: { fx: 0.5, fy: -0.5 },
  e: { fx: 0.5, fy: 0 },
  se: { fx: 0.5, fy: 0.5 },
  s: { fx: 0, fy: 0.5 },
  sw: { fx: -0.5, fy: 0.5 },
  w: { fx: -0.5, fy: 0 },
};

const ROTATION_GRIP_STEM = 22; // screen px from the top edge to the grip (zoom-constant)
const ROTATION_GRIP_RADIUS = 6;

export interface LayerHandlesProps {
  bbox: LayerBBox;
  rotation: number;
  /** Text layers get width-only resize (no schema `h`) — hides the n/s (vertical-only) handles,
   * which would otherwise be dead no-ops per `computeResizePatch`'s documented behavior. */
  hasHeight: boolean;
  canvasToScreen: (canvasX: number, canvasY: number) => CanvasPoint;
  onResizePointerDown: (handle: ResizeHandle, e: React.PointerEvent) => void;
  /** Rotation grip drag start (T7.1) — omit to hide the grip (e.g. tests that don't exercise it). */
  onRotatePointerDown?: (e: React.PointerEvent) => void;
}

function rotatePointDeg(point: CanvasPoint, deg: number): CanvasPoint {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

export function LayerHandles({
  bbox,
  rotation,
  hasHeight,
  canvasToScreen,
  onResizePointerDown,
  onRotatePointerDown,
}: LayerHandlesProps) {
  const corners = getRotatedCorners(bbox, rotation).map((p) => canvasToScreen(p.x, p.y));
  const [tl, tr, br, bl] = corners;

  const outlinePoints = `${tl.x},${tl.y} ${tr.x},${tr.y} ${br.x},${br.y} ${bl.x},${bl.y}`;

  const center: CanvasPoint = { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 };

  // Rotation grip: a stem from the top-edge midpoint outward (away from the box center), computed
  // in SCREEN space so the stem length is constant regardless of zoom. The outward-normal picks
  // whichever perpendicular of the top edge points away from the (screen) box center.
  const topMid: CanvasPoint = { x: (tl.x + tr.x) / 2, y: (tl.y + tr.y) / 2 };
  const screenCenter: CanvasPoint = {
    x: (tl.x + tr.x + br.x + bl.x) / 4,
    y: (tl.y + tr.y + br.y + bl.y) / 4,
  };
  const edge: CanvasPoint = { x: tr.x - tl.x, y: tr.y - tl.y };
  const edgeLen = Math.hypot(edge.x, edge.y) || 1;
  let normal: CanvasPoint = { x: -edge.y / edgeLen, y: edge.x / edgeLen };
  // Flip to point AWAY from the box center (toward the top, outside the outline).
  if ((topMid.x - screenCenter.x) * normal.x + (topMid.y - screenCenter.y) * normal.y < 0) {
    normal = { x: -normal.x, y: -normal.y };
  }
  const grip: CanvasPoint = {
    x: topMid.x + normal.x * ROTATION_GRIP_STEM,
    y: topMid.y + normal.y * ROTATION_GRIP_STEM,
  };

  const handles = RESIZE_HANDLES.filter((h) => hasHeight || HANDLE_LOCAL_FRACTION[h].fx !== 0).map(
    (handle) => {
      const { fx, fy } = HANDLE_LOCAL_FRACTION[handle];
      const localOffset: CanvasPoint = { x: fx * bbox.w, y: fy * bbox.h };
      const rotatedOffset = rotatePointDeg(localOffset, rotation);
      const canvasPoint: CanvasPoint = {
        x: center.x + rotatedOffset.x,
        y: center.y + rotatedOffset.y,
      };
      const screenPoint = canvasToScreen(canvasPoint.x, canvasPoint.y);
      return { handle, screenPoint };
    },
  );

  return (
    <svg
      style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
      data-testid="layer-handles"
    >
      <polygon
        points={outlinePoints}
        fill="none"
        stroke="var(--primary-color, #eab308)"
        strokeWidth={1.5}
      />
      {onRotatePointerDown && (
        <g>
          <line
            x1={topMid.x}
            y1={topMid.y}
            x2={grip.x}
            y2={grip.y}
            stroke="var(--primary-color, #eab308)"
            strokeWidth={1.5}
            style={{ pointerEvents: 'none' }}
          />
          {/* Invisible larger hit-area for the grip. */}
          <circle
            cx={grip.x}
            cy={grip.y}
            r={HANDLE_HIT_SIZE / 2}
            fill="transparent"
            data-testid="rotate-handle"
            style={{ cursor: 'grab', pointerEvents: 'auto', touchAction: 'none' }}
            onPointerDown={onRotatePointerDown}
          />
          <circle
            cx={grip.x}
            cy={grip.y}
            r={ROTATION_GRIP_RADIUS}
            fill="#ffffff"
            stroke="var(--primary-color, #eab308)"
            strokeWidth={1.5}
            style={{ pointerEvents: 'none' }}
          />
        </g>
      )}
      {handles.map(({ handle, screenPoint }) => (
        <g key={handle}>
          {/* Larger invisible hit-area for pointer usability, per plan §6.2. */}
          <rect
            x={screenPoint.x - HANDLE_HIT_SIZE / 2}
            y={screenPoint.y - HANDLE_HIT_SIZE / 2}
            width={HANDLE_HIT_SIZE}
            height={HANDLE_HIT_SIZE}
            fill="transparent"
            style={{ cursor: HANDLE_CURSORS[handle], pointerEvents: 'auto', touchAction: 'none' }}
            data-testid={`resize-handle-${handle}`}
            onPointerDown={(e) => onResizePointerDown(handle, e)}
          />
          <rect
            x={screenPoint.x - HANDLE_VISUAL_SIZE / 2}
            y={screenPoint.y - HANDLE_VISUAL_SIZE / 2}
            width={HANDLE_VISUAL_SIZE}
            height={HANDLE_VISUAL_SIZE}
            fill="#ffffff"
            stroke="var(--primary-color, #eab308)"
            strokeWidth={1.5}
            style={{ pointerEvents: 'none' }}
          />
        </g>
      ))}
    </svg>
  );
}
