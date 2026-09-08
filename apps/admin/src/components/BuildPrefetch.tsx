import { useEffect } from 'react';
import { prefetchBuildAssets } from '@mesaas/app-lifecycle';
import { useAdminAuth } from '../context/AdminAuthContext';

/** Same idea as the CRM's BuildPrefetch: warm the cache for a confirmed admin only. */
export function BuildPrefetch() {
  const { isAdmin } = useAdminAuth();

  useEffect(() => {
    if (!isAdmin) return;
    return prefetchBuildAssets({ manifestUrl: '/admin/build-manifest.json' });
  }, [isAdmin]);

  return null;
}
