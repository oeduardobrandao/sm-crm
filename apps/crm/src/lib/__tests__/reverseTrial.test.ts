import { describe, it, expect } from 'vitest';
import {
  reverseTrialPhase,
  hubPauseDate,
  daysLeftLabel,
  isReverseTrialRunning,
  isExReverseTrial,
  formatTrialDate,
  formatTrialHour,
} from '../reverseTrial';

// 2026-12-08 17:00 UTC = 14:00 in São Paulo (UTC-3, no DST).
const ENDS_AT = '2026-12-08T17:00:00Z';

describe('reverseTrialPhase', () => {
  it('phase_normal_10_days', () => {
    expect(reverseTrialPhase(new Date('2026-11-28T15:00:00Z'), ENDS_AT)).toEqual({
      phase: 'normal',
      daysLeft: 10,
    });
  });

  it('phase_normal_at_4_days', () => {
    expect(reverseTrialPhase(new Date('2026-12-04T15:00:00Z'), ENDS_AT)).toEqual({
      phase: 'normal',
      daysLeft: 4,
    });
  });

  it('phase_ending_3_days', () => {
    expect(reverseTrialPhase(new Date('2026-12-05T12:00:00Z'), ENDS_AT)).toEqual({
      phase: 'ending',
      daysLeft: 3,
    });
    expect(reverseTrialPhase(new Date('2026-12-07T12:00:00Z'), ENDS_AT)).toEqual({
      phase: 'ending',
      daysLeft: 1,
    });
  });

  it('phase_last_day_sao_paulo', () => {
    // 2026-12-07 23:30 UTC is still 20:30 on 7/12 in São Paulo: 1 day left, not last day.
    expect(reverseTrialPhase(new Date('2026-12-07T23:30:00Z'), ENDS_AT)).toEqual({
      phase: 'ending',
      daysLeft: 1,
    });
    // 2026-12-08 03:30 UTC is 00:30 on 8/12 in São Paulo: same date as the end.
    expect(reverseTrialPhase(new Date('2026-12-08T03:30:00Z'), ENDS_AT)).toEqual({
      phase: 'last_day',
      daysLeft: 0,
    });
  });

  it('phase_last_day_when_end_is_late_evening_sp', () => {
    // Ends 2026-12-09 01:00 UTC = 22:00 on 8/12 in São Paulo. At 23:30 UTC on 8/12 (20:30 SP)
    // the UTC dates differ but the São Paulo dates are the same.
    expect(reverseTrialPhase(new Date('2026-12-08T23:30:00Z'), '2026-12-09T01:00:00Z')).toEqual({
      phase: 'last_day',
      daysLeft: 0,
    });
  });

  it('phase_ended_once_past_end', () => {
    expect(reverseTrialPhase(new Date('2026-12-08T17:00:00Z'), ENDS_AT)).toEqual({
      phase: 'ended',
      daysLeft: 0,
    });
    expect(reverseTrialPhase(new Date('2026-12-10T00:00:00Z'), ENDS_AT)).toEqual({
      phase: 'ended',
      daysLeft: 0,
    });
  });

  it('days_left_monotonic', () => {
    const start = Date.parse('2026-11-24T17:00:00Z');
    const end = Date.parse(ENDS_AT);
    let previous = Number.POSITIVE_INFINITY;
    for (let t = start; t <= end + 3_600_000; t += 17 * 60_000) {
      const { daysLeft } = reverseTrialPhase(new Date(t), ENDS_AT);
      expect(daysLeft).toBeLessThanOrEqual(previous);
      previous = daysLeft;
    }
    expect(previous).toBe(0);
  });

  it('invalid_end_reads_as_ended', () => {
    expect(reverseTrialPhase(new Date(), 'nope')).toEqual({ phase: 'ended', daysLeft: 0 });
  });
});

describe('helpers', () => {
  it('hubPauseDate adds 7 days', () => {
    expect(hubPauseDate('2026-12-08T17:00:00Z').toISOString()).toBe('2026-12-15T17:00:00.000Z');
  });

  it('daysLeftLabel pluralizes', () => {
    expect(daysLeftLabel(1)).toBe('1 dia');
    expect(daysLeftLabel(3)).toBe('3 dias');
  });

  it('formats dates and hours in São Paulo', () => {
    expect(formatTrialDate('2026-12-08T17:00:00Z')).toBe('8 de dezembro');
    // 02:00 UTC on 9/12 is still 8/12 in São Paulo.
    expect(formatTrialDate('2026-12-09T02:00:00Z')).toBe('8 de dezembro');
    expect(formatTrialHour('2026-12-08T17:00:00Z')).toBe('14h');
    expect(formatTrialHour('2026-12-08T17:30:00Z')).toBe('14h30');
  });

  it('isReverseTrialRunning reads plan_source trial with an end date', () => {
    const base = {
      planId: 'pro',
      planSource: 'trial',
      reverseTrial: {
        startedAt: '2026-11-24T17:00:00Z',
        endsAt: ENDS_AT,
        endedAt: null,
        outcome: null,
        cardAddedAt: null,
        firstPaidAt: null,
      },
    };
    expect(isReverseTrialRunning(base)).toBe(true);
    expect(isReverseTrialRunning({ ...base, planSource: 'stripe' })).toBe(false);
    expect(isReverseTrialRunning(undefined)).toBe(false);
    expect(isReverseTrialRunning({ planId: 'pro', planSource: 'trial' })).toBe(false);
  });

  it('isExReverseTrial requires a downgraded outcome on Free', () => {
    const rt = {
      startedAt: '2026-11-24T17:00:00Z',
      endsAt: ENDS_AT,
      endedAt: ENDS_AT,
      outcome: 'downgraded' as const,
      cardAddedAt: null,
      firstPaidAt: null,
    };
    expect(isExReverseTrial({ planId: null, planSource: 'system', reverseTrial: rt })).toBe(true);
    expect(isExReverseTrial({ planId: 'free', planSource: 'system', reverseTrial: rt })).toBe(true);
    expect(isExReverseTrial({ planId: 'pro', planSource: 'stripe', reverseTrial: rt })).toBe(false);
    expect(
      isExReverseTrial({
        planId: null,
        planSource: 'system',
        reverseTrial: { ...rt, outcome: 'ended_by_admin' },
      }),
    ).toBe(false);
  });
});
