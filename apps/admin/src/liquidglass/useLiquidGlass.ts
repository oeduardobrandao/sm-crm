import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useLiquidGlassContext } from './LiquidGlassProvider';
import { stripBoundAndTagNew } from './dedupe';
import { doubleRaf } from './scheduleRefresh';
import { initLiquidGL, refreshLiquidGL } from './liquidGLAdapter';

// Module-level so React 19 StrictMode's dev double-invoke can't double-initialize.
let didInit = false;

export function useLiquidGlass(): void {
  const { enabled, ready } = useLiquidGlassContext();
  const location = useLocation();
  const lastPathRef = useRef<string | null>(null);

  // One-time init after vendor scripts are ready.
  useEffect(() => {
    if (!enabled || !ready || didInit) return;
    didInit = true;
    doubleRaf(() => {
      stripBoundAndTagNew(document); // tag every initial pane as bound
      initLiquidGL(); // scan binds them all
    });
  }, [enabled, ready]);

  // Route change: bind any newly-mounted tiles (deduped) and re-snapshot.
  // Guarded so it fires only on an actual pathname change, not on the
  // init-time enabled/ready flip (which shares this effect's deps).
  useEffect(() => {
    if (!enabled || !ready || !didInit) return;
    if (lastPathRef.current === null) {
      lastPathRef.current = location.pathname; // first eligible run = init-time; record, don't refresh
      return;
    }
    if (location.pathname === lastPathRef.current) return;
    lastPathRef.current = location.pathname;
    doubleRaf(() => {
      const fresh = stripBoundAndTagNew(document); // strip chrome, tag new tiles
      if (fresh > 0) initLiquidGL(); // re-scan binds only the new tiles
      refreshLiquidGL(); // re-raster the snapshot for the new page
    });
  }, [location.pathname, enabled, ready]);
}
