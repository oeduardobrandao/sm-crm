import { changeLanguage, i18n } from '@mesaas/i18n';

/** Same key `@mesaas/i18n` persists the UI language under. */
const LANGUAGE_STORAGE_KEY = 'mesaas-language';
const SUPPORTED_LANGUAGES = ['pt', 'en'];

/**
 * The signup market carried by an `/en` CTA (`/login?tab=register&market=us`). Only one `market`
 * param whose value is exactly `us` counts: `US`, `us ` (padded), `br` and a repeated param are all
 * ignored, so a tampered or ambiguous URL never turns a Brazilian signup into a USD workspace.
 */
export function readSignupMarket(search: string): 'us' | undefined {
  const values = new URLSearchParams(search).getAll('market');
  return values.length === 1 && values[0] === 'us' ? 'us' : undefined;
}

function hasSavedLanguage(): boolean {
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return saved !== null && SUPPORTED_LANGUAGES.includes(saved);
  } catch {
    return false;
  }
}

/**
 * Cross-device fallback for a US signup (spec §5): the confirmation link opened on another device
 * has no saved language, so the account's `user_metadata.market === 'us'` picks English and saves
 * it. A saved language always wins. Called by AuthContext as soon as the session's user is known.
 */
export function applyAccountLanguageFallback(
  user: { user_metadata?: Record<string, unknown> } | null,
): void {
  if (user?.user_metadata?.market !== 'us') return;
  if (hasSavedLanguage()) return;
  try {
    changeLanguage('en');
  } catch {
    // Storage blocked (private mode): switch for this page load without persisting it.
    void i18n.changeLanguage('en');
  }
}
