import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedConsent } from '../../test/consent';

const PIXEL_ID = '1234567890';

function pixelScripts() {
  return document.head.querySelectorAll(
    'script[src="https://connect.facebook.net/en_US/fbevents.js"]',
  );
}

/** Each queued fbq call, as the stub stored it. */
function queuedCalls(): unknown[][] {
  return (window.fbq?.queue ?? []) as unknown[][];
}

describe('metaPixelLoader', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_META_PIXEL_ID', PIXEL_ID);
    localStorage.clear();
    document.head.querySelectorAll('script').forEach((s) => s.remove());
    delete window.fbq;
    delete window._fbq;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('injects fbevents.js once and queues consent, init and the first PageView only', async () => {
    const { loadMetaPixel } = await import('../metaPixelLoader');
    loadMetaPixel();
    loadMetaPixel();
    expect(pixelScripts()).toHaveLength(1);
    expect(queuedCalls()).toEqual([
      ['consent', 'grant'],
      ['set', 'autoConfig', false, PIXEL_ID],
      ['init', PIXEL_ID],
      ['track', 'PageView'],
    ]);
    // No automatic PageView per SPA route: signed-in CRM URLs must not reach Meta.
    expect(window.fbq?.disablePushState).toBe(true);
  });

  it('does nothing when VITE_META_PIXEL_ID is unset (dev, staging)', async () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '');
    const { loadMetaPixel } = await import('../metaPixelLoader');
    loadMetaPixel();
    expect(pixelScripts()).toHaveLength(0);
    expect(window.fbq).toBeUndefined();
  });

  it('loadMetaPixelWhenIdle skips the load if marketing was revoked before it fires', async () => {
    vi.useFakeTimers();
    seedConsent({ marketing: true });
    const { loadMetaPixelWhenIdle } = await import('../metaPixelLoader');
    loadMetaPixelWhenIdle();
    seedConsent({ marketing: false });
    vi.advanceTimersByTime(5000);
    expect(pixelScripts()).toHaveLength(0);
  });

  it('revokes and clears _fbp when consent was revoked during the download', async () => {
    seedConsent({ marketing: true });
    const { loadMetaPixel } = await import('../metaPixelLoader');
    loadMetaPixel();
    seedConsent({ marketing: false });
    document.cookie = '_fbp=fb.1.123.456; path=/';
    (pixelScripts()[0] as HTMLScriptElement).onload?.(new Event('load'));
    expect(queuedCalls().at(-1)).toEqual(['consent', 'revoke']);
    expect(document.cookie).not.toContain('_fbp');
  });

  it('sends no event without marketing consent', async () => {
    seedConsent({ marketing: false });
    const { trackMetaEvent } = await import('../metaPixelLoader');
    trackMetaEvent('CompleteRegistration');
    expect(window.fbq).toBeUndefined();
    expect(pixelScripts()).toHaveLength(0);
  });

  it('loads the pixel before the idle window when an event arrives first', async () => {
    seedConsent({ marketing: true });
    const { trackMetaEvent } = await import('../metaPixelLoader');
    trackMetaEvent('Purchase', { value: 97, currency: 'BRL' });
    expect(pixelScripts()).toHaveLength(1);
    expect(queuedCalls().at(-1)).toEqual(['track', 'Purchase', { value: 97, currency: 'BRL' }]);
  });

  it('sends custom events with trackCustom and reports whether they went out', async () => {
    seedConsent({ marketing: true });
    const { trackMetaCustomEvent } = await import('../metaPixelLoader');
    expect(trackMetaCustomEvent('IniciouCadastro', { origem: 'formulario' })).toBe(true);
    expect(pixelScripts()).toHaveLength(1);
    expect(queuedCalls().at(-1)).toEqual([
      'trackCustom',
      'IniciouCadastro',
      { origem: 'formulario' },
    ]);
  });

  it('reports a custom event as not sent without marketing consent', async () => {
    seedConsent({ marketing: false });
    const { trackMetaCustomEvent } = await import('../metaPixelLoader');
    expect(trackMetaCustomEvent('IniciouCadastro')).toBe(false);
    expect(window.fbq).toBeUndefined();
  });
});
