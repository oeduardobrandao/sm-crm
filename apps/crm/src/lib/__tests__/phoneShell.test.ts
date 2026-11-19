import { act, renderHook } from '@testing-library/react';
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

describe('useIsTabletShell', () => {
  let media: ReturnType<typeof mockMatchMediaEnv> | null = null;
  afterEach(() => {
    media?.restore();
    media = null;
  });

  it('is true on iPads in both orientations and on an iPad mini in landscape', () => {
    for (const env of [touch(820, 1180), touch(1180, 820), touch(1133, 744)]) {
      media = mockMatchMediaEnv(env);
      expect(renderHook(() => useIsTabletShell()).result.current, `${env.width}`).toBe(true);
      media.restore();
    }
  });

  it('is false on a phone in either orientation and on a desktop', () => {
    for (const env of [
      touch(390, 844),
      touch(844, 390),
      touch(956, 440),
      // iPad mini in portrait is under 768px wide: the plain phone shell.
      touch(744, 1133),
      { width: 1440, height: 900, hover: 'hover', pointer: 'fine' } as MediaEnv,
    ]) {
      media = mockMatchMediaEnv(env);
      expect(renderHook(() => useIsTabletShell()).result.current, `${env.width}`).toBe(false);
      media.restore();
    }
  });

  it('stays true when the iOS app keyboard shrinks a landscape iPad under 600px', () => {
    media = mockMatchMediaEnv(touch(1180, 820));
    const { result } = renderHook(() => useIsTabletShell());
    expect(result.current).toBe(true);
    act(() => {
      media!.setEnv({ ...touch(1180, 400), screen: { width: 1180, height: 820 } });
    });
    expect(result.current).toBe(true);
  });

  it('is false without a screen size (old test envs)', () => {
    media = mockMatchMediaEnv({ ...touch(1180, 820), screen: { width: 0, height: 0 } });
    expect(renderHook(() => useIsTabletShell()).result.current).toBe(false);
  });
});
