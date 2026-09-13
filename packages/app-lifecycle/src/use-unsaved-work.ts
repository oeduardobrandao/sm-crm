import { useEffect } from 'react';
import { holdUnsavedWork } from './unsaved-work';

/**
 * Hold the unsaved-work registry while mounted and `active`. Pass the same condition the
 * screen already uses for "there is something unsaved here": a dirty flag, a save in flight.
 */
export function useUnsavedWork(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return holdUnsavedWork();
  }, [active]);
}
