import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useIsPhone } from '../useIsPhone';
import { mockPhone } from '../../__tests__/phone';

describe('useIsPhone', () => {
  let restore: (() => void) | null = null;
  afterEach(() => restore?.());

  it('is false under the default jsdom stub (desktop)', () => {
    expect(renderHook(() => useIsPhone()).result.current).toBe(false);
  });

  it('is true when the phone query matches', () => {
    restore = mockPhone();
    expect(renderHook(() => useIsPhone()).result.current).toBe(true);
  });

  it('follows change events', () => {
    const listeners: Array<() => void> = [];
    let matches = false;
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      get matches() {
        return matches;
      },
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: (_: string, cb: () => void) => listeners.push(cb),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    restore = () => {
      window.matchMedia = original;
    };
    const { result } = renderHook(() => useIsPhone());
    expect(result.current).toBe(false);
    act(() => {
      matches = true;
      listeners.forEach((l) => l());
    });
    expect(result.current).toBe(true);
  });
});
