import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { readEnabled, writeEnabled } from './storage';

interface LiquidGlassContextValue {
  enabled: boolean;
  toggle: () => void;
}

const LiquidGlassContext = createContext<LiquidGlassContextValue | null>(null);

export function LiquidGlassProvider({ children }: { children: ReactNode }) {
  // CSS-based glass: toggling is instant (no WebGL context to tear down).
  const [enabled, setEnabled] = useState(() => readEnabled(window.localStorage));

  // Drive the CSS (glass on/off) + persist the choice.
  useEffect(() => {
    document.documentElement.dataset.liquidGlass = enabled ? 'on' : 'off';
    writeEnabled(window.localStorage, enabled);
  }, [enabled]);

  const toggle = () => setEnabled((e) => !e);

  return (
    <LiquidGlassContext.Provider value={{ enabled, toggle }}>
      {children}
    </LiquidGlassContext.Provider>
  );
}

export function useLiquidGlassContext(): LiquidGlassContextValue {
  const ctx = useContext(LiquidGlassContext);
  if (!ctx) throw new Error('useLiquidGlassContext must be used within <LiquidGlassProvider>');
  return ctx;
}
