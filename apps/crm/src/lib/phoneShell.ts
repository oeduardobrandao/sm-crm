import { useEffect, useState } from 'react';
import { usePhoneLayout } from '@/components/layout/PhoneLayoutContext';

/**
 * Phone shell vs desktop shell. The phone layout is used on narrow viewports
 * and on every touch-primary device (iPad included); the desktop layout needs
 * at least 768px AND a mouse/trackpad (or no pointer info at all).
 *
 * The two queries are exclusive and exhaustive. Nothing here touches `window`
 * at module scope: the landing is server-rendered in Node.
 */
export const PHONE_SHELL_QUERY = '(max-width: 767px), (hover: none) and (pointer: coarse)';

export const DESKTOP_SHELL_QUERY =
  '(min-width: 768px) and (hover: hover), (min-width: 768px) and (pointer: fine), (min-width: 768px) and (pointer: none)';

/**
 * The tablet rule as one media query, as the plan first wrote it. No longer the source of
 * truth: `useIsTabletShell()` reads the screen's shortest side instead of the viewport
 * height (see there), and the CSS uses `PHONE_WIDE_QUERY`. Kept for the plan and its tests.
 */
export const TABLET_SHELL_QUERY =
  '(hover: none) and (pointer: coarse) and (min-width: 768px) and (min-height: 600px)';

/** A tablet's screen is at least this tall in landscape (iPad mini: 744). iPhones top out at 440. */
export const TABLET_MIN_SCREEN_SIDE = 600;

/** Touch-primary at 768px or wider, in any orientation (tablets and landscape phones). */
export const PHONE_WIDE_QUERY = '(hover: none) and (pointer: coarse) and (min-width: 768px)';

/** The three-branch desktop query at `minWidth`, optionally capped and `screen`-scoped. */
export function desktopShellQuery(
  minWidth: number,
  opts: { maxWidth?: number; screen?: boolean } = {},
): string {
  const prefix = opts.screen ? 'screen and ' : '';
  const range =
    `(min-width: ${minWidth}px)` +
    (opts.maxWidth !== undefined ? ` and (max-width: ${opts.maxWidth}px)` : '');
  return ['(hover: hover)', '(pointer: fine)', '(pointer: none)']
    .map((feature) => `${prefix}${range} and ${feature}`)
    .join(', ');
}

function readMatch(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false;
}

/** Live `matchMedia`; false when `matchMedia` is missing (SSR, old test envs). */
export function useMediaQueryMatch(query: string): boolean {
  const [matches, setMatches] = useState(() => readMatch(query));
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [query]);
  return matches;
}

/** True unless the desktop shell applies (so true in jsdom, where matchMedia is stubbed false). */
export function useIsPhoneShell(): boolean {
  return !useMediaQueryMatch(DESKTOP_SHELL_QUERY);
}

/** Positive form of the phone question; false in jsdom, so tests render desktop by default. */
export function useIsPhoneShellMatch(): boolean {
  return useMediaQueryMatch(PHONE_SHELL_QUERY);
}

/** Shortest side of the device screen in CSS px; 0 without `window.screen` (SSR, old test envs). */
function readScreenShortSide(): number {
  if (typeof window === 'undefined' || !window.screen) return 0;
  return Math.min(window.screen.width || 0, window.screen.height || 0);
}

/**
 * Touch tablet: the wide phone shell (touch, 768px or wider) on a screen whose shortest side
 * is at least 600px, so a phone held sideways (440px at most) stays out. It reads the screen,
 * not the viewport height: the iOS app resizes the web view above the keyboard
 * (`Keyboard.resize: 'native'`), which takes a landscape iPad under 600px tall while the user
 * types, and a viewport rule would swap the editor for the phone view mid-edit.
 */
export function useIsTabletShell(): boolean {
  const wide = useIsWidePhoneShell();
  const [shortSide, setShortSide] = useState(readScreenShortSide);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const read = () => setShortSide(readScreenShortSide());
    read();
    window.addEventListener('resize', read);
    window.addEventListener('orientationchange', read);
    return () => {
      window.removeEventListener('resize', read);
      window.removeEventListener('orientationchange', read);
    };
  }, [wide]);
  return wide && shortSide >= TABLET_MIN_SCREEN_SIDE;
}

export function useIsWidePhoneShell(): boolean {
  return useMediaQueryMatch(PHONE_WIDE_QUERY);
}

/** Raw `(min-width: Npx)`, for code that can render outside `AppLayout`. */
export function useMinWidth(px: number): boolean {
  return useMediaQueryMatch(`(min-width: ${px}px)`);
}

/**
 * Phone UI for components that render both inside `AppLayout` and outside it (e.g. the
 * trial-offer page): the shell's answer when there is one (touch tablets included), else
 * the plain width below 768px. True in jsdom, where matchMedia is stubbed false.
 */
export function useIsPhoneUi(): boolean {
  const { isPhone } = usePhoneLayout();
  const wide = useMinWidth(768);
  return isPhone || !wide;
}
