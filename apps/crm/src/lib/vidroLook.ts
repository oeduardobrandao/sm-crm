/**
 * Desktop "Vidro" look (spec docs/superpowers/specs/2026-10-12-desktop-vidro-design.md, D2/D3).
 * The workspace flag decides; each user can opt out per browser. `look-vidro` holds the id of the
 * user the look last resolved "on" for; index.html pre-paints only when the Supabase session in
 * localStorage belongs to that same user, so any identity change falls back to classic.
 */
export const LOOK_CACHE_KEY = 'look-vidro';

export function optOutKey(userId: string): string {
  return `look-optout:${userId}`;
}

export function readOptOut(userId: string | null | undefined): boolean {
  if (!userId) return false;
  try {
    return localStorage.getItem(optOutKey(userId)) === '1';
  } catch {
    return false;
  }
}

export function writeOptOut(userId: string, classic: boolean): void {
  try {
    if (classic) localStorage.setItem(optOutKey(userId), '1');
    else localStorage.removeItem(optOutKey(userId));
  } catch {
    // Storage unavailable: the choice lasts for this page load only.
  }
}

export function isVidroAttributeSet(): boolean {
  return document.documentElement.getAttribute('data-look') === 'vidro';
}

export function applyVidro(on: boolean, userId: string | null): void {
  const root = document.documentElement;
  if (on) root.setAttribute('data-look', 'vidro');
  else if (root.getAttribute('data-look') === 'vidro') root.removeAttribute('data-look');
  try {
    if (on && userId) localStorage.setItem(LOOK_CACHE_KEY, userId);
    else localStorage.removeItem(LOOK_CACHE_KEY);
  } catch {
    // The attribute is already applied; only the next load loses the pre-paint.
  }
}

/** Sign-out or workspace switch: the next load must not pre-paint the previous look. */
export function clearVidroCache(): void {
  try {
    localStorage.removeItem(LOOK_CACHE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/**
 * Sign-out: drop the attribute and the cache. Sign-out is an SPA redirect, not a reload, so the
 * attribute would otherwise outlive the session and seed the next user's shell in this tab.
 */
export function resetVidroLook(): void {
  try {
    applyVidro(false, null);
  } catch {
    // No document to touch; nothing to reset.
  }
}

/**
 * Launch intro (one modal announcing the look, with a way back to classic). Shown once per user
 * per browser, like the opt-out it offers. Accounts created on or after the launch never saw the
 * classic look, so there is nothing to announce to them.
 */
export const VIDRO_LAUNCHED_AT = '2026-10-23T03:00:00Z';

export function introSeenKey(userId: string): string {
  return `vidro-intro:${userId}`;
}

export function readIntroSeen(userId: string): boolean {
  try {
    return localStorage.getItem(introSeenKey(userId)) === '1';
  } catch {
    // Storage unavailable: treat as seen rather than announce on every load.
    return true;
  }
}

export function writeIntroSeen(userId: string): void {
  try {
    localStorage.setItem(introSeenKey(userId), '1');
  } catch {
    // Nothing to persist; readIntroSeen already reports seen without storage.
  }
}

export function isIntroDue(i: {
  vidroShell: boolean;
  userId: string | null | undefined;
  userCreatedAt: string | null | undefined;
}): boolean {
  if (!i.vidroShell || !i.userId) return false;
  const created = i.userCreatedAt ? Date.parse(i.userCreatedAt) : NaN;
  if (Number.isFinite(created) && created >= Date.parse(VIDRO_LAUNCHED_AT)) return false;
  return !readIntroSeen(i.userId);
}
