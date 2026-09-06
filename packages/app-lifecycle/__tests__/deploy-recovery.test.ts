import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  installDeployRecovery,
  isModuleLoadError,
  reloadForNewDeploy,
  suppressDeployRecovery,
} from '../src/deploy-recovery';

const reload = vi.fn();

beforeEach(() => {
  reload.mockClear();
  window.sessionStorage.clear();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('isModuleLoadError', () => {
  it('matches the browser wordings for a missing chunk', () => {
    // Chrome, Firefox, Safari and Vite's CSS preload respectively.
    expect(
      isModuleLoadError(new Error('Failed to fetch dynamically imported module: /assets/a.js')),
    ).toBe(true);
    expect(
      isModuleLoadError(new Error('error loading dynamically imported module: /assets/a.js')),
    ).toBe(true);
    expect(isModuleLoadError(new Error('Importing a module script failed.'))).toBe(true);
    expect(isModuleLoadError(new Error('Unable to preload CSS for /assets/a.css'))).toBe(true);
  });

  it('ignores unrelated errors', () => {
    expect(isModuleLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isModuleLoadError(undefined)).toBe(false);
    expect(isModuleLoadError({ message: 'Failed to fetch dynamically imported module' })).toBe(
      false,
    );
  });
});

describe('reloadForNewDeploy', () => {
  it('reloads once and records the attempt', () => {
    expect(reloadForNewDeploy()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem('mesaas:deploy-reload-at')).not.toBeNull();
  });

  it('declines a second reload inside the cooldown', () => {
    reloadForNewDeploy();
    expect(reloadForNewDeploy()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('allows another reload once the cooldown has passed', () => {
    vi.useFakeTimers();
    reloadForNewDeploy();
    vi.advanceTimersByTime(20_000);
    expect(reloadForNewDeploy()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('declines when sessionStorage is unavailable, since the loop guard would be gone', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(reloadForNewDeploy()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('declines while a swap suppresses it, and reloads again once released', () => {
    const release = suppressDeployRecovery();
    expect(reloadForNewDeploy()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    release();
    expect(reloadForNewDeploy()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('installDeployRecovery', () => {
  it('reloads and swallows the error on vite:preloadError', () => {
    installDeployRecovery();
    const event = new Event('vite:preloadError', { cancelable: true });

    window.dispatchEvent(event);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('lets the error through when it declines to reload', () => {
    installDeployRecovery();
    // Burn the one reload the cooldown allows.
    reloadForNewDeploy();
    const event = new Event('vite:preloadError', { cancelable: true });

    window.dispatchEvent(event);

    expect(reload).toHaveBeenCalledTimes(1);
    // Not prevented: swallowing it here would resolve the import to `undefined`
    // and crash somewhere less legible than the error boundary.
    expect(event.defaultPrevented).toBe(false);
  });

  it('reloads on an unhandled module-load rejection', () => {
    installDeployRecovery();
    const event = new Event('unhandledrejection') as Event & { reason: unknown };
    event.reason = new Error('Failed to fetch dynamically imported module: /assets/a.js');

    window.dispatchEvent(event);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('ignores unrelated unhandled rejections', () => {
    installDeployRecovery();
    const event = new Event('unhandledrejection') as Event & { reason: unknown };
    event.reason = new Error('boom');

    window.dispatchEvent(event);

    expect(reload).not.toHaveBeenCalled();
  });
});
