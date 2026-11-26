import i18n from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { seedConsent } from '../../test/consent';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn() }) }));

function setGpc(value: boolean | undefined): void {
  Object.defineProperty(navigator, 'globalPrivacyControl', { value, configurable: true });
}

async function load() {
  const consent = await import('../consent');
  const us = await import('../usConsentDefault');
  return { ...consent, ...us };
}

describe('applyUsConsentDefault', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    // main.tsx passes window.location.pathname; reads follow the same path.
    window.history.replaceState(null, '', '/en');
  });
  afterEach(() => {
    window.history.replaceState(null, '', '/');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setGpc(undefined);
    localStorage.clear();
  });

  it('saves the US opt-out default on an /en page with no record', async () => {
    const { applyUsConsentDefault, getConsent, CONSENT_STORAGE_KEY } = await load();
    applyUsConsentDefault('/en');
    expect(getConsent()).toMatchObject({
      analytics: true,
      support: true,
      marketing: true,
      basis: 'us_default',
    });
    expect(JSON.parse(localStorage.getItem(CONSENT_STORAGE_KEY) ?? 'null')).toMatchObject({
      marketing: true,
      basis: 'us_default',
    });
  });

  it('also covers /en sub-pages', async () => {
    const { applyUsConsentDefault, getConsent } = await load();
    applyUsConsentDefault('/en/pricing');
    expect(getConsent()?.basis).toBe('us_default');
  });

  it('saves advertising off when the browser sends GPC', async () => {
    setGpc(true);
    const { applyUsConsentDefault, CONSENT_STORAGE_KEY } = await load();
    applyUsConsentDefault('/en');
    expect(JSON.parse(localStorage.getItem(CONSENT_STORAGE_KEY) ?? 'null')).toMatchObject({
      analytics: true,
      support: true,
      marketing: false,
      basis: 'us_default',
    });
  });

  it('saves nothing on a Brazilian page', async () => {
    window.history.replaceState(null, '', '/');
    const { applyUsConsentDefault, getConsent, CONSENT_STORAGE_KEY } = await load();
    applyUsConsentDefault('/');
    applyUsConsentDefault('/english');
    expect(getConsent()).toBeNull();
    expect(localStorage.getItem(CONSENT_STORAGE_KEY)).toBeNull();
  });

  it('leaves an existing decision alone', async () => {
    seedConsent({ analytics: false, support: false, marketing: false });
    const { applyUsConsentDefault, getConsent } = await load();
    applyUsConsentDefault('/en');
    expect(getConsent()).toMatchObject({
      analytics: false,
      support: false,
      marketing: false,
      basis: 'choice',
    });
  });

  it('keeps the default in memory when storage writes throw', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const { applyUsConsentDefault, getConsent } = await load();
    applyUsConsentDefault('/en');
    expect(getConsent()).toMatchObject({
      analytics: true,
      support: true,
      marketing: true,
      basis: 'us_default',
    });
  });

  it('never applies inside the iOS app (no ad tags there)', async () => {
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true, getPlatform: () => 'ios' });
    const { applyUsConsentDefault, getConsent } = await load();
    applyUsConsentDefault('/en');
    expect(getConsent()).toBeNull();
  });
});

describe('doNotSellOrShare', () => {
  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    vi.mocked(toast.success).mockClear();
    window.history.replaceState(null, '', '/en');
    await i18n.changeLanguage('en');
  });
  afterEach(async () => {
    window.history.replaceState(null, '', '/');
    localStorage.clear();
    await i18n.changeLanguage('pt');
  });

  it('turns advertising off keeping the US default basis, the rest, and confirms', async () => {
    const { applyUsConsentDefault, doNotSellOrShare, getConsent } = await load();
    applyUsConsentDefault('/en');
    doNotSellOrShare();
    expect(getConsent()).toMatchObject({
      analytics: true,
      support: true,
      marketing: false,
      basis: 'us_default',
    });
    expect(toast.success).toHaveBeenCalledWith(
      "Done. We won't sell or share your personal information for advertising.",
    );
  });

  it('a us_default record stays /en-only: on a Brazilian path it still reads undecided', async () => {
    const { applyUsConsentDefault, doNotSellOrShare, getConsent } = await load();
    applyUsConsentDefault('/en');
    doNotSellOrShare();
    window.history.replaceState(null, '', '/precos');
    expect(getConsent()).toBeNull();
  });

  it('an existing choice record stays a choice', async () => {
    seedConsent({ analytics: false, support: true, marketing: true });
    const { doNotSellOrShare, getConsent } = await load();
    doNotSellOrShare();
    expect(getConsent()).toMatchObject({ marketing: false, basis: 'choice' });
  });

  it('keeps analytics and support as the visitor had them', async () => {
    seedConsent({ analytics: false, support: true, marketing: true });
    const { doNotSellOrShare, getConsent } = await load();
    doNotSellOrShare();
    expect(getConsent()).toMatchObject({ analytics: false, support: true, marketing: false });
  });

  it('with no record at all, writes advertising off and the US default for the rest', async () => {
    const { doNotSellOrShare, getConsent } = await load();
    doNotSellOrShare();
    expect(getConsent()).toMatchObject({
      analytics: true,
      support: true,
      marketing: false,
      basis: 'us_default',
    });
  });
});
