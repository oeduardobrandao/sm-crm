import { createElement } from 'react';
import type { createRoot, hydrateRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountApp } from '../mountApp';

type HydrateOptions = { onRecoverableError?: (err: unknown, info: unknown) => void };

function setup(preload: () => Promise<void>, isSsr: boolean) {
  const container = document.createElement('div');
  const element = createElement('div', null, 'app');
  const report = vi.fn();
  const render = vi.fn();
  const create = vi.fn(() => ({ render }));
  let hydrateOptions: HydrateOptions | undefined;
  const hydrate = vi.fn((_c: unknown, _e: unknown, opts?: HydrateOptions) => {
    hydrateOptions = opts;
    return {};
  });
  const run = (extra: { timeoutMs?: number; ssrTimeoutMs?: number } = {}) =>
    mountApp({
      container,
      element,
      isSsr,
      preload,
      report,
      hydrate: hydrate as unknown as typeof hydrateRoot,
      create: create as unknown as typeof createRoot,
      ...extra,
    });
  return {
    container,
    element,
    report,
    render,
    create,
    hydrate,
    run,
    recoverable: (err: unknown) => hydrateOptions?.onRecoverableError?.(err, {}),
  };
}

const never = () => new Promise<void>(() => {});

afterEach(() => {
  vi.useRealTimers();
});

describe('mountApp, client-rendered path', () => {
  it('renders with createRoot once the preload resolves', async () => {
    const t = setup(() => Promise.resolve(), false);
    await expect(t.run()).resolves.toBe('rendered');
    expect(t.create).toHaveBeenCalledWith(t.container);
    expect(t.render).toHaveBeenCalledWith(t.element);
    expect(t.hydrate).not.toHaveBeenCalled();
    expect(t.report).not.toHaveBeenCalled();
  });

  it('renders anyway when the preload rejects, without reporting', async () => {
    const t = setup(() => Promise.reject(new Error('chunk')), false);
    await expect(t.run()).resolves.toBe('rendered');
    expect(t.render).toHaveBeenCalledTimes(1);
    expect(t.report).not.toHaveBeenCalled();
  });

  it('renders after the 2000 ms timeout when the preload stalls', async () => {
    vi.useFakeTimers();
    const t = setup(never, false);
    const result = t.run();
    await vi.advanceTimersByTimeAsync(1999);
    expect(t.create).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe('rendered');
    expect(t.render).toHaveBeenCalledTimes(1);
  });
});

describe('mountApp, server-rendered path', () => {
  it('hydrates once the preload resolves and never calls createRoot', async () => {
    const t = setup(() => Promise.resolve(), true);
    await expect(t.run()).resolves.toBe('hydrated');
    expect(t.hydrate).toHaveBeenCalledTimes(1);
    expect(t.hydrate.mock.calls[0][0]).toBe(t.container);
    expect(t.hydrate.mock.calls[0][1]).toBe(t.element);
    expect(t.create).not.toHaveBeenCalled();
    expect(t.report).not.toHaveBeenCalled();
  });

  it('reports recoverable hydration errors at most once', async () => {
    const t = setup(() => Promise.resolve(), true);
    await t.run();
    t.recoverable(new Error('mismatch 1'));
    t.recoverable(new Error('mismatch 2'));
    expect(t.report).toHaveBeenCalledTimes(1);
    expect(t.report).toHaveBeenCalledWith(new Error('mismatch 1'));
  });

  it('reports the first failure, retries once and hydrates when the retry succeeds', async () => {
    const preload = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('chunk'))
      .mockResolvedValueOnce(undefined);
    const t = setup(preload, true);
    await expect(t.run()).resolves.toBe('hydrated');
    expect(preload).toHaveBeenCalledTimes(2);
    expect(t.report).toHaveBeenCalledTimes(1);
    expect(t.hydrate).toHaveBeenCalledTimes(1);
    // A later hydration mismatch must not report a second time on the same page load.
    t.recoverable(new Error('mismatch'));
    expect(t.report).toHaveBeenCalledTimes(1);
    expect(t.create).not.toHaveBeenCalled();
  });

  it('leaves the server HTML untouched after two failures', async () => {
    const preload = vi.fn(() => Promise.reject(new Error('chunk')));
    const t = setup(preload, true);
    t.container.innerHTML = '<main>server html</main>';
    await expect(t.run()).resolves.toBe('static');
    expect(preload).toHaveBeenCalledTimes(2);
    expect(t.report).toHaveBeenCalledTimes(1);
    expect(t.hydrate).not.toHaveBeenCalled();
    expect(t.create).not.toHaveBeenCalled();
    expect(t.container.innerHTML).toBe('<main>server html</main>');
  });

  it('ends static after two timeouts when the preload never settles', async () => {
    vi.useFakeTimers();
    const preload = vi.fn(never);
    const t = setup(preload, true);
    const result = t.run();
    await vi.advanceTimersByTimeAsync(9999);
    expect(preload).toHaveBeenCalledTimes(1);
    expect(t.report).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(t.report).toHaveBeenCalledTimes(1);
    expect(preload).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10000);
    await expect(result).resolves.toBe('static');
    expect(t.report).toHaveBeenCalledTimes(1);
    expect(t.hydrate).not.toHaveBeenCalled();
    expect(t.create).not.toHaveBeenCalled();
  });

  it('does not hydrate when the chunk arrives after the page went static', async () => {
    vi.useFakeTimers();
    let lateResolve: (() => void) | undefined;
    const preload = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          lateResolve = resolve;
        }),
    );
    const t = setup(preload, true);
    const result = t.run({ ssrTimeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(200);
    await expect(result).resolves.toBe('static');
    lateResolve?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.hydrate).not.toHaveBeenCalled();
  });

  it('reports a synchronous preload throw as a failure', async () => {
    const preload = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => {
        throw new Error('sync');
      })
      .mockResolvedValueOnce(undefined);
    const t = setup(preload, true);
    await expect(t.run()).resolves.toBe('hydrated');
    expect(t.report).toHaveBeenCalledTimes(1);
  });
});
