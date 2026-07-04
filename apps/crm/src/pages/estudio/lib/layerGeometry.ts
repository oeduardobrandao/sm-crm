// Pure rotation-aware layer geometry math (docs/estudio-design.md §6.3/§6.6, plan T2.6/T2.7).
// No React, no DOM, no satori import — mirrors the "pure ops, testable in isolation" style of
// `lib/designDocOps.ts`. Everything here operates purely in CANVAS-space pixels (the same space
// as `layer.x/y/w/h` in design-doc.ts), never screen pixels — callers convert screen<->canvas via
// `useCanvasTransform.ts` before/after calling into this module.
//
// Rotation convention (confirmed against design-render-tree.ts's `positionStyle()`, which emits
// `transform: rotate(${layer.rotation}deg)` — standard CSS/SVG rotation semantics): `rotation` is
// in DEGREES, CLOCKWISE for positive values, applied around the layer's own bounding-box center.
// This module assumes a y-down canvas coordinate system (canvas (0,0) is top-left, +y points
// down), matching every other coordinate in this codebase (design-doc.ts, useCanvasTransform.ts).

import type {
  NormalizedImageLayer,
  NormalizedLayer,
  NormalizedShapeLayer,
  NormalizedTextLayer,
} from '../types';

/** Canvas-space axis-aligned bounding box, pre-rotation (i.e. the box rotation is applied
 * *around*, not a box that already accounts for rotated extents). */
export interface LayerBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CanvasPoint {
  x: number;
  y: number;
}

/** Text layers have no schema `h` (design-doc.ts: height is emergent from satori/yoga text
 * layout) — callers inject however they measured it (e.g. via `buildTextMeasurementTree` +
 * resvg's bbox in a real render, or a stubbed constant in tests). This module never measures
 * text itself. */
export type GetTextHeight = (layer: NormalizedTextLayer) => number;

const MIN_SIZE = 20;

function isTextLayer(layer: NormalizedLayer): layer is NormalizedTextLayer {
  return layer.type === 'text';
}

/** Computes a layer's canvas-space bounding box `{x, y, w, h}`. Image/shape layers carry an
 * explicit `h`; text layers have none, so `getTextHeight` is required to resolve it. */
export function getLayerBBox(layer: NormalizedLayer, getTextHeight: GetTextHeight): LayerBBox {
  if (isTextLayer(layer)) {
    return { x: layer.x, y: layer.y, w: layer.w, h: getTextHeight(layer) };
  }
  const withHeight = layer as NormalizedImageLayer | NormalizedShapeLayer;
  return { x: withHeight.x, y: withHeight.y, w: withHeight.w, h: withHeight.h };
}

