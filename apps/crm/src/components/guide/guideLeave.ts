import { createContext, useContext } from 'react';

/**
 * Leaves the guide for a route without dismissing it (the "Fazer agora" path), provided
 * by the phone guide sheet: it closes the sheet first and navigates once the sheet's
 * history entry is gone, so Back from the destination doesn't land on a dead entry.
 * Null in the desktop dialog, where callers close and navigate directly.
 */
export const GuideLeaveContext = createContext<((to: string) => void) | null>(null);

export function useGuideLeave() {
  return useContext(GuideLeaveContext);
}
