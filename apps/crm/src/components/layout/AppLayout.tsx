import { Outlet, useLocation } from 'react-router-dom';
import { ContextHelpLinks } from '../help/ContextHelpLinks';
import { lazy, Suspense, useEffect, useState, useCallback } from 'react';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import TopBar from './TopBar';
import { DunningBanner } from '../billing/DunningBanner';
import { useAuth } from '../../context/AuthContext';
import type { FinancialAccess } from '../../lib/financialAccess';
import FinancialRestrictionScreen from './FinancialRestrictionScreen';
import { Spinner } from '../ui/spinner';
import { GuideProvider } from '../guide/GuideContext';
import { GuidePill } from '../guide/GuidePill';

const GlobalBannerContainer = lazy(() => import('./GlobalBannerContainer'));
const GuideDialog = lazy(() => import('../guide/GuideDialog'));

export const FINANCIAL_PATHS = ['/financeiro', '/contratos'];

export function isFinancialPath(pathname: string): boolean {
  // App.tsx declares routes lowercase with no `caseSensitive`, so React
  // Router matches `/Financeiro` to the same page as `/financeiro`. Lowercase
  // before matching here too, or a capitalized path slips past this guard.
  const lower = pathname.toLowerCase();
  return FINANCIAL_PATHS.some((p) => lower === p || lower.startsWith(p + '/'));
}

/**
 * Pure decision function so all three capability states are unit-testable
 * without rendering the shell.
 *
 * 'unknown' is deliberately excluded from the denial branch: the route guard
 * fails NEUTRAL (loading), not closed. Writing this as `!== true` would show
 * an owner the restriction screen during hydration or a transient
 * membership-lookup failure. The loading state leaks nothing -- route
 * content is unrendered either way and the database denies regardless. This
 * is intentionally asymmetric with `formatFinancialBRL`, which fails CLOSED
 * (masks unless access is literally `true`) because the harm there is
 * showing a real figure, not withholding one.
 */
export function financialGuardOutcome(
  pathname: string,
  canSeeFinancials: FinancialAccess,
): 'content' | 'loading' | 'denied' {
  if (!isFinancialPath(pathname)) return 'content';
  if (canSeeFinancials === true) return 'content';
  if (canSeeFinancials === 'unknown') return 'loading';
  return 'denied';
}

function useIsTablet() {
  const [isTablet, setIsTablet] = useState(() => {
    const w = window.innerWidth;
    return w >= 768 && w <= 1100;
  });

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px) and (max-width: 1100px)');
    const handler = (e: MediaQueryListEvent) => setIsTablet(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return isTablet;
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return isMobile;
}

export default function AppLayout() {
  const location = useLocation();
  const { canSeeFinancials } = useAuth();
  const isTablet = useIsTablet();
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const outcome = financialGuardOutcome(location.pathname, canSeeFinancials);

  useEffect(() => {
    if (!isTablet) setDrawerOpen(false);
  }, [isTablet]);

  useEffect(() => {
    const main = document.getElementById('app');
    if (main) main.scrollTop = 0;
  }, [location.pathname]);

  useEffect(() => {
    window.$crisp?.push(['do', 'chat:hide']);
  }, []);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return (
    <GuideProvider>
      <div className="app-container">
        {!isMobile && (
          <TopBar
            showHamburger={isTablet}
            isDrawerOpen={drawerOpen}
            onHamburgerClick={() => setDrawerOpen((v) => !v)}
          />
        )}

        <Suspense fallback={null}>
          <GlobalBannerContainer>
            <DunningBanner />
          </GlobalBannerContainer>
        </Suspense>

        <Sidebar isDrawer={isTablet} isOpen={drawerOpen} onClose={closeDrawer} />

        {isTablet && drawerOpen && (
          <div className="tablet-drawer-backdrop visible" onClick={closeDrawer} />
        )}

        <main className="main-content" id="app">
          <ContextHelpLinks />
          {outcome === 'content' && <Outlet />}
          {outcome === 'loading' && (
            <div style={{ padding: '3rem', textAlign: 'center' }}>
              <Spinner size="lg" />
            </div>
          )}
          {outcome === 'denied' && <FinancialRestrictionScreen />}
        </main>

        <MobileNav />
        <GuidePill />
        <Suspense fallback={null}>
          <GuideDialog />
        </Suspense>
      </div>
    </GuideProvider>
  );
}
