import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase');

import * as supabaseModule from '../../lib/supabase';
import {
  disconnectYouTube,
  getGoogleAuthUrl,
  getGoogleSummary,
  GoogleServiceError,
  linkGbpLocations,
  listGbpLocationOptions,
} from '../google';

type MockedSupabaseModule = typeof supabaseModule & {
  __resetSupabaseMock: () => void;
};

const mockedSupabase = supabaseModule as MockedSupabaseModule;

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status < 400,
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

describe('google service', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
    vi.restoreAllMocks();
  });

  it('GETs /auth/:clientId with the product and returns the url', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ url: 'https://accounts.google.com/o/oauth2?x=1' }));

    const url = await getGoogleAuthUrl(42, 'youtube');

    expect(url).toBe('https://accounts.google.com/o/oauth2?x=1');
    const [calledUrl, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toContain('/functions/v1/google-integration/auth/42?product=youtube');
    expect(init.method).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Bearer /);
  });

  it('passes the gbp product through', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ url: 'https://x' }));
    await getGoogleAuthUrl(7, 'gbp');
    expect(fetchSpy.mock.calls[0][0] as string).toContain('/auth/7?product=gbp');
  });

  it('GETs /summary/:clientId', async () => {
    const summary = { youtube: null, gmn: { locations: [], connections: [] } };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(summary));

    await expect(getGoogleSummary(5)).resolves.toEqual(summary);
    expect(fetchSpy.mock.calls[0][0] as string).toContain('/google-integration/summary/5');
  });

  it('GETs /locations/:clientId with the connection and unwraps options', async () => {
    const options = [{ locationName: 'locations/1', eligible: true }];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ options }));

    await expect(listGbpLocationOptions(5, 'conn-1')).resolves.toEqual(options);
    expect(fetchSpy.mock.calls[0][0] as string).toContain(
      '/google-integration/locations/5?connection=conn-1',
    );
  });

  it('POSTs the selection to /locations/:clientId and returns the linked count', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ linked: 2 }));

    await expect(linkGbpLocations(5, 'conn-1', ['locations/1', 'locations/2'])).resolves.toBe(2);

    const [calledUrl, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toContain('/google-integration/locations/5');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      connectionId: 'conn-1',
      locationNames: ['locations/1', 'locations/2'],
    });
  });

  it('POSTs to /disconnect/youtube/:clientId', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await expect(disconnectYouTube(9)).resolves.toBeUndefined();

    const [calledUrl, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toContain('/google-integration/disconnect/youtube/9');
    expect(init.method).toBe('POST');
  });

  it('rejects a 409 gmn_not_approved with a typed GoogleServiceError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ error: 'gmn_not_approved' }, 409),
    );

    const err = await listGbpLocationOptions(5, 'c').catch((e) => e);
    expect(err).toBeInstanceOf(GoogleServiceError);
    expect(err.code).toBe('gmn_not_approved');
  });

  it.each(['feature_disabled', 'reconnect', 'location_unavailable', 'rate_limited'])(
    'maps the %s body error to its code',
    async (code) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ error: code }, 403));
      const err = await getGoogleAuthUrl(1, 'gbp').catch((e) => e);
      expect(err).toBeInstanceOf(GoogleServiceError);
      expect(err.code).toBe(code);
    },
  );

  it('maps an unrecognised body error to unknown', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ error: 'invalid_product' }, 400),
    );
    const err = await getGoogleAuthUrl(1, 'youtube').catch((e) => e);
    expect(err).toBeInstanceOf(GoogleServiceError);
    expect(err.code).toBe('unknown');
  });

  it('maps a non-JSON error body to unknown', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(invalidJsonResponse(502));
    const err = await getGoogleSummary(1).catch((e) => e);
    expect(err).toBeInstanceOf(GoogleServiceError);
    expect(err.code).toBe('unknown');
  });
});
