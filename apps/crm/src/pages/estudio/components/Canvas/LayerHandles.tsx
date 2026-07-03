// Rotation-aware selection outline + 8 resize handles for the currently-selected layer (docs/
// estudio-design.md §6.2/§6.3, plan T2.6/T2.7). ROTATION HANDLES ARE OUT OF SCOPE for this PR
// (plan task T7.1) — layers can already HAVE a nonzero rotation (authored via schema/MCP), so the
// outline/handle placement below correctly accounts for it via `layerGeometry.ts`'s
// `getRotatedCorners`, but there is no rotate-icon/handle here, only the 8 resize handles.
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

export interface LayerHandlesProps {
  bbox: LayerBBox;
  rotation: number;
  /** Text layers get width-only resize (no schema `h`) — hides the n/s (vertical-only) handles,
   * which would otherwise be dead no-ops per `computeResizePatch`'s documented behavior. */
  hasHeight: boolean;
  canvasToScreen: (canvasX: number, canvasY: number) => CanvasPoint;
  onResizePointerDown: (handle: ResizeHandle, e: React.PointerEvent) => void;
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
}: LayerHandlesProps) {
  const corners = getRotatedCorners(bbox, rotation).map((p) => canvasToScreen(p.x, p.y));
  const [tl, tr, br, bl] = corners;

  const outlinePoints = `${tl.x},${tl.y} ${tr.x},${tr.y} ${br.x},${br.y} ${bl.x},${bl.y}`;

  const center: CanvasPoint = { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 };

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
