import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedConsent } from '../../test/consent';

const PIXEL_ID = 'WKVtestPixel';

function pixelScripts() {
  return document.head.querySelectorAll('script[src="https://bzrcdn.openai.com/sdk/oaiq.min.js"]');
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
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('injects the SDK once and queues init (no debug), consent and the first page_viewed only', async () => {
    const { loadOpenAiAds } = await import('../openaiAdsLoader');
    loadOpenAiAds();
    loadOpenAiAds();
    expect(pixelScripts()).toHaveLength(1);
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
    expect(pixelScripts()).toHaveLength(1);
    expect(queuedCalls().at(-1)).toEqual([
      'measure',
      'subscription_created',
      { type: 'plan_enrollment', amount: 9700, currency: 'BRL' },
    ]);
  });
});
