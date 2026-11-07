import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isNativeApp } from './platform';
import { isBlockedInNativeApp } from './blockedPaths';

/**
 * Inside the iOS app, sends any path the app never shows (sign-up, pricing, billing,
 * the marketing site) to /dashboard, replacing the history entry.
 *
 * An effect, never a render branch: `/` is prerendered and hydrated, so its first client
 * render must match the server HTML. Never `useBlocker` either (installSilentUpdate owns
 * the one blocker React Router honours).
 */
export function useNativePathGuard(): void {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (isNativeApp() && isBlockedInNativeApp(pathname)) {
      navigate('/dashboard', { replace: true });
    }
  }, [pathname, navigate]);
}
