import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase');

import * as supabaseModule from '../../lib/supabase';
import {
  disconnectInstagram,
  getInstagramAuthUrl,
  getInstagramPosts,
  getInstagramSummary,
  syncInstagramData,
} from '../instagram';

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

describe('instagram service', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the auth url from /auth/:clientId', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ url: 'https://meta.example/authorize?x=1' }),
    );

    const url = await getInstagramAuthUrl(42);

    expect(url).toBe('https://meta.example/authorize?x=1');
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/instagram-integration/auth/42');
  });

  it('throws the server-provided message when the auth endpoint fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ message: 'Conta não encontrada' }, { status: 404, ok: false }),
    );

    await expect(getInstagramAuthUrl(7)).rejects.toThrow('Conta não encontrada');
  });

  it('falls back to a generic message when the error body is not valid JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(invalidJsonResponse());
    await expect(getInstagramAuthUrl(7)).rejects.toThrow('Error generating auth url');
  });

  it('disconnects via POST and invalidates the cached summary for that client', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ seeded: true })) // summary fetch
      .mockResolvedValueOnce(jsonResponse({ ok: true })) // disconnect POST
      .mockResolvedValueOnce(jsonResponse({ refetched: true })); // summary re-fetch

    const first = await getInstagramSummary(9);
    expect(first).toEqual({ seeded: true });

    await disconnectInstagram(9);

    const postCall = fetchSpy.mock.calls[1];
    expect(postCall[0]).toContain('/disconnect/9');
    expect((postCall[1] as RequestInit).method).toBe('POST');

    const refetched = await getInstagramSummary(9);
    expect(refetched).toEqual({ refetched: true });
  });

  it('maps TOKEN_EXPIRED on sync to a typed error for callers to catch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ code: 'TOKEN_EXPIRED', message: 'Expirado' }, { status: 401, ok: false }),
    );

    await expect(syncInstagramData(3)).rejects.toThrow('TOKEN_EXPIRED');
  });

  it('returns null from getInstagramSummary when the backend reports exists:false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ exists: false }),
    );
    const result = await getInstagramSummary(1);
    expect(result).toBeNull();
  });

  it('serves getInstagramSummary from cache on the second call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ followers: 100 }),
    );

    const first = await getInstagramSummary(100);
    const second = await getInstagramSummary(100);

    expect(first).toEqual({ followers: 100 });
    expect(second).toEqual({ followers: 100 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('keys the posts cache by page so pages 1 and 2 each hit the network once', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ page: 1, posts: [] }))
      .mockResolvedValueOnce(jsonResponse({ page: 2, posts: [] }));

    await getInstagramPosts(5, 1);
    await getInstagramPosts(5, 1); // cache hit
    await getInstagramPosts(5, 2); // different page -> refetch

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toContain('page=1');
    expect(fetchSpy.mock.calls[1][0]).toContain('page=2');
  });

  it('sends the Supabase bearer token and anon apikey on every request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ url: 'x' }),
    );

    await getInstagramAuthUrl(1);

    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-de-teste');
    expect(headers.apikey).toBe('anon-key-for-tests');
    expect(headers['Content-Type']).toBe('application/json');
  });
});
