import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { PhoneLayoutContext } from '@/components/layout/PhoneLayoutContext';
import { matchesQuery, mockMatchMediaEnv, type MediaEnv } from '@/test/mediaQueryMatcher';
import {
  DESKTOP_SHELL_QUERY,
  PHONE_SHELL_QUERY,
  PHONE_WIDE_QUERY,
  TABLET_SHELL_QUERY,
  desktopShellQuery,
  useIsPhoneShell,
  useIsPhoneUi,
  useIsTabletShell,
} from '../phoneShell';

const touch = (width: number, height: number): MediaEnv => ({
  width,
  height,
  hover: 'none',
  pointer: 'coarse',
});

describe('phone shell queries', () => {
  it('phone and desktop shell queries are exclusive and exhaustive', () => {
    for (const width of [390, 767, 768, 820, 1180, 1440]) {
      for (const hover of ['none', 'hover'] as const) {
        for (const pointer of ['none', 'coarse', 'fine'] as const) {
          const env: MediaEnv = { width, height: 900, hover, pointer };
          expect(
            matchesQuery(PHONE_SHELL_QUERY, env) !== matchesQuery(DESKTOP_SHELL_QUERY, env),
          ).toBe(true);
        }
      }
    }
  });

  it('iPad portrait and landscape are phone shell', () => {
    for (const env of [touch(820, 1180), touch(1180, 820)]) {
      expect(matchesQuery(PHONE_SHELL_QUERY, env)).toBe(true);
      expect(matchesQuery(TABLET_SHELL_QUERY, env)).toBe(true);
    }
  });

  it('iPhone landscape is phone shell and wide, not tablet', () => {
    const env = touch(844, 390);
    expect(matchesQuery(PHONE_SHELL_QUERY, env)).toBe(true);
    expect(matchesQuery(PHONE_WIDE_QUERY, env)).toBe(true);
    expect(matchesQuery(TABLET_SHELL_QUERY, env)).toBe(false);
  });

  it('touch laptop with a mouse stays desktop', () => {
    const env: MediaEnv = { width: 1280, height: 800, hover: 'hover', pointer: 'coarse' };
    expect(matchesQuery(DESKTOP_SHELL_QUERY, env)).toBe(true);
  });

  it('narrow desktop window stays desktop', () => {
    const env: MediaEnv = { width: 800, height: 900, hover: 'hover', pointer: 'fine' };
    expect(matchesQuery(DESKTOP_SHELL_QUERY, env)).toBe(true);
    expect(matchesQuery(PHONE_SHELL_QUERY, env)).toBe(false);
  });

  it('desktopShellQuery builds ranges and screen prefixes', () => {
    expect(desktopShellQuery(768)).toBe(DESKTOP_SHELL_QUERY);
    const mouse: MediaEnv = { width: 1180, height: 820, hover: 'hover', pointer: 'fine' };
    expect(matchesQuery(desktopShellQuery(901), mouse)).toBe(true);
    expect(matchesQuery(desktopShellQuery(901), touch(1180, 820))).toBe(false);
    expect(matchesQuery(desktopShellQuery(768, { maxWidth: 1100 }), mouse)).toBe(false);
    expect(
      matchesQuery(desktopShellQuery(768, { screen: true }), { ...mouse, media: 'print' }),
    ).toBe(false);
    expect(matchesQuery(desktopShellQuery(768, { screen: true }), mouse)).toBe(true);
  });

  it('useIsDesktop and useIsPhoneShell polarity in jsdom', () => {
    expect(renderHook(() => useIsDesktop(768)).result.current).toBe(false);
    expect(renderHook(() => useIsPhoneShell()).result.current).toBe(true);
    expect(renderHook(() => useIsTabletShell()).result.current).toBe(false);
  });
});

describe('useIsPhoneUi', () => {
  let media: ReturnType<typeof mockMatchMediaEnv> | null = null;
  afterEach(() => {
    media?.restore();
    media = null;
  });
  const insideShell = ({ children }: { children: ReactNode }) =>
    createElement(
      PhoneLayoutContext.Provider,
      { value: { isPhone: true, register: () => () => {} } },
      children,
    );

  it('follows the shell inside AppLayout, even on a wide touch tablet', () => {
    media = mockMatchMediaEnv(touch(1180, 820));
    expect(renderHook(() => useIsPhoneUi(), { wrapper: insideShell }).result.current).toBe(true);
  });

  it('falls back to the width outside the shell', () => {
    media = mockMatchMediaEnv({ width: 390, height: 844, hover: 'none', pointer: 'coarse' });
    expect(renderHook(() => useIsPhoneUi()).result.current).toBe(true);
    media.restore();
    media = mockMatchMediaEnv({ width: 1440, height: 900, hover: 'hover', pointer: 'fine' });
    expect(renderHook(() => useIsPhoneUi()).result.current).toBe(false);
  });
});
