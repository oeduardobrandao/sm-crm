import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedConsent } from '../../test/consent';

const AW_ID = 'AW-123456789';

function tagScripts() {
  return document.head.querySelectorAll('script[src^="https://www.googletagmanager.com/gtag/js"]');
}

/** Each queued gtag call as a plain array (the stub pushes `arguments` objects). */
function queuedCalls(): unknown[][] {
  return (window.dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>));
}

describe('googleAdsLoader', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_GOOGLE_ADS_ID', AW_ID);
    vi.stubEnv('VITE_META_PIXEL_ID', 'PIXEL');
    localStorage.clear();
    document.head.querySelectorAll('script').forEach((s) => s.remove());
    delete window.dataLayer;
    delete window.gtag;
    delete window.fbq;
    delete window._fbq;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('injects gtag.js once, for the configured ID', async () => {
    const { loadGoogleAds } = await import('../googleAdsLoader');
    loadGoogleAds();
    loadGoogleAds();
    const scripts = tagScripts();
    expect(scripts).toHaveLength(1);
    expect((scripts[0] as HTMLScriptElement).src).toBe(
      `https://www.googletagmanager.com/gtag/js?id=${AW_ID}`,
    );
  });

  it('does nothing when VITE_GOOGLE_ADS_ID is unset (dev, staging)', async () => {
    vi.stubEnv('VITE_GOOGLE_ADS_ID', '');
    const { loadGoogleAds } = await import('../googleAdsLoader');
    loadGoogleAds();
    expect(tagScripts()).toHaveLength(0);
    expect(window.dataLayer).toBeUndefined();
  });

  it('queues Consent Mode default denied, then granted, before config', async () => {
    const { loadGoogleAds } = await import('../googleAdsLoader');
    loadGoogleAds();
    const calls = queuedCalls();
    expect(calls.map((c) => c.slice(0, 2))).toEqual([
      ['consent', 'default'],
      ['consent', 'update'],
      ['js', expect.any(Date)],
      ['config', AW_ID],
    ]);
    expect(calls[0][2]).toMatchObject({ ad_storage: 'denied', ad_user_data: 'denied' });
    expect(calls[1][2]).toMatchObject({ ad_storage: 'granted', ad_personalization: 'granted' });
  });

  it('pushes the arguments object gtag.js expects, not an array', async () => {
    const { loadGoogleAds } = await import('../googleAdsLoader');
    loadGoogleAds();
    expect(Array.isArray(window.dataLayer?.[0])).toBe(false);
  });

  it('loadGoogleAdsWhenIdle skips the load if marketing was revoked before it fires', async () => {
    vi.useFakeTimers();
    seedConsent({ marketing: true });
    const { loadGoogleAdsWhenIdle } = await import('../googleAdsLoader');
    loadGoogleAdsWhenIdle();
    seedConsent({ marketing: false });
    vi.advanceTimersByTime(5000);
    expect(tagScripts()).toHaveLength(0);
  });

  it('retries after gtag.js fails to load', async () => {
    const { loadGoogleAds } = await import('../googleAdsLoader');
    loadGoogleAds();
    (tagScripts()[0] as HTMLScriptElement).onerror?.(new Event('error'));
    expect(tagScripts()).toHaveLength(0);
    loadGoogleAds();
    expect(tagScripts()).toHaveLength(1);
  });

  it('denies again and clears _gcl_ cookies when consent was revoked during the download', async () => {
    seedConsent({ marketing: true });
    const { loadGoogleAds } = await import('../googleAdsLoader');
    loadGoogleAds();
    seedConsent({ marketing: false });
    document.cookie = '_gcl_au=1.1.x; path=/';
    (tagScripts()[0] as HTMLScriptElement).onload?.(new Event('load'));
    expect(queuedCalls().at(-1)).toEqual([
      'consent',
      'update',
      expect.objectContaining({ ad_storage: 'denied' }),
    ]);
    expect(document.cookie).not.toContain('_gcl_au');
  });

  it('sends no conversion without marketing consent', async () => {
    seedConsent({ marketing: false });
    const { trackGoogleAdsConversion } = await import('../googleAdsLoader');
    trackGoogleAdsConversion('signup');
    expect(window.dataLayer).toBeUndefined();
    expect(tagScripts()).toHaveLength(0);
  });

  it('loads the tag before the idle window when a conversion arrives first', async () => {
    seedConsent({ marketing: true });
    const { trackGoogleAdsConversion } = await import('../googleAdsLoader');
    trackGoogleAdsConversion('purchase', { amount: 97, transactionId: 'in_1' });
    expect(tagScripts()).toHaveLength(1);
    expect(queuedCalls().at(-1)).toEqual([
      'event',
      'conversion',
      { send_to: `${AW_ID}/purchase`, value: 97, currency: 'BRL', transaction_id: 'in_1' },
    ]);
  });

  it('reports the purchase with the price remembered at checkout start, once', async () => {
    seedConsent({ marketing: true });
    sessionStorage.clear();
    const { rememberCheckoutValue, reportPurchaseConversion, PURCHASE_CONVERSION_LABEL } =
      await import('../googleAdsLoader');
    rememberCheckoutValue(9990);
    reportPurchaseConversion();
    expect(queuedCalls().at(-1)).toEqual([
      'event',
      'conversion',
      { send_to: `${AW_ID}/${PURCHASE_CONVERSION_LABEL}`, value: 99.9, currency: 'BRL' },
    ]);
    expect(window.fbq?.queue.at(-1)).toEqual([
      'track',
      'Purchase',
      { value: 99.9, currency: 'BRL' },
    ]);
    expect(sessionStorage.length).toBe(0);
    reportPurchaseConversion();
    expect(queuedCalls().at(-1)).toEqual([
      'event',
      'conversion',
      { send_to: `${AW_ID}/${PURCHASE_CONVERSION_LABEL}` },
    ]);
  });
});
