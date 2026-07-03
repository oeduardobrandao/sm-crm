import { describe, expect, it } from 'vitest';
import * as geo from '../lib/layerGeometry';
import type { NormalizedTextLayer } from '../types';
import { makeTextLayer } from './fixtures';

// Fixed stub height for text layers — this module never measures text itself, it only accepts
// whatever `getTextHeight` returns.
const getTextHeight = (_layer: NormalizedTextLayer): number => 50;

describe('getLayerBBox', () => {
  it('resolves text layer height via the injected getTextHeight callback', () => {
    const layer = makeTextLayer({ x: 10, y: 20, w: 200 }) as NormalizedTextLayer;
    const bbox = geo.getLayerBBox(layer, getTextHeight);
    expect(bbox).toEqual({ x: 10, y: 20, w: 200, h: 50 });
  });

  it('never calls getTextHeight for image/shape layers (h comes from the schema field)', () => {
    let called = false;
    const spy = () => {
      called = true;
      return 999;
    };
    const imageLayer = {
      ...makeTextLayer({ x: 5, y: 5, w: 100 }),
      type: 'image',
      h: 80,
      file_id: 1,
      fit: 'cover',
    } as never;
    const bbox = geo.getLayerBBox(imageLayer, spy);
    expect(bbox).toEqual({ x: 5, y: 5, w: 100, h: 80 });
    expect(called).toBe(false);
  });

  it('resolves shape layer bbox from its own h field', () => {
    const shapeLayer = {
      ...makeTextLayer({ x: 0, y: 0, w: 100 }),
      type: 'shape',
      h: 60,
      shape: 'rect',
    } as never;
    const bbox = geo.getLayerBBox(shapeLayer, getTextHeight);
    expect(bbox).toEqual({ x: 0, y: 0, w: 100, h: 60 });
  });
});

describe('isPointInLayerBBox — unrotated', () => {
  const bbox: geo.LayerBBox = { x: 100, y: 100, w: 200, h: 100 }; // spans x:[100,300] y:[100,200]

  it('a point in the center is inside', () => {
    expect(geo.isPointInLayerBBox({ x: 200, y: 150 }, bbox, 0)).toBe(true);
  });

  it('a point clearly outside is outside', () => {
    expect(geo.isPointInLayerBBox({ x: 50, y: 50 }, bbox, 0)).toBe(false);
    expect(geo.isPointInLayerBBox({ x: 350, y: 150 }, bbox, 0)).toBe(false);
  });

  it('a point exactly on the left edge counts as inside (inclusive boundary)', () => {
    expect(geo.isPointInLayerBBox({ x: 100, y: 150 }, bbox, 0)).toBe(true);
  });

  it('a point exactly on the right edge counts as inside (inclusive boundary)', () => {
    expect(geo.isPointInLayerBBox({ x: 300, y: 150 }, bbox, 0)).toBe(true);
  });

  it('a point exactly on the top edge counts as inside (inclusive boundary)', () => {
    expect(geo.isPointInLayerBBox({ x: 200, y: 100 }, bbox, 0)).toBe(true);
  });

  it('a point exactly on the bottom edge counts as inside (inclusive boundary)', () => {
    expect(geo.isPointInLayerBBox({ x: 200, y: 200 }, bbox, 0)).toBe(true);
  });

  it('a point just past an edge is outside', () => {
    expect(geo.isPointInLayerBBox({ x: 99.99, y: 150 }, bbox, 0)).toBe(false);
    expect(geo.isPointInLayerBBox({ x: 300.01, y: 150 }, bbox, 0)).toBe(false);
  });

  it('exact corner points count as inside', () => {
    expect(geo.isPointInLayerBBox({ x: 100, y: 100 }, bbox, 0)).toBe(true);
    expect(geo.isPointInLayerBBox({ x: 300, y: 200 }, bbox, 0)).toBe(true);
  });
});

