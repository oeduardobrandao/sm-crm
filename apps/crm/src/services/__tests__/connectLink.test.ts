import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { access_token: 'jwt-1' } } })),
    },
  },
}));

const fetchMock = vi.fn();

import {
  createConnectLink,
  getConnectLink,
  getPublicConnectInfo,
  revokeConnectLink,
  startPublicConnect,
} from '../connectLink';

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe('connectLink service', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  test('getConnectLink returns null when there is no live link', async () => {
    fetchMock.mockResolvedValue(ok({ link: null }));
    expect(await getConnectLink(42)).toBeNull();
  });

  test('getConnectLink sends the bearer token', async () => {
    fetchMock.mockResolvedValue(ok({ link: { url: 'u', expires_at: 'e' } }));
    expect(await getConnectLink(42)).toEqual({ url: 'u', expires_at: 'e' });
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-1');
  });

  test('createConnectLink posts the cliente_id', async () => {
    fetchMock.mockResolvedValue(ok({ link: { url: 'u', expires_at: 'e' } }));
    await createConnectLink(42);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ cliente_id: 42 });
  });

  test('revokeConnectLink issues a DELETE with the cliente_id in the query', async () => {
    fetchMock.mockResolvedValue(ok({ ok: true }));
    await revokeConnectLink(42);
    const [url, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('DELETE');
    expect(String(url)).toContain('cliente_id=42');
  });

  test('createConnectLink throws on a non-ok response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'feature_disabled' }),
    } as unknown as Response);
    await expect(createConnectLink(42)).rejects.toThrow('feature_disabled');
  });

  test('getPublicConnectInfo sends no Authorization header', async () => {
    fetchMock.mockResolvedValue(
      ok({ status: 'live', cliente_name: 'X', workspace_name: 'Y', connected_username: null }),
    );
    const info = await getPublicConnectInfo('tok');
    expect(info.status).toBe('live');
    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as Record<string, string>)?.Authorization).toBeUndefined();
  });

  test('getPublicConnectInfo maps a 404 to not_found instead of throwing', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    } as unknown as Response);
    expect((await getPublicConnectInfo('tok')).status).toBe('not_found');
  });

  test('startPublicConnect returns the authorize url', async () => {
    fetchMock.mockResolvedValue(ok({ url: 'https://www.instagram.com/oauth/authorize?x=1' }));
    expect(await startPublicConnect('tok')).toBe('https://www.instagram.com/oauth/authorize?x=1');
  });
});
