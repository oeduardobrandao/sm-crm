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
