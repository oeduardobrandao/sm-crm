import { describe, expect, it } from 'vitest';
import type { GetTextHeight } from '../lib/layerGeometry';
import {
  collectSnapCandidates,
  getCanvasSnapLines,
  getLayerSnapLines,
  snapBBox,
  type SnapLine,
} from '../lib/snapMath';
import { makeImageLayer, makeTextLayer } from './fixtures';

const CANVAS_W = 1080;
const CANVAS_H = 1350;

// makeTextLayer's fixture text layers never need real measurement in this suite (all assertions
// are geometric, not text-content-driven) — a fixed stand-in height keeps every bbox computation
// deterministic without depending on satori/yoga.
const getTextHeight: GetTextHeight = () => 40;

describe('getCanvasSnapLines', () => {
  it('produces left/center/right x-lines and top/center/bottom y-lines', () => {
    const lines = getCanvasSnapLines(CANVAS_W, CANVAS_H);
    const xs = lines.filter((l) => l.axis === 'x').map((l) => l.position);
    const ys = lines.filter((l) => l.axis === 'y').map((l) => l.position);
    expect(xs).toEqual([0, CANVAS_W / 2, CANVAS_W]);
    expect(ys).toEqual([0, CANVAS_H / 2, CANVAS_H]);
    expect(lines.every((l) => l.source === 'canvas')).toBe(true);
  });
});

describe('getLayerSnapLines', () => {
  it('produces edge/center lines from a layer bounding box, tagged with its id', () => {
    const layer = makeTextLayer({ id: 'a', x: 100, y: 200, w: 300 });
    const lines = getLayerSnapLines(layer, getTextHeight);
    const xs = lines.filter((l) => l.axis === 'x').map((l) => l.position);
    const ys = lines.filter((l) => l.axis === 'y').map((l) => l.position);
    expect(xs).toEqual([100, 250, 400]); // left, center (100+300/2), right
    expect(ys).toEqual([200, 220, 240]); // top, center (200+40/2), bottom (200+40)
    expect(lines.every((l) => l.source === 'layer' && l.layerId === 'a')).toBe(true);
  });

  it('a rotated layer contributes lines from its ROTATED (visible) extent, not its pre-rotation bbox', () => {
    // 100x100 box centered at (200,200), rotated 45deg -> rotated AABB is a ~141.42x141.42 square
    // still centered at (200,200) (100*sqrt(2), the classic "diamond" bounding box of a rotated
    // square). If this used the pre-rotation bbox instead, the x-lines would incorrectly be
    // [150, 200, 250] (the UN-rotated box's left/center/right) rather than the visible extent.
    const layer = makeImageLayer({ id: 'r', x: 150, y: 150, w: 100, h: 100, rotation: 45 });
    const lines = getLayerSnapLines(layer, getTextHeight);
    const xs = lines.filter((l) => l.axis === 'x').map((l) => l.position);
    const ys = lines.filter((l) => l.axis === 'y').map((l) => l.position);
    const halfDiag = 141.4213562373095 / 2; // 100*sqrt(2)/2
    expect(xs[0]).toBeCloseTo(200 - halfDiag, 10);
    expect(xs[1]).toBeCloseTo(200, 10);
    expect(xs[2]).toBeCloseTo(200 + halfDiag, 10);
    expect(ys[0]).toBeCloseTo(200 - halfDiag, 10);
    expect(ys[1]).toBeCloseTo(200, 10);
    expect(ys[2]).toBeCloseTo(200 + halfDiag, 10);
  });

  it('an UNrotated layer (rotation 0) is unaffected by the rotated-AABB computation', () => {
    const layer = makeImageLayer({ id: 'a', x: 100, y: 200, w: 300, h: 40, rotation: 0 });
    const lines = getLayerSnapLines(layer, getTextHeight);
    const xs = lines.filter((l) => l.axis === 'x').map((l) => l.position);
    expect(xs).toEqual([100, 250, 400]);
  });
});