describe('isPointInLayerBBox — rotated', () => {
  // A square centered at (200,200), spanning x:[150,250] y:[150,250] when unrotated.
  const square: geo.LayerBBox = { x: 150, y: 150, w: 100, h: 100 };

  it('90deg rotation of a square maps back onto itself (center-hit still true)', () => {
    expect(geo.isPointInLayerBBox({ x: 200, y: 200 }, square, 90)).toBe(true);
  });

  it('180deg rotation: a point outside the unrotated box on one side is inside after rotation matches symmetric square (sanity: center still inside)', () => {
    expect(geo.isPointInLayerBBox({ x: 200, y: 200 }, square, 180)).toBe(true);
  });

  it('a wide rectangle rotated 90deg CW hit-tests as if it were tall (clockwise convention)', () => {
    // Unrotated: centered at (200, 200), w=200 h=50 -> spans x:[100,300] y:[175,225].
    // A point at (200, 130) is OUTSIDE the unrotated box (well above the top edge, y range
    // [175,225]), but after a 90deg CW rotation the box becomes effectively w=50 h=200 in visual
    // canvas-space (spans x:[175,225] y:[100,300]) — a point at (200,130) should now be inside.
    const rect: geo.LayerBBox = { x: 100, y: 175, w: 200, h: 50 };
    expect(geo.isPointInLayerBBox({ x: 200, y: 130 }, rect, 0)).toBe(false);
    expect(geo.isPointInLayerBBox({ x: 200, y: 130 }, rect, 90)).toBe(true);
    // And a point that WAS inside along the long unrotated axis (e.g. far left, x=110) should now
    // be OUTSIDE after the 90deg rotation collapses that axis down to the short 50px span.
    expect(geo.isPointInLayerBBox({ x: 110, y: 200 }, rect, 0)).toBe(true);
    expect(geo.isPointInLayerBBox({ x: 110, y: 200 }, rect, 90)).toBe(false);
  });

  it('45deg rotation moves a corner-adjacent point outside the rotated box', () => {
    // square centered (200,200) half-extent 50. Unrotated corner (250,250) is a corner (inside,
    // boundary). After 45deg rotation the corners swing to the axis midpoints at distance
    // 50*sqrt(2) ≈ 70.7 from center along x/y — so the ORIGINAL corner point (250,250), which is
    // at distance 50*sqrt(2) from center diagonally, now falls exactly on the rotated square's
    // edge-midpoint-to-edge-midpoint diagonal, i.e. outside the rotated (axis-aligned-in-local)
    // square's boundary along that diagonal (rotated square edges no longer pass through the
    // original corner locations except at the new corners).
    expect(geo.isPointInLayerBBox({ x: 250, y: 250 }, square, 45)).toBe(false);
  });

  it('45deg rotation: a point straight above center at the pre-rotation edge distance is now inside (rotated corner reaches further along the axis)', () => {
    // The rotated square's new corners sit at (center.x, center.y - 50*sqrt(2)) etc (~ -70.7).
    // A point at (200, 130) — 70 above center, just short of that reach — should be inside.
    expect(geo.isPointInLayerBBox({ x: 200, y: 130 }, square, 45)).toBe(true);
  });
});

