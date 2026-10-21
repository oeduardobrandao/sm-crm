import { useIsDesktop } from '@/hooks/useIsDesktop';

/**
 * True below 768px, the phone breakpoint (D17): the post editor opens as its own pushed
 * screen with tabs instead of expanding inline in the drawer.
 *
 * Its own module (not a bare `useIsDesktop(768)` at each call site) so the editor's
 * desktop-asserting suites can pin the inline layout with one `vi.mock` without also
 * flipping every other `useIsDesktop` consumer on the page (EntregasPage's 901px sheets,
 * the Entregas phone views).
 */
export function useIsPhoneEditor(): boolean {
  return !useIsDesktop(768);
}
