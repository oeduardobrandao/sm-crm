import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTheme } from '../useTheme';

const STORAGE_KEY = 'hub-theme';

function mountHubRoot() {
  document.body.replaceChildren();
  const root = document.createElement('div');
  root.className = 'hub-root';
  document.body.appendChild(root);
  return root;
}

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    mountHubRoot();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('defaults to light when nothing is stored', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
    const root = document.querySelector('.hub-root')!;
    expect(root.getAttribute('data-theme')).toBeNull();
  });

  it('initialises from the stored value when it is "dark"', () => {
    localStorage.setItem(STORAGE_KEY, 'dark');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
    expect(document.querySelector('.hub-root')!.getAttribute('data-theme')).toBe('dark');
  });

  it('ignores unknown stored values and falls back to light', () => {
    localStorage.setItem(STORAGE_KEY, 'neon');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
  });

  it('toggles the theme and persists it to localStorage', () => {
    const { result } = renderHook(() => useTheme());

    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe('dark');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
    expect(document.querySelector('.hub-root')!.getAttribute('data-theme')).toBe('dark');

    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe('light');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
    expect(document.querySelector('.hub-root')!.getAttribute('data-theme')).toBeNull();
  });

  it('still returns a usable hook when localStorage.getItem throws', () => {
    const getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    try {
      const { result } = renderHook(() => useTheme());
      expect(result.current.theme).toBe('light');
    } finally {
      getSpy.mockRestore();
    }
  });

  it('swallows errors when localStorage.setItem throws', () => {
    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    try {
      const { result } = renderHook(() => useTheme());
      expect(() => act(() => result.current.toggleTheme())).not.toThrow();
      expect(result.current.theme).toBe('dark');
    } finally {
      setSpy.mockRestore();
    }
  });

  it('no-ops when the .hub-root container is missing', () => {
    document.body.replaceChildren();
    const { result } = renderHook(() => useTheme());
    expect(() => act(() => result.current.toggleTheme())).not.toThrow();
    expect(result.current.theme).toBe('dark');
  });
});
