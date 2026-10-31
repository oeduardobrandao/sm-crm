import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase');

import * as supabaseModule from '../../lib/supabase';
import {
  YouTubeNotConnectedError,
  getYouTubeDaily,
  getYouTubeDemographics,
  getYouTubeOverview,
  getYouTubeTopShorts,
  getYouTubeTraffic,
  getYouTubeVideos,
  isGoogleFeatureDisabled,
} from '../youtubeAnalytics';

type MockedSupabaseModule = typeof supabaseModule & { __resetSupabaseMock: () => void };
const mockedSupabase = supabaseModule as MockedSupabaseModule;

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: () => Promise.resolve(body) } as Response;
}

const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/youtube-analytics`;

describe('youtubeAnalytics service', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
    vi.restoreAllMocks();
  });
  afterEach(() => vi.restoreAllMocks());

  it('getYouTubeOverview builds ?days=&type= for a days range', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ kpis: {} }));
    await getYouTubeOverview(7, { days: 28 }, 'shorts');
    expect(spy.mock.calls[0][0]).toBe(`${BASE}/overview/7?days=28&type=shorts`);
  });

  it('getYouTubeOverview builds ?start=&end=&type= for a date range', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ kpis: {} }));
    await getYouTubeOverview(7, { start: '2026-10-01', end: '2026-10-15' }, 'all');
    expect(spy.mock.calls[0][0]).toBe(
      `${BASE}/overview/7?start=2026-10-01&end=2026-10-15&type=all`,
    );
  });

  it('sends the session bearer token and apikey', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ kpis: {} }));
    await getYouTubeOverview(7, { days: 7 }, 'all');
    const headers = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-de-teste');
    expect(headers).toHaveProperty('apikey');
  });

  it('getYouTubeDaily and getYouTubeTraffic carry the range and type', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ daily: [] }))
      .mockResolvedValueOnce(jsonResponse({ traffic: [] }));
    await getYouTubeDaily(3, { days: 90 }, 'long');
    await getYouTubeTraffic(3, { days: 90 });
    expect(spy.mock.calls[0][0]).toBe(`${BASE}/daily/3?days=90&type=long`);
    expect(spy.mock.calls[1][0]).toBe(`${BASE}/traffic/3?days=90`);
  });

  it('getYouTubeDemographics takes no range', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ rows: [] }));
    await getYouTubeDemographics(3);
    expect(spy.mock.calls[0][0]).toBe(`${BASE}/demographics/3`);
  });

  it('getYouTubeVideos carries the range and sort', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ videos: [] }));
    await getYouTubeVideos(3, { days: 28 }, 'published_at');
    expect(spy.mock.calls[0][0]).toBe(`${BASE}/videos/3?days=28&sort=published_at`);
  });

  it('getYouTubeTopShorts carries the range', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ shorts: [] }));
    await getYouTubeTopShorts(3, { start: '2026-10-01', end: '2026-10-05' });
    expect(spy.mock.calls[0][0]).toBe(`${BASE}/top-shorts/3?start=2026-10-01&end=2026-10-05`);
  });

  it('throws YouTubeNotConnectedError on 404 not_connected', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ error: 'not_connected' }, 404),
    );
    await expect(getYouTubeOverview(7, { days: 7 }, 'all')).rejects.toBeInstanceOf(
      YouTubeNotConnectedError,
    );
  });

  it('maps a 403 feature_disabled body through isGoogleFeatureDisabled', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ error: 'feature_disabled', feature: 'feature_youtube' }, 403),
    );
    const err = await getYouTubeOverview(7, { days: 7 }, 'all').catch((e) => e);
    expect(isGoogleFeatureDisabled(err)).toBe(true);
    expect(isGoogleFeatureDisabled(new Error('x'))).toBe(false);
  });

  it('does not surface a 500 body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ error: 'select * from secrets exploded' }, 500),
    );
    const err = await getYouTubeOverview(7, { days: 7 }, 'all').catch((e) => e);
    expect(err.message).toBe('Error 500');
    expect(err.message).not.toContain('secrets');
  });
});
