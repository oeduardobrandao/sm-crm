import { describe, it, expect } from 'vitest';
import { readEnabled, writeEnabled, LIQUID_GLASS_STORAGE_KEY } from '../storage';

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    _map: map,
  };
}

describe('liquid glass storage', () => {
  it('defaults to enabled when nothing is stored', () => {
    expect(readEnabled(fakeStorage())).toBe(true);
  });

  it('reads a stored false as disabled', () => {
    expect(readEnabled(fakeStorage({ [LIQUID_GLASS_STORAGE_KEY]: 'false' }))).toBe(false);
  });

  it('persists the boolean as a string', () => {
    const s = fakeStorage();
    writeEnabled(s, false);
    expect(s._map.get(LIQUID_GLASS_STORAGE_KEY)).toBe('false');
    writeEnabled(s, true);
    expect(s._map.get(LIQUID_GLASS_STORAGE_KEY)).toBe('true');
  });
});