describe('collectSnapCandidates', () => {
  it('excludes the moving layer itself but includes every other layer plus the canvas', () => {
    const moving = makeTextLayer({ id: 'moving', x: 0, y: 0, w: 100 });
    const other = makeTextLayer({ id: 'other', x: 500, y: 500, w: 100 });
    const candidates = collectSnapCandidates(
      [moving, other],
      'moving',
      CANVAS_W,
      CANVAS_H,
      getTextHeight,
    );

    expect(candidates.some((l) => l.layerId === 'moving')).toBe(false);
    expect(candidates.some((l) => l.layerId === 'other')).toBe(true);
    expect(candidates.some((l) => l.source === 'canvas')).toBe(true);
  });

  it('a layer never snaps to itself (moving-layer bbox coincides with candidates but is excluded)', () => {
    // The moving layer sits exactly on a canvas line (x=0) too, so this also proves the "self"
    // exclusion isn't just coincidentally masked by threshold — even a layer whose OWN geometry
    // would trivially "match" itself perfectly does not appear as a candidate.
    const moving = makeTextLayer({ id: 'moving', x: 0, y: 0, w: 100 });
    const candidates = collectSnapCandidates([moving], 'moving', CANVAS_W, CANVAS_H, getTextHeight);
    expect(candidates.every((l) => l.source === 'canvas')).toBe(true);
    expect(candidates.length).toBe(6); // only the 6 canvas lines, no layer-sourced lines at all
  });
});

