import { trackMetaCustomEvent } from '@/lib/metaPixelLoader';

// Module scope, not a ref: "once per page load" must survive a remount of LoginPage (switching
// tabs, the email-confirmation bounce) inside the same SPA load.
let sent = false;

/**
 * Meta `IniciouCadastro`: the intermediate signal between PageView and CompleteRegistration that
 * the ad set optimizes on. Fires on the first focus inside the signup form, once per page load.
 * Without marketing consent nothing is sent and the latch stays open, so a visitor who accepts
 * the cookie banner and then focuses a field still counts.
 */
export function markSignupStarted(): void {
  if (sent) return;
  if (trackMetaCustomEvent('IniciouCadastro', { origem: 'formulario' })) sent = true;
}

/** Test-only: the latch is module state. */
export function resetSignupStartedForTests(): void {
  sent = false;
}
