import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { chartInk, chartFont, useFontsReady } from './chartInk';

describe('chartInk', () => {
  it('returns near-white for dark mode', () => {
    expect(chartInk('dark')).toBe('245, 245, 245');
  });

  it('returns near-black for light mode', () => {
    expect(chartInk('light')).toBe('23, 23, 23');
  });
});

describe('chartFont', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--hub-font-sans');
  });

  it('reads the live --hub-font-sans value off :root', () => {
    document.documentElement.style.setProperty(
      '--hub-font-sans',
      "'Space Grotesk', ui-sans-serif, system-ui, sans-serif",
    );
    expect(chartFont()).toBe("'Space Grotesk', ui-sans-serif, system-ui, sans-serif");
  });

  it('falls back to the neutral Instrument Sans stack when the variable is unset', () => {
    expect(chartFont()).toBe("'Instrument Sans', sans-serif");
  });
});

describe('useFontsReady', () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(document, 'fonts');

  afterEach(() => {
    if (originalDescriptor) {
      Object.defineProperty(document, 'fonts', originalDescriptor);
    } else {
      // @ts-expect-error -- test-only cleanup; jsdom doesn't define `fonts` at all
      delete document.fonts;
    }
  });

  it('stays at 0 when document.fonts is unavailable (jsdom has no FontFaceSet by default)', () => {
    // Confirms the guard the implementation relies on: this repo's jsdom
    // genuinely leaves document.fonts undefined, so this isn't a contrived case.
    expect(document.fonts).toBeUndefined();
    const { result } = renderHook(() => useFontsReady());
    expect(result.current).toBe(0);
  });

  it('bumps once after a mocked document.fonts.ready resolves', async () => {
    let resolveReady!: () => void;
    const ready = new Promise<FontFaceSet>((resolve) => {
      resolveReady = () => resolve({} as FontFaceSet);
    });
    Object.defineProperty(document, 'fonts', {
      value: { ready },
      configurable: true,
    });

    const { result } = renderHook(() => useFontsReady());
    expect(result.current).toBe(0);

    resolveReady();
    await waitFor(() => expect(result.current).toBe(1));
  });

  it('does not bump again on a second resolution of a stale promise after unmount', async () => {
    let resolveReady!: () => void;
    const ready = new Promise<FontFaceSet>((resolve) => {
      resolveReady = () => resolve({} as FontFaceSet);
    });
    Object.defineProperty(document, 'fonts', {
      value: { ready },
      configurable: true,
    });

    const { result, unmount } = renderHook(() => useFontsReady());
    unmount();
    resolveReady();

    // Give the microtask queue a chance to run; the cancelled flag must have
    // suppressed the state update, so there is nothing to assert against a
    // live `result.current` post-unmount beyond "this doesn't throw".
    await Promise.resolve();
    expect(result.current).toBe(0);
  });
});
