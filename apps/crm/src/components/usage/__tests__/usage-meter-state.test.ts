import { describe, expect, it } from 'vitest';
import { computeMeterState, formatStorageBytes } from '../usage-meter-state';

describe('computeMeterState', () => {
  it('is ok with no CTA well below the limit', () => {
    expect(computeMeterState(3, 10)).toEqual({ state: 'ok', pct: 30, remaining: 7, showCta: false });
  });
  it('shows the CTA above 75% while still ok (green band)', () => {
    const m = computeMeterState(76, 100);
    expect(m.state).toBe('ok');
    expect(m.showCta).toBe(true);
  });
  it('does not show the CTA at exactly 75% or below', () => {
    expect(computeMeterState(75, 100).showCta).toBe(false);
    expect(computeMeterState(74, 100).showCta).toBe(false);
  });
  it('warns at 80% usage', () => {
    const m = computeMeterState(8, 10);
    expect(m.state).toBe('warning');
    expect(m.showCta).toBe(true);
  });
  it('warns when only 1 slot remains, even below 75% (tiny limits)', () => {
    const m = computeMeterState(1, 2);
    expect(m.state).toBe('warning');
    expect(m.remaining).toBe(1);
    expect(m.showCta).toBe(true);
  });
  it('is danger at the limit and clamps pct at 100 when over', () => {
    expect(computeMeterState(10, 10)).toEqual({ state: 'danger', pct: 100, remaining: 0, showCta: true });
    expect(computeMeterState(12, 10).pct).toBe(100);
  });
  it('treats limit 0 as blocked (fail-closed), never 0-de-0 danger', () => {
    expect(computeMeterState(0, 0)).toEqual({ state: 'blocked', pct: 0, remaining: 0, showCta: true });
  });
  it('treats null limit as unlimited with no CTA', () => {
    expect(computeMeterState(42, null)).toEqual({ state: 'unlimited', pct: 0, remaining: null, showCta: false });
  });
});

describe('formatStorageBytes', () => {
  it('formats GB with pt-BR decimal comma', () => {
    expect(formatStorageBytes(4.2 * 1024 ** 3)).toBe('4,2 GB');
    expect(formatStorageBytes(10 * 1024 ** 3)).toBe('10 GB');
  });
  it('formats sub-GB as MB', () => {
    expect(formatStorageBytes(100 * 1024 ** 2)).toBe('100 MB');
  });
});
