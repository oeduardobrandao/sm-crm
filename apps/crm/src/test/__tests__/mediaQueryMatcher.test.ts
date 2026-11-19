import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useIsPhoneShell } from '@/lib/phoneShell';
import { mockMatchMediaEnv, type MediaEnv } from '../mediaQueryMatcher';

const DESKTOP: MediaEnv = { width: 1440, height: 900, hover: 'hover', pointer: 'fine' };
const WIDE_DESKTOP: MediaEnv = { width: 1920, height: 1080, hover: 'hover', pointer: 'fine' };
const TABLET_TOUCH: MediaEnv = { width: 1180, height: 820, hover: 'none', pointer: 'coarse' };

describe('mockMatchMediaEnv', () => {
  let handle: ReturnType<typeof mockMatchMediaEnv> | null = null;
  afterEach(() => {
    handle?.restore();
    handle = null;
  });

  it('drives a live hook and flips it on setEnv', () => {
    handle = mockMatchMediaEnv(DESKTOP);
    const { result } = renderHook(() => useIsPhoneShell());
    expect(result.current).toBe(false);
    act(() => handle!.setEnv(TABLET_TOUCH));
    expect(result.current).toBe(true);
  });

  it('does not fire a listener when the result does not change', () => {
    handle = mockMatchMediaEnv(DESKTOP);
    const listener = vi.fn();
    window.matchMedia('(min-width: 768px)').addEventListener('change', listener);
    handle.setEnv(WIDE_DESKTOP);
    expect(listener).not.toHaveBeenCalled();
    handle.setEnv({ ...DESKTOP, width: 500 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('registers the same (query, listener) pair once', () => {
    handle = mockMatchMediaEnv(DESKTOP);
    const listener = vi.fn();
    window.matchMedia('(min-width: 768px)').addEventListener('change', listener);
    window.matchMedia('(min-width: 768px)').addEventListener('change', listener);
    handle.setEnv({ ...DESKTOP, width: 500 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('legacy addListener/removeListener register and unregister change listeners', () => {
    handle = mockMatchMediaEnv(DESKTOP);
    const listener = vi.fn();
    const mql = window.matchMedia('(min-width: 768px)');
    mql.addListener(listener);
    handle.setEnv({ ...DESKTOP, width: 500 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({ matches: false });
    mql.removeListener(listener);
    handle.setEnv(DESKTOP);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('restore puts back matchMedia, innerWidth and innerHeight', () => {
    const original = {
      matchMedia: window.matchMedia,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    };
    const local = mockMatchMediaEnv(TABLET_TOUCH);
    expect(window.innerWidth).toBe(1180);
    expect(window.innerHeight).toBe(820);
    expect(window.matchMedia).not.toBe(original.matchMedia);
    local.restore();
    expect(window.matchMedia).toBe(original.matchMedia);
    expect(window.innerWidth).toBe(original.innerWidth);
    expect(window.innerHeight).toBe(original.innerHeight);
  });
});
