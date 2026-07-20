import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase');

import * as supabaseModule from '../../lib/supabase';
import {
  disconnectTikTok,
  getTikTokAuthUrl,
  getTikTokPosts,
  getTikTokSummary,
  refreshTikTokToken,
  syncTikTokData,
} from '../tiktok';

type MockedSupabaseModule = typeof supabaseModule & {
  __resetSupabaseMock: () => void;
};

const mockedSupabase = supabaseModule as MockedSupabaseModule;

function jsonResponse(body: unknown, init: { status?: number; ok?: boolean } = {}) {
  const status = init.status ?? 200;
  return {
    ok: init.ok ?? status < 400,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

function invalidJsonResponse(status = 500) {
  return {
    ok: false,
    status,
    json: () => Promise.reject(new Error('bad json')),
  } as Response;
}

describe('tiktok service', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── URL construction per endpoint ─────────────────────────────────

  it('returns the auth url from /auth/:clientId', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ url: 'https://tiktok.example/authorize?x=1' }));

    const url = await getTikTokAuthUrl(42);

    expect(url).toBe('https://tiktok.example/authorize?x=1');
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/tiktok-integration/auth/42');
  });

  it('POSTs to /sync/:clientId', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ ok: true, synced_posts: 3, refreshed_posts: 12 }));

    await syncTikTokData(9);

    expect(fetchSpy.mock.calls[0][0]).toContain('/tiktok-integration/sync/9');
    expect((fetchSpy.mock.calls[0][1] as RequestInit).method).toBe('POST');
  });

  it('POSTs to /refresh/:clientId', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await refreshTikTokToken(9);

    expect(fetchSpy.mock.calls[0][0]).toContain('/tiktok-integration/refresh/9');
    expect((fetchSpy.mock.calls[0][1] as RequestInit).method).toBe('POST');
  });

  it('POSTs to /disconnect/:clientId', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await disconnectTikTok(9);

    expect(fetchSpy.mock.calls[0][0]).toContain('/tiktok-integration/disconnect/9');
    expect((fetchSpy.mock.calls[0][1] as RequestInit).method).toBe('POST');
  });

  it('GETs /summary/:clientId', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        account: { id: 'acct-1', authorization_status: 'active', username: 'u' },
        follower_history: [{ date: '2026-07-15', follower_count: 98 }],
      }),
    );

    const summary = await getTikTokSummary(9);

    expect(fetchSpy.mock.calls[0][0]).toContain('/tiktok-integration/summary/9');
    expect(summary?.account.username).toBe('u');
    expect(summary?.follower_history).toEqual([{ date: '2026-07-15', follower_count: 98 }]);
  });

  it('GETs /posts/:clientId with page query param', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ posts: [{ id: 'p1' }], total: 1 }));

    const result = await getTikTokPosts(9, 2);

    expect(fetchSpy.mock.calls[0][0]).toContain('/tiktok-integration/posts/9');
    expect(fetchSpy.mock.calls[0][0]).toContain('page=2');
    expect(result).toEqual({ posts: [{ id: 'p1' }], total: 1 });
  });

  it('defaults getTikTokPosts to page 1', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ posts: [], total: 0 }));

    await getTikTokPosts(9);

    expect(fetchSpy.mock.calls[0][0]).toContain('page=1');
  });

  // ─── Error handling ─────────────────────────────────────────────────

  it('throws the server-provided message when the auth endpoint fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ message: 'Conta não encontrada' }, { status: 404, ok: false }),
    );

    await expect(getTikTokAuthUrl(7)).rejects.toThrow('Conta não encontrada');
  });

  it('falls back to a generic message when the error body is not valid JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(invalidJsonResponse());
    await expect(getTikTokAuthUrl(7)).rejects.toThrow('Error generating auth url');
  });

  it('maps TOKEN_EXPIRED on sync to a typed error for callers to catch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ code: 'TOKEN_EXPIRED', message: 'Expirado' }, { status: 401, ok: false }),
    );

    await expect(syncTikTokData(3)).rejects.toThrow('TOKEN_EXPIRED');
  });

  it('maps TOKEN_EXPIRED on refresh to a typed error for callers to catch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(
        { error: true, code: 'TOKEN_EXPIRED', message: 'Token expirado — necessário reconectar' },
        { status: 401, ok: false },
      ),
    );

    await expect(refreshTikTokToken(3)).rejects.toThrow('TOKEN_EXPIRED');
  });

  it('returns null from getTikTokSummary when the backend reports exists:false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ exists: false }));
    const result = await getTikTokSummary(1);
    expect(result).toBeNull();
  });

  // ─── The 3-field sync response shape (review fix: refreshed_posts added) ─────

  it('resolves the 3-field { ok, synced_posts, refreshed_posts } shape from sync', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ ok: true, synced_posts: 5, refreshed_posts: 23 }),
    );

    const result = await syncTikTokData(3);

    expect(result).toEqual({ ok: true, synced_posts: 5, refreshed_posts: 23 });
  });

  // ─── Caching ──────────────────────────────────────────────────────────

  it('serves getTikTokSummary from cache within the 5-min TTL (second call = no second fetch)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        account: { id: 'acct-1', authorization_status: 'active', follower_count: 100 },
        follower_history: [],
      }),
    );

    const first = await getTikTokSummary(100);
    const second = await getTikTokSummary(100);

    expect(first).toEqual(second);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('keys the posts cache by page so pages 1 and 2 each hit the network once', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ posts: [], total: 0 }))
      .mockResolvedValueOnce(jsonResponse({ posts: [], total: 0 }));

    await getTikTokPosts(5, 1);
    await getTikTokPosts(5, 1); // cache hit
    await getTikTokPosts(5, 2); // different page -> refetch

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toContain('page=1');
    expect(fetchSpy.mock.calls[1][0]).toContain('page=2');
  });

  it('busts the summary/posts cache for that client after syncTikTokData', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ account: { id: 'acct-1' }, follower_history: [] })) // summary fetch
      .mockResolvedValueOnce(jsonResponse({ ok: true, synced_posts: 1, refreshed_posts: 1 })) // sync POST
      .mockResolvedValueOnce(jsonResponse({ account: { id: 'acct-1' }, follower_history: [] })); // summary re-fetch

    await getTikTokSummary(13);
    await syncTikTokData(13);
    await getTikTokSummary(13);

    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('busts the cache for that client after refreshTikTokToken', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ account: { id: 'acct-1' }, follower_history: [] })) // summary fetch
      .mockResolvedValueOnce(jsonResponse({ ok: true })) // refresh POST
      .mockResolvedValueOnce(jsonResponse({ account: { id: 'acct-1' }, follower_history: [] })); // summary re-fetch

    await getTikTokSummary(11);
    await refreshTikTokToken(11);
    await getTikTokSummary(11);

    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('busts the cache for that client after disconnectTikTok', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ account: { id: 'acct-1' }, follower_history: [] })) // summary fetch
      .mockResolvedValueOnce(jsonResponse({ ok: true })) // disconnect POST
      .mockResolvedValueOnce(jsonResponse({ exists: false })); // summary re-fetch (disconnected)

    await getTikTokSummary(12);
    await disconnectTikTok(12);
    const refetched = await getTikTokSummary(12);

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(refetched).toBeNull();
  });

  // ─── Auth headers ───────────────────────────────────────────────────

  it('sends the Supabase bearer token and anon apikey on every request', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ url: 'x' }));

    await getTikTokAuthUrl(1);

    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-de-teste');
    expect(headers.apikey).toBe('anon-key-for-tests');
    expect(headers['Content-Type']).toBe('application/json');
  });
});