function bboxCenter(bbox: LayerBBox): CanvasPoint {
  return { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 };
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Rotates a point `{x, y}` around the origin by `deg` degrees, CLOCKWISE (matching CSS
 * `transform: rotate()` in this codebase's y-down canvas space: standard math CCW rotation is
 * `(x cosθ - y sinθ, x sinθ + y cosθ)`; negating y-down flips the visual sense of that rotation
 * to CW for positive θ, which is exactly the CSS/SVG convention we're mirroring here). */
function rotatePoint(point: CanvasPoint, deg: number): CanvasPoint {
  const rad = degToRad(deg);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}

/** Converts a canvas-space point into a layer's LOCAL (unrotated, center-origin) coordinate
 * space: translate by `-center`, then rotate by `-rotation` (the inverse of the layer's own
 * clockwise rotation) to undo it. */
function toLocalSpace(point: CanvasPoint, bbox: LayerBBox, rotationDeg: number): CanvasPoint {
  const center = bboxCenter(bbox);
  const offset: CanvasPoint = { x: point.x - center.x, y: point.y - center.y };
  return rotatePoint(offset, -rotationDeg);
}

/** Rotation-aware point-in-layer hit test. `point` and `bbox` are both canvas-space; `rotationDeg`
 * is the layer's own rotation (clockwise degrees) applied around the box's center. Boundary points
 * (exactly on an edge) count as inside — an inclusive `<=` test, matching typical hit-test UX
 * (a click right on the edge should still select). */
export function isPointInLayerBBox(
  point: CanvasPoint,
  bbox: LayerBBox,
  rotationDeg: number,
): boolean {
  const local = toLocalSpace(point, bbox, rotationDeg);
  const halfW = bbox.w / 2;
  const halfH = bbox.h / 2;
  return local.x >= -halfW && local.x <= halfW && local.y >= -halfH && local.y <= halfH;
}

export interface HitTestableLayer {
  layer: NormalizedLayer;
  bbox: LayerBBox;
}

/** Finds the topmost (last-in-array, per `buildPageTree`'s paint order) unlocked layer hit at a
 * canvas-space point, checking in REVERSE z-order. `layers` is the page's ordered layer list, in
 * the same bottom-to-top order `NormalizedPage.layers`/`buildPageTree` use; `getTextHeight`
 * resolves text-layer height the same way `getLayerBBox` does. Returns `null` if nothing (visible
 * and unlocked) is hit. */
export function hitTestLayers(
  point: CanvasPoint,
  layers: NormalizedLayer[],
  getTextHeight: GetTextHeight,
): NormalizedLayer | null {
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (layer.locked) continue;
    const bbox = getLayerBBox(layer, getTextHeight);
    if (isPointInLayerBBox(point, bbox, layer.rotation)) return layer;
  }
  return null;
}

/** The 4 rotated corner points of a layer's bounding box, in canvas-space, in
 * top-left/top-right/bottom-right/bottom-left order (pre-rotation winding) — for drawing a
 * rotated selection outline or positioning resize handles. */
export function getRotatedCorners(
  bbox: LayerBBox,
  rotationDeg: number,
): [CanvasPoint, CanvasPoint, CanvasPoint, CanvasPoint] {
  const center = bboxCenter(bbox);
  const halfW = bbox.w / 2;
  const halfH = bbox.h / 2;
  const localCorners: CanvasPoint[] = [
    { x: -halfW, y: -halfH }, // top-left
    { x: halfW, y: -halfH }, // top-right
    { x: halfW, y: halfH }, // bottom-right
    { x: -halfW, y: halfH }, // bottom-left
  ];
  return localCorners.map((corner) => {
    const rotated = rotatePoint(corner, rotationDeg);
    return { x: rotated.x + center.x, y: rotated.y + center.y };
  }) as [CanvasPoint, CanvasPoint, CanvasPoint, CanvasPoint];
}

/** The canvas-space AXIS-ALIGNED bounding box that *contains* a rotated layer's visible extent
 * (the AABB of its 4 rotated corners) — as opposed to `getLayerBBox`, which returns the box
 * rotation is applied *around*, not one that accounts for the rotated extent. Snapping (see
 * `lib/snapMath.ts`) needs this: a rotated layer's visually-apparent edges/center for alignment
 * purposes are the rotated AABB's edges/center, not the pre-rotation box's — using the pre-
 * rotation box would offer snap lines at positions the layer doesn't actually appear to occupy on
 * screen. Returns `bbox` itself (same reference) when `rotationDeg` is exactly 0, since an
 * unrotated layer's AABB is by definition its own bbox — avoids needless float churn on the
 * overwhelmingly common unrotated case. */
export function getRotatedAABB(bbox: LayerBBox, rotationDeg: number): LayerBBox {
  if (rotationDeg === 0) return bbox;
  const corners = getRotatedCorners(bbox, rotationDeg);
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** The 8 resize-handle identifiers: 4 corners + 4 edge midpoints, named by compass direction. */
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** Which of {x, y} edges a handle moves. `-1`/`1` mean "this handle drags that edge, scaled by
 * this sign in LOCAL (unrotated) space"; `0` means the handle doesn't move that axis at all. */
const HANDLE_AXES: Record<ResizeHandle, { x: -1 | 0 | 1; y: -1 | 0 | 1 }> = {
  nw: { x: -1, y: -1 },
  n: { x: 0, y: -1 },
  ne: { x: 1, y: -1 },
  e: { x: 1, y: 0 },
  se: { x: 1, y: 1 },
  s: { x: 0, y: 1 },
  sw: { x: -1, y: 1 },
  w: { x: -1, y: 0 },
};

export interface ResizeResult {
  x: number;
  y: number;
  w: number;
  /** Present for image/shape layers (which have a schema `h`); absent for text layers, which
   * have no `h` to set — width-only resize per plan scope. */
  h?: number;
}

/** Computes a resize-adjusted `{x, y, w}` (text layers, width-only — no schema `h` to set) or
 * `{x, y, w, h}` (image/shape layers) given a drag `handle`, the layer's current canvas-space
 * `bbox` + `rotationDeg`, and a canvas-space pointer delta `{x, y}` (i.e. `pointerNow - pointerAtGestureStart`,
 * already in canvas units — callers resolve screen->canvas themselves).
 *
 * Rotation handling: a screen-axis-aligned drag on a rotated box must move the box along its OWN
 * local axes, not the canvas's — so `delta` is first projected into the box's local (unrotated)
 * coordinate frame via the same inverse-rotation technique as hit-testing, then applied to
 * whichever local edges `handle` controls. The box's opposite edge/corner is held fixed (the
 * anchor), and the new center (hence new canvas-space x/y) is re-derived from the anchor + the
 * new size, then rotated back out to canvas-space.
 *
 * `hasHeight` selects whether `h` is resizable (image/shape) or omitted (text, width-only); for
 * text layers, handles that only move the y-axis (`n`/`s`) are a no-op (no vertical resize
 * possible — height is emergent, not authored).
 */
export function computeResizePatch(
  handle: ResizeHandle,
  bbox: LayerBBox,
  rotationDeg: number,
  delta: CanvasPoint,
  hasHeight: boolean,
): ResizeResult {
  const axes = HANDLE_AXES[handle];

  // Text layers can't resize on the y-axis at all (no `h` field) — a purely-vertical handle is a
  // total no-op; horizontal-component handles (nw/ne/se/sw/e/w) still resize width normally, the
  // y-component of the delta is simply ignored for them.
  if (!hasHeight && axes.x === 0) {
    return { x: bbox.x, y: bbox.y, w: bbox.w };
  }

  // Project the canvas-space delta into the box's own local (unrotated) axes — same inverse
  // rotation as hit-testing, but on a vector (no translation component needed for a delta).
  const localDelta = rotatePoint(delta, -rotationDeg);

  const halfW = bbox.w / 2;
  const halfH = bbox.h / 2;

  // The two local-space edges this handle drags, before clamping to the minimum size.
  let newHalfW = halfW + (axes.x !== 0 ? (localDelta.x * axes.x) / 2 : 0);
  let newHalfH = hasHeight && axes.y !== 0 ? halfH + (localDelta.y * axes.y) / 2 : halfH;

  const newW = Math.max(MIN_SIZE, newHalfW * 2);
  const newH = hasHeight ? Math.max(MIN_SIZE, newHalfH * 2) : bbox.h;
  // Re-derive the (possibly clamped) half extents from the floored size so the anchor math below
  // stays consistent with what we actually apply.
  newHalfW = newW / 2;
  newHalfH = hasHeight ? newH / 2 : halfH;

  // The anchor is the local-space point on the OPPOSITE side from the handle, which must not move
  // in canvas-space. For an axis the handle doesn't touch (axes.x/y === 0), the anchor sits at the
  // box's own local center on that axis (i.e. that axis doesn't shift at all).
  const anchorLocal: CanvasPoint = {
    x: axes.x === 0 ? 0 : -axes.x * halfW,
    y: axes.y === 0 || !hasHeight ? 0 : -axes.y * halfH,
  };

  // The new local-space position of that same anchor corner/edge relative to the NEW center once
  // the box has been resized (still unrotated).
  const anchorInNewLocal: CanvasPoint = {
    x: axes.x === 0 ? 0 : -axes.x * newHalfW,
    y: axes.y === 0 || !hasHeight ? 0 : -axes.y * newHalfH,
  };

  // The new center is whatever keeps the (rotated) anchor point fixed in canvas-space:
  // anchorCanvas = oldCenter + rotate(anchorLocal) = newCenter + rotate(anchorInNewLocal)
  // => newCenter = oldCenter + rotate(anchorLocal) - rotate(anchorInNewLocal)
  const oldCenter = bboxCenter(bbox);
  const anchorCanvasOffset = rotatePoint(anchorLocal, rotationDeg);
  const anchorNewCanvasOffset = rotatePoint(anchorInNewLocal, rotationDeg);
  const newCenter: CanvasPoint = {
    x: oldCenter.x + anchorCanvasOffset.x - anchorNewCanvasOffset.x,
    y: oldCenter.y + anchorCanvasOffset.y - anchorNewCanvasOffset.y,
  };

  const result: ResizeResult = {
    x: newCenter.x - newW / 2,
    y: newCenter.y - newH / 2,
    w: newW,
  };
  if (hasHeight) result.h = newH;
  return result;
}

export interface UniformScaleResult {
  x: number;
  y: number;
  w: number;
  h: number;
  /** The uniform factor applied to the start bbox — callers scale font_size etc. by this. */
  scale: number;
}

/** Figma-style proportional corner resize: the whole box scales uniformly about the OPPOSITE
 * corner (the anchor), driven by the pointer's projection onto the dragged corner's diagonal
 * axis (smooth for any drag direction — no per-axis flip mid-gesture). Used for text-layer
 * corners (where the committed patch scales `font_size` by `scale` and lets height re-emerge)
 * and for Shift+corner on image/shape layers (aspect-locked resize). */
export function computeUniformScalePatch(
  handle: ResizeHandle,
  bbox: LayerBBox,
  rotationDeg: number,
  delta: CanvasPoint,
): UniformScaleResult {
  const axes = HANDLE_AXES[handle];
  const localDelta = rotatePoint(delta, -rotationDeg);

  const halfW = bbox.w / 2;
  const halfH = bbox.h / 2;
  // The dragged corner's local position; its projection onto its own diagonal after the drag
  // gives the new (signed) diagonal length, and the ratio IS the uniform scale.
  const cornerX = axes.x * halfW;
  const cornerY = axes.y * halfH;
  const diag = Math.hypot(cornerX, cornerY);
  const projected =
    ((cornerX + localDelta.x) * cornerX + (cornerY + localDelta.y) * cornerY) / diag;
  // Floor: neither dimension may scale below MIN_SIZE (and never flip negative).
  const scale = Math.max(projected / diag, MIN_SIZE / bbox.w, MIN_SIZE / bbox.h);

  const newW = bbox.w * scale;
  const newH = bbox.h * scale;

  // Same fixed-anchor derivation as computeResizePatch, with the OPPOSITE CORNER as anchor on
  // both axes (uniform scale always drags a corner).
  const anchorLocal: CanvasPoint = { x: -cornerX, y: -cornerY };
  const anchorInNewLocal: CanvasPoint = { x: -axes.x * (newW / 2), y: -axes.y * (newH / 2) };
  const oldCenter = bboxCenter(bbox);
  const anchorCanvasOffset = rotatePoint(anchorLocal, rotationDeg);
  const anchorNewCanvasOffset = rotatePoint(anchorInNewLocal, rotationDeg);
  const newCenter: CanvasPoint = {
    x: oldCenter.x + anchorCanvasOffset.x - anchorNewCanvasOffset.x,
    y: oldCenter.y + anchorCanvasOffset.y - anchorNewCanvasOffset.y,
  };

  return {
    x: newCenter.x - newW / 2,
    y: newCenter.y - newH / 2,
    w: newW,
    h: newH,
    scale,
  };
}

// ============================================================
// Rotation (T7.1)
// ============================================================

/** Wraps any angle into the [0, 360) range (handles negatives and multi-turn values). */
export function normalizeAngle(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** The clockwise rotation (degrees, normalized [0,360)) implied by a pointer at canvas-space
 * `pointer` relative to a box `center`, measured from the 12-o'clock (straight-up) direction —
 * matching the rotation grip that sits above the box's top edge. In y-down canvas space, "up" is
 * -y; `atan2(dx, -dy)` gives 0° when the pointer is straight up and increases clockwise. */
export function angleFromPointer(center: CanvasPoint, pointer: CanvasPoint): number {
  const dx = pointer.x - center.x;
  const dy = pointer.y - center.y;
  return normalizeAngle((Math.atan2(dx, -dy) * 180) / Math.PI);
}

/** Snaps `deg` to the nearest multiple of `stop` (default 45°) when within `threshold` degrees of
 * one; otherwise returns it unchanged (normalized). Pass `threshold: Infinity` to ALWAYS snap
 * (the Shift-held behavior). Result is normalized to [0, 360). */
export function snapAngle(deg: number, stop = 45, threshold = 5): number {
  const normalized = normalizeAngle(deg);
  const nearest = Math.round(normalized / stop) * stop;
  const delta = Math.abs(normalizeAngle(normalized - nearest + 180) - 180);
  return delta <= threshold ? normalizeAngle(nearest) : normalized;
}

// ============================================================
// Align-to-canvas (T7.2)
// ============================================================

export type AlignAxis = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** New top-left `{x, y}` for a layer so its ROTATED extent (the AABB of its rotated corners)
 * aligns to the canvas edge/center named by `axis`. Aligning a rotated layer by its pre-rotation
 * box would let its visible edge poke past the canvas — the rotated AABB is what the user sees, so
 * we shift the layer by the delta between the AABB's current aligned-edge and the target, and
 * apply that same delta to the layer's own `x/y` (translation is rotation-invariant). Only the
 * moved axis changes; the other is preserved. */
export function alignLayerToCanvas(
  bbox: LayerBBox,
  rotationDeg: number,
  canvasWidth: number,
  canvasHeight: number,
  axis: AlignAxis,
): { x: number; y: number } {
  const aabb = getRotatedAABB(bbox, rotationDeg);
  let dx = 0;
  let dy = 0;
  switch (axis) {
    case 'left':
      dx = 0 - aabb.x;
      break;
    case 'hcenter':
      dx = (canvasWidth - aabb.w) / 2 - aabb.x;
      break;
    case 'right':
      dx = canvasWidth - aabb.w - aabb.x;
      break;
    case 'top':
      dy = 0 - aabb.y;
      break;
    case 'vcenter':
      dy = (canvasHeight - aabb.h) / 2 - aabb.y;
      break;
    case 'bottom':
      dy = canvasHeight - aabb.h - aabb.y;
      break;
  }
  return { x: bbox.x + dx, y: bbox.y + dy };
}
