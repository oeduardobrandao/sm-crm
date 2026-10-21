import { CONSENT_STORAGE_KEY, type ConsentChoice } from '../lib/consent';

/** Test helper: stores a decided consent. Call AFTER any `localStorage.clear()`. */
export function seedConsent(choice: Partial<ConsentChoice> = {}): void {
  localStorage.setItem(
    CONSENT_STORAGE_KEY,
    JSON.stringify({
      analytics: false,
      support: false,
      decidedAt: '2026-09-19T00:00:00.000Z',
      ...choice,
    }),
  );
}
