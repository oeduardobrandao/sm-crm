import { act, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect, useState } from 'react';
import type { FinancialAccess } from '../../../lib/financialAccess';
import { makeCan, fakeMembership } from '@/test/makeCan';

vi.mock('../../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../Sidebar', () => ({
  default: ({
    isDrawer,
    isOpen,
    collapsible,
    pinned,
    onTogglePinned,
    vidroShell,
  }: {
    isDrawer?: boolean;
    isOpen?: boolean;
    collapsible?: boolean;
    pinned?: boolean;
    onTogglePinned?: () => void;
    vidroShell?: boolean;
  }) => (
    <div
      data-testid="sidebar"
      data-drawer={String(Boolean(isDrawer))}
      data-open={String(Boolean(isOpen))}
      data-collapsible={String(Boolean(collapsible))}
      data-pinned={String(Boolean(pinned))}
      data-vidro-shell={String(Boolean(vidroShell))}
    >
      Sidebar
      <button type="button" onClick={onTogglePinned}>
        Pin
      </button>
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

const vidroState = vi.hoisted(() => ({
  active: false,
  enabled: false,
  optedOut: false,
  setOptedOut: (() => {}) as (v: boolean) => void,
}));

// The real hook reads useWorkspaceLimits (useQuery), which this suite has no QueryClient for.
vi.mock('../../../hooks/useVidro', () => ({
  useVidro: () => vidroState,
}));

vi.mock('../PageToolbar', () => ({
  default: ({ capsule }: { capsule?: React.ReactNode }) => (
    <div data-testid="page-toolbar">{capsule}</div>
  ),
}));

vi.mock('../TopBarActions', () => ({
  default: ({ variant }: { variant?: string }) => <div data-testid={'actions-' + variant} />,
}));

vi.mock('../PhoneShellHeader', () => ({
  default: () => <div data-testid="phone-shell-header">Phone header</div>,
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
  ContextHelpLinks: () => <div data-testid="context-help" />,
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

vi.mock('../GlobalPopupHost', () => ({
  default: () => null,
}));

import { useAuth } from '../../../context/AuthContext';
import AppLayout from '../AppLayout';
import { usePhoneChrome, usePhoneLayout } from '../PhoneLayoutContext';

/** A page that brings its own phone header and hides the tab bar (F0a.1). */
function ChromePage() {
  usePhoneChrome({ pageHeader: true, tabBar: false });
  const { isPhone } = usePhoneLayout();
  return (
    <div>
      <div>Chrome screen</div>
      <span data-testid="is-phone">{String(isPhone)}</span>
      <Link to="/clientes">Ir para clientes</Link>
    </div>
  );
}

const mockedUseAuth = vi.mocked(useAuth);

/**
 * AppLayout now reads BOTH `canSeeFinancials` (the /financeiro guard) and
 * `can('contratos','ver')` (the /contratos guard, F1) off `useAuth()`, so the
 * mock has to supply both. `membership` defaults to a legacy owner, which
 * clears every capability -- the contract guard then stays 'content' on the
 * financial-route tests below and never interferes with what they assert.
 */
function setCanSeeFinancials(
  canSeeFinancials: FinancialAccess,
  membership: Parameters<typeof fakeMembership>[0] = { role: 'owner' },
) {
  mockedUseAuth.mockReturnValue({
    user: { id: 'u1' } as never,
    profile: { id: 'u1', nome: 'Ana', role: 'owner', conta_id: 'c1' } as never,
    role: 'owner',
    workspaceRole: 'owner',
    membershipResolved: true,
    canSeeFinancials,
    can: makeCan(fakeMembership(membership)),
    loading: false,
    refetchProfile: vi.fn(),
    signOut: vi.fn(),
  });
}

beforeEach(() => {
  localStorage.clear();
  vidroState.active = false;
  vidroState.enabled = false;
  vidroState.optedOut = false;
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
  return render(layoutTree(pathname));
}

function layoutTree(pathname = '/dashboard') {
  return (
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
          <Route path="/contratos" element={<div>Contratos screen</div>} />
          <Route path="/chrome" element={<ChromePage />} />
        </Route>
      </Routes>
    </MemoryRouter>
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

  it('renders the phone shell header instead of the TopBar below 768px (AUDIT #1)', async () => {
    setViewport(390);
    mockMatchMedia(false);

    renderLayout();
    await screen.findByTestId('global-banner');

    expect(screen.getByTestId('phone-shell-header')).toBeInTheDocument();
    expect(screen.queryByTestId('topbar')).not.toBeInTheDocument();
    // The related-articles button moves into the phone header (AUDIT #3): not in <main>.
    expect(
      document.getElementById('app')?.querySelector('[data-testid="context-help"]'),
    ).toBeNull();
  });

  it('applies the page phone chrome to .app-container and clears it on the next route', async () => {
    setViewport(390);
    mockMatchMedia(false);

    renderLayout('/chrome');
    await screen.findByText('Chrome screen');

    const container = document.querySelector('.app-container')!;
    expect(container).toHaveAttribute('data-phone-page-header');
    expect(container).toHaveAttribute('data-phone-tab-bar', 'hidden');
    // The page header carries the bell, so the shell's own bar is not mounted.
    expect(screen.queryByTestId('phone-shell-header')).not.toBeInTheDocument();
    expect(screen.getByTestId('is-phone')).toHaveTextContent('true');

    fireEvent.click(screen.getByRole('link', { name: 'Ir para clientes' }));
    await screen.findByText('Clientes screen');

    expect(container).not.toHaveAttribute('data-phone-page-header');
    expect(container).not.toHaveAttribute('data-phone-tab-bar');
    expect(screen.getByTestId('phone-shell-header')).toBeInTheDocument();
  });

  it('reports desktop through usePhoneLayout from 768px up', async () => {
    setViewport(1280);
    mockMatchMedia(false);

    renderLayout('/chrome');
    await screen.findByText('Chrome screen');

    expect(screen.getByTestId('is-phone')).toHaveTextContent('false');
    expect(screen.getByTestId('topbar')).toBeInTheDocument();
  });

  it('keeps the TopBar and the in-page related-articles button from 768px up', async () => {
    setViewport(1280);
    mockMatchMedia(false);

    renderLayout();
    await screen.findByTestId('global-banner');

    expect(screen.getByTestId('topbar')).toBeInTheDocument();
    expect(screen.queryByTestId('phone-shell-header')).not.toBeInTheDocument();
    expect(
      document.getElementById('app')?.querySelector('[data-testid="context-help"]'),
    ).not.toBeNull();
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

  it('defaults the desktop sidebar to the rail, and pinning insets the content', async () => {
    setViewport(1280);
    mockMatchMedia(false);

    const { container, unmount } = renderLayout();
    await screen.findByTestId('global-banner');
    const shell = container.querySelector('.app-container')!;

    // Unpinned by default: the content sits next to the 64px rail.
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-collapsible', 'true');
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-pinned', 'false');
    expect(shell).toHaveAttribute('data-sidebar-collapsed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-pinned', 'true');
    expect(shell).not.toHaveAttribute('data-sidebar-collapsed');
    expect(localStorage.getItem('sidebar-pinned')).toBe('1');

    unmount();
    const { container: again } = renderLayout();
    await screen.findByTestId('global-banner');
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-pinned', 'true');
    expect(again.querySelector('.app-container')).not.toHaveAttribute('data-sidebar-collapsed');

    fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
    expect(again.querySelector('.app-container')).toHaveAttribute('data-sidebar-collapsed', 'true');
    expect(localStorage.getItem('sidebar-pinned')).toBe('0');
  });

  it('never applies the rail to the tablet drawer, and restores it on widening', async () => {
    setViewport(900);
    const mediaQueryList = mockMatchMedia(true);

    const { container } = renderLayout();
    await screen.findByTestId('global-banner');

    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-collapsible', 'false');
    expect(container.querySelector('.app-container')).not.toHaveAttribute('data-sidebar-collapsed');

    act(() => {
      mediaQueryList.dispatch(false);
    });
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-collapsible', 'true');
    expect(container.querySelector('.app-container')).toHaveAttribute(
      'data-sidebar-collapsed',
      'true',
    );
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

  it('shows a loading skeleton, not the restriction screen, while capability is unknown', async () => {
    setViewport(1280);
    mockMatchMedia(false);
    setCanSeeFinancials('unknown');

    renderLayout('/financeiro');
    await screen.findByTestId('global-banner');

    expect(screen.queryByText('Financeiro screen')).not.toBeInTheDocument();
    expect(screen.queryByText('Acesso financeiro restrito')).not.toBeInTheDocument();
    expect(screen.getByTestId('crm-skeleton')).toBeInTheDocument();
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

/**
 * F1: /contratos left FINANCIAL_PATHS and got its own guard on
 * `can('contratos','ver')`. These prove the layout wires that capability
 * (not canSeeFinancials) into the /contratos decision, and that the two
 * guards no longer bleed into each other.
 */
describe('AppLayout contract guard wiring', () => {
  it('renders /contratos for {contratos: editar, financeiro: none} — the shape that used to hit the restriction screen', async () => {
    setViewport(1280);
    mockMatchMedia(false);
    setCanSeeFinancials(false, {
      role: 'agent',
      role_id: 'role-1',
      permissions: { contratos: 'editar' },
    });

    renderLayout('/contratos');
    await screen.findByTestId('global-banner');

    expect(screen.getByText('Contratos screen')).toBeInTheDocument();
    expect(screen.queryByText('Acesso a contratos restrito')).not.toBeInTheDocument();
  });

  it('shows the contracts restriction screen for {contratos: none, financeiro: editar}', async () => {
    setViewport(1280);
    mockMatchMedia(false);
    setCanSeeFinancials(true, {
      role: 'agent',
      role_id: 'role-1',
      permissions: { financeiro: 'editar' },
    });

    renderLayout('/contratos');
    await screen.findByTestId('global-banner');

    expect(screen.getByText('Acesso a contratos restrito')).toBeInTheDocument();
    expect(screen.queryByText('Contratos screen')).not.toBeInTheDocument();
    // Copy is contracts-specific, not the financial wording.
    expect(screen.queryByText('Acesso financeiro restrito')).not.toBeInTheDocument();
    // The shell survives, same as the financial guard.
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
  });

  it('still restricts /contratos for a legacy restricted admin (regression)', async () => {
    setViewport(1280);
    mockMatchMedia(false);
    setCanSeeFinancials(false, { role: 'admin', can_see_financials: false });

    renderLayout('/contratos');
    await screen.findByTestId('global-banner');

    expect(screen.getByText('Acesso a contratos restrito')).toBeInTheDocument();
    expect(screen.queryByText('Contratos screen')).not.toBeInTheDocument();
  });

  it('shows a skeleton, not a denial, while the contracts capability is unknown', async () => {
    setViewport(1280);
    mockMatchMedia(false);
    mockedUseAuth.mockReturnValue({
      user: { id: 'u1' } as never,
      profile: { id: 'u1', nome: 'Ana', role: 'owner', conta_id: 'c1' } as never,
      role: 'owner',
      workspaceRole: 'owner',
      membershipResolved: false,
      canSeeFinancials: 'unknown',
      can: makeCan(null),
      loading: false,
      refetchProfile: vi.fn(),
      signOut: vi.fn(),
    });

    renderLayout('/contratos');
    await screen.findByTestId('global-banner');

    expect(screen.queryByText('Contratos screen')).not.toBeInTheDocument();
    expect(screen.queryByText('Acesso a contratos restrito')).not.toBeInTheDocument();
    expect(screen.getByTestId('crm-skeleton')).toBeInTheDocument();
  });
});

describe('AppLayout Vidro shell', () => {
  it('replaces the TopBar with the glass panel and page toolbar at desktop width', async () => {
    vidroState.active = true;
    vidroState.enabled = true;
    setViewport(1280);
    mockMatchMedia(false);

    renderLayout();
    await screen.findByTestId('global-banner');

    expect(screen.queryByTestId('topbar')).not.toBeInTheDocument();
    const panel = document.querySelector('.vidro-panel');
    expect(panel).not.toBeNull();
    expect(panel).toContainElement(screen.getByTestId('page-toolbar'));
    expect(panel).toContainElement(document.getElementById('app'));
    expect(panel).toContainElement(screen.getByTestId('actions-capsule'));
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-vidro-shell', 'true');
  });

  it('keeps the same <main> mounted when the window crosses 1101px', async () => {
    vidroState.active = true;
    vidroState.enabled = true;
    setViewport(1280);
    const tabletQuery = mockMatchMedia(false);

    renderLayout();
    await screen.findByTestId('global-banner');
    const main = document.getElementById('app');
    expect(document.querySelector('.vidro-panel')).toContainElement(main);

    act(() => {
      tabletQuery.dispatch(true);
    });
    expect(document.querySelector('.vidro-panel')).toBeNull();
    expect(screen.getByTestId('topbar')).toBeInTheDocument();
    expect(document.getElementById('app')).toBe(main);
    // The wrapper stays, out of the layout.
    expect(main?.parentElement).toHaveStyle({ display: 'contents' });

    act(() => {
      tabletQuery.dispatch(false);
    });
    expect(document.querySelector('.vidro-panel')).toContainElement(main);
    expect(document.getElementById('app')).toBe(main);
  });

  it('keeps the same <main> mounted when the user opts out of the look', async () => {
    vidroState.active = true;
    vidroState.enabled = true;
    setViewport(1280);
    mockMatchMedia(false);

    const { rerender } = renderLayout();
    await screen.findByTestId('global-banner');
    const main = document.getElementById('app');
    expect(document.querySelector('.vidro-panel')).toContainElement(main);

    vidroState.active = false;
    vidroState.optedOut = true;
    rerender(layoutTree());

    expect(document.querySelector('.vidro-panel')).toBeNull();
    expect(screen.getByTestId('topbar')).toBeInTheDocument();
    expect(document.getElementById('app')).toBe(main);
  });

  it('wraps <main> in a layout-neutral div when the flag is off', async () => {
    setViewport(1280);
    mockMatchMedia(false);

    const { container } = renderLayout();
    await screen.findByTestId('global-banner');

    // Same tree shape as with the flag on, so a flag flip never remounts the page. The wrapper is
    // out of the layout through an inline style (no class, so no CSS outside the vidro guards).
    const wrapper = document.getElementById('app')?.parentElement;
    expect(wrapper?.parentElement).toBe(container.querySelector('.app-container'));
    expect(wrapper).toHaveStyle({ display: 'contents' });
    expect(wrapper).not.toHaveAttribute('class');
  });

  it('keeps the same <main> and page state when the flag flips on a refetch', async () => {
    setViewport(1280);
    mockMatchMedia(false);
    let mounts = 0;
    function CounterPage() {
      const [n, setN] = useState(0);
      useEffect(() => {
        mounts += 1;
      }, []);
      return (
        <button type="button" onClick={() => setN((v) => v + 1)}>
          count {n}
        </button>
      );
    }
    const tree = () => (
      <MemoryRouter initialEntries={['/contador']}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/contador" element={<CounterPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    const { rerender, container } = render(tree());
    await screen.findByTestId('global-banner');
    const main = document.getElementById('app');
    fireEvent.click(await screen.findByRole('button', { name: 'count 0' }));
    expect(screen.getByRole('button', { name: 'count 1' })).toBeInTheDocument();
    const appContainer = container.querySelector('.app-container');

    // false -> true: the flag arrives on a successful refetch.
    vidroState.enabled = true;
    vidroState.active = true;
    rerender(tree());
    expect(document.querySelector('.vidro-panel')).toContainElement(main);
    expect(document.getElementById('app')).toBe(main);
    expect(main?.parentElement?.parentElement).toBe(appContainer);
    expect(screen.getByRole('button', { name: 'count 1' })).toBeInTheDocument();

    // true -> false: the kill switch lands on the next refetch.
    vidroState.enabled = false;
    vidroState.active = false;
    rerender(tree());
    expect(document.querySelector('.vidro-panel')).toBeNull();
    expect(document.getElementById('app')).toBe(main);
    expect(main?.parentElement?.parentElement).toBe(appContainer);
    expect(screen.getByRole('button', { name: 'count 1' })).toBeInTheDocument();
    expect(mounts).toBe(1);
  });

  it('keeps the classic TopBar at tablet width even when vidro is active', async () => {
    vidroState.active = true;
    vidroState.enabled = true;
    setViewport(900);
    mockMatchMedia(true);

    renderLayout();
    await screen.findByTestId('global-banner');

    expect(screen.getByTestId('topbar')).toBeInTheDocument();
    expect(document.querySelector('.vidro-panel')).toBeNull();
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-vidro-shell', 'false');
  });

  it('keeps the classic TopBar at desktop width when vidro is inactive', async () => {
    setViewport(1280);
    mockMatchMedia(false);

    renderLayout();
    await screen.findByTestId('global-banner');

    expect(screen.getByTestId('topbar')).toBeInTheDocument();
    expect(document.querySelector('.vidro-panel')).toBeNull();
    expect(screen.queryByTestId('page-toolbar')).not.toBeInTheDocument();
  });
});
