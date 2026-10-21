/**
 * localStorage cache behind Crisp Session Continuity
 * (docs/superpowers/specs/2026-09-17-crisp-session-continuity-design.md).
 *
 * Holds the `{ userId, token }` pair the widget was LAST bound to in this
 * browser, so AuthContext's Crisp-identify effect can tell "Crisp already has
 * it right, do nothing" from "rebind now" without resetting the session on
 * every load. It is a reconciliation hint, never a credential source:
 * nothing reads it before authentication (index.html is deliberately
 * untouched), and `window.CRISP_TOKEN_ID` is only ever set from a
 * server-confirmed token.
 *
 * Every access is wrapped: private browsing, blocked storage or a full quota
 * must never break auth (same discipline as every `$crisp.push` in
 * AuthContext.tsx).
 */
export const CRISP_SESSION_STORAGE_KEY = 'crisp_session_v1';

export interface CrispSessionCache {
  userId: string;
  token: string;
}

export function readCrispSessionCache(): CrispSessionCache | null {
  try {
    const raw = localStorage.getItem(CRISP_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CrispSessionCache> | null;
    if (
      !parsed ||
      typeof parsed.userId !== 'string' ||
      !parsed.userId ||
      typeof parsed.token !== 'string' ||
      !parsed.token
    ) {
      return null;
    }
    return { userId: parsed.userId, token: parsed.token };
  } catch {
    return null;
  }
}

export function writeCrispSessionCache(userId: string, token: string): void {
  try {
    localStorage.setItem(CRISP_SESSION_STORAGE_KEY, JSON.stringify({ userId, token }));
  } catch {
    // Best effort: a failed write only means the next load rebinds again.
  }
}

export function clearCrispSessionCache(): void {
  try {
    localStorage.removeItem(CRISP_SESSION_STORAGE_KEY);
  } catch {
    // Best effort: see writeCrispSessionCache.
  }
}
