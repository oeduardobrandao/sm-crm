import { useCallback, useState } from 'react';
import type { DashboardPlatform } from '../../types';

export const DASHBOARD_SECTION_ID = 'hub-desempenho';

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Which platform the performance section shows; null until the client picks one. */
export function useDashboardPlatform() {
  const [platform, setPlatform] = useState<DashboardPlatform | null>(null);

  const openPlatform = useCallback((p: DashboardPlatform) => {
    setPlatform(p);
    document.getElementById(DASHBOARD_SECTION_ID)?.scrollIntoView?.({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start',
    });
  }, []);

  return { platform, setPlatform, openPlatform };
}
