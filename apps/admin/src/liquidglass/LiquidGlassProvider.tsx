import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { readEnabled, writeEnabled } from './storage';
import { loadVendorScripts } from './loadVendorScripts';

interface LiquidGlassContextValue {
  enabled: boolean;
  ready: boolean; // vendor scripts loaded
  toggle: () => void;
}

const LiquidGlassContext = createContext<LiquidGlassContextValue | null>(null);

export function LiquidGlassProvider({ children }: { children: ReactNode }) {
  // Fixed for the session: toggling reloads the page (the library has no teardown).
  const [enabled] = useState(() => readEnabled(window.localStorage));
  const [ready, setReady] = useState(false);

  // Expose the on/off state to CSS (glass-off fallback + dark-only-when-on).
  useEffect(() => {
    document.documentElement.dataset.liquidGlass = enabled ? 'on' : 'off';
  }, [enabled]);

  // Lazy-load vendor scripts only when enabled (zero cost before first activation).
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    loadVendorScripts()
      .then(() => {
        if (active) setReady(true);
      })
      .catch((err) => console.error('[liquidGL] vendor load failed', err));
    return () => {
      active = false;
    };
  }, [enabled]);

  const toggle = () => {
    writeEnabled(window.localStorage, !enabled);
    window.location.reload(); // only way to reclaim the WebGL context / stop the rAF loop
  };

  return (
    <LiquidGlassContext.Provider value={{ enabled, ready, toggle }}>
      {children}
    </LiquidGlassContext.Provider>
  );
}

export function useLiquidGlassContext(): LiquidGlassContextValue {
  const ctx = useContext(LiquidGlassContext);
  if (!ctx) throw new Error('useLiquidGlassContext must be used within <LiquidGlassProvider>');
  return ctx;
}
