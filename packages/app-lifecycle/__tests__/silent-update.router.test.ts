import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryRouter } from 'react-router';
import { installSilentUpdate } from '../src/silent-update';
import { resetUnsavedWorkForTests } from '../src/unsaved-work';

/**
 * `installSilentUpdate` against React Router's real data router (`createMemoryRouter`),
 * not the `FakeRouter` test double in `silent-update.test.ts`. The fake proved the module's
 * own logic; this proves the module's assumptions about the router's blocker contract hold
 * against the real implementation (only the last registered blocker is consulted, `proceed()`
 * resumes the navigation, a completed navigation resets every blocker to `unblocked`).
 *
 * Helpers below are copied from `silent-update.test.ts`, not imported, since that file's
 * `FakeRouter` and its setup are local test doubles, not part of the module's public surface.
 */

const HTML = (hash: string) =>
  `<!DOCTYPE html><html><head><link rel="stylesheet" href="/assets/index-${hash}.css" /></head>
   <body><script type="module" src="/assets/index-${hash}.js"></script></body></html>`;

const reload = vi.fn();
const assign = vi.fn();
const stop = vi.fn();
const uninstalls: Array<() => void> = [];
const routersToDispose: Array<{ dispose: () => void }> = [];

function mockFetch(responses: Array<string | Error>) {
  let call = 0;
  return vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    const next = responses[Math.min(call++, responses.length - 1)];
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(new Response(next, { status: 200 }));
  });
}

const ROUTES = [
  { path: '/dashboard', element: null },
  { path: '/clientes', element: null },
  { path: '/equipe', element: null },
];

function createRouter() {
  const router = createMemoryRouter(ROUTES, { initialEntries: ['/dashboard'] });
  routersToDispose.push(router);
  return router;
}

/** Baseline at t=0, new hashes at the first interval tick: reaches `pending` at t=1500. */
async function reachPending(overrides: Partial<Parameters<typeof installSilentUpdate>[0]> = {}) {
  mockFetch([HTML('aaa'), HTML('bbb')]);
  const router = createRouter();
  const uninstall = installSilentUpdate({
    router,
    documentUrl: '/app.html',
    intervalMs: 1_000,
    hiddenAfterMs: 5_000,
    idleAfterMs: 10_000,
    swapWatchdogMs: 2_000,
    ...overrides,
  });
  uninstalls.push(uninstall);
  await vi.advanceTimersByTimeAsync(1_500);
  return router;
}

beforeEach(() => {
  vi.useFakeTimers();
  resetUnsavedWorkForTests();
  reload.mockClear();
  assign.mockClear();
  stop.mockClear();
  window.sessionStorage.clear();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload, assign },
  });
  Object.defineProperty(window, 'stop', { configurable: true, value: stop });
});

afterEach(() => {
  uninstalls.splice(0).forEach((uninstall) => uninstall());
  routersToDispose.splice(0).forEach((router) => router.dispose());
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (window as unknown as { stop?: unknown }).stop;
});

describe('installSilentUpdate against the real React Router data router', () => {
  it(
    'blocks a PUSH to a new pathname (keeping search and hash), gives up the swap at the ' +
      'watchdog handing the navigation to the router, then never blocks again',
    async () => {
      const router = await reachPending();

      await router.navigate('/clientes?x=1#h');
      expect(assign).toHaveBeenCalledWith('/clientes?x=1#h');
      expect(router.state.blockers.get('silent-update')?.state).toBe('blocked');
      expect(router.state.location.pathname).toBe('/dashboard');

      await vi.advanceTimersByTimeAsync(2_000);
      expect(stop).toHaveBeenCalledTimes(1);
      // `proceed()` is React Router's own closure here, not a mock: its effect is the proof
      // it ran, and it only runs right after `stop()` in `giveUpSwap`'s give-up branch, so
      // the router having actually navigated also proves the ordering.
      expect(router.state.location.pathname).toBe('/clientes');
      expect(router.state.blockers.get('silent-update')?.state).toBe('unblocked');

      // One failed attempt per tab: the next PUSH to a new pathname goes through untouched.
      await router.navigate('/equipe');
      expect(assign).toHaveBeenCalledTimes(1);
      expect(router.state.location.pathname).toBe('/equipe');
    },
  );

  it('lets a REPLACE through untouched', async () => {
    const router = await reachPending();

    await router.navigate('/clientes', { replace: true });
    expect(assign).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/clientes');
  });

  it('lets a PUSH on the same pathname through untouched', async () => {
    const router = await reachPending();

    await router.navigate('/dashboard?tab=2');
    expect(assign).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/dashboard');
    expect(router.state.location.search).toBe('?tab=2');
  });

  it('uninstall removes the blocker: navigation proceeds untouched afterward', async () => {
    const router = await reachPending();
    const uninstall = uninstalls.pop()!;
    uninstall();

    await router.navigate('/clientes');
    expect(assign).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/clientes');
  });
});
