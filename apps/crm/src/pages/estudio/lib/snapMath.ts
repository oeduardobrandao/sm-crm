// Pure "smart guide" alignment-snapping math (docs/estudio-design.md §6.2/§6.3, plan T2.6/T2.7).
// No React, no DOM — mirrors the "pure ops, testable in isolation" style of `lib/designDocOps.ts`
// and `lib/layerGeometry.ts`. Everything here operates purely in CANVAS-space pixels; callers
// (the interaction overlay) convert the screen-space snap threshold to canvas-space themselves
// via `useCanvasTransform`'s `scale` before calling in, since a "feels like 8px" snap distance
// must stay constant on screen regardless of zoom.
//
// Reuses `layerGeometry.ts`'s `getLayerBBox` for computing OTHER layers' bounding boxes rather
// than duplicating bbox math — same `GetTextHeight` injection pattern (text layers have no
// schema `h`; height is emergent from satori/yoga layout, per design-doc.ts).

import type { NormalizedLayer } from '../types';
import { getLayerBBox, getRotatedAABB, type GetTextHeight, type LayerBBox } from './layerGeometry';

/** A single candidate alignment line on one axis, with enough identity for the caller to render
 * a labeled/keyed guide and to report which line(s) are currently "active". */
export interface SnapLine {
  axis: 'x' | 'y';
  /** The canvas-space coordinate of the line itself (an x for axis 'x', a y for axis 'y'). */
  position: number;
  /** Where on the source this line was taken from — which edge/center of the canvas or of
   * another layer produced it. Purely descriptive (for UI/debugging), not used in the snap math. */
  source: 'canvas' | 'layer';
  /** Which layer produced this line, when `source === 'layer'`. */
  layerId?: string;
}

export interface SnapResult {
  /** The (possibly adjusted) bounding box — unchanged from the proposed input on any axis that
   * didn't find a candidate within threshold. */
  bbox: LayerBBox;
  /** The candidate line(s) that were snapped to — 0, 1, or 2 entries (at most one per axis). For
   * the interaction overlay to render as thin guide lines during the gesture. */
  activeLines: SnapLine[];
}

/** Canvas-space alignment candidates from the canvas itself: left/center/right on the x axis,
 * top/center/bottom on the y axis. */
export function getCanvasSnapLines(canvasWidth: number, canvasHeight: number): SnapLine[] {
  return [
    { axis: 'x', position: 0, source: 'canvas' },
    { axis: 'x', position: canvasWidth / 2, source: 'canvas' },
    { axis: 'x', position: canvasWidth, source: 'canvas' },
    { axis: 'y', position: 0, source: 'canvas' },
    { axis: 'y', position: canvasHeight / 2, source: 'canvas' },
    { axis: 'y', position: canvasHeight, source: 'canvas' },
  ];
}

/** Canvas-space alignment candidates contributed by one layer: left/center/right x-lines and
 * top/center/bottom y-lines of its bounding box. For a rotated layer, these are taken from the
 * ROTATED AABB (`getRotatedAABB`) — the box's visually-apparent extent — not its pre-rotation
 * bbox, since that's where the layer actually appears to a user aligning against it. A layer with
 * `rotation === 0` is unaffected (`getRotatedAABB` returns the same bbox unchanged in that case). */
export function getLayerSnapLines(
  layer: NormalizedLayer,
  getTextHeight: GetTextHeight,
): SnapLine[] {
  const bbox = getRotatedAABB(getLayerBBox(layer, getTextHeight), layer.rotation);
  return [
    { axis: 'x', position: bbox.x, source: 'layer', layerId: layer.id },
    { axis: 'x', position: bbox.x + bbox.w / 2, source: 'layer', layerId: layer.id },
    { axis: 'x', position: bbox.x + bbox.w, source: 'layer', layerId: layer.id },
    { axis: 'y', position: bbox.y, source: 'layer', layerId: layer.id },
    { axis: 'y', position: bbox.y + bbox.h / 2, source: 'layer', layerId: layer.id },
    { axis: 'y', position: bbox.y + bbox.h, source: 'layer', layerId: layer.id },
  ];
}

/** All candidate alignment lines for a drag/resize gesture on `movingLayerId`: the canvas's own
 * edges/center, plus every OTHER layer on the page's edges/center (the layer currently being
 * dragged/resized is excluded — it should never snap to itself). */
