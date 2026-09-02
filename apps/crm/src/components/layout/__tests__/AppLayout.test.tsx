import { act, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinancialAccess } from '../../../lib/financialAccess';

vi.mock('../../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../Sidebar', () => ({
  default: ({ isDrawer, isOpen }: { isDrawer?: boolean; isOpen?: boolean }) => (
    <div
      data-testid="sidebar"
      data-drawer={String(Boolean(isDrawer))}
      data-open={String(Boolean(isOpen))}
    >
      Sidebar
    </div>
  ),
}));

vi.mock('../MobileNav', () => ({
  default: () => <div data-testid="mobile-nav">Mobile nav</div>,
}));

vi.mock('../TopBar', () => ({
  default: ({
    showHamburger,
    isDrawerOpen,
    onHamburgerClick,
  }: {
    showHamburger?: boolean;
    isDrawerOpen?: boolean;
    onHamburgerClick?: () => void;
  }) => (
    <div data-testid="topbar">
      {showHamburger && (
        <button
          type="button"
          onClick={onHamburgerClick}
          aria-label={isDrawerOpen ? 'Fechar menu' : 'Abrir menu'}
        >
          Menu
        </button>
      )}
    </div>
  ),
}));

vi.mock('../GlobalBannerContainer', () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="global-banner">{children}</div>
  ),
}));

vi.mock('../../billing/DunningBanner', () => ({
  DunningBanner: () => null,
}));

vi.mock('../IncidentBanner', () => ({
  IncidentBanner: () => null,
}));

vi.mock('../../help/ContextHelpLinks', () => ({
  ContextHelpLinks: () => null,
}));

// The guide feature has its own dedicated test suites (GuideContext,
// GuideDialog, GuidePill, useGuideSignals, useGuideProgress, guideGating).
// Its real GuideProvider needs a QueryClientProvider (useGuideSignals runs
// useQueries) and the real AuthContext (useIsWorkspaceOwner reads it via
// useContext), neither of which this file's shell-focused mocks provide.
// Mocking it here -- same technique already used for every other child of
// AppLayout above -- keeps this suite scoped to AppLayout's own layout/guard
// logic instead of re-exercising the guide's wiring.
vi.mock('../../guide/GuideContext', () => ({
  GuideProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../guide/GuidePill', () => ({
  GuidePill: () => null,
}));

vi.mock('../../guide/GuideDialog', () => ({
  default: () => null,
}));

import { useAuth } from '../../../context/AuthContext';
import AppLayout from '../AppLayout';

const mockedUseAuth = vi.mocked(useAuth);

function setCanSeeFinancials(canSeeFinancials: FinancialAccess) {
  mockedUseAuth.mockReturnValue({
    user: { id: 'u1' } as never,
    profile: { id: 'u1', nome: 'Ana', role: 'owner', conta_id: 'c1' } as never,
    role: 'owner',
    workspaceRole: 'owner',
    membershipResolved: true,
    canSeeFinancials,
    loading: false,
    refetchProfile: vi.fn(),
    signOut: vi.fn(),
  });
}

beforeEach(() => {
  // Default: unrestricted. Non-financial routes render regardless of this
  // value, so only the financial-guard tests below need to vary it.
  setCanSeeFinancials(true);
});

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
}

function createMediaQuery(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  return {
    get matches() {
      return matches;
    },
    media: '',
    addEventListener: vi.fn((_event: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_event: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    }),
    dispatch(nextMatches: boolean) {
      matches = nextMatches;
      listeners.forEach((listener) => listener({ matches: nextMatches } as MediaQueryListEvent));
    },
  };
}

function mockMatchMedia(tabletMatches: boolean) {
  const tabletQuery = createMediaQuery(tabletMatches);
  const mobileQuery = createMediaQuery(false);

  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => {
      if (query.includes('max-width: 767px')) return mobileQuery;
      return tabletQuery;
    }),
  );

  return tabletQuery;
}

