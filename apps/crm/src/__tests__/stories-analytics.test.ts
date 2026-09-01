import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: { access_token: 'test-token' } } }),
    },
  },
  getCurrentProfile: vi.fn(),
}));

vi.mock('../lib/ig-rates', () => ({
  computeRates: vi.fn(),
  scorePost: vi.fn(),
  buildRateDistributions: vi.fn(),
  buildBaseline: vi.fn(),
  postRateSortValue: vi.fn(),
}));

function mockFetchOk(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(body),
  });
}

describe('getStoriesAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds correct URL with days param', async () => {
    const spy = mockFetchOk({ stories: [], kpis: { current: {}, previous: null } });
    vi.stubGlobal('fetch', spy);

    const { getStoriesAnalytics } = await import('../services/analytics');
    await getStoriesAnalytics(123, 60);

    expect(spy).toHaveBeenCalledOnce();
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain('/stories/123');
    expect(url).toContain('days=60');
  });

  it('builds correct URL with date range', async () => {
    const spy = mockFetchOk({ stories: [], kpis: { current: {}, previous: null } });
    vi.stubGlobal('fetch', spy);

    const { getStoriesAnalytics } = await import('../services/analytics');
    await getStoriesAnalytics(123, undefined, { start: '2026-08-01', end: '2026-08-31' });

    expect(spy).toHaveBeenCalledOnce();
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain('/stories/123');
    expect(url).toContain('start=2026-08-01');
    expect(url).toContain('end=2026-08-31');
  });

  it('returns null on fetch error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: () => Promise.resolve(''),
    }));

    const { getStoriesAnalytics } = await import('../services/analytics');
    const result = await getStoriesAnalytics(123);
    expect(result).toBeNull();
  });
});
