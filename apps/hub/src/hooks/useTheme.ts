import { useState, useEffect } from 'react';

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'hub-theme';

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
  // callers use this to tell "the client already chose a mode" (their choice always
  // wins) apart from "this is the very first visit" (safe to apply an agency default).
  const [hasStoredPreference] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === 'dark' || stored === 'light';
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

  function toggleTheme() {
    setThemeState((t) => (t === 'light' ? 'dark' : 'light'));
  }

  function setTheme(t: Theme) {
    setThemeState(t);
  }

  return { theme, toggleTheme, setTheme, hasStoredPreference };
}
