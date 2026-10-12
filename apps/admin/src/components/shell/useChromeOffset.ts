import { useEffect } from 'react';

/**
 * Keeps `--mobile-nav-chrome-offset` equal to the part of the layout viewport that Safari's
 * own bottom toolbar covers, so the fixed tab bar sits above it. Copied from the CRM's
 * MobileNav.
 */
export function useChromeOffset(): void {
  // `env(safe-area-inset-bottom)` only covers the home-indicator inset, not Safari's
  // own collapsible bottom toolbar -- a separate overlay that shrinks the visible
  // (visual) viewport without moving the layout viewport `.mobile-nav-glass` is fixed
  // against. When Safari's toolbar is expanded, that gap can fully hide the pill
  // behind it. window.visualViewport tracks the actually-visible area, so the gap
  // between its bottom edge and the layout viewport's bottom edge is exactly the
  // extra clearance the pill needs -- 0px whenever there's no such overlay (Chrome,
  // the standalone home-screen app, or Safari with its toolbar collapsed).
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const updateChromeOffset = () => {
      // The iOS home-screen app reports offsetTop as minus the status-bar height
      // (-62px) with height = innerHeight, which would read as a 62px toolbar.
      const gap = window.innerHeight - (Math.max(0, viewport.offsetTop) + viewport.height);
      document.documentElement.style.setProperty(
        '--mobile-nav-chrome-offset',
        `${Math.max(0, Math.round(gap))}px`,
      );
    };

    updateChromeOffset();
    viewport.addEventListener('resize', updateChromeOffset);
    viewport.addEventListener('scroll', updateChromeOffset);

    return () => {
      viewport.removeEventListener('resize', updateChromeOffset);
      viewport.removeEventListener('scroll', updateChromeOffset);
      document.documentElement.style.setProperty('--mobile-nav-chrome-offset', '0px');
    };
  }, []);
}