describe('hitTestLayers', () => {
  it('returns null when no layers are hit', () => {
    const layers = [makeTextLayer({ id: 'a', x: 0, y: 0, w: 50 })] as never[];
    const result = geo.hitTestLayers({ x: 500, y: 500 }, layers as never, getTextHeight);
    expect(result).toBeNull();
  });

  it('returns the single hit layer', () => {
    const layer = makeTextLayer({ id: 'a', x: 0, y: 0, w: 100 });
    const result = geo.hitTestLayers({ x: 20, y: 20 }, [layer] as never, getTextHeight);
    expect(result?.id).toBe('a');
  });

  it('picks the TOPMOST (last-in-array) layer when multiple overlap', () => {
    const bottom = makeTextLayer({ id: 'bottom', x: 0, y: 0, w: 100 });
    const top = makeTextLayer({ id: 'top', x: 0, y: 0, w: 100 });
    const result = geo.hitTestLayers({ x: 20, y: 20 }, [bottom, top] as never, getTextHeight);
    expect(result?.id).toBe('top');
  });

  it('skips locked layers even if they are on top', () => {
    const bottom = makeTextLayer({ id: 'bottom', x: 0, y: 0, w: 100 });
    const lockedTop = makeTextLayer({ id: 'locked-top', x: 0, y: 0, w: 100, locked: true });
    const result = geo.hitTestLayers({ x: 20, y: 20 }, [bottom, lockedTop] as never, getTextHeight);
    expect(result?.id).toBe('bottom');
  });

  it('returns null if the only hit layer is locked', () => {
    const lockedOnly = makeTextLayer({ id: 'locked-only', x: 0, y: 0, w: 100, locked: true });
    const result = geo.hitTestLayers({ x: 20, y: 20 }, [lockedOnly] as never, getTextHeight);
    expect(result).toBeNull();
  });

  it('falls through to a lower unlocked layer when a higher one does not overlap the point', () => {
    const bottom = makeTextLayer({ id: 'bottom', x: 0, y: 0, w: 100 });
    const topElsewhere = makeTextLayer({ id: 'top-elsewhere', x: 500, y: 500, w: 100 });
    const result = geo.hitTestLayers(
      { x: 20, y: 20 },
      [bottom, topElsewhere] as never,
      getTextHeight,
    );
    expect(result?.id).toBe('bottom');
  });

  it('respects rotation when hit-testing within a stack', () => {
    // A rotated layer whose unrotated bbox would NOT cover the point, but does once rotated.
    const rect = makeTextLayer({ id: 'rotated', x: 0, y: 75, w: 200, rotation: 90 });
    // unrotated span (w=200,h=50 stub): x:[0,200] y:[75,125] centered at (100,100).
    // point (100, 30) is outside unrotated, inside once rotated 90deg (long axis now vertical).
    const result = geo.hitTestLayers({ x: 100, y: 30 }, [rect] as never, getTextHeight);
    expect(result?.id).toBe('rotated');
  });
});

describe('getRotatedCorners', () => {
  it('unrotated box returns its 4 axis-aligned corners in TL/TR/BR/BL order', () => {
    const bbox: geo.LayerBBox = { x: 100, y: 100, w: 200, h: 100 };
    const corners = geo.getRotatedCorners(bbox, 0);
    expect(corners[0]).toEqual({ x: 100, y: 100 }); // TL
    expect(corners[1]).toEqual({ x: 300, y: 100 }); // TR
    expect(corners[2]).toEqual({ x: 300, y: 200 }); // BR
    expect(corners[3]).toEqual({ x: 100, y: 200 }); // BL
  });

  it('90deg CW rotation maps TL -> where TR used to be (clockwise sanity check)', () => {
    // square centered (200,200), half-extent 50: unrotated TL=(150,150), TR=(250,150).
    const square: geo.LayerBBox = { x: 150, y: 150, w: 100, h: 100 };
    const corners = geo.getRotatedCorners(square, 90);
    const [tl] = corners;
    // A 90deg clockwise rotation around the center takes the local top-left corner (-50,-50) to
    // local (-50*cos90 - (-50)*sin90, -50*sin90 + (-50)*cos90) = (50, -50) -> canvas (250, 150),
    // i.e. exactly the old top-right corner's position.
    expect(tl.x).toBeCloseTo(250, 5);
    expect(tl.y).toBeCloseTo(150, 5);
  });

  it('all 4 corners of a 45deg-rotated square are equidistant from center', () => {
    const square: geo.LayerBBox = { x: 150, y: 150, w: 100, h: 100 };
    const center = { x: 200, y: 200 };
    const corners = geo.getRotatedCorners(square, 45);
    const expectedDist = Math.SQRT2 * 50;
    for (const c of corners) {
      const dist = Math.hypot(c.x - center.x, c.y - center.y);
      expect(dist).toBeCloseTo(expectedDist, 5);
    }
  });

  it('360deg rotation returns to the original corners', () => {
    const bbox: geo.LayerBBox = { x: 10, y: 20, w: 80, h: 40 };
    const corners = geo.getRotatedCorners(bbox, 360);
    expect(corners[0].x).toBeCloseTo(10, 5);
    expect(corners[0].y).toBeCloseTo(20, 5);
    expect(corners[2].x).toBeCloseTo(90, 5);
    expect(corners[2].y).toBeCloseTo(60, 5);
  });
});

