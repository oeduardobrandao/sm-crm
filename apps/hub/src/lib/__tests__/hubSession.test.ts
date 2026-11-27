import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HUB_SESSION_STORAGE_KEY,
  clearHubSession,
  getHubSession,
  setHubSession,
} from '../hubSession';

describe('hubSession', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('round-trips the token under the documented key', () => {
    expect(getHubSession()).toBeNull();
    setHubSession('sess-1');
    expect(getHubSession()).toBe('sess-1');
    expect(window.localStorage.getItem(HUB_SESSION_STORAGE_KEY)).toBe('sess-1');
    clearHubSession();
    expect(getHubSession()).toBeNull();
    expect(window.localStorage.getItem(HUB_SESSION_STORAGE_KEY)).toBeNull();
  });

  describe('on a Hub link', () => {
    const A = '/agencia/hub/0123456789abcdef0123456789abcdef';
    const A_HYPHENATED = '/agencia/hub/01234567-89ab-cdef-0123-456789abcdef/postagens';
    const B = '/outra/hub/ffffffffffffffffffffffffffffffff';
    const KEY_A = `${HUB_SESSION_STORAGE_KEY}:01234567-89ab-cdef-0123-456789abcdef`;

    afterEach(() => window.history.replaceState(null, '', '/'));

    it('keeps one entry per link, so a second Hub never reads or clears the first one', () => {
      window.history.replaceState(null, '', A);
      setHubSession('sess-a');
      expect(window.localStorage.getItem(KEY_A)).toBe('sess-a');

      window.history.replaceState(null, '', B);
      expect(getHubSession()).toBeNull();
      clearHubSession();

      window.history.replaceState(null, '', A);
      expect(getHubSession()).toBe('sess-a');
    });

    it('shares the entry between the compact link and the old hyphenated one', () => {
      window.history.replaceState(null, '', A);
      setHubSession('sess-a');
      window.history.replaceState(null, '', A_HYPHENATED);
      expect(getHubSession()).toBe('sess-a');
    });

    it('moves a session stored under the old shared key to the first Hub opened', () => {
      window.localStorage.setItem(HUB_SESSION_STORAGE_KEY, 'legacy');
      window.history.replaceState(null, '', A);
      expect(getHubSession()).toBe('legacy');
      expect(window.localStorage.getItem(KEY_A)).toBe('legacy');
      expect(window.localStorage.getItem(HUB_SESSION_STORAGE_KEY)).toBeNull();

      window.history.replaceState(null, '', B);
      expect(getHubSession()).toBeNull();
    });
  });

  it('reads as null and never throws when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(getHubSession()).toBeNull();
    expect(() => setHubSession('x')).not.toThrow();
    expect(() => clearHubSession()).not.toThrow();
  });
});
