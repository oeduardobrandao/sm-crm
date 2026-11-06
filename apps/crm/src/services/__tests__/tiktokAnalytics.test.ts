import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase');

import * as supabaseModule from '../../lib/supabase';
import {
  TikTokNotConnectedError,
  TikTokRateLimitedError,
  getTikTokAIAnalysis,
  getTikTokBestTimes,
  getTikTokFollowerHistory,
  getTikTokOverview,
  getTikTokPortfolio,
  getTikTokPortfolioAI,
  getTikTokPostsAnalytics,
} from '../tiktokAnalytics';

type MockedSupabaseModule = typeof supabaseModule & { __resetSupabaseMock: () => void };
const mockedSupabase = supabaseModule as MockedSupabaseModule;

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: () => Promise.resolve(body) } as Response;
}

const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tiktok-analytics`;

describe('tiktokAnalytics service', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
    vi.restoreAllMocks();
  });
  afterEach(() => vi.restoreAllMocks());

  it('getTikTokOverview builds ?days= for a days range', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ kpis: {} }));
    await getTikTokOverview(7, { days: 30 });
    expect(spy.mock.calls[0][0]).toBe(`${BASE}/overview/7?days=30`);
  });

  it('getTikTokOverview builds ?start=&end= for a date range', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ kpis: {} }));
    await getTikTokOverview(7, { start: '2026-10-01', end: '2026-10-15' });
    expect(spy.mock.calls[0][0]).toBe(`${BASE}/overview/7?start=2026-10-01&end=2026-10-15`);
  });

  it('sends the session bearer token and apikey', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ kpis: {} }));
    await getTikTokOverview(7, { days: 7 });
    const headers = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-de-teste');
    expect(headers).toHaveProperty('apikey');
  });

  it('throws TikTokNotConnectedError on 404 not_connected', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ error: 'not_connected' }, 404),
    );
    await expect(getTikTokOverview(7, { days: 7 })).rejects.toBeInstanceOf(TikTokNotConnectedError);
  });

  it('throws feature_disabled on 403 feature_disabled', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ error: 'feature_disabled', feature: 'feature_tiktok' }, 403),
    );
    await expect(getTikTokOverview(7, { days: 7 })).rejects.toMatchObject({
      message: 'feature_disabled',
    });
  });

  it('throws TikTokRateLimitedError (status 429) when rate limited', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ error: 'Rate limit exceeded' }, 429),
    );
    const err = await getTikTokAIAnalysis(7, 30).catch((e) => e);
    expect(err).toBeInstanceOf(TikTokRateLimitedError);
    expect(err.status).toBe(429);
    expect(err.message).not.toContain('Rate limit exceeded');
  });

  it('throws a generic error on other failures without leaking the body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500));
    const err = await getTikTokOverview(7, { days: 7 }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(TikTokNotConnectedError);
    expect(err.message).toBe('Error 500');
  });

  it('getTikTokFollowerHistory unwraps history', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({ history: [{ date: '2026-10-01', follower_count: 5, source: 'cron' }] }),
      );
    const rows = await getTikTokFollowerHistory(3, { days: 90 });
    expect(spy.mock.calls[0][0]).toBe(`${BASE}/follower-history/3?days=90`);
    expect(rows).toEqual([{ date: '2026-10-01', follower_count: 5, source: 'cron' }]);
  });

  it('getTikTokPostsAnalytics unwraps posts and appends sort', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ posts: [] }));
    const rows = await getTikTokPostsAnalytics(
      3,
      { start: '2026-10-01', end: '2026-10-15' },
      'engagement_rate',
    );
    expect(spy.mock.calls[0][0]).toBe(
      `${BASE}/posts-analytics/3?start=2026-10-01&end=2026-10-15&sort=engagement_rate`,
    );
    expect(rows).toEqual([]);
  });

  it('getTikTokBestTimes hits /best-times/:id', async () => {
    const payload = { heatmap: [], counts: [], topSlots: [], totalPosts: 0 };
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(payload));
    expect(await getTikTokBestTimes(3)).toEqual(payload);
    expect(spy.mock.calls[0][0]).toBe(`${BASE}/best-times/3`);
  });

  it('getTikTokPortfolio hits /portfolio?days=', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ accounts: [] }));
    await getTikTokPortfolio(28);
    expect(spy.mock.calls[0][0]).toBe(`${BASE}/portfolio?days=28`);
  });

  it('AI routes POST a JSON body with days', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ analysis: {}, generatedAt: 'x' }));
    await getTikTokAIAnalysis(3, 30);
    await getTikTokPortfolioAI(90);
    expect(spy.mock.calls[0][0]).toBe(`${BASE}/ai-analysis/3`);
    expect((spy.mock.calls[0][1] as RequestInit).method).toBe('POST');
    expect((spy.mock.calls[0][1] as RequestInit).body).toBe(JSON.stringify({ days: 30 }));
    expect(spy.mock.calls[1][0]).toBe(`${BASE}/ai-analysis-portfolio`);
    expect((spy.mock.calls[1][1] as RequestInit).body).toBe(JSON.stringify({ days: 90 }));
  });
});
