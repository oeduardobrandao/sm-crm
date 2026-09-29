import { describe, expect, it } from 'vitest';

import {
  ACTION_SORT_KEYS,
  compareNullableNumber,
  followsPerMilReach,
  missingActionMetricTitle,
  toNullableCount,
} from '../post-action-metrics';

describe('post-action-metrics', () => {
  it('toNullableCount keeps finite numbers (0 included) and maps everything else to null', () => {
    expect(toNullableCount(0)).toBe(0);
    expect(toNullableCount(75)).toBe(75);
    expect(toNullableCount(null)).toBeNull();
    expect(toNullableCount(undefined)).toBeNull();
    expect(toNullableCount('5')).toBeNull();
    expect(toNullableCount(Number.NaN)).toBeNull();
  });

  it('followsPerMilReach divides by reach per thousand and is null-safe', () => {
    expect(followsPerMilReach(75, 37600)).toBeCloseTo(1.9947, 3);
    expect(followsPerMilReach(0, 1000)).toBe(0);
    expect(followsPerMilReach(null, 1000)).toBeNull();
    expect(followsPerMilReach(5, 0)).toBeNull();
    expect(followsPerMilReach(5, null)).toBeNull();
  });

  it('compareNullableNumber sorts nulls last in both directions', () => {
    const values = [5, null, 20, undefined, 1];
    const desc = [...values].sort((a, b) => compareNullableNumber(a, b, 'desc'));
    expect(desc.slice(0, 3)).toEqual([20, 5, 1]);
    expect(desc.slice(3).every((v) => v == null)).toBe(true);
    const asc = [...values].sort((a, b) => compareNullableNumber(a, b, 'asc'));
    expect(asc.slice(0, 3)).toEqual([1, 5, 20]);
    expect(asc.slice(3).every((v) => v == null)).toBe(true);
  });

  it('missingActionMetricTitle distinguishes "not returned" from "never fetched"', () => {
    expect(missingActionMetricTitle('follows', ['follows'])).toBe(
      'O Instagram não retornou este dado na última sincronização',
    );
    expect(missingActionMetricTitle('follows', ['reposts'])).toBe('Sem dado para este post');
    expect(missingActionMetricTitle('follows', undefined)).toBe('Sem dado para este post');
  });

  it('exposes the sortable keys', () => {
    expect(ACTION_SORT_KEYS).toEqual([
      'reposts',
      'profile_visits',
      'follows',
      'bio_link_clicks',
      'follows_per_mil_reach',
    ]);
  });
});
