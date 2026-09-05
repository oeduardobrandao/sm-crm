import { useEffect } from 'react';
import { prefetchBuildAssets } from '@mesaas/app-lifecycle';
import { useAuth } from '@/context/AuthContext';

/**
 * Warms the HTTP cache with every chunk of the running build once the user is signed in, so a
 * tab that outlives the next deploy still finds its lazy routes locally. Signed-out visitors
 * (landing, pricing, blog) never pay for it.
 */
export function BuildPrefetch() {
  const { user } = useAuth();
  const signedIn = user !== null;

  useEffect(() => {
    if (!signedIn) return;
    return prefetchBuildAssets({ manifestUrl: '/build-manifest.json' });
  }, [signedIn]);

  return null;
}
