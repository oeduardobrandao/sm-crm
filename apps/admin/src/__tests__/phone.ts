import { vi } from 'vitest';
import { PHONE_QUERY } from '../hooks/useIsPhone';

/** Makes `useIsPhone()` true (or false) for the current test. Returns a restore function. */
export function mockPhone(isPhone = true): () => void {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: isPhone && query === PHONE_QUERY,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

/**
 * A matchMedia whose `matches` can change and whose change listeners are captured, so a test
 * can cross 768px the way rotating an iPhone to landscape does. Starts in phone mode. It does
 * not restore anything: install it after `mockPhone()` and that restore puts the original back.
 */
export function controllableMatchMedia(): (phone: boolean) => void {
  const listeners: Array<() => void> = [];
  let matches = true;
  window.matchMedia = ((query: string) => ({
    get matches() {
      return matches;
    },
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: (_: string, cb: () => void) => listeners.push(cb),
    removeEventListener: (_: string, cb: () => void) => {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  return (phone: boolean) => {
    matches = phone;
    listeners.slice().forEach((l) => l());
  };
}
