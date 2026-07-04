import { createElement, type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthContext } from '@/context/AuthContext';
import { useGuidesPreference } from '../hooks/useGuidesPreference';

// Minimal AuthContext wrapper — only `user.id` matters to the hook.
function wrapperFor(userId: string | null) {
  const value = { user: userId ? { id: userId } : null } as never;
  return ({ children }: { children: ReactNode }) =>
    createElement(AuthContext.Provider, { value }, children);
}

const KEY = (id: string) => `estudio_guias_${id}`;

describe('useGuidesPreference', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('defaults to ON when nothing is stored', () => {
    const { result } = renderHook(() => useGuidesPreference(), { wrapper: wrapperFor('u1') });
    expect(result.current[0]).toBe(true);
  });

  it('reads a stored "off" as hidden', () => {
    localStorage.setItem(KEY('u1'), 'off');
    const { result } = renderHook(() => useGuidesPreference(), { wrapper: wrapperFor('u1') });
    expect(result.current[0]).toBe(false);
  });

  it('persists a toggle to the user-scoped key', () => {
    const { result } = renderHook(() => useGuidesPreference(), { wrapper: wrapperFor('u1') });
    act(() => result.current[1](false));
    expect(localStorage.getItem(KEY('u1'))).toBe('off');
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true));
    expect(localStorage.getItem(KEY('u1'))).toBe('on');
    expect(result.current[0]).toBe(true);
  });

  it('scopes storage per user (one user cannot read another user’s preference)', () => {
    localStorage.setItem(KEY('u2'), 'off');
    const { result } = renderHook(() => useGuidesPreference(), { wrapper: wrapperFor('u1') });
    expect(result.current[0]).toBe(true); // u1 has no key → ON, unaffected by u2's "off"
  });

  it('degrades to an in-memory default with no auth (no write) — e.g. tests without a provider', () => {
    const { result } = renderHook(() => useGuidesPreference());
    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false); // in-memory toggle still works
    expect(localStorage.length).toBe(0); // but nothing was persisted (no user key)
  });
});
