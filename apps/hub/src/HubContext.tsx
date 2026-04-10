import { createContext, useContext } from 'react';
import type { HubBootstrap } from './types';

interface HubContextValue {
  bootstrap: HubBootstrap;
  token: string;
  workspace: string;
}

export const HubContext = createContext<HubContextValue | null>(null);

export function useHub(): HubContextValue {
  const ctx = useContext(HubContext);
  if (!ctx) throw new Error('useHub must be used inside HubContext.Provider');
  return ctx;
}
