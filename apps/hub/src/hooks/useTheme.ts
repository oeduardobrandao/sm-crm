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
  const [theme, setTheme] = useState<Theme>(() => {
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
    } catch { /* storage unavailable */ }
  }, [theme]);

  function toggleTheme() {
    setTheme(t => t === 'light' ? 'dark' : 'light');
  }

  return { theme, toggleTheme };
}