describe('computeResizePatch — unrotated, image/shape (hasHeight=true)', () => {
  const bbox: geo.LayerBBox = { x: 100, y: 100, w: 200, h: 100 };

  it('"se" handle grows w/h and keeps the top-left corner (nw) fixed', () => {
    const result = geo.computeResizePatch('se', bbox, 0, { x: 20, y: 10 }, true);
    expect(result).toEqual({ x: 100, y: 100, w: 220, h: 110 });
  });

  it('"nw" handle shrinks from the top-left and keeps the bottom-right corner fixed', () => {
    const result = geo.computeResizePatch('nw', bbox, 0, { x: 20, y: 10 }, true);
    // dragging nw inward by (20,10) shrinks w by 20, h by 10, and shifts x/y by the same amount
    // so the opposite (se) corner at (300,200) stays fixed.
    expect(result.w).toBeCloseTo(180, 5);
    expect(result.h).toBeCloseTo(90, 5);
    expect(result.x).toBeCloseTo(120, 5);
    expect(result.y).toBeCloseTo(110, 5);
    // se corner unchanged
    expect(result.x + result.w).toBeCloseTo(300, 5);
    expect(result.y! + result.h!).toBeCloseTo(200, 5);
  });

  it('"e" handle only changes width, not height, and anchors the left edge', () => {
    const result = geo.computeResizePatch('e', bbox, 0, { x: 30, y: 999 }, true);
    expect(result.w).toBeCloseTo(230, 5);
    expect(result.h).toBeCloseTo(100, 5);
    expect(result.x).toBeCloseTo(100, 5); // left edge anchored
    expect(result.y).toBeCloseTo(100, 5);
  });

  it('"s" handle only changes height, not width, and anchors the top edge', () => {
    const result = geo.computeResizePatch('s', bbox, 0, { x: 999, y: 15 }, true);
    expect(result.w).toBeCloseTo(200, 5);
    expect(result.h).toBeCloseTo(115, 5);
    expect(result.x).toBeCloseTo(100, 5);
    expect(result.y).toBeCloseTo(100, 5); // top edge anchored
  });

  it('"n" handle anchors the bottom edge', () => {
    const result = geo.computeResizePatch('n', bbox, 0, { x: 0, y: -15 }, true);
    expect(result.h).toBeCloseTo(115, 5);
    expect(result.y).toBeCloseTo(85, 5);
    expect(result.y! + result.h!).toBeCloseTo(200, 5); // bottom edge fixed
  });

  it('clamps to the minimum size floor and keeps the anchor stable at the floor', () => {
    // Drag "se" inward by a huge amount — should floor at MIN_SIZE (20) on both axes.
    const result = geo.computeResizePatch('se', bbox, 0, { x: -500, y: -500 }, true);
    expect(result.w).toBe(20);
    expect(result.h).toBe(20);
    expect(result.x).toBeCloseTo(100, 5); // nw corner (the anchor for se) still fixed
    expect(result.y).toBeCloseTo(100, 5);
  });
});

describe('computeResizePatch — unrotated, text layer (hasHeight=false, width-only)', () => {
  const bbox: geo.LayerBBox = { x: 100, y: 100, w: 200, h: 60 };

  it('"e" handle resizes width and omits h entirely', () => {
    const result = geo.computeResizePatch('e', bbox, 0, { x: 40, y: 0 }, false);
    expect(result).toEqual({ x: 100, y: 100, w: 240 });
    expect(result.h).toBeUndefined();
  });

  it('"w" handle resizes width from the left, anchoring the right edge, and omits h', () => {
    const result = geo.computeResizePatch('w', bbox, 0, { x: -30, y: 0 }, false);
    expect(result.w).toBeCloseTo(230, 5);
    expect(result.x).toBeCloseTo(70, 5);
    expect(result.x + result.w).toBeCloseTo(300, 5); // right edge fixed
    expect(result.h).toBeUndefined();
  });

  it('a purely-vertical handle ("n"/"s") is a total no-op for text layers', () => {
    const resultN = geo.computeResizePatch('n', bbox, 0, { x: 0, y: -50 }, false);
    expect(resultN).toEqual({ x: 100, y: 100, w: 200 });
    const resultS = geo.computeResizePatch('s', bbox, 0, { x: 0, y: 50 }, false);
    expect(resultS).toEqual({ x: 100, y: 100, w: 200 });
  });

  it('a corner handle ("se") still resizes width for text (y-component of delta ignored)', () => {
    const result = geo.computeResizePatch('se', bbox, 0, { x: 25, y: 500 }, false);
    expect(result.w).toBeCloseTo(225, 5);
    expect(result.x).toBeCloseTo(100, 5);
    expect(result.h).toBeUndefined();
  });

  it('clamps width to the minimum size floor', () => {
    const result = geo.computeResizePatch('e', bbox, 0, { x: -500, y: 0 }, false);
    expect(result.w).toBe(20);
  });
});

