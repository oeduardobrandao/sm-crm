import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: 'jwt-1' } } }) },
  },
}));

import { _resetPausaEnderecos, buscarEnderecos } from '../geoAutocomplete';

const fetchMock = vi.fn();

beforeEach(() => {
  _resetPausaEnderecos();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const ok = (sugestoes: unknown) =>
  Promise.resolve(new Response(JSON.stringify({ sugestoes }), { status: 200 }));

describe('buscarEnderecos', () => {
  it('calls the function with the session JWT and returns its suggestions', async () => {
    fetchMock.mockReturnValue(ok([{ rotulo: 'A', linha1: 'A', linha2: '' }]));
    const out = await buscarEnderecos('  av paulista ');
    expect(out).toEqual([{ rotulo: 'A', linha1: 'A', linha2: '' }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/functions\/v1\/geo-autocomplete\?q=av\+paulista$/);
    expect(init.headers.Authorization).toBe('Bearer jwt-1');
  });

  it('skips the call below 3 or above 200 characters', async () => {
    expect(await buscarEnderecos('ab')).toEqual([]);
    expect(await buscarEnderecos('x'.repeat(201))).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pauses for 10 minutes after a 503, then calls again', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(new Response('{}', { status: 503 }));
    await expect(buscarEnderecos('paulista')).rejects.toThrow('503');
    expect(await buscarEnderecos('paulista 2')).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10 * 60_000 + 1);
    fetchMock.mockReturnValue(ok([]));
    await buscarEnderecos('paulista 3');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('pauses for a minute after a 429', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(new Response('{}', { status: 429 }));
    await expect(buscarEnderecos('paulista')).rejects.toThrow('429');
    expect(await buscarEnderecos('paulista 2')).toEqual([]);
    vi.advanceTimersByTime(60_001);
    fetchMock.mockReturnValue(ok([]));
    await buscarEnderecos('paulista 3');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
