import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('getStoriesAnalytics', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('builds correct URL with days param', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ stories: [], kpis: { current: {}, previous: null } }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { getStoriesAnalytics } = await import('@/services/analytics');
    await getStoriesAnalytics(123, 60);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/stories/123?days=60'),
      expect.any(Object),
    );
  });

  it('builds correct URL with date range', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ stories: [], kpis: { current: {}, previous: null } }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { getStoriesAnalytics } = await import('@/services/analytics');
    await getStoriesAnalytics(123, undefined, { start: '2026-08-01', end: '2026-08-31' });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/stories/123?start=2026-08-01&end=2026-08-31'),
      expect.any(Object),
    );
  });

  it('returns null on fetch error', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('') });
    vi.stubGlobal('fetch', mockFetch);

    const { getStoriesAnalytics } = await import('@/services/analytics');
    const result = await getStoriesAnalytics(123);
    expect(result).toBeNull();
  });
});
