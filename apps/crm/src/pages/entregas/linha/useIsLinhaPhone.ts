import { useIsPhoneShellMatch } from '@/lib/phoneShell';

/**
 * True on the phone shell (below 768px, or a touch tablet), the same question as
 * `useIsPhoneEditor` and EntregasPage's `isPhone` (`!useIsDesktop(768)`), asked the
 * other way round: jsdom's matchMedia never matches, so a positive phone query keeps
 * every desktop suite that renders `LinhaEditorialView` on the table without having
 * to mock the hook.
 */
export function useIsLinhaPhone(): boolean {
  return useIsPhoneShellMatch();
}
