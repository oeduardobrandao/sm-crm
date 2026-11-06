import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const limits = { features: null as Record<string, boolean> | null, isSuccess: false };
vi.mock('@/hooks/useWorkspaceLimits', () => ({ useWorkspaceLimits: () => limits }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));

import { useVidro } from '../useVidro';
import { captureEvent } from '@/lib/analytics';

beforeEach(() => {
  limits.features = null;
  limits.isSuccess = false;
});
afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-look');
});

describe('useVidro', () => {
  it('is off when the flag is absent and on when it is true', () => {
    limits.isSuccess = true;
    limits.features = {};
    const { result, rerender } = renderHook(() => useVidro());
    expect(result.current.active).toBe(false);
    limits.features = { feature_crm_vidro: true };
    rerender();
    expect(result.current.active).toBe(true);
    expect(document.documentElement.getAttribute('data-look')).toBe('vidro');
    expect(localStorage.getItem('look-vidro')).toBe('u1');
  });

  it('uses the pre-painted attribute while loading and does not touch the cache', () => {
    document.documentElement.setAttribute('data-look', 'vidro');
    localStorage.setItem('look-vidro', 'u1');
    const { result } = renderHook(() => useVidro());
    expect(result.current.active).toBe(true);
    expect(localStorage.getItem('look-vidro')).toBe('u1');
  });

  it('keeps vidro when a later refetch fails (success, then error with data kept)', () => {
    limits.isSuccess = true;
    limits.features = { feature_crm_vidro: true };
    const { result, rerender } = renderHook(() => useVidro());
    expect(result.current.active).toBe(true);
    // TanStack v5: a failed refetch sets status 'error' (isSuccess false) even with data present.
    limits.isSuccess = false;
    rerender();
    expect(result.current.active).toBe(true);
    expect(document.documentElement.getAttribute('data-look')).toBe('vidro');
    expect(localStorage.getItem('look-vidro')).toBe('u1');
  });

  it('keeps classic when a later refetch fails after resolving off', () => {
    limits.isSuccess = true;
    limits.features = {};
    const { result, rerender } = renderHook(() => useVidro());
    limits.isSuccess = false;
    limits.features = null;
    rerender();
    expect(result.current.active).toBe(false);
    expect(document.documentElement.hasAttribute('data-look')).toBe(false);
  });

  it('opt-out turns it off, stores per user and fires the event', () => {
    limits.isSuccess = true;
    limits.features = { feature_crm_vidro: true };
    const { result } = renderHook(() => useVidro());
    act(() => result.current.setOptedOut(true));
    expect(result.current.active).toBe(false);
    expect(result.current.enabled).toBe(true);
    expect(localStorage.getItem('look-optout:u1')).toBe('1');
    expect(document.documentElement.hasAttribute('data-look')).toBe(false);
    expect(captureEvent).toHaveBeenCalledWith('vidro_look_toggled', { on: false });
  });
});
