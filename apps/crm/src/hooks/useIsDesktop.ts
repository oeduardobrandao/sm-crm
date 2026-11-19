import { desktopShellQuery, useMediaQueryMatch } from '@/lib/phoneShell';

/**
 * True at or above `minWidth` px on a desktop shell (mouse or trackpad).
 * Touch-primary devices are never desktop; see lib/phoneShell.ts.
 * jsdom's matchMedia stub always reports false, so tests render the
 * mobile branch of any layout gated on this hook.
 */
export function useIsDesktop(minWidth = 768): boolean {
  return useMediaQueryMatch(desktopShellQuery(minWidth));
}
