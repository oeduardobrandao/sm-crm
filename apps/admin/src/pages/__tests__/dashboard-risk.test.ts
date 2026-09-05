import { describe, expect, it } from 'vitest';
import { pendingLabel, selectTrialsEndingSoon, trialDeadlineLabel } from '../dashboard-risk';

const NOW = new Date('2026-09-04T12:00:00.000Z');
const DAY = 86_400_000;
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

describe('selectTrialsEndingSoon', () => {
  it('keeps trials ending between now and now + 3 days inclusive, soonest first', () => {
    const trials = [
      { id: 'late', trial_ends_at: at(3 * DAY + 1) },
      { id: 'edge', trial_ends_at: at(3 * DAY) },
      { id: 'past', trial_ends_at: at(-1) },
      { id: 'soon', trial_ends_at: at(DAY) },
      { id: 'now', trial_ends_at: at(0) },
      { id: 'unknown', trial_ends_at: null },
    ];
    expect(selectTrialsEndingSoon(trials, NOW).map((t) => t.id)).toEqual(['now', 'soon', 'edge']);
  });
  it('honours a custom window', () => {
    const trials = [{ id: 'a', trial_ends_at: at(6 * DAY) }];
    expect(selectTrialsEndingSoon(trials, NOW, 7)).toHaveLength(1);
    expect(selectTrialsEndingSoon(trials, NOW)).toHaveLength(0);
  });
});

describe('trialDeadlineLabel', () => {
  it('says hoje / amanhã / em N dias by calendar day', () => {
    expect(trialDeadlineLabel(at(2 * 3_600_000), NOW)).toBe('hoje');
    expect(trialDeadlineLabel(at(DAY), NOW)).toBe('amanhã');
    expect(trialDeadlineLabel(at(3 * DAY), NOW)).toBe('em 3 dias');
  });

  it('counts days in the viewer local zone, not UTC', () => {
    // 21:00 local today vs 23:30 local today: same local day even if UTC has rolled over.
    const nowLocal = new Date(2026, 8, 4, 21, 0, 0);
    const laterToday = new Date(2026, 8, 4, 23, 30, 0);
    const earlyTomorrow = new Date(2026, 8, 5, 0, 30, 0);
    expect(trialDeadlineLabel(laterToday.toISOString(), nowLocal)).toBe('hoje');
    expect(trialDeadlineLabel(earlyTomorrow.toISOString(), nowLocal)).toBe('amanhã');
  });
});

describe('pendingLabel', () => {
  it('prefers the retry count', () => {
    expect(pendingLabel({ failed_payment_count: 3, current_period_end: at(DAY) }, NOW)).toBe(
      '3ª tentativa',
    );
    expect(pendingLabel({ failed_payment_count: 1, current_period_end: null }, NOW)).toBe(
      '1ª tentativa',
    );
  });
  it('falls back to the period end', () => {
    expect(pendingLabel({ failed_payment_count: 0, current_period_end: at(5 * DAY) }, NOW)).toBe(
      'vence em 5 dias',
    );
    expect(pendingLabel({ failed_payment_count: 0, current_period_end: at(3_600_000) }, NOW)).toBe(
      'vence hoje',
    );
    expect(pendingLabel({ failed_payment_count: 0, current_period_end: at(-2 * DAY) }, NOW)).toBe(
      'venceu há 2 dias',
    );
  });
  it('renders a dash when nothing is known', () => {
    expect(pendingLabel({ failed_payment_count: 0, current_period_end: null }, NOW)).toBe('—');
    expect(pendingLabel(null, NOW)).toBe('—');
  });

  it('vence hoje follows the local calendar day', () => {
    const nowLocal = new Date(2026, 8, 4, 21, 0, 0);
    const laterToday = new Date(2026, 8, 4, 23, 30, 0).toISOString();
    expect(
      pendingLabel({ failed_payment_count: 0, current_period_end: laterToday }, nowLocal),
    ).toBe('vence hoje');
  });
});