describe('computeResizePatch — rotated', () => {
  it('a 90deg-rotated box\'s "e" handle drag (canvas-space horizontal) resizes along the box\'s own local axis, not the canvas x-axis', () => {
    // Square centered (200,200), 100x100, rotated 90deg. Locally "e" means +x in local space,
    // which after a 90deg CW rotation points in the CANVAS +y direction. So a canvas-space delta
    // of (0, 40) — straight down — should project onto the box's local +x axis and grow width,
    // leaving canvas x unchanged-ish and shifting canvas y.
    const bbox: geo.LayerBBox = { x: 150, y: 150, w: 100, h: 100 };
    const result = geo.computeResizePatch('e', bbox, 90, { x: 0, y: 40 }, true);
    expect(result.w).toBeCloseTo(140, 5);
    expect(result.h).toBeCloseTo(100, 5);
  });

  it('resize anchor stays fixed in CANVAS space even under rotation', () => {
    // 45deg-rotated box, drag "se" — the opposite corner (nw, in local space) must remain at the
    // exact same canvas-space location before and after.
    const bbox: geo.LayerBBox = { x: 150, y: 150, w: 100, h: 100 };
    const beforeCorners = geo.getRotatedCorners(bbox, 45);
    const nwBefore = beforeCorners[0];

    const result = geo.computeResizePatch('se', bbox, 45, { x: 20, y: 0 }, true);
    const afterBbox: geo.LayerBBox = { x: result.x, y: result.y, w: result.w, h: result.h! };
    const afterCorners = geo.getRotatedCorners(afterBbox, 45);
    const nwAfter = afterCorners[0];

    expect(nwAfter.x).toBeCloseTo(nwBefore.x, 5);
    expect(nwAfter.y).toBeCloseTo(nwBefore.y, 5);
  });

  it('30deg rotation: "s" handle keeps the local top edge fixed in canvas-space', () => {
    const bbox: geo.LayerBBox = { x: 100, y: 100, w: 200, h: 100 };
    const beforeCorners = geo.getRotatedCorners(bbox, 30);
    const [tlBefore, trBefore] = beforeCorners;

    const result = geo.computeResizePatch('s', bbox, 30, { x: 0, y: 25 }, true);
    const afterBbox: geo.LayerBBox = { x: result.x, y: result.y, w: result.w, h: result.h! };
    const afterCorners = geo.getRotatedCorners(afterBbox, 30);
    const [tlAfter, trAfter] = afterCorners;

    expect(tlAfter.x).toBeCloseTo(tlBefore.x, 5);
    expect(tlAfter.y).toBeCloseTo(tlBefore.y, 5);
    expect(trAfter.x).toBeCloseTo(trBefore.x, 5);
    expect(trAfter.y).toBeCloseTo(trBefore.y, 5);
    // height actually grew
    expect(result.h!).toBeGreaterThan(bbox.h);
  });

  it('rotated text layer "e" handle resizes width along the local axis and omits h', () => {
    const bbox: geo.LayerBBox = { x: 100, y: 100, w: 200, h: 60 };
    // 90deg rotated text layer: local +x now points along canvas +y.
    const result = geo.computeResizePatch('e', bbox, 90, { x: 0, y: 30 }, false);
    expect(result.w).toBeCloseTo(230, 5);
    expect(result.h).toBeUndefined();
  });
});
