import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTheme } from '../useTheme';

const STORAGE_KEY = 'hub-theme';
const EXPLICIT_KEY = 'hub-theme-explicit';

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

  describe('hasStoredPreference (explicit-choice marker)', () => {
    it('is false when nothing is stored', () => {
      const { result } = renderHook(() => useTheme());
      expect(result.current.hasStoredPreference).toBe(false);
    });

    it('is false when a valid theme value is stored WITHOUT the explicit marker (the auto-persisted-default case)', () => {
      // This is exactly what every first-time visitor's mount effect writes:
      // 'hub-theme' gets the default 'light' persisted even though nobody chose
      // it. Without the separate marker this would misread as "already chosen".
      localStorage.setItem(STORAGE_KEY, 'light');
      const { result } = renderHook(() => useTheme());
      expect(result.current.hasStoredPreference).toBe(false);
    });

    it('is true when the explicit marker is set alongside a valid "light" value', () => {
      localStorage.setItem(STORAGE_KEY, 'light');
      localStorage.setItem(EXPLICIT_KEY, '1');
      const { result } = renderHook(() => useTheme());
      expect(result.current.hasStoredPreference).toBe(true);
    });

    it('is true when the explicit marker is set alongside a valid "dark" value', () => {
      localStorage.setItem(STORAGE_KEY, 'dark');
      localStorage.setItem(EXPLICIT_KEY, '1');
      const { result } = renderHook(() => useTheme());
      expect(result.current.hasStoredPreference).toBe(true);
    });

    it('is false when the explicit marker is set but the stored theme value is unknown', () => {
      localStorage.setItem(STORAGE_KEY, 'neon');
      localStorage.setItem(EXPLICIT_KEY, '1');
      const { result } = renderHook(() => useTheme());
      expect(result.current.hasStoredPreference).toBe(false);
    });

    it('stays at its init value for the lifetime of the hook even after setTheme/toggleTheme are called', () => {
      const { result } = renderHook(() => useTheme());
      act(() => result.current.setTheme('dark'));
      act(() => result.current.toggleTheme());
      expect(result.current.hasStoredPreference).toBe(false);
    });
  });

  describe('toggleTheme sets the explicit-choice marker', () => {
    it('writes hub-theme-explicit="1" on toggle', () => {
      const { result } = renderHook(() => useTheme());
      expect(localStorage.getItem(EXPLICIT_KEY)).toBeNull();
      act(() => result.current.toggleTheme());
      expect(localStorage.getItem(EXPLICIT_KEY)).toBe('1');
    });

    it('a later mount picks up the marker written by an earlier toggle', () => {
      const first = renderHook(() => useTheme());
      act(() => first.result.current.toggleTheme());
      first.unmount();

      const second = renderHook(() => useTheme());
      expect(second.result.current.hasStoredPreference).toBe(true);
    });
  });

  describe('setTheme', () => {
    it('applies and persists the given theme', () => {
      const { result } = renderHook(() => useTheme());

      act(() => result.current.setTheme('dark'));
      expect(result.current.theme).toBe('dark');
      expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
      expect(document.querySelector('.hub-root')!.getAttribute('data-theme')).toBe('dark');

      act(() => result.current.setTheme('light'));
      expect(result.current.theme).toBe('light');
      expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
      expect(document.querySelector('.hub-root')!.getAttribute('data-theme')).toBeNull();
    });

    it('does NOT set the explicit marker by default (the HubShell default-appearance application path)', () => {
      const { result } = renderHook(() => useTheme());
      act(() => result.current.setTheme('dark'));
      expect(localStorage.getItem(EXPLICIT_KEY)).toBeNull();
    });

    it('sets the explicit marker when called with { explicit: true }', () => {
      const { result } = renderHook(() => useTheme());
      act(() => result.current.setTheme('dark', { explicit: true }));
      expect(localStorage.getItem(EXPLICIT_KEY)).toBe('1');
    });
  });
});
