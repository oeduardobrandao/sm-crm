/**
 * The client's login session for the Hub (the token hub-auth hands back after the e-mail
 * code). Kept in localStorage so it survives a reload. Every access is guarded: storage can be
 * blocked (private mode, disabled site data), and then the Hub simply behaves as logged out.
 *
 * One entry per Hub link. Every Hub lives on the same origin, so a single shared entry made
 * the links fight: opening a second Hub where the e-mail is not listed answered
 * `login_required` and wiped the session the first one was using.
 */
import { canonicalHubToken } from './hubLinks';

export const HUB_SESSION_STORAGE_KEY = 'mesaas:hub-session';

const HUB_PATH = /^\/[^/]+\/hub\/([^/]+)/;

/**
 * The entry of the Hub link in the address bar (`/:workspace/hub/:token`). Outside a Hub link
 * (the guest invite, the report print page) there is no login, and the bare key is used.
 * The token is canonicalised: an old hyphenated link and its compact form are the same Hub
 * (HubShell rewrites one into the other right after the first requests went out).
 */
export function hubSessionKey(): string {
  let token: string | undefined;
  try {
    token = HUB_PATH.exec(window.location.pathname)?.[1];
  } catch {
    token = undefined;
  }
  return token ? `${HUB_SESSION_STORAGE_KEY}:${canonicalHubToken(token)}` : HUB_SESSION_STORAGE_KEY;
}

export function getHubSession(): string | null {
  try {
    const key = hubSessionKey();
    const own = window.localStorage.getItem(key);
    if (own !== null || key === HUB_SESSION_STORAGE_KEY) return own;
    // A session stored before the entries were per link: it moves (never copies) to the first
    // Hub opened, so nobody is logged out by the change and one token never sits under two keys.
    const legacy = window.localStorage.getItem(HUB_SESSION_STORAGE_KEY);
    if (legacy === null) return null;
    window.localStorage.setItem(key, legacy);
    window.localStorage.removeItem(HUB_SESSION_STORAGE_KEY);
    return legacy;
  } catch {
    return null;
  }
}

export function setHubSession(token: string): void {
  try {
    window.localStorage.setItem(hubSessionKey(), token);
  } catch {
    // Storage unavailable: the session lives only until the next reload.
  }
}

export function clearHubSession(): void {
  try {
    window.localStorage.removeItem(hubSessionKey());
  } catch {
    // Nothing stored, nothing to clear.
  }
}
