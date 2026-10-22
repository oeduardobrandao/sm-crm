import { Outlet, useLocation } from 'react-router-dom';
import { ContextHelpLinks } from '../help/ContextHelpLinks';
import { lazy, Suspense, useEffect, useState, useCallback } from 'react';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import TopBar from './TopBar';
import PhoneShellHeader from './PhoneShellHeader';
import { DunningBanner } from '../billing/DunningBanner';
import { IncidentBanner } from './IncidentBanner';
import { useAuth } from '../../context/AuthContext';
import type { FinancialAccess } from '../../lib/financialAccess';
import type { PermissionCheck } from '../../lib/permissions';
import FinancialRestrictionScreen from './FinancialRestrictionScreen';
import { PageSkeleton } from '../ui/skeletons';
import { GuideProvider } from '../guide/GuideContext';
import { GuidePill } from '../guide/GuidePill';
import { PhoneLayoutContext, usePhoneChromeController } from './PhoneLayoutContext';
import { useVidro } from '../../hooks/useVidro';
import { isIntroDue } from '../../lib/vidroLook';
import { PageToolbarProvider } from './PageToolbarContext';
import PageToolbar from './PageToolbar';
import TopBarActions from './TopBarActions';
import NavigationProgress from './NavigationProgress';

const GlobalBannerContainer = lazy(() => import('./GlobalBannerContainer'));
const GuideDialog = lazy(() => import('../guide/GuideDialog'));
const GlobalPopupHost = lazy(() => import('./GlobalPopupHost'));
const VidroIntro = lazy(() => import('./VidroIntro'));

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

const SIDEBAR_PINNED_STORAGE_KEY = 'sidebar-pinned';

// Desktop sidebar: an icon rail that expands over the content on hover, or pinned open,
// pushing the content over. The stored preference is tri-state: '1' pinned, '0' rail, unset
// follows the look (pinned under Vidro, rail in classic; see AppLayout). Only an explicit click
// writes it. Deliberately not reset when the viewport drops into drawer/mobile range, so
// widening the window again restores it.
type PinPref = '1' | '0' | null;

function readPinPref(): PinPref {
  try {
    const v = localStorage.getItem(SIDEBAR_PINNED_STORAGE_KEY);
    return v === '1' || v === '0' ? v : null;
  } catch {
    return null;
  }
}

function useSidebarPinPref() {
  const [pref, setPref] = useState<PinPref>(readPinPref);
  const choose = useCallback((next: boolean) => {
    const v: PinPref = next ? '1' : '0';
    try {
      localStorage.setItem(SIDEBAR_PINNED_STORAGE_KEY, v);
    } catch {
      // localStorage unavailable (private mode, quota) -- preference just won't persist.
    }
    setPref(v);
  }, []);
  return [pref, choose] as const;
}

export default function AppLayout() {
  const location = useLocation();
  const { canSeeFinancials, can, user, loading: authLoading } = useAuth();
  const isTablet = useIsTablet();
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const sidebarCollapsible = !isTablet && !isMobile;
  // Desktop "Vidro" look: only where the static sidebar exists (>=1101px).
  const vidro = useVidro();
  const vidroShell = vidro.active && sidebarCollapsible;
  // The launch intro takes this session's single modal slot from GlobalPopupHost. Decided once,
  // after the look is final for this load, so a flag refetch or a resize never swaps them.
  const [intro, setIntro] = useState<'pending' | 'show' | 'no'>('pending');
  useEffect(() => {
    if (intro !== 'pending' || authLoading || !vidro.settled) return;
    setIntro(
      isIntroDue({ vidroShell, userId: user?.id, userCreatedAt: user?.created_at }) ? 'show' : 'no',
    );
  }, [intro, authLoading, vidro.settled, vidroShell, user?.id, user?.created_at]);
  const [pinPref, choosePinned] = useSidebarPinPref();
  // Unset preference follows the look (spec: Sidebar default open): pinned under Vidro, rail in
  // classic. vidro.active is already seeded from the pre-paint attribute, so no first-paint flash.
  const sidebarPinned = pinPref === '1' ? true : pinPref === '0' ? false : vidro.active;
  const toggleSidebarPinned = useCallback(
    () => choosePinned(!sidebarPinned),
    [choosePinned, sidebarPinned],
  );
  // Pages opt into phone chrome changes (own page header, hidden tab bar) through
  // usePhoneChrome; the attributes on .app-container drive the CSS (phone only).
  const phoneChrome = usePhoneChromeController(isMobile);
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

  const mainContent = (
    <main className="main-content" id="app">
      {/* On phones the related-articles button lives in PhoneShellHeader. */}
      {!isMobile && <ContextHelpLinks />}
      {/* The page chunks are lazy: on a cold load the shell stays up and only the
        content area waits. In-app navigations run in a transition, so they keep the
        previous page on screen instead of falling back here. */}
      {outcome === 'content' && (
        <Suspense fallback={<PageSkeleton />}>
          <Outlet />
        </Suspense>
      )}
      {outcome === 'loading' && <PageSkeleton />}
      {outcome === 'denied' && <FinancialRestrictionScreen variant={deniedScreen} />}
    </main>
  );

  return (
    <GuideProvider>
      <PhoneLayoutContext.Provider value={phoneChrome.contextValue}>
        <PageToolbarProvider vidroShell={vidroShell}>
          <div
            className="app-container"
            data-sidebar-collapsed={(sidebarCollapsible && !sidebarPinned) || undefined}
            {...phoneChrome.attributes}
          >
            {isMobile ? (
              // A page with its own PhonePageHeader carries the bell and help links itself.
              !phoneChrome.chrome.pageHeader && <PhoneShellHeader />
            ) : vidroShell ? null : (
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

            <Sidebar
              isDrawer={isTablet}
              isOpen={drawerOpen}
              onClose={closeDrawer}
              collapsible={sidebarCollapsible}
              pinned={sidebarPinned}
              onTogglePinned={toggleSidebarPinned}
              vidroShell={vidroShell}
              look={{
                enabled: vidro.enabled,
                optedOut: vidro.optedOut,
                onToggle: () => vidro.setOptedOut(!vidro.optedOut),
              }}
            />

            {isTablet && drawerOpen && (
              <div className="tablet-drawer-backdrop visible" onClick={closeDrawer} />
            )}

            {/* The wrapper is always mounted (flag on or off, any width, opted out), so <main>
              keeps its place in the tree: a flag flip on a refetch, crossing 1101px or the opt-out
              toggle never remounts the page. Unless it is the glass panel it is out of the layout
              through an inline display: contents, never a class whose CSS sits outside vidro's
              guards. */}
            <div
              className={vidroShell ? 'vidro-panel' : undefined}
              style={vidroShell ? undefined : { display: 'contents' }}
            >
              {vidroShell && <NavigationProgress />}
              {vidroShell && <PageToolbar capsule={<TopBarActions variant="capsule" />} />}
              {mainContent}
            </div>

            <MobileNav />
            <GuidePill />
            <Suspense fallback={null}>
              <GuideDialog />
            </Suspense>
            <Suspense fallback={null}>
              {intro === 'show' && user ? (
                <VidroIntro userId={user.id} onClassic={() => vidro.setOptedOut(true)} />
              ) : (
                intro === 'no' && <GlobalPopupHost />
              )}
            </Suspense>
          </div>
        </PageToolbarProvider>
      </PhoneLayoutContext.Provider>
    </GuideProvider>
  );
}
