import { describe, expect, it } from 'vitest';

import { keepPostsAcrossBaselineRefresh } from '../postsPlaceholder';

const key = (over: Partial<Record<number, unknown>> = {}) => {
  const base: unknown[] = [
    'analytics-posts',
    42,
    30,
    'posted_at',
    'desc',
    undefined,
    undefined,
    1000,
  ];
  for (const [i, v] of Object.entries(over)) base[Number(i)] = v;
  return base;
};

const prevData = { posts: [{ id: 'post-1' }] };

describe('keepPostsAcrossBaselineRefresh', () => {
  it('keeps the previous posts when only the baseline dataUpdatedAt changed', () => {
    expect(keepPostsAcrossBaselineRefresh(prevData, { queryKey: key() }, key({ 7: 2000 }))).toBe(
      prevData,
    );
  });

  it('returns undefined when the client, days, sort or period changed', () => {
    const prevQuery = { queryKey: key() };
    for (const next of [
      key({ 1: 43, 7: 2000 }),
      key({ 2: 7 }),
      key({ 3: 'reach' }),
      key({ 4: 'asc' }),
      key({ 5: '2026-10-01', 6: '2026-10-31' }),
    ]) {
      expect(keepPostsAcrossBaselineRefresh(prevData, prevQuery, next)).toBeUndefined();
    }
  });

  it('returns undefined without a previous query or previous data', () => {
    expect(keepPostsAcrossBaselineRefresh(prevData, undefined, key())).toBeUndefined();
    expect(keepPostsAcrossBaselineRefresh(undefined, { queryKey: key() }, key())).toBeUndefined();
  });

  it('returns undefined when the key length differs', () => {
    expect(
      keepPostsAcrossBaselineRefresh(prevData, { queryKey: key().slice(0, 7) }, key()),
    ).toBeUndefined();
  });
});
