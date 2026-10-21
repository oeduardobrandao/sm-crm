import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CRISP_SESSION_STORAGE_KEY,
  clearCrispSessionCache,
  readCrispSessionCache,
  writeCrispSessionCache,
} from '../crispSession';

describe('crispSession cache', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('round-trips a { userId, token } pair under a single versioned key', () => {
    writeCrispSessionCache('user-1', 'tok-1');
    expect(readCrispSessionCache()).toEqual({ userId: 'user-1', token: 'tok-1' });
    expect(JSON.parse(localStorage.getItem(CRISP_SESSION_STORAGE_KEY) ?? 'null')).toEqual({
      userId: 'user-1',
      token: 'tok-1',
    });
  });

  it('reads null when nothing is cached', () => {
    expect(readCrispSessionCache()).toBeNull();
  });

  it('reads null for malformed or incomplete entries instead of throwing', () => {
    localStorage.setItem(CRISP_SESSION_STORAGE_KEY, '{not json');
    expect(readCrispSessionCache()).toBeNull();
    localStorage.setItem(CRISP_SESSION_STORAGE_KEY, JSON.stringify({ userId: 'user-1' }));
    expect(readCrispSessionCache()).toBeNull();
    localStorage.setItem(CRISP_SESSION_STORAGE_KEY, JSON.stringify({ userId: '', token: 'tok-1' }));
    expect(readCrispSessionCache()).toBeNull();
    localStorage.setItem(CRISP_SESSION_STORAGE_KEY, JSON.stringify({ userId: 'user-1', token: 7 }));
    expect(readCrispSessionCache()).toBeNull();
  });

  it('clear removes the entry', () => {
    writeCrispSessionCache('user-1', 'tok-1');
    clearCrispSessionCache();
    expect(localStorage.getItem(CRISP_SESSION_STORAGE_KEY)).toBeNull();
    expect(readCrispSessionCache()).toBeNull();
  });

  it('never throws when storage is unavailable', () => {
    // Safari private mode / blocked storage: every Storage call throws.
    // vi.restoreAllMocks() in test/vitest.setup.ts undoes these spies.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => writeCrispSessionCache('user-1', 'tok-1')).not.toThrow();
    expect(readCrispSessionCache()).toBeNull();
    expect(() => clearCrispSessionCache()).not.toThrow();
  });
});