describe('snapBBox', () => {
  const threshold = 8;

  it('snaps to a canvas edge (left edge, x=0) when within threshold', () => {
    const candidates = getCanvasSnapLines(CANVAS_W, CANVAS_H);
    const proposed = { x: 5, y: 500, w: 100, h: 100 }; // left edge at x=5, within 8px of x=0
    const result = snapBBox(proposed, 0, candidates, threshold);
    expect(result.bbox.x).toBe(0);
    expect(result.activeLines).toContainEqual<SnapLine>({
      axis: 'x',
      position: 0,
      source: 'canvas',
    });
  });

  it('snaps to canvas horizontal center', () => {
    const candidates = getCanvasSnapLines(CANVAS_W, CANVAS_H);
    // Box center should land on CANVAS_W / 2 = 540. Box w=100 -> center = x + 50.
    // Place center 3px off (543) so it's within threshold but not already exact.
    const proposed = { x: 493, y: 0, w: 100, h: 100 };
    const result = snapBBox(proposed, 0, candidates, threshold);
    expect(result.bbox.x + result.bbox.w / 2).toBe(CANVAS_W / 2);
    expect(result.activeLines).toContainEqual<SnapLine>({
      axis: 'x',
      position: CANVAS_W / 2,
      source: 'canvas',
    });
  });

  it("snaps to another layer's edge", () => {
    const other = makeTextLayer({ id: 'other', x: 300, y: 0, w: 200 }); // right edge at x=500
    const candidates = getLayerSnapLines(other, getTextHeight);
    // Move proposed so its right edge (x + w = 304) is within 8px of other's left edge (300).
    const proposedNearOtherLeft = { x: 204, y: 0, w: 100, h: 50 };
    const result = snapBBox(proposedNearOtherLeft, 0, candidates, threshold);
    expect(result.bbox.x + result.bbox.w).toBe(300);
    expect(result.activeLines).toContainEqual<SnapLine>({
      axis: 'x',
      position: 300,
      source: 'layer',
      layerId: 'other',
    });
  });

  it("snaps to another layer's center", () => {
    const other = makeTextLayer({ id: 'other', x: 0, y: 300, w: 100 }); // y-center at 300 + 40/2 = 320
    const candidates = getLayerSnapLines(other, getTextHeight);
    // Proposed box's own vertical center should land near 320: y=280, h=80 -> center=320 exactly
    // minus a few px so it's a genuine snap, not a coincidence.
    const proposed = { x: 500, y: 275, w: 60, h: 80 }; // center = 275 + 40 = 315, 5px off 320
    const result = snapBBox(proposed, 0, candidates, threshold);
    expect(result.bbox.y + result.bbox.h / 2).toBe(320);
    expect(result.activeLines).toContainEqual<SnapLine>({
      axis: 'y',
      position: 320,
      source: 'layer',
      layerId: 'other',
    });
  });

  it('does not snap when nothing is within threshold (proposed position returned unchanged)', () => {
    const candidates = getCanvasSnapLines(CANVAS_W, CANVAS_H);
    const proposed = { x: 123, y: 456, w: 50, h: 50 }; // nowhere near any canvas edge/center
    const result = snapBBox(proposed, 0, candidates, threshold);
    expect(result.bbox).toEqual(proposed);
    expect(result.activeLines).toEqual([]);
  });

  it('a layer never snaps to itself end-to-end (collectSnapCandidates excludes self, so no snap happens even at an identical position)', () => {
    const moving = makeTextLayer({ id: 'moving', x: 0, y: 0, w: 100 });
    const candidates = collectSnapCandidates([moving], 'moving', CANVAS_W, CANVAS_H, getTextHeight);
    // Proposed position deliberately re-uses the moving layer's own (now-stale) bbox, which would
    // trivially "match" its own old edges/center if self-lines leaked through.
    const proposed = { x: 0, y: 0, w: 100, h: 40 };
    // x=0 still legitimately matches the CANVAS left edge (also x=0) — that's expected and fine.
    // What must NOT happen is a spurious match against the moving layer's own former lines that
    // don't coincide with a canvas line, e.g. its right edge (100) or vertical center (20).
    const result = snapBBox(proposed, 0, candidates, threshold);
    for (const line of result.activeLines) {
      expect(line.source).toBe('canvas');
      expect(line.layerId).toBeUndefined();
    }
  });

  it('snaps independently per axis: can snap on x without snapping on y, and vice versa', () => {
    const candidates = getCanvasSnapLines(CANVAS_W, CANVAS_H);
    // x=3 is within threshold of the canvas left edge (0); y=700 is nowhere near any canvas y-line
    // (0, 675, 1350) at threshold=8.
    const proposed = { x: 3, y: 700, w: 50, h: 50 };
    const result = snapBBox(proposed, 0, candidates, threshold);
    expect(result.bbox.x).toBe(0); // snapped
    expect(result.bbox.y).toBe(700); // unchanged — no y candidate within threshold
    expect(result.activeLines).toHaveLength(1);
    expect(result.activeLines[0].axis).toBe('x');
  });

  it('the reverse: snaps on y without snapping on x', () => {
    const candidates = getCanvasSnapLines(CANVAS_W, CANVAS_H);
    // y=1346 is within threshold of the canvas bottom edge (1350); x=333 is nowhere near any
    // canvas x-line (0, 540, 1080) at threshold=8.
    const proposed = { x: 333, y: 1296, w: 50, h: 50 }; // bottom edge = 1296+50=1346, 4px off 1350
    const result = snapBBox(proposed, 0, candidates, threshold);
    expect(result.bbox.y).toBe(1300); // 1350 - 50 (h) = 1300, so bottom edge lands on 1350
    expect(result.bbox.x).toBe(333); // unchanged
    expect(result.activeLines).toHaveLength(1);
    expect(result.activeLines[0].axis).toBe('y');
  });

  it('keeps w/h unchanged (only x/y move) for a plain drag snap', () => {
    const candidates = getCanvasSnapLines(CANVAS_W, CANVAS_H);
    const proposed = { x: 2, y: 500, w: 77, h: 33 };
    const result = snapBBox(proposed, 0, candidates, threshold);
    expect(result.bbox.w).toBe(77);
    expect(result.bbox.h).toBe(33);
  });

  it("matches the MOVING layer's own edges from its rotated extent too, not just candidate layers'", () => {
    // A 100x100 box rotated 45deg, centered at (75, 500) -> bbox.x=25 (pre-rotation), but its
    // rotated AABB's left edge is at 75 - 100*sqrt(2)/2 = ~4.29, which IS within the 8px threshold
    // of the canvas left edge (x=0). The pre-rotation bbox's own x (25) is NOT within threshold —
    // so this snap only happens if `snapBBox` accounts for the moving layer's own rotation.
    const candidates = getCanvasSnapLines(CANVAS_W, CANVAS_H);
    const proposed = { x: 25, y: 450, w: 100, h: 100 };
    const rotatedResult = snapBBox(proposed, 45, candidates, threshold);
    const expectedDelta = 0 - (75 - (100 * Math.sqrt(2)) / 2);
    expect(rotatedResult.bbox.x).toBeCloseTo(25 + expectedDelta, 10);
    expect(rotatedResult.activeLines).toContainEqual<SnapLine>({
      axis: 'x',
      position: 0,
      source: 'canvas',
    });

    // The SAME proposed box with rotation 0 must NOT snap (its raw edges are 25/75/125, none
    // within 8px of any canvas x-line at 0/540/1080) — proves the rotation param is load-bearing,
    // not just always-snapping regardless of the angle passed in.
    const unrotatedResult = snapBBox(proposed, 0, candidates, threshold);
    expect(unrotatedResult.bbox.x).toBe(25);
  });
});
