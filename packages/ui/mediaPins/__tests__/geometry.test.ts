import { describe, expect, it } from 'vitest';
import {
  containedRect,
  formatMoment,
  isNearMoment,
  pinNumbers,
  toPercentStyle,
  toRelative,
} from '../geometry';

describe('containedRect', () => {
  it('letterboxes a portrait image in a square box', () => {
    const box = { left: 0, top: 0, width: 400, height: 400 };
    expect(containedRect(box, 1080, 1350)).toEqual({ left: 40, top: 0, width: 320, height: 400 });
  });

  it('pillarboxes a landscape image in a square box', () => {
    const box = { left: 0, top: 0, width: 400, height: 400 };
    expect(containedRect(box, 1600, 800)).toEqual({ left: 0, top: 100, width: 400, height: 200 });
  });

  it('keeps the box offset', () => {
    const box = { left: 10, top: 20, width: 400, height: 400 };
    expect(containedRect(box, 1080, 1350)).toEqual({ left: 50, top: 20, width: 320, height: 400 });
  });

  it('falls back to the box when the natural size is unknown or zero', () => {
    const box = { left: 5, top: 6, width: 400, height: 300 };
    expect(containedRect(box, 0, 0)).toEqual(box);
    expect(containedRect(box, 1080, 0)).toEqual(box);
    expect(containedRect(box, Number.NaN, 100)).toEqual(box);
  });
});

describe('toRelative', () => {
  const rendered = { left: 40, top: 0, width: 320, height: 400 };

  it('returns null in the letterbox bar', () => {
    expect(toRelative(20, 200, rendered)).toBeNull();
  });

  it('returns the center at (200, 200)', () => {
    expect(toRelative(200, 200, rendered)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('rounds to 4 decimals', () => {
    const r = toRelative(40 + 100, 100, { left: 40, top: 0, width: 300, height: 300 });
    expect(r).toEqual({ x: 0.3333, y: 0.3333 });
  });

  it('accepts points on the edges', () => {
    expect(toRelative(40, 0, rendered)).toEqual({ x: 0, y: 0 });
    expect(toRelative(360, 400, rendered)).toEqual({ x: 1, y: 1 });
  });

  it('returns null for an empty rendered rect', () => {
    expect(toRelative(0, 0, { left: 0, top: 0, width: 0, height: 0 })).toBeNull();
  });
});

describe('toPercentStyle', () => {
  it('round trip at another size lands at the image center', () => {
    const p = toRelative(
      200,
      200,
      containedRect({ left: 0, top: 0, width: 400, height: 400 }, 1080, 1350),
    );
    expect(p).toEqual({ x: 0.5, y: 0.5 });
    const box = { left: 0, top: 0, width: 800, height: 600 };
    const rendered = containedRect(box, 1080, 1350);
    expect(toPercentStyle(p!, box, rendered)).toEqual({ left: '50%', top: '50%' });
  });

  it('positions within the full box, not the image', () => {
    const box = { left: 0, top: 0, width: 400, height: 400 };
    const rendered = { left: 40, top: 0, width: 320, height: 400 };
    expect(toPercentStyle({ x: 0, y: 0 }, box, rendered)).toEqual({ left: '10%', top: '0%' });
  });
});

describe('pinNumbers', () => {
  type N = { id: number; x: number | null; created_at: string; link: number | null };
  const linkOf = (n: N) => n.link;

  it('numbers per link and skips whole-slide notes', () => {
    const notes: N[] = [
      { id: 3, x: 0.2, created_at: '2026-10-01T10:00:00Z', link: 10 },
      { id: 1, x: null, created_at: '2026-10-01T09:00:00Z', link: 10 },
      { id: 2, x: 0.5, created_at: '2026-10-01T09:30:00Z', link: 10 },
      { id: 4, x: 0.1, created_at: '2026-10-01T08:00:00Z', link: 11 },
      { id: 5, x: 0.9, created_at: '2026-10-01T07:00:00Z', link: null },
    ];
    const m = pinNumbers(notes, linkOf);
    expect(m.get(2)).toBe(1);
    expect(m.get(3)).toBe(2);
    expect(m.get(4)).toBe(1);
    expect(m.has(1)).toBe(false);
    expect(m.has(5)).toBe(false);
  });

  it('breaks created_at ties by id', () => {
    const notes: N[] = [
      { id: 9, x: 0.1, created_at: '2026-10-01T10:00:00Z', link: 1 },
      { id: 8, x: 0.1, created_at: '2026-10-01T10:00:00Z', link: 1 },
    ];
    const m = pinNumbers(notes, linkOf);
    expect(m.get(8)).toBe(1);
    expect(m.get(9)).toBe(2);
  });
});

describe('formatMoment', () => {
  it('formats seconds as m:ss', () => {
    expect(formatMoment(42)).toBe('0:42');
    expect(formatMoment(125.4)).toBe('2:05');
    expect(formatMoment(0)).toBe('0:00');
  });

  it('clamps negative or non-finite values to 0:00', () => {
    expect(formatMoment(-3)).toBe('0:00');
    expect(formatMoment(Number.NaN)).toBe('0:00');
  });
});

describe('isNearMoment', () => {
  it('is true within the window and false outside', () => {
    expect(isNearMoment(42, 42.9)).toBe(true);
    expect(isNearMoment(42, 41.2)).toBe(true);
    expect(isNearMoment(42, 43.5)).toBe(false);
  });

  it('honours a custom window', () => {
    expect(isNearMoment(42, 43.5, 2)).toBe(true);
  });
});
