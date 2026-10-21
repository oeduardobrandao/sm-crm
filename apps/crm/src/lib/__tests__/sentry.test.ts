import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sentryMock } = vi.hoisted(() => ({
  sentryMock: { init: vi.fn(), browserTracingIntegration: vi.fn(() => ({ name: 'tracing' })) },
}));
vi.mock('@sentry/react', () => sentryMock);

describe('sentry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('no-ops without a DSN', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', '');
    const { initSentry } = await import('../sentry');
    initSentry();
    expect(sentryMock.init).not.toHaveBeenCalled();
  });

  it('initialises without any replay option (replay is not installed)', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://key@example.ingest.sentry.io/1');
    const { initSentry } = await import('../sentry');
    initSentry();
    const options = sentryMock.init.mock.calls[0][0] as Record<string, unknown>;
    expect(options).not.toHaveProperty('replaysOnErrorSampleRate');
    expect(options).not.toHaveProperty('replaysSessionSampleRate');
    expect(options.beforeSend).toBeTypeOf('function');
    expect(options.beforeSendTransaction).toBeTypeOf('function');
  });

  it('replaces the invite token in /conectar/:token URLs', async () => {
    const { scrubInviteToken } = await import('../sentry');
    expect(scrubInviteToken('https://app.mesaas.com.br/conectar/abc123?x=1')).toBe(
      'https://app.mesaas.com.br/conectar/:token?x=1',
    );
    expect(scrubInviteToken('/clientes/5')).toBe('/clientes/5');
  });

  it('scrubs the request url, transaction name and navigation breadcrumbs', async () => {
    const { scrubEvent } = await import('../sentry');
    const event = scrubEvent({
      request: { url: 'https://x.test/conectar/secret-token' },
      transaction: '/conectar/secret-token',
      breadcrumbs: [
        { category: 'navigation', data: { from: '/conectar/secret-token', to: '/login' } },
        { category: 'console', data: undefined },
      ],
      spans: [
        {
          description: 'GET https://x.test/conectar/secret-token',
          data: { 'http.url': 'https://x.test/conectar/secret-token', status: 200 },
        },
      ],
      contexts: { trace: { data: { url: '/conectar/secret-token' } } },
    });
    expect(event.request?.url).toBe('https://x.test/conectar/:token');
    expect(event.transaction).toBe('/conectar/:token');
    expect(event.breadcrumbs?.[0].data).toEqual({ from: '/conectar/:token', to: '/login' });
    expect(event.spans?.[0].description).toBe('GET https://x.test/conectar/:token');
    expect(event.spans?.[0].data).toEqual({
      'http.url': 'https://x.test/conectar/:token',
      status: 200,
    });
    expect(event.contexts?.trace?.data).toEqual({ url: '/conectar/:token' });
  });

  it('replaces the invite token in the instagram-connect-link function URLs', async () => {
    const { scrubInviteToken } = await import('../sentry');
    const base = 'https://x.supabase.co/functions/v1/instagram-connect-link/public';
    expect(scrubInviteToken(`${base}/abc%2Fdef`)).toBe(`${base}/:token`);
    expect(scrubInviteToken(`${base}/abc%2Fdef/start`)).toBe(`${base}/:token/start`);
  });

  it('scrubs the function URL from fetch breadcrumbs and http spans', async () => {
    const { scrubEvent } = await import('../sentry');
    const url = 'https://x.supabase.co/functions/v1/instagram-connect-link/public/abc%2Fdef';
    const scrubbed = 'https://x.supabase.co/functions/v1/instagram-connect-link/public/:token';
    const event = scrubEvent({
      breadcrumbs: [{ category: 'fetch', data: { method: 'GET', url } }],
      spans: [{ description: `GET ${url}`, data: { 'http.url': url } }],
    });
    expect(event.breadcrumbs?.[0].data).toEqual({ method: 'GET', url: scrubbed });
    expect(event.spans?.[0].description).toBe(`GET ${scrubbed}`);
    expect(event.spans?.[0].data).toEqual({ 'http.url': scrubbed });
  });
});
