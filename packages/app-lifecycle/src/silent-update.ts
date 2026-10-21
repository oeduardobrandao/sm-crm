/**
 * Silent version swap for a tab that outlives a deploy.
 *
 * `watchForNewVersion` notices the deploy. From then on the tab is "pending" and moves to
 * the new build at the first moment the user would not notice:
 *
 * - the next client-side navigation to another pathname becomes a full document
 *   navigation to the same destination (a PUSH only; REPLACE and same-path PUSHes are
 *   query housekeeping that carries in-memory state the URL does not);
 * - the tab has been hidden for `hiddenAfterMs`;
 * - the tab is visible but has had no input for `idleAfterMs`.
 *
 * Every trigger defers to the unsaved-work registry, the DOM heuristic (`isDocumentBusy`)
 * and the app's `holdWhile` (in-flight mutations: a full navigation aborts requests that a
 * client-side route change would let finish). The two passive triggers also wait for the
 * server to answer, since nobody is there to notice a network error page.
 *
 * The watchdog's `window.stop()` aborts every in-flight request of the page, not only the
 * pending document navigation; it only runs after the swap already failed and `holdWhile()`
 * reports no mutation at that moment. Past the re-arm cap with a mutation still in flight, the
 * click is handed back without stopping loads. Never register another blocker (`useBlocker`) in
 * the apps: React Router honours only the last one registered, and a second one silently
 * disables this swap while it is mounted.
 */

import { suppressDeployRecovery } from './deploy-recovery';
import { watchForNewVersion } from './new-version';
import { hasUnsavedWork, isDocumentBusy, trackDocumentEdits } from './unsaved-work';

const BLOCKER_KEY = 'silent-update';
const DEFAULT_HIDDEN_AFTER_MS = 5 * 60_000;
const DEFAULT_IDLE_AFTER_MS = 10 * 60_000;
/** A full navigation that has not unloaded the page by then is treated as failed. */
const DEFAULT_SWAP_WATCHDOG_MS = 8_000;
/** A mutation that outlasts this many watchdog periods gives up the swap anyway. */
const MAX_SWAP_WATCHDOG_REARMS = 3;
const IDLE_TICK_MS = 30_000;
const INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel', 'scroll', 'touchstart'] as const;

export interface SilentUpdateLocation {
  pathname: string;
  search: string;
  hash: string;
}

export interface SilentUpdateBlockerArgs {
  currentLocation: SilentUpdateLocation;
  nextLocation: SilentUpdateLocation;
  /** 'PUSH' | 'REPLACE' | 'POP'. Typed as string so React Router's enum is assignable. */
  historyAction: string;
}

export interface SilentUpdateBlocker {
  state: string;
  location?: SilentUpdateLocation;
  proceed?: () => void;
}

export interface SilentUpdateRouterState {
  blockers: Map<string, SilentUpdateBlocker>;
}

/** The slice of a React Router data router this module needs. `createBrowserRouter` satisfies it. */
export interface SilentUpdateRouter {
  getBlocker(key: string, fn: (args: SilentUpdateBlockerArgs) => boolean): unknown;
  deleteBlocker(key: string): void;
  subscribe(fn: (state: SilentUpdateRouterState) => void): () => void;
}

export interface InstallSilentUpdateOptions {
  router: SilentUpdateRouter;
  /** Hidden for this long, and the tab reloads in the background. Default 5 min. */
  hiddenAfterMs?: number;
  /** Visible with no input for this long, and the tab reloads. Default 10 min. */
  idleAfterMs?: number;
  /** Page still alive this long after `location.assign`, and the swap is given up. Default 8 s. */
  swapWatchdogMs?: number;
  /** Passed to `watchForNewVersion`. */
  documentUrl?: string;
  intervalMs?: number;
  /** App-level busy signal, e.g. `() => queryClient.isMutating() > 0`. Default: never busy. */
  holdWhile?: () => boolean;
}

async function serverAnswers(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'text/html' } });
    return response.ok;
  } catch {
    return false;
  }
}

