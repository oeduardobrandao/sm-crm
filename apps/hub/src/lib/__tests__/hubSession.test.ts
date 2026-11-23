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
