import { useSyncExternalStore } from 'react';

declare global {
  interface Window {
    $crisp?: Array<unknown[]>;
    /**
     * Crisp Session Continuity token, read by the widget on `session:reset`.
     * Only ever written by AuthContext.tsx: set on an authenticated rebind,
     * nulled on sign-out and user change. Declared here once; a TS global
     * augmentation merges across the compilation, so MobileNav.tsx's own
     * `$crisp` block deliberately does not repeat it.
     */
    CRISP_TOKEN_ID?: string | null;
  }
}

/**
 * One owner for the desktop support-chat unread dot. The Crisp listeners used to be pushed by
 * TopBarActions on mount with no cleanup; the Vidro shell can remount it (shell swap, crossing
 * 768px), so registration is once-guarded here and the flag lives outside React.
 */
let registered = false;
let unread = false;
const listeners = new Set<() => void>();

function setUnread(next: boolean) {
  if (unread === next) return;
  unread = next;
  listeners.forEach((l) => l());
}

export function ensureCrispListeners(): void {
  if (registered || !window.$crisp) return;
  registered = true;
  window.$crisp.push(['on', 'message:received', () => setUnread(true)]);
  window.$crisp.push(['on', 'chat:opened', () => setUnread(false)]);
  window.$crisp.push(['on', 'chat:closed', () => window.$crisp?.push(['do', 'chat:hide'])]);
}

export function markSupportChatRead(): void {
  setUnread(false);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSupportChatUnread(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => unread,
    () => false,
  );
}

export function __resetSupportChatUnreadForTests(): void {
  registered = false;
  unread = false;
  listeners.clear();
}
