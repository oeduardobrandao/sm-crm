import { describe, expect, it } from 'vitest';
import { formatFollowerTick, isNarrowRange } from '../followerTicks';

describe('followerTicks', () => {
  it('treats a range under 1000 as narrow', () => {
    expect(isNarrowRange([3833, 3906])).toBe(true);
    expect(isNarrowRange([3000, 4000])).toBe(false);
    expect(isNarrowRange([])).toBe(false);
  });
  it('narrow ranges read as full integers with locale grouping, so ticks stay distinct', () => {
    const ticks = [3850, 3875, 3900].map((v) => formatFollowerTick(v, true, 'pt-BR'));
    expect(ticks).toEqual(['3.850', '3.875', '3.900']);
    expect(new Set(ticks).size).toBe(3);
    expect(formatFollowerTick(3850, true, 'en-US')).toBe('3,850');
  });
  it('wide ranges keep the compact form', () => {
    expect(formatFollowerTick(12500, false, 'pt-BR')).toBe('12.5k');
    expect(formatFollowerTick(800, false, 'pt-BR')).toBe('800');
  });
});
