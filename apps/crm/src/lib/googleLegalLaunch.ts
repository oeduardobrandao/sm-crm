/**
 * Whether the public legal pages (privacy policy and terms) name YouTube and Google Meu Negócio.
 *
 * Off until the Google integration launches. Those pages are public and pre-rendered, so the
 * per-workspace plan flags (`feature_youtube`, `feature_google_business`) cannot gate them, and
 * the policy text promises deletion jobs that only Phase 2 delivers. Flip it to `true` in the
 * PR that ships Phase 2, before submitting Google's OAuth verification (which reviews this
 * policy) and before either flag leaves the pilot workspace.
 */
export const GOOGLE_LEGAL_TEXT_LIVE = false;

/** The connected networks the legal pages name, in Portuguese list form. */
export function legalNetworkList(): string {
  return GOOGLE_LEGAL_TEXT_LIVE
    ? 'Instagram, TikTok, YouTube e Google Meu Negócio'
    : 'Instagram e TikTok';
}
