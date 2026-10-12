import { useEffect, useState } from 'react';
import { useLiquidGlassContext } from '../liquidglass/LiquidGlassProvider';

export type AdminTheme = 'light' | 'dark';

/** The Admin's light/dark theme plus the Liquid Glass toggle, shared by both shells. */
export function useAdminTheme() {
  const [theme, setTheme] = useState<AdminTheme>(
    () => (localStorage.getItem('admin-theme') as AdminTheme) || 'dark',
  );
  const { enabled: glassEnabled, toggle: toggleGlass } = useLiquidGlassContext();

  // Apply theme to the DOM. While glass is ON the trial forces dark for the best
  // presentation, but does NOT persist it: the user's saved 'admin-theme' is
  // preserved and restored when glass is turned OFF.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', glassEnabled ? 'dark' : theme);
    if (!glassEnabled) localStorage.setItem('admin-theme', theme);
  }, [theme, glassEnabled]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  return { theme, setTheme, toggleTheme, glassEnabled, toggleGlass };
}
