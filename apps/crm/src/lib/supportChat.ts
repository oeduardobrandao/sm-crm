import { getConsent, openConsentPreferences } from './consent';
import { loadCrisp } from './crispLoader';

let pendingOpen = false;

function showChat(): void {
  loadCrisp();
  window.$crisp?.push(['do', 'chat:show']);
  window.$crisp?.push(['do', 'chat:open']);
}

/**
 * The single entry point for "open the support chat". Without support consent the widget is not
 * loaded, so a bare `$crisp.push(['do','chat:open'])` would be a silent dead click; instead we
 * open the consent dialog focused on the support toggle and open the chat once it is granted.
 * Returns true when the chat was actually opened, false when only the consent dialog was.
 */
export function openSupportChat(): boolean {
  if (getConsent()?.support !== true) {
    pendingOpen = true;
    openConsentPreferences('support');
    return false;
  }
  showChat();
  return true;
}

/** Called by consent handling when support consent is granted. */
export function resumePendingSupportChat(): void {
  if (!pendingOpen) return;
  pendingOpen = false;
  // Re-check: the grant that triggered this may have been revoked again before we run.
  if (getConsent()?.support !== true) return;
  showChat();
}

/** Called when the dialog closes, so a later unrelated grant does not pop the chat open. */
export function clearPendingSupportChat(): void {
  pendingOpen = false;
}
