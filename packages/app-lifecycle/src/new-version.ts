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

/**
 * Poll for a new deploy. Returns a stop function.
 *
 * The first successful poll sets the baseline rather than the current DOM: Vite
 * appends `<link rel="modulepreload">` tags for lazily loaded chunks at runtime, so
 * the live document drifts from the one that was served and would false-positive.
 */
export function watchForNewVersion({
  documentUrl,
  intervalMs = DEFAULT_INTERVAL_MS,
  onNewVersion,
}: WatchForNewVersionOptions): () => void {
  const url = documentUrl ?? window.location.href;
  let baseline: string | null = null;
  let inFlight = false;
  let stopped = false;

  // `timer` is initialised below, after the functions that close over it. Nothing
  // can call stop() before then: the first caller is the interval itself.
  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  }

  async function check() {
    if (stopped || inFlight || document.visibilityState === 'hidden') return;
    inFlight = true;
    try {
      const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'text/html' } });
      if (!response.ok) return;
      const fingerprint = extractBuildFingerprint(await response.text());
      if (fingerprint === null || stopped) return;
      if (baseline === null) {
        baseline = fingerprint;
        return;
      }
      if (fingerprint !== baseline) {
        stop();
        onNewVersion();
      }
    } catch {
      // Offline or a transient failure. The next tick tries again.
    } finally {
      inFlight = false;
    }
  }

  function onVisible() {
    if (document.visibilityState === 'visible') void check();
  }

  document.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(() => void check(), intervalMs);
  void check();

  return stop;
}
