/**
 * Deploy detection for long-lived tabs.
 *
 * `installDeployRecovery()` is the safety net for a tab that already broke. This is
 * the polite half: notice the deploy while the tab is still working and let the user
 * refresh on their own terms, instead of waiting for the next lazy route to 404.
 *
 * The signal is the HTML document itself. It is served `max-age=0, must-revalidate`
 * (see vercel.json) and its `/assets/` references are content-hashed, so re-fetching
 * it and comparing those references detects a deploy with no build-time wiring.
 */

const DEFAULT_INTERVAL_MS = 5 * 60_000;

const ASSET_REFERENCE = /(?:src|href)="([^"]*\/assets\/[^"]+)"/g;

/**
 * Fingerprint of a document's hashed asset references. Returns null when the HTML
 * has none, which means the response was not the document we expected (a login
 * wall, an error page) and must not be compared against.
 */
export function extractBuildFingerprint(html: string): string | null {
  const references = Array.from(html.matchAll(ASSET_REFERENCE), (match) => match[1]).sort();
  return references.length > 0 ? references.join('|') : null;
}

export interface WatchForNewVersionOptions {
  /** Document to poll. Defaults to the URL this tab was served from. */
  documentUrl?: string;
  intervalMs?: number;
  /** Fired once, when the deployed assets stop matching the ones this tab loaded. */
  onNewVersion: () => void;
}

export interface NewVersionWatcher {
  /** Stop polling and drop the listeners. */
  stop: () => void;
  /**
   * Check now, even with the tab hidden (the interval keeps its hidden gate). Resolves true
   * when the server answered with a comparable document, false on a failure, a document
   * without hashed assets, or once stopped.
   */
  check: () => Promise<boolean>;
}

/**
 * Poll for a new deploy.
 *
 * The first successful poll sets the baseline rather than the current DOM: Vite
 * appends `<link rel="modulepreload">` tags for lazily loaded chunks at runtime, so
 * the live document drifts from the one that was served and would false-positive.
 */
export function watchForNewVersion({
  documentUrl,
  intervalMs = DEFAULT_INTERVAL_MS,
  onNewVersion,
}: WatchForNewVersionOptions): NewVersionWatcher {
  const url = documentUrl ?? window.location.href;
  let baseline: string | null = null;
  let inFlight: Promise<boolean> | null = null;
  let stopped = false;

  // `timer` is initialised below, after the functions that close over it. Nothing
  // can call stop() before then: the first caller is the interval itself.
  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  }

  async function fetchAndCompare(): Promise<boolean> {
    try {
      const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'text/html' } });
      if (!response.ok) return false;
      const fingerprint = extractBuildFingerprint(await response.text());
      if (fingerprint === null || stopped) return false;
      if (baseline === null) {
        baseline = fingerprint;
        return true;
      }
      if (fingerprint !== baseline) {
        stop();
        onNewVersion();
      }
      return true;
    } catch {
      // Offline or a transient failure. The next tick tries again.
      return false;
    }
  }

  function check(force: boolean): Promise<boolean> {
    if (stopped) return Promise.resolve(false);
    if (inFlight) return inFlight;
    if (!force && document.visibilityState === 'hidden') return Promise.resolve(false);
    inFlight = fetchAndCompare().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  function onVisible() {
    if (document.visibilityState === 'visible') void check(false);
  }

  document.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(() => void check(false), intervalMs);
  void check(false);

  return { stop, check: () => check(true) };
}
