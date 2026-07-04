import { describe, expect, it, vi, beforeEach } from 'vitest';

const getSession = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: () => getSession() } },
}));

import { generateImage, ImageGenClientError } from '../services/imageGen';

const OK_SESSION = { data: { session: { access_token: 'tok' } } };
const REQ = {
  prompt: 'fundo dourado',
  aspect_ratio: '4:5' as const,
  idempotency_key: 'k1',
};

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(OK_SESSION);
  vi.stubEnv('VITE_SUPABASE_URL', 'https://x.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');
});

describe('generateImage service', () => {
  it('returns the parsed response on 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ file_id: 900, preview_url: 'u', width: 1, height: 1 }), {
          status: 200,
        }),
      ),
    );
    const res = await generateImage(REQ);
    expect(res.file_id).toBe(900);
  });

  it('preserves the §8 envelope as a typed ImageGenClientError (code + retryable + retry_after)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'quota_exhausted',
              message: 'cota atingida',
              retryable: false,
              retry_after: '2026-08-01T00:00:00.000Z',
            },
          }),
          { status: 402 },
        ),
      ),
    );
    await expect(generateImage(REQ)).rejects.toMatchObject({
      code: 'quota_exhausted',
      retryable: false,
      retryAfter: '2026-08-01T00:00:00.000Z',
    });
  });

  it('a network failure throws a retryable provider_error (no spend reached the server)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    const err = await generateImage(REQ).catch((e) => e);
    expect(err).toBeInstanceOf(ImageGenClientError);
    expect(err.code).toBe('provider_error');
    expect(err.retryable).toBe(true);
  });

  it('a bare {error: string} (shape-validation 400) maps to an unknown error', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: 'invalid_prompt' }), { status: 400 }),
        ),
    );
    await expect(generateImage(REQ)).rejects.toMatchObject({ code: 'unknown' });
  });

  it('throws without a session', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    await expect(generateImage(REQ)).rejects.toBeInstanceOf(ImageGenClientError);
  });
});
