import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installSilentUpdate } from '../src/silent-update';
import type {
  SilentUpdateBlockerArgs,
  SilentUpdateLocation,
  SilentUpdateRouter,
  SilentUpdateRouterState,
} from '../src/silent-update';
import { reloadForNewDeploy } from '../src/deploy-recovery';
import { holdUnsavedWork, resetUnsavedWorkForTests } from '../src/unsaved-work';

const HTML = (hash: string) =>
  `<!DOCTYPE html><html><head><link rel="stylesheet" href="/assets/index-${hash}.css" /></head>
   <body><script type="module" src="/assets/index-${hash}.js"></script></body></html>`;

const DASHBOARD: SilentUpdateLocation = { pathname: '/dashboard', search: '', hash: '' };

class FakeRouter implements SilentUpdateRouter {
  blockerFn: ((args: SilentUpdateBlockerArgs) => boolean) | null = null;
  subscribers = new Set<(state: SilentUpdateRouterState) => void>();
  state: SilentUpdateRouterState = { blockers: new Map() };
  proceed = vi.fn();

  getBlocker(_key: string, fn: (args: SilentUpdateBlockerArgs) => boolean) {
    this.blockerFn = fn;
    return {};
  }

  deleteBlocker() {
    this.blockerFn = null;
  }

  subscribe(fn: (state: SilentUpdateRouterState) => void) {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  /** What the data router does on navigate(): ask the blocker; when it blocks, publish the state. */
  navigate(
    next: Partial<SilentUpdateLocation> & { pathname: string },
    historyAction = 'PUSH',
    current = DASHBOARD,
  ): boolean {
    const nextLocation = { search: '', hash: '', ...next };
    const blocked =
      this.blockerFn?.({ currentLocation: current, nextLocation, historyAction }) ?? false;
    if (blocked) {
      this.state.blockers.set('silent-update', {
        state: 'blocked',
        location: nextLocation,
        proceed: this.proceed,
      });
    }
    for (const subscriber of this.subscribers) subscriber(this.state);
    return blocked;
  }
}

const reload = vi.fn();
const assign = vi.fn();
const stop = vi.fn();
let visibility: 'visible' | 'hidden' = 'visible';
let online = true;
const uninstalls: Array<() => void> = [];

function mockFetch(responses: Array<string | Error>) {
  let call = 0;
  return vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    const next = responses[Math.min(call++, responses.length - 1)];
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(new Response(next, { status: 200 }));
  });
}

function install(
  router: FakeRouter,
  overrides: Partial<Parameters<typeof installSilentUpdate>[0]> = {},
) {
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
  return uninstall;
}

/** Baseline at t=0, new hashes at the first interval tick. */
async function reachPending(router: FakeRouter) {
  mockFetch([HTML('aaa'), HTML('bbb')]);
  install(router);
  await vi.advanceTimersByTimeAsync(1_500);
}

beforeEach(() => {
  vi.useFakeTimers();
  resetUnsavedWorkForTests();
  document.body.innerHTML = '';
  reload.mockClear();
  assign.mockClear();
  stop.mockClear();
  visibility = 'visible';
  online = true;
  window.sessionStorage.clear();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload, assign },
  });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  Object.defineProperty(window, 'stop', { configurable: true, value: stop });
});

afterEach(() => {
  uninstalls.splice(0).forEach((uninstall) => uninstall());
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (document as unknown as { visibilityState?: string }).visibilityState;
  delete (navigator as unknown as { onLine?: boolean }).onLine;
  delete (window as unknown as { stop?: unknown }).stop;
});

