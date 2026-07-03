import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSnapping } from '../hooks/useSnapping';
import { makeTextLayer } from './fixtures';
import type { NormalizedTextLayer } from '../types';

const getTextHeight = (_layer: NormalizedTextLayer): number => 50;

describe('useSnapping', () => {
  it('snaps a proposed bbox to the canvas center when within the screen-space threshold', () => {
    const layers = [makeTextLayer({ id: 'moving', x: 0, y: 0, w: 100 })];
    // canvas 1000x1000, center x = 500; scale = 1 => canvas-space threshold = 8px screen threshold / 1.
    const { result } = renderHook(() =>
      useSnapping({ layers, canvasWidth: 1000, canvasHeight: 1000, getTextHeight, scale: 1 }),
    );

    const proposed = { x: 448, y: 0, w: 100, h: 50 }; // center = 498, distance to canvas center 500 = 2
    const result2 = result.current.snap(proposed, 0, 'moving');

    expect(result2.bbox.x + result2.bbox.w / 2).toBe(500);
    expect(result2.activeLines.some((l) => l.axis === 'x' && l.position === 500)).toBe(true);
  });

  it('does not snap when the proposed bbox is outside the threshold on any axis', () => {
    const layers = [makeTextLayer({ id: 'moving', x: 0, y: 0, w: 100 })];
    const { result } = renderHook(() =>
      useSnapping({ layers, canvasWidth: 1000, canvasHeight: 1000, getTextHeight, scale: 1 }),
    );

    const proposed = { x: 200, y: 200, w: 100, h: 50 }; // nowhere near canvas edges/center or other layers
    const snapped = result.current.snap(proposed, 0, 'moving');

    expect(snapped.bbox).toEqual(proposed);
    expect(snapped.activeLines).toHaveLength(0);
  });

  it('excludes the moving layer itself from snap candidates', () => {
    // Only layer on the page IS the one being moved — with itself excluded, only canvas lines
    // remain as candidates.
    const layers = [makeTextLayer({ id: 'solo', x: 448, y: 0, w: 100 })];
    const { result } = renderHook(() =>
      useSnapping({ layers, canvasWidth: 1000, canvasHeight: 1000, getTextHeight, scale: 1 }),
    );

    // Proposed box positioned so it WOULD snap to "solo"'s own current edges if self-inclusion
    // were a bug, but 'solo' is excluded since movingLayerId === 'solo' — only canvas lines apply.
    const proposed = { x: 449, y: 0, w: 100, h: 50 }; // center = 499, close to canvas center 500 too
    const snapped = result.current.snap(proposed, 0, 'solo');

    // Should snap to canvas center (500), not to itself.
    expect(snapped.activeLines.every((l) => l.source === 'canvas')).toBe(true);
  });

  it('converts the screen-space threshold to canvas-space using the current scale', () => {
    const layers = [makeTextLayer({ id: 'moving', x: 0, y: 0, w: 100 })];
    // At scale 0.5, screen threshold 8px => canvas threshold 16px, so a 12px-off box should snap.
    const { result } = renderHook(() =>
      useSnapping({ layers, canvasWidth: 1000, canvasHeight: 1000, getTextHeight, scale: 0.5 }),
    );

    const proposed = { x: 438, y: 0, w: 100, h: 50 }; // center = 488, distance to 500 = 12
    const snapped = result.current.snap(proposed, 0, 'moving');

    expect(snapped.bbox.x + snapped.bbox.w / 2).toBe(500);
  });

  it('at scale 1, a 12px-off box (beyond the 8px canvas threshold) does not snap', () => {
    const layers = [makeTextLayer({ id: 'moving', x: 0, y: 0, w: 100 })];
    const { result } = renderHook(() =>
      useSnapping({ layers, canvasWidth: 1000, canvasHeight: 1000, getTextHeight, scale: 1 }),
    );

    const proposed = { x: 438, y: 0, w: 100, h: 50 }; // center = 488, distance to 500 = 12 > 8
    const snapped = result.current.snap(proposed, 0, 'moving');

    expect(snapped.bbox.x).toBe(438);
  });

  it('threads the rotationDeg argument through to snapMath so a rotated moving layer snaps by its rotated extent', () => {
    // Same scenario as lib/snapMath.test.ts's own rotation test, exercised through the hook: a
    // 100x100 box rotated 45deg centered at (75, 500) has a rotated-AABB left edge at
    // ~4.29 (within threshold of the canvas left edge, x=0), even though its pre-rotation x (25)
    // is not.
    const layers = [makeTextLayer({ id: 'moving', x: 0, y: 0, w: 100 })];
    const { result } = renderHook(() =>
      useSnapping({ layers, canvasWidth: 1000, canvasHeight: 1000, getTextHeight, scale: 1 }),
    );

    const proposed = { x: 25, y: 450, w: 100, h: 100 };
    const rotated = result.current.snap(proposed, 45, 'moving');
    const expectedDelta = 0 - (75 - (100 * Math.sqrt(2)) / 2);
    expect(rotated.bbox.x).toBeCloseTo(25 + expectedDelta, 10);

    const unrotated = result.current.snap(proposed, 0, 'moving');
    expect(unrotated.bbox.x).toBe(25); // same proposed box, no rotation -> no snap (proven above)
  });
});
