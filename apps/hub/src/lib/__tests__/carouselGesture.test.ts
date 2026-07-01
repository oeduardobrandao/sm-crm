import { describe, it, expect } from 'vitest';
import {
  resolveTarget,
  applyEdgeResistance,
  crossedDragThreshold,
  DRAG_INTENT_THRESHOLD_PX,
} from '../carouselGesture';

const W = 300;

describe('resolveTarget', () => {
  it('advances forward when distance exceeds 18% of width', () => {
    expect(resolveTarget({ currentIndex: 0, count: 3, deltaX: -60, width: W, velocity: 0 })).toBe(1);
  });
  it('advances backward on a rightward drag past threshold', () => {
    expect(resolveTarget({ currentIndex: 1, count: 3, deltaX: 60, width: W, velocity: 0 })).toBe(0);
  });
  it('advances on velocity even when distance is small', () => {
    expect(resolveTarget({ currentIndex: 0, count: 3, deltaX: -12, width: W, velocity: -0.6 })).toBe(
      1,
    );
  });
  it('returns current index below both thresholds', () => {
    expect(resolveTarget({ currentIndex: 1, count: 3, deltaX: -10, width: W, velocity: -0.1 })).toBe(
      1,
    );
  });
  it('clamps at the last slide', () => {
    expect(resolveTarget({ currentIndex: 2, count: 3, deltaX: -200, width: W, velocity: -2 })).toBe(
      2,
    );
  });
  it('clamps at the first slide', () => {
    expect(resolveTarget({ currentIndex: 0, count: 3, deltaX: 200, width: W, velocity: 2 })).toBe(0);
  });
});

describe('applyEdgeResistance', () => {
  it('dampens over-drag before the first slide', () => {
    expect(applyEdgeResistance(100, 0, 3)).toBeCloseTo(30);
  });
  it('dampens over-drag after the last slide', () => {
    expect(applyEdgeResistance(-100, 2, 3)).toBeCloseTo(-30);
  });
  it('leaves in-range drags unchanged', () => {
    expect(applyEdgeResistance(-100, 0, 3)).toBe(-100);
    expect(applyEdgeResistance(100, 2, 3)).toBe(100);
  });
});

describe('crossedDragThreshold', () => {
  it('is false for a stationary pointer', () => {
    expect(crossedDragThreshold(2, 1)).toBe(false);
  });
  it('is true for a clearly horizontal move', () => {
    expect(crossedDragThreshold(DRAG_INTENT_THRESHOLD_PX + 1, 2)).toBe(true);
  });
  it('is false when vertical dominates', () => {
    expect(crossedDragThreshold(10, 20)).toBe(false);
  });
});
