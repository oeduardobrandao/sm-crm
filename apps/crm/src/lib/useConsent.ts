import { useSyncExternalStore } from 'react';
import { getConsent, subscribe, type Consent } from './consent';

/** Reactive view of the consent store. `null` = undecided. */
export function useConsent(): Consent | null {
  return useSyncExternalStore(subscribe, getConsent, () => null);
}
