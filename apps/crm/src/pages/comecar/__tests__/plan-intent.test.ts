import { describe, expect, it } from 'vitest';
import { buildPlanIntentQuery, parsePlanIntent } from '../plan-intent';

describe('parsePlanIntent', () => {
  it('reads a valid plan and interval', () => {
    expect(parsePlanIntent('?plan=pro&interval=year')).toEqual({
      planId: 'pro',
      interval: 'year',
    });
  });

  it('defaults a missing or unknown interval to month', () => {
    expect(parsePlanIntent('?plan=start')).toEqual({ planId: 'start', interval: 'month' });
    expect(parsePlanIntent('?plan=start&interval=weekly')).toEqual({
      planId: 'start',
      interval: 'month',
    });
  });

  it('rejects a plan id outside the self-serve set', () => {
    expect(parsePlanIntent('?plan=lifetime')).toBeNull();
    expect(parsePlanIntent('?plan=free')).toBeNull();
    expect(parsePlanIntent('?plan=../../etc/passwd')).toBeNull();
  });

  it('returns null when no plan is present', () => {
    expect(parsePlanIntent('')).toBeNull();
    expect(parsePlanIntent('?tab=register')).toBeNull();
  });
});

describe('buildPlanIntentQuery', () => {
  it('round-trips through parsePlanIntent', () => {
    const query = buildPlanIntentQuery('max', 'year');
    expect(parsePlanIntent(`?${query}`)).toEqual({ planId: 'max', interval: 'year' });
  });
});