export function collectSnapCandidates(
  layers: NormalizedLayer[],
  movingLayerId: string,
  canvasWidth: number,
  canvasHeight: number,
  getTextHeight: GetTextHeight,
): SnapLine[] {
  const lines = getCanvasSnapLines(canvasWidth, canvasHeight);
  for (const layer of layers) {
    if (layer.id === movingLayerId) continue;
    lines.push(...getLayerSnapLines(layer, getTextHeight));
  }
  return lines;
}

/** The three x-edges (left/center/right) and three y-edges (top/center/bottom) of a proposed
 * bounding box, in the same shape as a `SnapLine[]` entry's `position` — used to compare against
 * candidates on each axis independently. Computed from the ROTATED AABB (same reasoning as
 * `getLayerSnapLines`): a rotated layer's own visually-apparent edges are its rotated extent, not
 * its pre-rotation bbox's. Safe to apply the resulting per-axis delta straight back onto `bbox`'s
 * raw (pre-rotation) x/y — `snapBBox` is only ever invoked mid-DRAG (a pure translation; `w`/`h`
 * never change), and a rotated AABB's position translates by exactly the same delta as the
 * underlying pre-rotation box it's derived from (rotation is applied around a center that itself
 * shifts by that same delta, so the two stay in lockstep). This does NOT generalize to resize
 * (where `w`/`h` also change) — snapping is deliberately not wired up for resize gestures at all
 * (see InteractionOverlay.tsx), so that case never reaches this function today. */
function ownEdges(bbox: LayerBBox, rotationDeg: number, axis: 'x' | 'y'): number[] {
  const aabb = getRotatedAABB(bbox, rotationDeg);
  if (axis === 'x') return [aabb.x, aabb.x + aabb.w / 2, aabb.x + aabb.w];
  return [aabb.y, aabb.y + aabb.h / 2, aabb.y + aabb.h];
}

interface BestMatch {
  line: SnapLine;
  /** Signed delta to apply to the proposed bbox's origin on this axis: `line.position - edgeValue`. */
  delta: number;
  distance: number;
}

/** Finds the candidate line (on one axis) that lands closest to any of the proposed box's own
 * three edges (left/center/right, or top/center/bottom), among candidates within `threshold`.
 * Ties (equal distance) keep the first candidate encountered, matching `collectSnapCandidates`'s
 * canvas-then-layers, in-array order — a stable, deterministic choice rather than an arbitrary one. */
function findBestMatch(
  candidates: SnapLine[],
  axis: 'x' | 'y',
  bbox: LayerBBox,
  rotationDeg: number,
  threshold: number,
): BestMatch | null {
  const edges = ownEdges(bbox, rotationDeg, axis);
  let best: BestMatch | null = null;
  for (const line of candidates) {
    if (line.axis !== axis) continue;
    for (const edge of edges) {
      const distance = Math.abs(line.position - edge);
      if (distance > threshold) continue;
      if (best === null || distance < best.distance) {
        best = { line, delta: line.position - edge, distance };
      }
    }
  }
  return best;
}

/**
 * Given a layer's proposed new canvas-space bounding box (mid-DRAG, BEFORE snapping — see
 * `ownEdges`'s comment for why this doesn't generalize to resize) plus that layer's own
 * `rotationDeg`, and the set of candidate alignment lines, finds the nearest matching line on
 * each axis (x and y independently, each within `threshold` canvas-space pixels) and returns a
 * snapped bounding box plus which line(s) matched.
 *
 * `threshold` is canvas-space (the caller converts a screen-space "feels like 8px" distance via
 * `threshold = screenThresholdPx / scale` from `useCanvasTransform`, so the snap feel stays
 * constant across zoom levels — this module has no notion of screen space itself).
 *
 * x and y snap independently: a box can snap on one axis and not the other in the same call.
 * When no candidate is within threshold on an axis, that axis of `bbox` is returned unchanged.
 */
export function snapBBox(
  bbox: LayerBBox,
  rotationDeg: number,
  candidates: SnapLine[],
  threshold: number,
): SnapResult {
  const activeLines: SnapLine[] = [];
  let { x, y } = bbox;

  const xMatch = findBestMatch(candidates, 'x', bbox, rotationDeg, threshold);
  if (xMatch) {
    x = bbox.x + xMatch.delta;
    activeLines.push(xMatch.line);
  }

  const yMatch = findBestMatch(candidates, 'y', bbox, rotationDeg, threshold);
  if (yMatch) {
    y = bbox.y + yMatch.delta;
    activeLines.push(yMatch.line);
  }

  return { bbox: { ...bbox, x, y }, activeLines };
}
