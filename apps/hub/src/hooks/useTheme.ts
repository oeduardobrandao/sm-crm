import { useState, useEffect } from 'react';

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'hub-theme';
// Marks that the CLIENT explicitly picked a mode (via the sun/moon toggle), as
// opposed to 'hub-theme' merely holding whatever mode last rendered — which
// includes the default 'light' every first-time visitor auto-persists on mount.
// Without this separate marker, hasStoredPreference below would read that
// auto-persisted default as "the client already chose", and an agency's
// configured dark default would never apply to a single returning visitor.
const EXPLICIT_KEY = 'hub-theme-explicit';

function applyTheme(theme: Theme) {
  const root = document.querySelector('.hub-root');
  if (!root) return;
  if (theme === 'dark') {
    root.setAttribute('data-theme', 'dark');
  } else {
    root.removeAttribute('data-theme');
  }
}

export function useTheme() {
  // Captured once at init, independent of subsequent setTheme/toggleTheme calls —
  // callers use this to tell "the client already explicitly chose a mode" (their
  // choice always wins) apart from "this client has never actively chosen" (safe
  // to (re-)apply an agency default, even if a theme value happens to be stored
  // from a prior auto-persisted render).
  const [hasStoredPreference] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const explicit = localStorage.getItem(EXPLICIT_KEY);
      return explicit === '1' && (stored === 'dark' || stored === 'light');
    } catch {
      return false;
    }
  });

  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);

  // The client's own toggle is always an explicit choice — set the marker so it
  // sticks and is never again overridden by an agency default appearance.
  function toggleTheme() {
    setThemeState((t) => (t === 'light' ? 'dark' : 'light'));
    try {
      localStorage.setItem(EXPLICIT_KEY, '1');
    } catch {
      /* storage unavailable */
    }
  }

  // `explicit` defaults to false: HubShell applying the agency's configured
  // default appearance on a first/non-choosing visit calls plain setTheme(t)
  // and must NOT mark the client as having chosen. Pass { explicit: true } only
  // from a genuine client-initiated action.
  function setTheme(t: Theme, options: { explicit?: boolean } = {}) {
    setThemeState(t);
    if (options.explicit) {
      try {
        localStorage.setItem(EXPLICIT_KEY, '1');
      } catch {
        /* storage unavailable */
      }
    }
  }

  return { theme, toggleTheme, setTheme, hasStoredPreference };
}
