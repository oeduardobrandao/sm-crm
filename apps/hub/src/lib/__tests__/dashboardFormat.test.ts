import { describe, expect, it } from 'vitest';
import {
  formatCompact,
  formatCount,
  formatDayMonth,
  formatDuration,
  syncAge,
} from '../dashboardFormat';

describe('dashboardFormat', () => {
  it('formatCount groups in pt-BR and returns a dash for null', () => {
    expect(formatCount(12480, 'pt-BR')).toBe('12.480');
    expect(formatCount(null, 'pt-BR')).toBe('—');
  });
  it('formatCompact keeps small numbers whole and compacts from 1000', () => {
    expect(formatCompact(214, 'pt-BR')).toBe('214');
    expect(formatCompact(48200, 'pt-BR')).toBe('48,2 mil');
    expect(formatCompact(126000, 'pt-BR')).toBe('126 mil');
    expect(formatCompact(undefined, 'pt-BR')).toBe('—');
  });
  it('syncAge buckets', () => {
    const now = new Date('2026-11-10T12:00:00Z');
    expect(syncAge('2026-11-10T11:20:00Z', now)).toEqual({ kind: 'minutes', n: 40 });
    expect(syncAge('2026-11-10T10:00:00Z', now)).toEqual({ kind: 'hours', n: 2 });
    expect(syncAge('2026-11-08T10:00:00Z', now)).toEqual({
      kind: 'date',
      iso: '2026-11-08T10:00:00Z',
    });
    expect(syncAge(null, now)).toEqual({ kind: 'never' });
  });
  it('syncAge never goes below one minute, even for a future stamp', () => {
    const now = new Date('2026-11-10T12:00:00Z');
    expect(syncAge('2026-11-10T11:59:50Z', now)).toEqual({ kind: 'minutes', n: 1 });
    expect(syncAge('2026-11-10T12:03:00Z', now)).toEqual({ kind: 'minutes', n: 1 });
  });
  it('syncAge floors hours and switches to date at 24 hours', () => {
    const now = new Date('2026-11-10T12:00:00Z');
    expect(syncAge('2026-11-10T09:30:00Z', now)).toEqual({ kind: 'hours', n: 2 });
    expect(syncAge('2026-11-09T12:01:00Z', now)).toEqual({ kind: 'hours', n: 23 });
    expect(syncAge('2026-11-09T12:00:00Z', now).kind).toBe('date');
  });
  it('formatDayMonth and formatDuration', () => {
    expect(formatDayMonth('2026-10-30', 'pt-BR')).toBe('30/10');
    expect(formatDuration(42)).toBe('0:42');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(null)).toBeNull();
  });
  it('formatDayMonth reads an ISO instant in the local zone and orders by locale', () => {
    expect(formatDayMonth('2026-10-30T12:00:00Z', 'pt-BR')).toBe('30/10');
    expect(formatDayMonth('2026-10-30', 'en')).toBe('10/30');
  });
});
