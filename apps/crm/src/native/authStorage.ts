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
  const keychain = (): Keychain | null => {
    try {
      return getKeychain();
    } catch {
      return null;
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

  return {
    async getItem(key) {
      const kc = keychain();
      if (!kc) return legacyGet(key);

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
      const kc = keychain();
      if (!kc) {
        legacySet(key, value);
        return;
      }
      try {
        await kc.keychainSet({ key, value });
        legacyRemove(key);
      } catch {
        legacySet(key, value);
        // getItem prefers the Keychain, so an older value left there would shadow
        // this one (a rotated refresh token that no longer works). Best effort.
        try {
          await kc.keychainRemove({ key });
        } catch {
          // Keychain unusable right now.
        }
      }
    },

    async removeItem(key) {
      legacyRemove(key);
      const kc = keychain();
      if (!kc) return;
      try {
        await kc.keychainRemove({ key });
      } catch {
        // Best effort: the localStorage copy is already gone.
      }
    },
  };
}
