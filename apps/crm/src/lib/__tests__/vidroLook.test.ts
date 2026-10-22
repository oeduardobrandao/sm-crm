import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LOOK_CACHE_KEY,
  applyVidro,
  clearVidroCache,
  isIntroDue,
  isVidroAttributeSet,
  optOutKey,
  readIntroSeen,
  writeIntroSeen,
  resetVidroLook,
  readOptOut,
  writeOptOut,
} from '../vidroLook';

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-look');
  vi.restoreAllMocks();
});

describe('vidroLook', () => {
  it('scopes the opt-out to the user', () => {
    writeOptOut('u1', true);
    expect(localStorage.getItem(optOutKey('u1'))).toBe('1');
    expect(readOptOut('u1')).toBe(true);
    expect(readOptOut('u2')).toBe(false);
    expect(readOptOut(null)).toBe(false);
    writeOptOut('u1', false);
    expect(localStorage.getItem(optOutKey('u1'))).toBeNull();
  });

  it('writes the attribute and the user-keyed cache together', () => {
    applyVidro(true, 'u1');
    expect(document.documentElement.getAttribute('data-look')).toBe('vidro');
    expect(isVidroAttributeSet()).toBe(true);
    expect(localStorage.getItem(LOOK_CACHE_KEY)).toBe('u1');
    applyVidro(false, 'u1');
    expect(document.documentElement.hasAttribute('data-look')).toBe(false);
    expect(localStorage.getItem(LOOK_CACHE_KEY)).toBeNull();
  });

  it('applies the attribute even when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => applyVidro(true, 'u1')).not.toThrow();
    expect(isVidroAttributeSet()).toBe(true);
  });

  it('does not write the cache without a user', () => {
    applyVidro(true, null);
    expect(isVidroAttributeSet()).toBe(true);
    expect(localStorage.getItem(LOOK_CACHE_KEY)).toBeNull();
  });

  it('clears only the cache', () => {
    applyVidro(true, 'u1');
    clearVidroCache();
    expect(localStorage.getItem(LOOK_CACHE_KEY)).toBeNull();
    expect(isVidroAttributeSet()).toBe(true);
  });

  it('does not remove a foreign data-look value', () => {
    document.documentElement.setAttribute('data-look', 'other');
    applyVidro(false, 'u1');
    expect(document.documentElement.getAttribute('data-look')).toBe('other');
  });

  it('resets the attribute and the cache together (sign-out)', () => {
    applyVidro(true, 'u1');
    resetVidroLook();
    expect(isVidroAttributeSet()).toBe(false);
    expect(localStorage.getItem(LOOK_CACHE_KEY)).toBeNull();
  });

  it('reset keeps a foreign data-look value and survives throwing storage', () => {
    document.documentElement.setAttribute('data-look', 'other');
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => resetVidroLook()).not.toThrow();
    expect(document.documentElement.getAttribute('data-look')).toBe('other');
  });

  it('announces the look once per user, only to accounts older than the launch', () => {
    const old = '2026-03-01T12:00:00Z';
    expect(isIntroDue({ vidroShell: true, userId: 'u1', userCreatedAt: old })).toBe(true);
    expect(isIntroDue({ vidroShell: false, userId: 'u1', userCreatedAt: old })).toBe(false);
    expect(isIntroDue({ vidroShell: true, userId: null, userCreatedAt: old })).toBe(false);
    expect(
      isIntroDue({ vidroShell: true, userId: 'u1', userCreatedAt: '2026-10-30T12:00:00Z' }),
    ).toBe(false);
    expect(isIntroDue({ vidroShell: true, userId: 'u1', userCreatedAt: undefined })).toBe(true);

    writeIntroSeen('u1');
    expect(readIntroSeen('u1')).toBe(true);
    expect(isIntroDue({ vidroShell: true, userId: 'u1', userCreatedAt: old })).toBe(false);
    expect(isIntroDue({ vidroShell: true, userId: 'u2', userCreatedAt: old })).toBe(true);
  });
});
