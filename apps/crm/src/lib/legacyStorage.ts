import { CRISP_SESSION_STORAGE_KEY } from './crispSession';

/**
 * Deletes a tool's browser storage directly, WITHOUT initialising its SDK. Existing users
 * already carry a PostHog `ph_*` identifier and a Crisp session from before the consent gate;
 * SDK-level opt-out calls are no-ops against an SDK that never started this session, so a
 * "Rejeitar todos" on launch day has to clear the legacy keys itself.
 *
 * No browser access at module scope (prerender imports this transitively via LgpdPage).
 */

function expireCookie(name: string): void {
  const host = location.hostname;
  const parts = host.split('.');
  // Cookies are only removed by an expiry that matches the domain they were set with, so try
  // the host-only form, the host, and every parent domain.
  const domains: Array<string | null> = [null, host, `.${host}`];
  for (let i = 1; i < parts.length - 1; i++) domains.push(`.${parts.slice(i).join('.')}`);
  for (const domain of domains) {
    document.cookie = `${name}=; Max-Age=0; path=/${domain ? `; domain=${domain}` : ''}`;
  }
}

function purge(prefixes: string[], exactKeys: string[] = []): void {
  try {
    const names = document.cookie
      .split(';')
      .map((cookie) => cookie.split('=')[0].trim())
      .filter(Boolean);
    for (const name of names) {
      if (prefixes.some((prefix) => name.startsWith(prefix))) expireCookie(name);
    }
  } catch {
    // Cookie access can be blocked; never let cleanup break the app.
  }
  try {
    // Collect first, remove after: removing while iterating skips entries.
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) keys.push(key);
    }
    for (const key of keys) {
      if (prefixes.some((prefix) => key.startsWith(prefix)) || exactKeys.includes(key)) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Storage can be blocked; never let cleanup break the app.
  }
}

/** PostHog identifier storage. Leaves `__ph_opt_in_out_*` (the SDK's own opt-out flag) alone. */
export function purgeAnalyticsStorage(): void {
  purge(['ph_']);
}

/**
 * Crisp storage plus Mesaas's own reconciliation cache. Crisp's docs describe a cookie family
 * under `crisp-client`; the prefix scan also covers localStorage in case that is wrong. Task 10
 * confirms the real keys in a browser.
 */
export function purgeSupportStorage(): void {
  purge(['crisp-client'], [CRISP_SESSION_STORAGE_KEY]);
}
