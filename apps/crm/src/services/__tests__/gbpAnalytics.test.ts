import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase');

import * as supabaseModule from '../../lib/supabase';
import {
  GbpNotConnectedError,
  getGbpDaily,
  getGbpKeywords,
  getGbpOverview,
  getGbpRatingDistribution,
  getGbpReviews,
  getGbpSurfaces,
  getGbpUnits,
  isGoogleFeatureDisabled,
} from '../gbpAnalytics';

type MockedSupabaseModule = typeof supabaseModule & { __resetSupabaseMock: () => void };
const mockedSupabase = supabaseModule as MockedSupabaseModule;

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: () => Promise.resolve(body) } as Response;
}

const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gbp-analytics`;
const UUID = '11111111-2222-3333-4444-555555555555';

describe('gbpAnalytics service', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
    vi.restoreAllMocks();
  });
  afterEach(() => vi.restoreAllMocks());

  it('getGbpOverview builds ?location=&days= for a days range', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ kpis: {} }));
    await getGbpOverview(7, { days: 30 }, 'all');
    expect(spy.mock.calls[0][0]).toBe(`${BASE}/overview/7?days=30&location=all`);
  });

  it('getGbpOverview builds ?start=&end=&location= for a date range and a unit', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ kpis: {} }));
    await getGbpOverview(7, { start: '2026-10-01', end: '2026-10-15' }, UUID);
    expect(spy.mock.calls[0][0]).toBe(
      `${BASE}/overview/7?start=2026-10-01&end=2026-10-15&location=${UUID}`,
    );
  });

  it('sends the session bearer token and apikey', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ kpis: {} }));
    await getGbpOverview(7, { days: 7 }, 'all');
    const headers = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-de-teste');
    expect(headers).toHaveProperty('apikey');
  });

  it('daily, surfaces and units carry the range and location', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ daily: [] }))
      .mockResolvedValueOnce(jsonResponse({ surfaces: [] }))
      .mockResolvedValueOnce(jsonResponse({ units: [] }));
    await getGbpDaily(3, { days: 90 }, UUID);
    await getGbpSurfaces(3, { days: 90 }, 'all');
    await getGbpUnits(3, { days: 90 });
    expect(spy.mock.calls[0][0]).toBe(`${BASE}/daily/3?days=90&location=${UUID}`);
    expect(spy.mock.calls[1][0]).toBe(`${BASE}/surfaces/3?days=90&location=all`);
    expect(spy.mock.calls[2][0]).toBe(`${BASE}/units/3?days=90`);
  });

  it('getGbpKeywords sends the month only when given', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ keywords: [] }))
      .mockResolvedValueOnce(jsonResponse({ keywords: [] }));
    await getGbpKeywords(3, '2026-09', 'all');
    await getGbpKeywords(3, null, UUID);
    expect(spy.mock.calls[0][0]).toBe(`${BASE}/keywords/3?month=2026-09&location=all`);
    expect(spy.mock.calls[1][0]).toBe(`${BASE}/keywords/3?location=${UUID}`);
  });

  it('getGbpReviews carries the filter and location', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ reviews: [] }));
    await getGbpReviews(3, 'unanswered', 'all');
    expect(spy.mock.calls[0][0]).toBe(`${BASE}/reviews/3?filter=unanswered&location=all`);
  });

  it('getGbpRatingDistribution carries the location', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ counts: {} }));
    await getGbpRatingDistribution(3, UUID);
    expect(spy.mock.calls[0][0]).toBe(`${BASE}/rating-distribution/3?location=${UUID}`);
  });

  it('throws GbpNotConnectedError on 404 not_connected', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ error: 'not_connected' }, 404),
    );
    await expect(getGbpOverview(7, { days: 7 }, 'all')).rejects.toBeInstanceOf(
      GbpNotConnectedError,
    );
  });

  it('maps a 403 feature_disabled body through isGoogleFeatureDisabled', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ error: 'feature_disabled', feature: 'feature_google_business' }, 403),
    );
    const err = await getGbpOverview(7, { days: 7 }, 'all').catch((e) => e);
    expect(isGoogleFeatureDisabled(err)).toBe(true);
  });

  it('does not surface a 500 body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ error: 'select * from secrets exploded' }, 500),
    );
    const err = await getGbpOverview(7, { days: 7 }, 'all').catch((e) => e);
    expect(err.message).toBe('Error 500');
  });
});
