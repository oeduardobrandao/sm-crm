/**
 * Recovery from the stale-chunk failure that follows every production deploy.
 *
 * Every route in the three apps is a dynamic import, and Vite emits each one as a
 * content-hashed file under `/assets/` served `immutable`. A deploy flips the
 * production alias to a new set of hashes, so a tab opened before the deploy asks
 * for a chunk filename that no longer exists: the request 404s, the `import()`
 * rejects, and the rejection surfaces as the "Algo deu errado" error screen.
 *
 * Reloading re-fetches the (uncached) HTML document, which points at the new
 * hashes, and the user carries on where they were.
 */

export const RELOAD_STAMP_KEY = 'mesaas:deploy-reload-at';

/** Two recovery reloads inside this window means reloading is not fixing it. */
const RELOAD_COOLDOWN_MS = 15_000;

const MODULE_LOAD_ERROR =
  /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|unable to preload css/i;

/** True for the browser-specific ways a missing chunk reports itself. */
export function isModuleLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return MODULE_LOAD_ERROR.test(message);
}

let suppressed = false;

/**
 * Hold off recovery reloads while a silent version swap has a document navigation in flight:
 * a chunk 404 on the old page must not turn into a reload that cancels that navigation. The
 * flag lives in module memory on purpose, so the destination page starts with recovery armed.
 * Returns the release.
 */
export function suppressDeployRecovery(): () => void {
  suppressed = true;
  return () => {
    suppressed = false;
  };
}

/**
 * Reload once to pick up the current deploy. Returns false when it declined,
 * so callers can let the original error through to the error boundary.
 *
 * The loop guard lives in sessionStorage because it has to survive the reload it
 * is guarding. When sessionStorage is unavailable (Safari private mode) there is
 * no guard, and an unguarded reload on a genuinely broken build is a reload loop,
 * so we decline instead. Those users still get the error screen with its reload
 * button.
 */
export function reloadForNewDeploy(): boolean {
  if (suppressed) return false;
  const now = Date.now();
  let previous = 0;

  try {
    previous = Number(window.sessionStorage.getItem(RELOAD_STAMP_KEY)) || 0;
    if (now - previous < RELOAD_COOLDOWN_MS) return false;
    window.sessionStorage.setItem(RELOAD_STAMP_KEY, String(now));
  } catch {
    return false;
  }

  window.location.reload();
  return true;
}

/** Wire the recovery listeners. Call once, as early as possible in the entrypoint. */
export function installDeployRecovery(): void {
  // Vite's preload helper dispatches this for every dynamic import that fails in a
  // production build, which is exactly the post-deploy failure. `preventDefault()`
  // makes the helper swallow the error and resolve the import to `undefined`, so
  // only do that when we are actually navigating away.
  window.addEventListener('vite:preloadError', (event: Event) => {
    if (reloadForNewDeploy()) event.preventDefault();
  });

  // Backstop for module loads that do not go through Vite's helper.
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    if (isModuleLoadError(event.reason)) reloadForNewDeploy();
  });
}
