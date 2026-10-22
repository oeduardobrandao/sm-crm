import type { ReactNode } from 'react';
import { createRoot as reactCreateRoot, hydrateRoot as reactHydrateRoot } from 'react-dom/client';

export type MountResult = 'hydrated' | 'rendered' | 'static';

export interface MountAppOptions {
  container: HTMLElement;
  element: ReactNode;
  /** The document is the prerendered landing (`#root[data-ssr="landing"]` on `/`). */
  isSsr: boolean;
  /** Loads the chunk the first render needs (the landing page's). */
  preload: () => Promise<void>;
  /** Error reporting (Sentry). Called at most once per page load. */
  report: (err: unknown) => void;
  hydrate?: typeof reactHydrateRoot;
  create?: typeof reactCreateRoot;
  /** Client-rendered path: how long the first render waits for `preload`. */
  timeoutMs?: number;
  /** Server-rendered path: how long one `preload` attempt may take before it counts as failed. */
  ssrTimeoutMs?: number;
}

class PreloadTimeoutError extends Error {
  constructor(ms: number) {
    super(`preload did not settle within ${ms} ms`);
    this.name = 'PreloadTimeoutError';
  }
}

/** Resolves/rejects with `preload`, or rejects after `ms` (a stalled `import()` never settles). */
function withTimeout(preload: () => Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PreloadTimeoutError(ms)), ms);
  });
  let attempt: Promise<void>;
  try {
    attempt = preload();
  } catch (err) {
    attempt = Promise.reject(err);
  }
  return Promise.race([attempt, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Mounts the app on `container`.
 *
 * Client-rendered documents wait up to `timeoutMs` for `preload` (failure or not), then
 * `createRoot` + render, as before SSR existed.
 *
 * The prerendered landing is hydrated, never re-rendered: `preload` must land first (hydrating
 * without the landing chunk would suspend and throw the server HTML away). A failed or timed-out
 * attempt is reported once and retried once; when the retry fails too the page stays the server
 * HTML (links still work) and a chunk that arrives later is not hydrated.
 */
export async function mountApp({
  container,
  element,
  isSsr,
  preload,
  report,
  hydrate = reactHydrateRoot,
  create = reactCreateRoot,
  timeoutMs = 2000,
  ssrTimeoutMs = 10000,
}: MountAppOptions): Promise<MountResult> {
  if (!isSsr) {
    await withTimeout(preload, timeoutMs).catch(() => {});
    create(container).render(element);
    return 'rendered';
  }

  let reported = false;
  const reportOnce = (err: unknown) => {
    if (reported) return;
    reported = true;
    report(err);
  };

  let ready = await withTimeout(preload, ssrTimeoutMs).then(
    () => true,
    (err: unknown) => {
      reportOnce(err);
      return false;
    },
  );
  if (!ready) {
    ready = await withTimeout(preload, ssrTimeoutMs).then(
      () => true,
      () => false,
    );
  }
  if (!ready) return 'static';

  hydrate(container, element, { onRecoverableError: (err) => reportOnce(err) });
  return 'hydrated';
}
