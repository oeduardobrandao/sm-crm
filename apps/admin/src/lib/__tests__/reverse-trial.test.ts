import { describe, expect, it } from 'vitest';
import {
  extendDateBounds,
  extendEndsAt,
  formatSpDate,
  reverseTrialBadgeLabel,
  reverseTrialOutcomeLabel,
  spDate,
} from '../reverse-trial';

describe('reverse trial helpers', () => {
  it('uses the São Paulo calendar day near UTC midnight', () => {
    // 01:30 UTC on the 16th is still 22:30 on the 15th in São Paulo.
    expect(spDate('2026-12-16T01:30:00Z')).toBe('2026-12-15');
    expect(formatSpDate('2026-12-16T01:30:00Z')).toBe('15/12/2026');
    expect(spDate('2026-12-16T03:00:00Z')).toBe('2026-12-16');
  });

  it('builds the badge copy, with and without a date', () => {
    expect(reverseTrialBadgeLabel('2026-12-16T01:30:00Z')).toBe(
      'Teste Pro sem cartão até 15/12/2026',
    );
    expect(reverseTrialBadgeLabel(null)).toBe('Teste Pro sem cartão');
  });

  it('labels an ended trial by its outcome', () => {
    expect(reverseTrialOutcomeLabel('downgraded')).toBe('Teste sem cartão: voltou ao Free');
    expect(reverseTrialOutcomeLabel('converted')).toBe('Teste sem cartão: virou pagante');
    expect(reverseTrialOutcomeLabel(null)).toBeNull();
    expect(reverseTrialOutcomeLabel('weird')).toBeNull();
  });

  it('keeps the current end wall-clock time when extending to a picked day', () => {
    // Current end 22:30 in São Paulo (01:30Z next day).
    expect(extendEndsAt('2026-12-20', '2026-12-16T01:30:00Z')).toBe('2026-12-21T01:30:00.000Z');
    expect(extendEndsAt('2026-12-20', '2026-12-15T15:00:00Z')).toBe('2026-12-20T15:00:00.000Z');
  });

  it('bounds the picker from tomorrow to start + 30 days (São Paulo days)', () => {
    expect(extendDateBounds('2026-12-01T15:00:00Z', new Date('2026-12-05T02:00:00Z'))).toEqual({
      min: '2026-12-05',
      max: '2026-12-31',
    });
  });
});
