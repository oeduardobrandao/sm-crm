import { getExplicitLanguage, setLanguageHint } from '@mesaas/i18n';

/**
 * The signup market carried by an `/en` CTA (`/login?tab=register&market=us`). Only one `market`
 * param whose value is exactly `us` counts: `US`, `us ` (padded), `br` and a repeated param are all
 * ignored, so a tampered or ambiguous URL never turns a Brazilian signup into a USD workspace.
 */
export function readSignupMarket(search: string): 'us' | undefined {
  const values = new URLSearchParams(search).getAll('market');
  return values.length === 1 && values[0] === 'us' ? 'us' : undefined;
}

/**
 * Cross-device fallback for a US signup (spec §5): the confirmation link opened on another device
 * has no explicit language, so the account's `user_metadata.market === 'us'` picks English as a
 * hint. An explicit choice always wins. Called by AuthContext as soon as the session's user is known.
 */
export function applyAccountLanguageFallback(
  user: { user_metadata?: Record<string, unknown> } | null,
): void {
  if (user?.user_metadata?.market !== 'us') return;
  if (getExplicitLanguage()) return;
  // A hint, not a choice: the workspace language takes over once it loads.
  setLanguageHint('en');
}
