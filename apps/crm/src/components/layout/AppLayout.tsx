import { Outlet, useLocation } from 'react-router-dom';
import { ContextHelpLinks } from '../help/ContextHelpLinks';
import { lazy, Suspense, useEffect, useState, useCallback } from 'react';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import TopBar from './TopBar';
import { DunningBanner } from '../billing/DunningBanner';
import { IncidentBanner } from './IncidentBanner';
import { useAuth } from '../../context/AuthContext';
import type { FinancialAccess } from '../../lib/financialAccess';
import type { PermissionCheck } from '../../lib/permissions';
import FinancialRestrictionScreen from './FinancialRestrictionScreen';
import { Spinner } from '../ui/spinner';
import { GuideProvider } from '../guide/GuideContext';
import { GuidePill } from '../guide/GuidePill';

const GlobalBannerContainer = lazy(() => import('./GlobalBannerContainer'));
const GuideDialog = lazy(() => import('../guide/GuideDialog'));

export const FINANCIAL_PATHS = ['/financeiro'];

/**
 * `/contratos` used to live in FINANCIAL_PATHS, so the whole route was guarded
 * and masked by the FINANCEIRO capability while `nav-data.ts` and the RLS
 * policies keyed on CONTRATOS. That split only stayed invisible because both
 * capabilities coincide for every legacy role (`derivePermission` couples
 * them). A custom role of `{contratos: editar, financeiro: none}` saw the nav
 * item, clicked it, and landed on the financial restriction screen. Contratos
 * now carries its own capability end to end.
 */
export const CONTRACT_PATHS = ['/contratos'];

function matchesPrefix(pathname: string, prefixes: string[]): boolean {
  // App.tsx declares routes lowercase with no `caseSensitive`, so React
  // Router matches `/Financeiro` to the same page as `/financeiro`. Lowercase
  // before matching here too, or a capitalized path slips past this guard.
  const lower = pathname.toLowerCase();
  return prefixes.some((p) => lower === p || lower.startsWith(p + '/'));
}

export function isFinancialPath(pathname: string): boolean {
  return matchesPrefix(pathname, FINANCIAL_PATHS);
}

export function isContractPath(pathname: string): boolean {
  return matchesPrefix(pathname, CONTRACT_PATHS);
}

/**
 * Paths whose access decision belongs to THIS layout, not to
 * `ProtectedRoute`'s redirect gate. Both render a dedicated restriction screen
 * (keeping the shell) instead of a bare bounce to /dashboard, so
 * `ProtectedRoute` deliberately skips enforcement on them — see the long
 * comment there.
 */
export function isLayoutGuardedPath(pathname: string): boolean {
  return isFinancialPath(pathname) || isContractPath(pathname);
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

/**
 * Same three-state shape as `financialGuardOutcome`, keyed on the CONTRATOS
 * capability instead. Split out rather than folded into that function so each
 * guard reads the capability its own route is actually about; both still fail
 * NEUTRAL on 'unknown' for the reason documented above.
 *
 * Legacy parity is automatic: `derivePermission` couples contratos and
 * financeiro for every legacy role (owner/admin both, agent/restricted admin
 * neither), so nobody without a custom role sees any change here.
 */
export function contractGuardOutcome(
  pathname: string,
  canSeeContracts: PermissionCheck,
): 'content' | 'loading' | 'denied' {
  if (!isContractPath(pathname)) return 'content';
  if (canSeeContracts === true) return 'content';
  if (canSeeContracts === 'unknown') return 'loading';
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
  const { canSeeFinancials, can } = useAuth();
  const isTablet = useIsTablet();
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const financialOutcome = financialGuardOutcome(location.pathname, canSeeFinancials);
  const contractOutcome = contractGuardOutcome(location.pathname, can('contratos', 'ver'));
  // The two guards cover disjoint path sets, so at most one is ever not
  // 'content' -- but resolve deterministically anyway: a denial outranks a
  // load, which outranks rendering the route.
  const outcome =
    financialOutcome === 'denied' || contractOutcome === 'denied'
      ? 'denied'
      : financialOutcome === 'loading' || contractOutcome === 'loading'
        ? 'loading'
        : 'content';
  const deniedScreen = contractOutcome === 'denied' ? 'contratos' : 'financeiro';

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
            <IncidentBanner />
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
          {outcome === 'denied' && <FinancialRestrictionScreen variant={deniedScreen} />}
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
