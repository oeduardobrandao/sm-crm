import { describe, expect, it, vi } from 'vitest';
import { createNativeAuthStorage } from '../authStorage';

const KEY = 'sb-abc-auth-token';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: vi.fn((k: string) => (data.has(k) ? data.get(k)! : null)),
    setItem: vi.fn((k: string, v: string) => {
      data.set(k, v);
    }),
    removeItem: vi.fn((k: string) => {
      data.delete(k);
    }),
  };
}

function fakeKeychain(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    keychainGet: vi.fn(async ({ key }: { key: string }) => ({ value: data.get(key) ?? null })),
    keychainSet: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      data.set(key, value);
    }),
    keychainRemove: vi.fn(async ({ key }: { key: string }) => {
      data.delete(key);
    }),
  };
}

describe('createNativeAuthStorage', () => {
  it('falls back to localStorage when the plugin is missing', async () => {
    const legacy = memoryStorage({ [KEY]: 'old' });
    const storage = createNativeAuthStorage(() => null, legacy);

    expect(await storage.getItem(KEY)).toBe('old');
    await storage.setItem(KEY, 'new');
    expect(legacy.data.get(KEY)).toBe('new');
    await storage.removeItem(KEY);
    expect(legacy.data.has(KEY)).toBe(false);
  });

  it('falls back to localStorage when getKeychain throws', async () => {
    const legacy = memoryStorage({ [KEY]: 'old' });
    const storage = createNativeAuthStorage(() => {
      throw new Error('bridge gone');
    }, legacy);

    expect(await storage.getItem(KEY)).toBe('old');
    await storage.setItem(KEY, 'new');
    expect(legacy.data.get(KEY)).toBe('new');
  });

  it('migrates an existing localStorage session on first read', async () => {
    const legacy = memoryStorage({ [KEY]: 'session' });
    const keychain = fakeKeychain();
    const storage = createNativeAuthStorage(() => keychain, legacy);

    expect(await storage.getItem(KEY)).toBe('session');
    expect(keychain.data.get(KEY)).toBe('session');
    expect(legacy.getItem(KEY)).toBeNull();
  });

  it("keeps the localStorage copy when the migration's keychainSet rejects", async () => {
    const legacy = memoryStorage({ [KEY]: 'session' });
    const keychain = fakeKeychain();
    keychain.keychainSet.mockRejectedValue(new Error('keychain locked'));
    const storage = createNativeAuthStorage(() => keychain, legacy);

    expect(await storage.getItem(KEY)).toBe('session');
    expect(legacy.data.get(KEY)).toBe('session');
    expect(legacy.removeItem).not.toHaveBeenCalled();
  });

  it('prefers the Keychain over a stale localStorage value', async () => {
    const legacy = memoryStorage({ [KEY]: 'stale' });
    const keychain = fakeKeychain({ [KEY]: 'fresh' });
    const storage = createNativeAuthStorage(() => keychain, legacy);

    expect(await storage.getItem(KEY)).toBe('fresh');
    expect(keychain.keychainSet).not.toHaveBeenCalled();
  });

  it('setItem removes the localStorage copy', async () => {
    const legacy = memoryStorage({ [KEY]: 'old' });
    const keychain = fakeKeychain();
    const storage = createNativeAuthStorage(() => keychain, legacy);

    await storage.setItem(KEY, 'new');
    expect(keychain.data.get(KEY)).toBe('new');
    expect(legacy.data.has(KEY)).toBe(false);
  });

  it('setItem falls back to localStorage when the Keychain rejects', async () => {
    const legacy = memoryStorage();
    const keychain = fakeKeychain();
    keychain.keychainSet.mockRejectedValue(new Error('keychain locked'));
    const storage = createNativeAuthStorage(() => keychain, legacy);

    await expect(storage.setItem(KEY, 'new')).resolves.toBeUndefined();
    expect(legacy.data.get(KEY)).toBe('new');
  });

  it('setItem fallback clears a stale Keychain copy', async () => {
    const legacy = memoryStorage();
    const keychain = fakeKeychain({ [KEY]: 'stale' });
    keychain.keychainSet.mockRejectedValue(new Error('keychain locked'));
    const storage = createNativeAuthStorage(() => keychain, legacy);

    await storage.setItem(KEY, 'new');
    expect(keychain.data.has(KEY)).toBe(false);
    expect(legacy.data.get(KEY)).toBe('new');
    expect(await storage.getItem(KEY)).toBe('new');
  });

  it('setItem resolves when both keychainSet and keychainRemove reject', async () => {
    const legacy = memoryStorage();
    const keychain = fakeKeychain();
    keychain.keychainSet.mockRejectedValue(new Error('keychain locked'));
    keychain.keychainRemove.mockRejectedValue(new Error('keychain locked'));
    const storage = createNativeAuthStorage(() => keychain, legacy);

    await expect(storage.setItem(KEY, 'new')).resolves.toBeUndefined();
    expect(legacy.data.get(KEY)).toBe('new');
  });

  it('removeItem clears both', async () => {
    const legacy = memoryStorage({ [KEY]: 'a' });
    const keychain = fakeKeychain({ [KEY]: 'b' });
    const storage = createNativeAuthStorage(() => keychain, legacy);

    await storage.removeItem(KEY);
    expect(legacy.data.has(KEY)).toBe(false);
    expect(keychain.data.has(KEY)).toBe(false);
  });

  it('removeItem still clears localStorage when keychainRemove rejects', async () => {
    const legacy = memoryStorage({ [KEY]: 'a' });
    const keychain = fakeKeychain({ [KEY]: 'b' });
    keychain.keychainRemove.mockRejectedValue(new Error('keychain locked'));
    const storage = createNativeAuthStorage(() => keychain, legacy);

    await expect(storage.removeItem(KEY)).resolves.toBeUndefined();
    expect(legacy.data.has(KEY)).toBe(false);
  });

  it('getItem resolves null instead of rejecting when keychainGet rejects', async () => {
    const legacy = memoryStorage();
    const keychain = fakeKeychain();
    keychain.keychainGet.mockRejectedValue(new Error('keychain locked'));
    const storage = createNativeAuthStorage(() => keychain, legacy);

    await expect(storage.getItem(KEY)).resolves.toBeNull();
  });

  it('never rejects when localStorage itself throws', async () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const storage = createNativeAuthStorage(() => null, throwing);

    await expect(storage.getItem(KEY)).resolves.toBeNull();
    await expect(storage.setItem(KEY, 'v')).resolves.toBeUndefined();
    await expect(storage.removeItem(KEY)).resolves.toBeUndefined();
  });
});
