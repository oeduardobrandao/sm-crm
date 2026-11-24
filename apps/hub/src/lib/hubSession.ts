/**
 * The client's login session for the Hub (the token hub-auth hands back after the e-mail
 * code). Kept in localStorage so it survives a reload. Every access is guarded: storage can be
 * blocked (private mode, disabled site data), and then the Hub simply behaves as logged out.
 */
export const HUB_SESSION_STORAGE_KEY = 'mesaas:hub-session';

export function getHubSession(): string | null {
  try {
    return window.localStorage.getItem(HUB_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setHubSession(token: string): void {
  try {
    window.localStorage.setItem(HUB_SESSION_STORAGE_KEY, token);
  } catch {
    // Storage unavailable: the session lives only until the next reload.
  }
}

export function clearHubSession(): void {
  try {
    window.localStorage.removeItem(HUB_SESSION_STORAGE_KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
}
