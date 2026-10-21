import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('consent store', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('is undecided (null) until a choice is stored', async () => {
    const { getConsent } = await import('../consent');
    expect(getConsent()).toBeNull();
  });

  it('round-trips a choice under the versioned key', async () => {
    const { getConsent, setConsent, CONSENT_STORAGE_KEY } = await import('../consent');
    setConsent({ analytics: true, support: false });
    expect(getConsent()).toMatchObject({ analytics: true, support: false });
    expect(typeof getConsent()?.decidedAt).toBe('string');
    expect(JSON.parse(localStorage.getItem(CONSENT_STORAGE_KEY) ?? 'null')).toMatchObject({
      analytics: true,
      support: false,
    });
    expect(CONSENT_STORAGE_KEY).toBe('consent_v1');
  });

  it('returns a referentially stable object while the stored value is unchanged', async () => {
    const { getConsent, setConsent } = await import('../consent');
    setConsent({ analytics: true, support: true });
    expect(getConsent()).toBe(getConsent());
  });

  it('treats malformed or wrong-shaped stored values as undecided', async () => {
    const { getConsent, CONSENT_STORAGE_KEY } = await import('../consent');
    localStorage.setItem(CONSENT_STORAGE_KEY, '{not json');
    expect(getConsent()).toBeNull();
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ analytics: 'yes', support: true }));
    expect(getConsent()).toBeNull();
  });

  it('ignores a previous-version key so a category change re-prompts', async () => {
    const { getConsent } = await import('../consent');
    localStorage.setItem(
      'consent_v0',
      JSON.stringify({ analytics: true, support: true, decidedAt: 'x' }),
    );
    expect(getConsent()).toBeNull();
  });

  it('notifies subscribers on set and stops after unsubscribe', async () => {
    const { setConsent, subscribe } = await import('../consent');
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    setConsent({ analytics: true, support: true });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setConsent({ analytics: false, support: false });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers when another tab changes the key (storage event)', async () => {
    const { subscribe, CONSENT_STORAGE_KEY } = await import('../consent');
    const listener = vi.fn();
    subscribe(listener);
    window.dispatchEvent(new StorageEvent('storage', { key: CONSENT_STORAGE_KEY }));
    expect(listener).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps the decision in memory when storage writes throw', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const { getConsent, setConsent } = await import('../consent');
    setConsent({ analytics: true, support: false });
    expect(getConsent()).toMatchObject({ analytics: true, support: false });
  });

  it('openConsentPreferences dispatches the window event with the requested focus', async () => {
    const { openConsentPreferences, OPEN_PREFERENCES_EVENT } = await import('../consent');
    const handler = vi.fn();
    window.addEventListener(OPEN_PREFERENCES_EVENT, handler);
    openConsentPreferences('support');
    window.removeEventListener(OPEN_PREFERENCES_EVENT, handler);
    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0][0] as CustomEvent).detail).toEqual({ focus: 'support' });
  });
});
