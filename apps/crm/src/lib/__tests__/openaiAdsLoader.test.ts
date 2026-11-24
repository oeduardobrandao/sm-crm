import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedConsent } from '../../test/consent';

const PIXEL_ID = 'WKVtestPixel';

function frames(): HTMLIFrameElement[] {
  return Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe[src="/oaiq-frame.html"]'));
}

/** Spies on what the parent posts into the frame, then announces the frame as ready. */
function readyFrame(frame: HTMLIFrameElement) {
  const win = frame.contentWindow!;
  const postSpy = vi.spyOn(win, 'postMessage').mockImplementation(() => {});
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { channel: 'mesaas-oaiq', ready: true },
      origin: window.location.origin,
      source: win,
    }),
  );
  const calls = () => postSpy.mock.calls.map(([msg]) => (msg as { call: unknown[] }).call);
  return { postSpy, calls };
}

describe('openaiAdsLoader', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_OPENAI_PIXEL_ID', PIXEL_ID);
    vi.stubEnv('DEV', false);
    localStorage.clear();
    document.body.replaceChildren();
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('runs the SDK only in a hidden same-origin frame, never on the page itself', async () => {
    seedConsent({ marketing: true });
    const { loadOpenAiAds } = await import('../openaiAdsLoader');
    loadOpenAiAds();
    loadOpenAiAds();
    expect(frames()).toHaveLength(1);
    const frame = frames()[0];
    // A signed-in boot must not hand OpenAI `/clientes/123` as the referrer.
    expect(frame.referrerPolicy).toBe('origin');
    expect(frame.getAttribute('aria-hidden')).toBe('true');
    expect(frame.tabIndex).toBe(-1);
    expect(document.querySelector('script[src*="oaiq"]')).toBeNull();
    expect((window as { oaiq?: unknown }).oaiq).toBeUndefined();
  });

  it('queues init (no debug), consent and the first page_viewed until the frame is ready', async () => {
    seedConsent({ marketing: true });
    const { loadOpenAiAds } = await import('../openaiAdsLoader');
    loadOpenAiAds();
    const { postSpy, calls } = readyFrame(frames()[0]);
    expect(calls()).toEqual([
      ['init', { pixelId: PIXEL_ID, debug: false }],
      ['consent', true],
      ['measure', 'page_viewed', { type: 'contents' }],
    ]);
    // Always to our own origin, never '*'.
    expect(postSpy.mock.calls.every(([, origin]) => origin === window.location.origin)).toBe(true);
  });

  it('passes the landing ad click id to init, captured before consent', async () => {
    window.history.replaceState(null, '', '/?oppref=click-123&utm_source=chatgpt');
    const { captureOpenAiClickId, loadOpenAiAds } = await import('../openaiAdsLoader');
    captureOpenAiClickId();
    // The SPA moves on before the visitor accepts the banner.
    window.history.replaceState(null, '', '/criar-conta');
    seedConsent({ marketing: true });
    loadOpenAiAds();
    const { calls } = readyFrame(frames()[0]);
    expect(calls()[0]).toEqual(['init', { pixelId: PIXEL_ID, debug: false, oppref: 'click-123' }]);
  });

  it('ignores ready messages that do not come from its frame', async () => {
    seedConsent({ marketing: true });
    const { loadOpenAiAds } = await import('../openaiAdsLoader');
    loadOpenAiAds();
    const postSpy = vi.spyOn(frames()[0].contentWindow!, 'postMessage');
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { channel: 'mesaas-oaiq', ready: true },
        origin: window.location.origin,
        source: window,
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { channel: 'mesaas-oaiq', ready: true },
        origin: 'https://evil.example',
        source: frames()[0].contentWindow,
      }),
    );
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('does nothing inside the iOS app, even with marketing consent', async () => {
    seedConsent({ marketing: true });
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true, getPlatform: () => 'ios' });
    const { loadOpenAiAds } = await import('../openaiAdsLoader');
    loadOpenAiAds();
    expect(frames()).toHaveLength(0);
  });

  it('does nothing when VITE_OPENAI_PIXEL_ID is unset (dev, staging)', async () => {
    vi.stubEnv('VITE_OPENAI_PIXEL_ID', '');
    const { loadOpenAiAds } = await import('../openaiAdsLoader');
    loadOpenAiAds();
    expect(frames()).toHaveLength(0);
  });

  it('loadOpenAiAdsWhenIdle skips the load if marketing was revoked before it fires', async () => {
    vi.useFakeTimers();
    seedConsent({ marketing: true });
    const { loadOpenAiAdsWhenIdle } = await import('../openaiAdsLoader');
    loadOpenAiAdsWhenIdle();
    seedConsent({ marketing: false });
    vi.advanceTimersByTime(5000);
    expect(frames()).toHaveLength(0);
  });

  it('revokes in the frame and clears the cookies the SDK left on our origin', async () => {
    seedConsent({ marketing: true });
    const { loadOpenAiAds, disableOpenAiAds } = await import('../openaiAdsLoader');
    loadOpenAiAds();
    const { calls } = readyFrame(frames()[0]);
    document.cookie = '__oppref=abc; path=/';
    document.cookie = '__obref=def; path=/';
    localStorage.setItem('oaiq_consent', 'true');
    disableOpenAiAds();
    expect(calls().at(-1)).toEqual(['consent', false]);
    expect(document.cookie).not.toContain('__oppref');
    expect(document.cookie).not.toContain('__obref');
    expect(localStorage.getItem('oaiq_consent')).toBeNull();
  });

  it('re-enables the SDK when marketing is granted again after a revoke', async () => {
    seedConsent({ marketing: true });
    const { loadOpenAiAds, disableOpenAiAds } = await import('../openaiAdsLoader');
    loadOpenAiAds();
    const { calls } = readyFrame(frames()[0]);
    disableOpenAiAds();
    loadOpenAiAds();
    expect(calls().at(-1)).toEqual(['consent', true]);
    expect(frames()).toHaveLength(1);
  });

  it('sends no event without marketing consent', async () => {
    seedConsent({ marketing: false });
    const { trackOpenAiAdsEvent } = await import('../openaiAdsLoader');
    trackOpenAiAdsEvent({ name: 'registration_completed', data: { type: 'customer_action' } });
    expect(frames()).toHaveLength(0);
  });

  it('loads the frame when an event arrives before the idle window, and delivers it', async () => {
    seedConsent({ marketing: true });
    const { trackOpenAiAdsEvent } = await import('../openaiAdsLoader');
    trackOpenAiAdsEvent({
      name: 'subscription_created',
      data: { type: 'plan_enrollment', amount: 9700, currency: 'BRL' },
    });
    expect(frames()).toHaveLength(1);
    const { calls } = readyFrame(frames()[0]);
    expect(calls().at(-1)).toEqual([
      'measure',
      'subscription_created',
      { type: 'plan_enrollment', amount: 9700, currency: 'BRL' },
    ]);
  });
});
