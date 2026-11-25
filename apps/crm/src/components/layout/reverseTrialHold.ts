import { createContext, useContext } from 'react';

/**
 * True while the reverse trial start is in flight or its welcome dialog is open
 * (`ProtectedRoute`). The onboarding guide holds its auto-open meanwhile, and with it every
 * popup that waits on the guide, so a brand-new owner sees the welcome first and the guide
 * right after closing it, never both stacked.
 */
export const ReverseTrialHoldContext = createContext(false);

export function useReverseTrialHold(): boolean {
  return useContext(ReverseTrialHoldContext);
}
