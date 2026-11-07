import type { MesaasNativePlugin } from './mesaasNative';

// Supabase auth storage for the iOS app: the session lives in the Keychain
// (apps/mobile PLAN.md D2) instead of the WKWebView's localStorage, which iOS may
// purge. Two hard rules, because a rejection or a lost value signs the user out:
//
// - No method ever rejects. Any Keychain failure falls back to `legacy`.
// - An older app binary without the MesaasNative plugin (a web deploy reaches
//   installed apps before an App Store update) makes `getKeychain()` return null,
//   and every call then goes to `legacy`, exactly like the web.
//
// A session already in localStorage (signed in before the Keychain build) moves
// into the Keychain on the first read; the localStorage copy is removed only after
// the Keychain write succeeded.

type Keychain = Pick<MesaasNativePlugin, 'keychainGet' | 'keychainSet' | 'keychainRemove'>;
type LegacyStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface NativeAuthStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export function createNativeAuthStorage(
  getKeychain: () => Keychain | null,
  legacy: LegacyStorage,
): NativeAuthStorage {
  // `failed` is a throw from getKeychain (bridge broken right now), as opposed to null
  // (web, or an older binary without the plugin, where nothing can be in the Keychain).
  const resolveKeychain = (): { kc: Keychain | null; failed: boolean } => {
    try {
      return { kc: getKeychain(), failed: false };
    } catch {
      return { kc: null, failed: true };
    }
  };

  const legacyGet = (key: string): string | null => {
    try {
      return legacy.getItem(key);
    } catch {
      return null;
    }
  };
  const legacySet = (key: string, value: string): void => {
    try {
      legacy.setItem(key, value);
    } catch {
      // Storage blocked or full: nothing left to try.
    }
  };
  const legacyRemove = (key: string): void => {
    try {
      legacy.removeItem(key);
    } catch {
      // Storage blocked: nothing to remove.
    }
  };

  // Logout tombstone: when the Keychain copy could not be deleted, a marker in
  // localStorage makes getItem ignore the Keychain until the delete succeeds, so a
  // signed-out session (maybe another user's) never comes back on the next launch.
  const tombstoneKey = (key: string) => `mesaas.authTombstone:${key}`;
  const hasTombstone = (key: string) => legacyGet(tombstoneKey(key)) !== null;
  const setTombstone = (key: string) => legacySet(tombstoneKey(key), '1');
  const clearTombstone = (key: string) => legacyRemove(tombstoneKey(key));

  /** Deletes the Keychain copy; on failure leaves (or keeps) the tombstone. */
  const removeFromKeychain = async (kc: Keychain, key: string): Promise<void> => {
    try {
      await kc.keychainRemove({ key });
      clearTombstone(key);
    } catch {
      setTombstone(key);
    }
  };

  return {
    async getItem(key) {
      const { kc } = resolveKeychain();
      if (!kc) return legacyGet(key);

      if (hasTombstone(key)) {
        // Never return or migrate the Keychain value. A localStorage value here can
        // only be a session setItem wrote after the Keychain failed.
        await removeFromKeychain(kc, key);
        return legacyGet(key);
      }

      let stored: string | null;
      try {
        stored = (await kc.keychainGet({ key }))?.value ?? null;
      } catch {
        // Keychain unreadable right now: an unmigrated localStorage copy is still
        // better than reporting "signed out".
        return legacyGet(key);
      }
      if (stored !== null) return stored;

      const old = legacyGet(key);
      if (old === null) return null;
      try {
        await kc.keychainSet({ key, value: old });
        legacyRemove(key);
      } catch {
        // Keep the localStorage copy; the next read retries the move.
      }
      return old;
    },

    async setItem(key, value) {
      const { kc, failed } = resolveKeychain();
      if (!kc) {
        legacySet(key, value);
        // A broken bridge may have left an older session in the Keychain.
        if (failed) setTombstone(key);
        else clearTombstone(key);
        return;
      }
      try {
        await kc.keychainSet({ key, value });
        legacyRemove(key);
        clearTombstone(key);
      } catch {
        legacySet(key, value);
        // getItem prefers the Keychain, so an older value left there (a rotated
        // refresh token, or the previous user's session) would shadow this one.
        await removeFromKeychain(kc, key);
      }
    },

    async removeItem(key) {
      legacyRemove(key);
      const { kc, failed } = resolveKeychain();
      if (!kc) {
        if (failed) setTombstone(key);
        return;
      }
      await removeFromKeychain(kc, key);
    },
  };
}
