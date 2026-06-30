import { useEffect } from 'react';
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
  useEffect(() => {
    if (!enabled || !ready || !didInit) return;
    doubleRaf(() => {
      const fresh = stripBoundAndTagNew(document); // strip chrome, tag new tiles
      if (fresh > 0) initLiquidGL(); // re-scan binds only the new tiles
      refreshLiquidGL(); // re-raster the snapshot for the new page
    });
  }, [location.pathname, enabled, ready]);
}
