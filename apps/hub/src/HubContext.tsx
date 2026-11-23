import { createContext, useContext } from 'react';
import type { HubBootstrap } from './types';

interface HubContextValue {
  bootstrap: HubBootstrap;
  token: string;
  workspace: string;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  /** The logged-in client person, when the Hub has client login; null when anonymous. */
  person?: { nome: string; email: string } | null;
  /** Ends the client's login session. Provided by HubShell next to `person`. */
  signOut?: () => void;
}

export const HubContext = createContext<HubContextValue | null>(null);

export function useHub(): HubContextValue {
  const ctx = useContext(HubContext);
  if (!ctx) throw new Error('useHub must be used inside HubContext.Provider');
  return ctx;
}
