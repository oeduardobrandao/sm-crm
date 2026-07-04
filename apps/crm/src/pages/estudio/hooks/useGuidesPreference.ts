// T7.5 — persists the IG safe-zone guides toggle (design §6.6) across sessions, keyed by user id
// so two people sharing a browser profile don't inherit each other's preference. Storage contract
// (plan §15 acceptance 21): key `estudio_guias_{user.id}`; ABSENT means ON (guides default visible),
// only an explicit "off" hides them.
import { useCallback, useContext, useEffect, useState } from 'react';
import { AuthContext } from '@/context/AuthContext';

const KEY_PREFIX = 'estudio_guias_';

function storageKeyFor(userId: string | null): string | null {
  return userId ? `${KEY_PREFIX}${userId}` : null;
}

/** Reads the stored preference. Absent/unreadable/anything-but-"off" → true (guides ON). */
function readPreference(key: string | null): boolean {
  if (!key) return true;
  try {
    return localStorage.getItem(key) !== 'off';
  } catch {
    return true;
  }
}

/**
 * `[visible, setVisible]` for the safe-zone guides, backed by user-scoped localStorage.
 *
 * Read via `useContext(AuthContext)` (NOT `useAuth`) so the hook degrades gracefully to an
 * in-memory default when there's no AuthProvider — e.g. the editor's component tests, which mount
 * CanvasStage without one. The user id can also arrive a render late (auth resolving); an effect
 * re-syncs from storage the moment a real key becomes available so a persisted "off" isn't missed.
 */
export function useGuidesPreference(): [boolean, (visible: boolean) => void] {
  const auth = useContext(AuthContext);
  const key = storageKeyFor(auth?.user?.id ?? null);

  const [visible, setVisibleState] = useState<boolean>(() => readPreference(key));

  useEffect(() => {
    if (key) setVisibleState(readPreference(key));
  }, [key]);

  const setVisible = useCallback(
    (next: boolean) => {
      setVisibleState(next);
      if (!key) return;
      try {
        localStorage.setItem(key, next ? 'on' : 'off');
      } catch {
        // Private-mode / quota / disabled storage — the in-memory toggle still works this session.
      }
    },
    [key],
  );

  return [visible, setVisible];
}
