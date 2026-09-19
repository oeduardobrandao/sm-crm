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
 */
export function openSupportChat(): void {
  if (getConsent()?.support !== true) {
    pendingOpen = true;
    openConsentPreferences('support');
    return;
  }
  showChat();
}

/** Called by consent handling when support consent is granted. */
export function resumePendingSupportChat(): void {
  if (!pendingOpen) return;
  pendingOpen = false;
  showChat();
}

/** Called when the dialog closes, so a later unrelated grant does not pop the chat open. */
export function clearPendingSupportChat(): void {
  pendingOpen = false;
}
