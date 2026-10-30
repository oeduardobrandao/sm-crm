/**
 * Whether the public legal pages (privacy policy and terms) name YouTube and Google Meu Negócio.
 *
 * On since Phase 2, which delivers the deletion jobs the policy text promises (the 30-day
 * expiry, revocation retries and orphan release in gbp-sync-cron, the YouTube purge on unlink and
 * revoke). The pages are public and pre-rendered, so the per-workspace plan flags
 * (`feature_youtube`, `feature_google_business`) cannot gate them.
 */
export const GOOGLE_LEGAL_TEXT_LIVE = true;

/** The connected networks the legal pages name, in Portuguese list form. */
export function legalNetworkList(): string {
  return GOOGLE_LEGAL_TEXT_LIVE
    ? 'Instagram, TikTok, YouTube e Google Meu Negócio'
    : 'Instagram e TikTok';
}