/** Wire the silent swap. Returns the uninstall function. */
export function installSilentUpdate(options: InstallSilentUpdateOptions): () => void {
  const {
    router,
    hiddenAfterMs = DEFAULT_HIDDEN_AFTER_MS,
    idleAfterMs = DEFAULT_IDLE_AFTER_MS,
    swapWatchdogMs = DEFAULT_SWAP_WATCHDOG_MS,
    holdWhile = () => false,
  } = options;
  const documentUrl = options.documentUrl ?? window.location.href;
  const stopEditTracking = trackDocumentEdits();

  let pending = false;
  let reloading = false;
  // One full-navigation attempt per tab: a failed one must not repeat on every click.
  let navigationSwapEnabled = true;
  let lastInputAt = Date.now();
  let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let swapRearms = 0;
  let releaseRecovery: (() => void) | null = null;

  const watcher = watchForNewVersion({
    documentUrl,
    intervalMs: options.intervalMs,
    onNewVersion: () => {
      pending = true;
    },
  });

  function reloadNow(): void {
    reloading = true;
    window.location.reload();
  }

  function quiet(): boolean {
    return !hasUnsavedWork() && !isDocumentBusy() && !holdWhile();
  }

  /**
   * Passive reload: registry, DOM heuristic, app busy signal, then a live server answer.
   * `stillQuiet` is re-checked after that await too, for a condition `quiet()` cannot see on
   * its own (idle: input that arrived while the request was in flight).
   */
  async function reloadIfQuiet(
    alreadyAnswered = false,
    stillQuiet: () => boolean = () => true,
  ): Promise<void> {
    if (!pending || reloading || !quiet()) return;
    if (!alreadyAnswered && !(await serverAnswers(documentUrl))) return;
    if (!pending || reloading || !quiet() || !stillQuiet()) return;
    reloadNow();
  }

  // Navigation. React Router consults only the most recently registered blocker; nothing
  // else registers one today (see apps/crm/src/main.tsx).
  router.getBlocker(
    BLOCKER_KEY,
    ({ currentLocation, nextLocation, historyAction }) =>
      pending &&
      navigationSwapEnabled &&
      !reloading &&
      navigator.onLine !== false &&
      historyAction === 'PUSH' &&
      nextLocation.pathname !== currentLocation.pathname &&
      quiet(),
  );
  const unsubscribe = router.subscribe((state) => {
    const blocker = state.blockers.get(BLOCKER_KEY);
    if (!blocker || blocker.state !== 'blocked' || !blocker.location || reloading) return;
    reloading = true;
    navigationSwapEnabled = false;
    const { pathname, search, hash } = blocker.location;
    // Hold off deploy-recovery while this navigation is in flight: a chunk 404 on the old
    // page must not turn into a reload that cancels it. Released below, in whichever branch
    // the swap ends up in.
    releaseRecovery = suppressDeployRecovery();
    const giveUpSwap = () => {
      if (holdWhile() && swapRearms < MAX_SWAP_WATCHDOG_REARMS) {
        // A mutation started while the document request hung; stopping the page's loads now
        // could cut it. Look again in a moment, up to a bounded number of times: a mutation
        // that never settles must not keep this watchdog re-arming forever.
        swapRearms += 1;
        watchdog = setTimeout(giveUpSwap, swapWatchdogMs);
        return;
      }
      // Still here, or the re-arm budget ran out: the document request did not replace this
      // page (or the app has been busy for too long to keep waiting). Stop it (the browser's
      // Stop button, so a slow response cannot land later as a second transition) and let
      // the navigation the user asked for go on client-side. The passive triggers keep the
      // swap alive.
      watchdog = null;
      reloading = false;
      // The suppression held off deploy-recovery for the navigation in flight; a swap that
      // did not happen must not leave it held forever.
      releaseRecovery?.();
      releaseRecovery = null;
      // Past the cap with a mutation still in flight: hand the click back without stopping
      // the page's loads. A late second transition is better than an aborted request.
      if (!holdWhile() && typeof window.stop === 'function') window.stop();
      blocker.proceed?.();
    };
    swapRearms = 0;
    watchdog = setTimeout(giveUpSwap, swapWatchdogMs);
    window.location.assign(pathname + search + hash);
  });

  // Hidden tab.
  function armHiddenTimer(): void {
    if (hiddenTimer !== null) clearTimeout(hiddenTimer);
    hiddenTimer = setTimeout(() => {
      hiddenTimer = null;
      void (async () => {
        if (document.visibilityState !== 'hidden') return;
        // The interval pauses while hidden, so ask now; a comparison doubles as proof
        // that the server answers.
        const answered = await watcher.check();
        if (document.visibilityState !== 'hidden') return;
        await reloadIfQuiet(answered);
        // Still hidden and the swap did not happen (busy, no new version yet, no server
        // answer): keep checking at the same cadence instead of going dark until the tab
        // becomes visible again.
        if (!reloading && document.visibilityState === 'hidden') armHiddenTimer();
      })();
    }, hiddenAfterMs);
  }
  function onVisibilityChange(): void {
    if (document.visibilityState === 'hidden') {
      armHiddenTimer();
    } else {
      if (hiddenTimer !== null) {
        clearTimeout(hiddenTimer);
        hiddenTimer = null;
      }
      // Idle is counted from the moment the tab came back: after hours hidden, the first
      // tick must not reload while the user is looking at the page.
      lastInputAt = Date.now();
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange);

  // Idle. Capture phase so `scroll` on any element counts; `scroll` does not bubble.
  function onInput(): void {
    lastInputAt = Date.now();
  }
  for (const type of INPUT_EVENTS) {
    window.addEventListener(type, onInput, { passive: true, capture: true });
  }
  // Tick at most every 30 s; a shorter idleAfterMs (tests) ticks at that period instead.
  const idleTimer = setInterval(
    () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastInputAt < idleAfterMs) return;
      void reloadIfQuiet(false, () => Date.now() - lastInputAt >= idleAfterMs);
    },
    Math.min(IDLE_TICK_MS, idleAfterMs),
  );

  // A tab that opens already hidden (background tab, prerender) must arm the hidden timer
  // now: `visibilitychange` never fires for the state the document started in.
  onVisibilityChange();

  return function uninstall() {
    stopEditTracking();
    watcher.stop();
    unsubscribe();
    router.deleteBlocker(BLOCKER_KEY);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    for (const type of INPUT_EVENTS) {
      window.removeEventListener(type, onInput, { capture: true });
    }
    clearInterval(idleTimer);
    if (hiddenTimer !== null) clearTimeout(hiddenTimer);
    if (watchdog !== null) {
      clearTimeout(watchdog);
      releaseRecovery?.();
      releaseRecovery = null;
    }
  };
}