function setVisibility(state: 'visible' | 'hidden') {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('installSilentUpdate: navigation', () => {
  it('lets navigation through before a new version is seen', async () => {
    const router = new FakeRouter();
    mockFetch([HTML('aaa')]);
    install(router);
    await vi.advanceTimersByTimeAsync(2_500);

    expect(router.navigate({ pathname: '/clientes' })).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it('turns a PUSH to a new pathname into a full navigation, keeping search and hash', async () => {
    const router = new FakeRouter();
    await reachPending(router);

    expect(router.navigate({ pathname: '/clientes', search: '?novo=1', hash: '#top' })).toBe(true);
    expect(assign).toHaveBeenCalledWith('/clientes?novo=1#top');
  });

  it('lets a PUSH on the same pathname, a REPLACE and a POP through', async () => {
    const router = new FakeRouter();
    await reachPending(router);

    expect(router.navigate({ pathname: '/dashboard', search: '?tab=2' })).toBe(false);
    expect(router.navigate({ pathname: '/clientes' }, 'REPLACE')).toBe(false);
    expect(router.navigate({ pathname: '/clientes' }, 'POP')).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it('does not swap while offline', async () => {
    const router = new FakeRouter();
    await reachPending(router);
    online = false;

    expect(router.navigate({ pathname: '/clientes' })).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it('does not swap while unsaved work is held, and does once released', async () => {
    const router = new FakeRouter();
    await reachPending(router);
    const release = holdUnsavedWork();

    expect(router.navigate({ pathname: '/clientes' })).toBe(false);
    release();
    expect(router.navigate({ pathname: '/clientes' })).toBe(true);
  });

  it('does not swap while the document looks busy', async () => {
    const router = new FakeRouter();
    await reachPending(router);
    document.body.innerHTML = '<textarea></textarea>';
    const el = document.querySelector('textarea')!;
    el.value = 'rascunho';
    el.dispatchEvent(new Event('input', { bubbles: true }));

    expect(router.navigate({ pathname: '/clientes' })).toBe(false);
    el.remove();
    expect(router.navigate({ pathname: '/clientes' })).toBe(true);
  });

  it('keeps waiting at the watchdog while holdWhile is true', async () => {
    const router = new FakeRouter();
    let mutating = false;
    mockFetch([HTML('aaa'), HTML('bbb')]);
    install(router, { holdWhile: () => mutating });
    await vi.advanceTimersByTimeAsync(1_500);

    router.navigate({ pathname: '/clientes' });
    mutating = true;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(router.proceed).not.toHaveBeenCalled();
    mutating = false;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(router.proceed).toHaveBeenCalledTimes(1);
  });

  it('does not swap while holdWhile reports the app busy', async () => {
    const router = new FakeRouter();
    let mutating = true;
    mockFetch([HTML('aaa'), HTML('bbb')]);
    install(router, { holdWhile: () => mutating });
    await vi.advanceTimersByTimeAsync(1_500);

    expect(router.navigate({ pathname: '/clientes' })).toBe(false);
    mutating = false;
    expect(router.navigate({ pathname: '/clientes' })).toBe(true);
  });

  it('hands the navigation back to the router when the page survives the watchdog, then never swaps again', async () => {
    const router = new FakeRouter();
    await reachPending(router);

    router.navigate({ pathname: '/clientes' });
    expect(assign).toHaveBeenCalledTimes(1);
    expect(reloadForNewDeploy()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(router.proceed).toHaveBeenCalledTimes(1);
    // A swap that did not happen must not leave deploy-recovery suppressed behind.
    expect(reloadForNewDeploy()).toBe(true);

    router.state.blockers.clear();
    expect(router.navigate({ pathname: '/equipe' })).toBe(false);
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('gives up the swap after a bounded number of holdWhile re-arms, without stopping loads while a mutation is still in flight', async () => {
    const router = new FakeRouter();
    mockFetch([HTML('aaa'), HTML('bbb')]);
    let mutating = false;
    install(router, { holdWhile: () => mutating });
    await vi.advanceTimersByTimeAsync(1_500);

    router.navigate({ pathname: '/clientes' });
    mutating = true;
    // swapWatchdogMs: 2_000 from the helper: 1 initial fire plus 3 re-arms is 4 periods.
    await vi.advanceTimersByTimeAsync(2_000 * 3);
    expect(router.proceed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(stop).not.toHaveBeenCalled();
    expect(router.proceed).toHaveBeenCalledTimes(1);
  });

  it('stops loads at the cap once the mutation has finished', async () => {
    const router = new FakeRouter();
    mockFetch([HTML('aaa'), HTML('bbb')]);
    let mutating = false;
    install(router, { holdWhile: () => mutating });
    await vi.advanceTimersByTimeAsync(1_500);

    router.navigate({ pathname: '/clientes' });
    mutating = true;
    await vi.advanceTimersByTimeAsync(2_000 * 2);
    mutating = false;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(router.proceed).toHaveBeenCalledTimes(1);
  });
});

describe('installSilentUpdate: hidden tab', () => {
  it('checks the server after hiddenAfterMs and reloads when a new version landed', async () => {
    const router = new FakeRouter();
    // Baseline at install; the deploy is only visible to the forced check while hidden.
    mockFetch([HTML('aaa'), HTML('bbb')]);
    install(router, { intervalMs: 60_000 });
    await vi.advanceTimersByTimeAsync(0);

    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(4_999);
    expect(reload).not.toHaveBeenCalled();
    // The timer fires at 5 s; the extra ticks flush the check() and the reload that follow it.
    await vi.advanceTimersByTimeAsync(50);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('arms the hidden timer for a tab that starts out hidden, and re-arms while it stays hidden', async () => {
    const router = new FakeRouter();
    visibility = 'hidden';
    mockFetch([HTML('aaa'), HTML('bbb')]);
    install(router, { intervalMs: 60_000 });
    await vi.advanceTimersByTimeAsync(5_050);
    // First fire: forced check sets the baseline; nothing pending yet.
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_050);
    // Second fire: the deploy is now visible to check(); reload while hidden.
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('disarms when the tab becomes visible again', async () => {
    const router = new FakeRouter();
    mockFetch([HTML('aaa'), HTML('bbb')]);
    // Becoming visible re-polls (and finds the deploy); a long idleAfterMs keeps the idle
    // trigger out of this test.
    install(router, { intervalMs: 60_000, idleAfterMs: 60_000 });
    await vi.advanceTimersByTimeAsync(0);

    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(3_000);
    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload a busy document', async () => {
    const router = new FakeRouter();
    mockFetch([HTML('aaa'), HTML('bbb')]);
    install(router, { intervalMs: 60_000 });
    await vi.advanceTimersByTimeAsync(0);
    document.body.innerHTML = '<div role="dialog">Novo post</div>';

    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(5_001);
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload when the server does not answer', async () => {
    const router = new FakeRouter();
    await reachPending(router);
    vi.mocked(fetch).mockRejectedValue(new Error('offline'));

    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(5_001);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('installSilentUpdate: idle', () => {
  it('reloads after idleAfterMs without input, once the server answers', async () => {
    const router = new FakeRouter();
    await reachPending(router);

    await vi.advanceTimersByTimeAsync(10_500);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('input restarts the idle countdown', async () => {
    const router = new FakeRouter();
    await reachPending(router);

    await vi.advanceTimersByTimeAsync(8_000);
    window.dispatchEvent(new Event('keydown'));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload when input arrives while the idle tick is asking the server', async () => {
    const router = new FakeRouter();
    await reachPending(router);
    let answer!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    await vi.advanceTimersByTimeAsync(10_000);
    window.dispatchEvent(new Event('keydown'));
    answer(new Response(HTML('bbb'), { status: 200 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).not.toHaveBeenCalled();
    // The idle tick samples on a fixed grid (every 10 s from install), not from the last
    // input: the next tick after the input (still only 8.5 s of quiet) also declines, so the
    // reload only lands on the tick after that, once a full idleAfterMs has actually passed.
    await vi.advanceTimersByTimeAsync(19_000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not count while the tab is hidden', async () => {
    const router = new FakeRouter();
    await reachPending(router);
    visibility = 'hidden';

    await vi.advanceTimersByTimeAsync(12_000);
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload while unsaved work is held, the document is busy or holdWhile is true', async () => {
    const router = new FakeRouter();
    let mutating = false;
    mockFetch([HTML('aaa'), HTML('bbb')]);
    install(router, { holdWhile: () => mutating });
    await vi.advanceTimersByTimeAsync(1_500);
    const release = holdUnsavedWork();
    await vi.advanceTimersByTimeAsync(10_500);
    expect(reload).not.toHaveBeenCalled();
    release();

    document.body.innerHTML = '<textarea></textarea>';
    const el = document.querySelector('textarea')!;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(10_500);
    expect(reload).not.toHaveBeenCalled();
    el.remove();

    mutating = true;
    await vi.advanceTimersByTimeAsync(10_500);
    expect(reload).not.toHaveBeenCalled();
    mutating = false;
    await vi.advanceTimersByTimeAsync(10_500);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload when the server does not answer', async () => {
    const router = new FakeRouter();
    await reachPending(router);
    vi.mocked(fetch).mockRejectedValue(new Error('offline'));

    await vi.advanceTimersByTimeAsync(10_500);
    expect(reload).not.toHaveBeenCalled();
  });

  it('restarts the idle countdown when the tab becomes visible again', async () => {
    const router = new FakeRouter();
    await reachPending(router);

    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(3_000);
    setVisibility('visible');
    // Idle is counted from the moment the tab came back, not from the last input before hiding.
    await vi.advanceTimersByTimeAsync(8_000);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('installSilentUpdate: uninstall', () => {
  it('removes the blocker, the listeners and the timers', async () => {
    const router = new FakeRouter();
    await reachPending(router);
    const uninstall = uninstalls.pop()!;
    uninstall();

    expect(router.blockerFn).toBeNull();
    expect(router.subscribers.size).toBe(0);
    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(reload).not.toHaveBeenCalled();
  });
});
