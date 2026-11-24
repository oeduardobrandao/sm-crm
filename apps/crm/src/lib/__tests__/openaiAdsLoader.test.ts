import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedConsent } from '../../test/consent';

const PIXEL_ID = 'WKVtestPixel';

function pixelScripts() {
  return document.head.querySelectorAll('script[src="https://bzrcdn.openai.com/sdk/oaiq.min.js"]');
}

function stubPixelConfig(config: unknown, ok = true) {
  const fetchMock = vi.fn(async () => ({ ok, json: async () => config }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Each queued oaiq call, as the stub stored it. */
function queuedCalls(): unknown[][] {
  return (window.oaiq?.q ?? []) as unknown[][];
}

describe('openaiAdsLoader', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_OPENAI_PIXEL_ID', PIXEL_ID);
    vi.stubEnv('DEV', false);
    localStorage.clear();
    document.head.querySelectorAll('script').forEach((s) => s.remove());
    delete window.oaiq;
    stubPixelConfig({ automatic_advanced_matching_enabled: false });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('injects the SDK once and queues init (no debug), consent and the first page_viewed only', async () => {
    seedConsent({ marketing: true });
    const fetchMock = stubPixelConfig({ automatic_advanced_matching_enabled: false });
    const { loadOpenAiAds } = await import('../openaiAdsLoader');
    loadOpenAiAds();
    loadOpenAiAds();
    await vi.waitFor(() => expect(pixelScripts()).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual([
      `https://bzrcdn.openai.com/pixel-config/v1/${PIXEL_ID}.json`,
      { credentials: 'omit' },
    ]);
    expect(queuedCalls()).toEqual([
      ['init', { pixelId: PIXEL_ID, debug: false }],
      ['consent', true],
      ['measure', 'page_viewed', { type: 'contents' }],
    ]);
  });

  it('does nothing inside the iOS app, even with marketing consent', async () => {
    seedConsent({ marketing: true });
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true, getPlatform: () => 'ios' });
    try {
      const { loadOpenAiAds } = await import('../openaiAdsLoader');
      loadOpenAiAds();
      expect(pixelScripts()).toHaveLength(0);
      expect(window.oaiq).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does nothing when VITE_OPENAI_PIXEL_ID is unset (dev, staging)', async () => {
    vi.stubEnv('VITE_OPENAI_PIXEL_ID', '');
    const { loadOpenAiAds } = await import('../openaiAdsLoader');
    loadOpenAiAds();
    expect(pixelScripts()).toHaveLength(0);
    expect(window.oaiq).toBeUndefined();
  });

  it('loadOpenAiAdsWhenIdle skips the load if marketing was revoked before it fires', async () => {
    vi.useFakeTimers();
    seedConsent({ marketing: true });
    const { loadOpenAiAdsWhenIdle } = await import('../openaiAdsLoader');
    loadOpenAiAdsWhenIdle();
    seedConsent({ marketing: false });
    vi.advanceTimersByTime(5000);
    expect(pixelScripts()).toHaveLength(0);
  });

  it('revokes and clears its cookies when consent was revoked during the download', async () => {
    seedConsent({ marketing: true });
    const { loadOpenAiAds } = await import('../openaiAdsLoader');
    loadOpenAiAds();
    await vi.waitFor(() => expect(pixelScripts()).toHaveLength(1));
    seedConsent({ marketing: false });
    document.cookie = '__oppref=abc; path=/';
    document.cookie = '__obref=def; path=/';
    localStorage.setItem('oaiq_consent', 'true');
    (pixelScripts()[0] as HTMLScriptElement).onload?.(new Event('load'));
    expect(queuedCalls().at(-1)).toEqual(['consent', false]);
    expect(document.cookie).not.toContain('__oppref');
    expect(document.cookie).not.toContain('__obref');
    expect(localStorage.getItem('oaiq_consent')).toBeNull();
  });

  it('sends no event without marketing consent', async () => {
    seedConsent({ marketing: false });
    const { trackOpenAiAdsEvent } = await import('../openaiAdsLoader');
    trackOpenAiAdsEvent({ name: 'registration_completed', data: { type: 'customer_action' } });
    expect(window.oaiq).toBeUndefined();
    expect(pixelScripts()).toHaveLength(0);
  });

  it('loads the pixel before the idle window when an event arrives first', async () => {
    seedConsent({ marketing: true });
    const { trackOpenAiAdsEvent } = await import('../openaiAdsLoader');
    trackOpenAiAdsEvent({
      name: 'subscription_created',
      data: { type: 'plan_enrollment', amount: 9700, currency: 'BRL' },
    });
    await vi.waitFor(() => expect(pixelScripts()).toHaveLength(1));
    expect(queuedCalls().at(-1)).toEqual([
      'measure',
      'subscription_created',
      { type: 'plan_enrollment', amount: 9700, currency: 'BRL' },
    ]);
  });

  // Automatic advanced matching hashes emails/phones anywhere on the page, including the
  // agency's clients in the signed-in CRM: the SDK must never run with it on.
  it.each([
    ['on', { automatic_advanced_matching_enabled: true }, true],
    ['missing', {}, true],
    ['unreachable', null, false],
  ])('never injects the SDK when auto-matching is %s', async (_label, config, ok) => {
    seedConsent({ marketing: true });
    const fetchMock = stubPixelConfig(config, ok);
    const { loadOpenAiAds, trackOpenAiAdsEvent } = await import('../openaiAdsLoader');
    loadOpenAiAds();
    await vi.waitFor(() => expect(window.oaiq).toBeUndefined());
    trackOpenAiAdsEvent({ name: 'registration_completed', data: { type: 'customer_action' } });
    expect(pixelScripts()).toHaveLength(0);
    expect(window.oaiq).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-enables the SDK when marketing is granted again after a revoke', async () => {
    seedConsent({ marketing: true });
    const { loadOpenAiAds, disableOpenAiAds } = await import('../openaiAdsLoader');
    loadOpenAiAds();
    await vi.waitFor(() => expect(pixelScripts()).toHaveLength(1));
    disableOpenAiAds();
    expect(queuedCalls().at(-1)).toEqual(['consent', false]);
    loadOpenAiAds();
    expect(queuedCalls().at(-1)).toEqual(['consent', true]);
    expect(pixelScripts()).toHaveLength(1);
  });
});
