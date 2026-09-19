import { afterEach, describe, expect, it } from 'vitest';
import { CRISP_SESSION_STORAGE_KEY } from '../crispSession';
import { purgeAnalyticsStorage, purgeSupportStorage } from '../legacyStorage';

function cookieNames(): string[] {
  return document.cookie
    .split(';')
    .map((c) => c.split('=')[0].trim())
    .filter(Boolean);
}

describe('legacy storage purge', () => {
  afterEach(() => {
    localStorage.clear();
    for (const name of cookieNames()) document.cookie = `${name}=; Max-Age=0; path=/`;
  });

  it('removes PostHog ph_ keys and cookies but leaves the opt-out flag and unrelated keys', () => {
    localStorage.setItem('ph_phc_test_posthog', '{"distinct_id":"x"}');
    localStorage.setItem('__ph_opt_in_out_phc_test', '0');
    localStorage.setItem('theme', 'dark');
    document.cookie = 'ph_phc_test_posthog=abc; path=/';
    document.cookie = 'session_hint=keep; path=/';

    purgeAnalyticsStorage();

    expect(localStorage.getItem('ph_phc_test_posthog')).toBeNull();
    expect(localStorage.getItem('__ph_opt_in_out_phc_test')).toBe('0');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(cookieNames()).not.toContain('ph_phc_test_posthog');
    expect(cookieNames()).toContain('session_hint');
  });

  it('removes Crisp cookies/keys and the Mesaas-owned crisp session cache', () => {
    localStorage.setItem('crisp-client/session/abc', 'x');
    localStorage.setItem(CRISP_SESSION_STORAGE_KEY, '{"userId":"u","token":"t"}');
    localStorage.setItem('theme', 'dark');
    document.cookie = 'crisp-client%2Fsession%2Fabc=1; path=/';

    purgeSupportStorage();

    expect(localStorage.getItem('crisp-client/session/abc')).toBeNull();
    expect(localStorage.getItem(CRISP_SESSION_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(cookieNames()).not.toContain('crisp-client%2Fsession%2Fabc');
  });

  it('does not throw when storage is unavailable', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('denied');
      },
    });
    try {
      expect(() => purgeAnalyticsStorage()).not.toThrow();
      expect(() => purgeSupportStorage()).not.toThrow();
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });
});