function renderLayout(pathname = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route
            path="/dashboard"
            element={
              <div>
                <div>Dashboard screen</div>
                <Link to="/clientes">Ir para clientes</Link>
              </div>
            }
          />
          <Route path="/clientes" element={<div>Clientes screen</div>} />
          <Route path="/financeiro" element={<div>Financeiro screen</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AppLayout', () => {
  it('renders the desktop shell without tablet drawer controls', async () => {
    setViewport(1280);
    mockMatchMedia(false);

    renderLayout();
    await screen.findByTestId('global-banner');

    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-drawer', 'false');
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-open', 'false');
    expect(screen.queryByRole('button', { name: 'Abrir menu' })).not.toBeInTheDocument();
    expect(screen.getByTestId('mobile-nav')).toBeInTheDocument();
  });

  it('opens and closes the tablet drawer, then resets when leaving tablet mode', async () => {
    setViewport(900);
    const mediaQueryList = mockMatchMedia(true);

    renderLayout();
    await screen.findByTestId('global-banner');

    expect(screen.getByRole('button', { name: 'Abrir menu' })).toBeInTheDocument();
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-drawer', 'true');
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-open', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menu' }));
    expect(screen.getByRole('button', { name: 'Fechar menu' })).toBeInTheDocument();
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-open', 'true');
    expect(document.querySelector('.tablet-drawer-backdrop')).not.toBeNull();

    fireEvent.click(document.querySelector('.tablet-drawer-backdrop')!);
    expect(screen.getByRole('button', { name: 'Abrir menu' })).toBeInTheDocument();
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-open', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menu' }));
    act(() => {
      mediaQueryList.dispatch(false);
    });

    expect(screen.queryByRole('button', { name: 'Fechar menu' })).not.toBeInTheDocument();
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-drawer', 'false');
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-open', 'false');
    expect(document.querySelector('.tablet-drawer-backdrop')).toBeNull();
  });

  it('scrolls the main content back to the top when the route changes', async () => {
    setViewport(1280);
    mockMatchMedia(false);

    const { container } = renderLayout();
    await screen.findByTestId('global-banner');
    const main = container.querySelector('#app') as HTMLDivElement;

    main.scrollTop = 180;
    fireEvent.click(screen.getByText('Ir para clientes'));

    expect(screen.getByText('Clientes screen')).toBeInTheDocument();
    expect(main.scrollTop).toBe(0);
  });
});

// These prove AppLayout actually wires `canSeeFinancials` from `useAuth()`
// into the guard, not merely that the pure `financialGuardOutcome` helper
// (covered in financialRouteGuard.test.ts) returns the right label.
describe('AppLayout financial guard wiring', () => {
  it('renders the restriction screen instead of the route when access is explicitly denied', async () => {
    setViewport(1280);
    mockMatchMedia(false);
    setCanSeeFinancials(false);

    renderLayout('/financeiro');
    await screen.findByTestId('global-banner');

    expect(screen.getByText('Acesso financeiro restrito')).toBeInTheDocument();
    expect(screen.queryByText('Financeiro screen')).not.toBeInTheDocument();
    // The shell survives -- this is what a ProtectedRoute-level redirect could not do.
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-nav')).toBeInTheDocument();
  });

  it('renders the route when access is granted', async () => {
    setViewport(1280);
    mockMatchMedia(false);
    setCanSeeFinancials(true);

    renderLayout('/financeiro');
    await screen.findByTestId('global-banner');

    expect(screen.getByText('Financeiro screen')).toBeInTheDocument();
    expect(screen.queryByText('Acesso financeiro restrito')).not.toBeInTheDocument();
  });

  it('shows a loading spinner, not the restriction screen, while capability is unknown', async () => {
    setViewport(1280);
    mockMatchMedia(false);
    setCanSeeFinancials('unknown');

    const { container } = renderLayout('/financeiro');
    await screen.findByTestId('global-banner');

    expect(screen.queryByText('Financeiro screen')).not.toBeInTheDocument();
    expect(screen.queryByText('Acesso financeiro restrito')).not.toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  it('leaves non-financial routes unaffected when access is denied', async () => {
    setViewport(1280);
    mockMatchMedia(false);
    setCanSeeFinancials(false);

    renderLayout('/dashboard');
    await screen.findByTestId('global-banner');

    expect(screen.getByText('Dashboard screen')).toBeInTheDocument();
  });
});
