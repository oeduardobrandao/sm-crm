import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../../../context/AuthContext';

vi.mock('../../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../../hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: vi.fn(),
}));

// Passthrough — see the matching comment in Sidebar.test.tsx.
vi.mock('../../../hooks/useEffectiveNavFeatures', () => ({
  useEffectiveNavFeatures: vi.fn((features: unknown) => features),
}));

vi.mock('../../../hooks/useMensagensUnread', () => ({
  useMensagensUnread: vi.fn(() => 0),
}));

vi.mock('../../../hooks/useEquipeChatUnread', () => ({
  useEquipeChatUnread: vi.fn(() => 0),
}));

// The real dialog needs a QueryClientProvider and the store modules; here we
// only care that the "Buscar" row hands control to it.
vi.mock('../GlobalSearchDialog', () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="global-search-dialog" /> : null,
}));

import MobileNav from '../MobileNav';
import { useWorkspaceLimits } from '../../../hooks/useWorkspaceLimits';
import { useMensagensUnread } from '../../../hooks/useMensagensUnread';
import { useEquipeChatUnread } from '../../../hooks/useEquipeChatUnread';
import { makeCan, fakeMembership } from '@/test/makeCan';

const mockedUseAuth = vi.mocked(useAuth);
const mockedUseWorkspaceLimits = vi.mocked(useWorkspaceLimits);
const mockedUseMensagensUnread = vi.mocked(useMensagensUnread);
const mockedUseEquipeChatUnread = vi.mocked(useEquipeChatUnread);

function setLimits(overrides: Record<string, unknown> = {}) {
  mockedUseWorkspaceLimits.mockReturnValue({
    limits: null,
    features: null,
    planName: null,
    isLoading: false,
    isUnlimited: true,
    ...overrides,
  } as never);
}

function PathProbe() {
  const loc = useLocation();
  return <div data-testid="path">{loc.pathname}</div>;
}

type Role = 'owner' | 'admin' | 'agent';

function setAuth(overrides: Record<string, unknown> = {}) {
  const role: Role = (overrides.role as Role | undefined) ?? 'owner';
  mockedUseAuth.mockReturnValue({
    user: { id: '1' } as any,
    session: {} as any,
    profile: {
      id: '1',
      nome: 'Ana Maria',
      role: 'owner',
      conta_id: 'c1',
      ...overrides,
    } as any,
    role,
    workspaceRole: role,
    canSeeFinancials: overrides.canSeeFinancials ?? true,
    can: makeCan(fakeMembership({ role })),
    loading: false,
    signOut: (overrides.signOut as any) || vi.fn(),
    refreshProfile: vi.fn(),
  } as any);
}

function setCustomRole(permissions: Record<string, string>) {
  mockedUseAuth.mockReturnValue({
    user: { id: '1' } as any,
    profile: { id: '1', nome: 'Ana Maria', role: 'agent', conta_id: 'c1' } as any,
    role: 'agent',
    workspaceRole: 'agent',
    canSeeFinancials: false,
    can: makeCan(
      fakeMembership({ role: 'agent', role_id: 'role-1', permissions: permissions as never }),
    ),
    loading: false,
    signOut: vi.fn(),
    refreshProfile: vi.fn(),
  } as any);
}

function renderMobileNav(pathname = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <MobileNav />
              <PathProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

/** Visible tab labels, in bar order ("Mais" included). */
function tabLabels(): string[] {
  const nav = screen.getByRole('navigation', { name: 'Navegação principal' });
  return Array.from(nav.querySelectorAll('.mobile-nav-item .nav-label')).map(
    (el) => el.textContent ?? '',
  );
}

function openMore() {
  fireEvent.click(document.getElementById('mobile-more-btn')!);
  return screen.getByRole('dialog', { name: 'Mais' });
}

/** Row labels in the open Mais sheet, top to bottom. */
function moreRows(): string[] {
  const sheet = screen.getByRole('dialog', { name: 'Mais' });
  return Array.from(sheet.querySelectorAll('.phone-cell__label')).map((el) => el.textContent ?? '');
}

function createPhoneMediaQuery(initialMatches = true) {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  return {
    get matches() {
      return matches;
    },
    media: '(max-width: 767px)',
    addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    }),
    dispatch(nextMatches: boolean) {
      matches = nextMatches;
      listeners.forEach((listener) => listener({ matches } as MediaQueryListEvent));
    },
  };
}

describe('MobileNav', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    localStorage.clear();
    setLimits();
    mockedUseMensagensUnread.mockReturnValue(0);
    mockedUseEquipeChatUnread.mockReturnValue(0);
  });

  it('renders a stable active route without canvas chrome', () => {
    setAuth();
    renderMobileNav('/entregas');

    const entregas = screen.getByRole('button', { name: 'Entregas' });
    expect(entregas).toHaveAttribute('aria-current', 'page');
    expect(entregas).toHaveClass('active');
    expect(document.querySelector('canvas')).not.toBeInTheDocument();
    expect(document.querySelector('.mobile-nav-bubble-circle')).not.toBeInTheDocument();
  });

  it('is a permanently mounted nav, never a dialog', () => {
    setAuth();
    renderMobileNav('/dashboard');
    // isDocumentBusy (packages/app-lifecycle) treats any [role="dialog"] as unsaved
    // work and would stall silent deploy swaps.
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Navegação principal' })).toBeInTheDocument();
  });

  describe('--mobile-nav-chrome-offset', () => {
    function stubViewport(offsetTop: number, height: number, innerHeight: number) {
      const viewport = Object.assign(new EventTarget(), { offsetTop, height });
      vi.stubGlobal('visualViewport', viewport);
      vi.stubGlobal('innerHeight', innerHeight);
      setAuth();
    }

    afterEach(() => {
      vi.unstubAllGlobals();
      document.documentElement.style.removeProperty('--mobile-nav-chrome-offset');
    });

    const offset = () =>
      document.documentElement.style.getPropertyValue('--mobile-nav-chrome-offset');

    it("lifts the bar by the part of the layout viewport Safari's toolbar covers", () => {
      stubViewport(0, 640, 714);
      renderMobileNav('/dashboard');
      expect(offset()).toBe('74px');
    });

    it('stays 0 in the iOS home-screen app, where offsetTop is minus the status bar', () => {
      // Measured in the iOS 26 Simulator: innerHeight 874, visualViewport 874 tall at -62.
      stubViewport(-62, 874, 874);
      renderMobileNav('/dashboard');
      expect(offset()).toBe('0px');
    });
  });

  it('exposes the Mais sheet state', () => {
    setAuth();
    renderMobileNav('/dashboard');

    const more = screen.getByRole('button', { name: 'Mais' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(more).toHaveAttribute('aria-controls', 'mobile-more-sheet');
    expect(document.querySelector('.mobile-more-profile .avatar')?.textContent).toBe('AM');
    expect(document.getElementById('mobile-user-name')?.textContent).toBe('Ana Maria');
  });

  it('MobileNav shows the user photo in the Mais sheet', () => {
    setAuth({ avatar_url: 'https://x.test/a.jpg' });
    renderMobileNav('/dashboard');
    fireEvent.click(screen.getByRole('button', { name: 'Mais' }));
    const photo = document.querySelector('.mobile-more-profile img.avatar--photo');
    expect(photo).toHaveAttribute('src', 'https://x.test/a.jpg');
  });

  it('marks Mais as the current destination for More routes, including primary-prefix collisions', () => {
    setAuth();
    renderMobileNav('/analytics-fluxos');

    expect(screen.getByRole('button', { name: 'Mais' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Mais' })).toHaveClass('active');
    expect(screen.getByRole('button', { name: 'Início' })).not.toHaveAttribute('aria-current');
  });

  it('marks Mais as current on a shortcut route that is not on the bar (Analytics)', () => {
    setAuth();
    renderMobileNav('/analytics');
    expect(screen.getByRole('button', { name: 'Mais' })).toHaveAttribute('aria-current', 'page');
  });

  it('uses dialog semantics, makes the background inert, closes on Escape, and restores focus', async () => {
    setAuth();
    const { container } = renderMobileNav('/dashboard');
    const more = screen.getByRole('button', { name: 'Mais' });

    fireEvent.click(more);

    const sheet = await screen.findByRole('dialog', { name: 'Mais' });
    expect(sheet).toHaveClass('mobile-more-sheet');
    await waitFor(() => expect(sheet).toContainElement(document.activeElement as HTMLElement));
    expect(container).toHaveAttribute('aria-hidden', 'true');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Mais' })).toBeNull());
    await waitFor(() => expect(more).toHaveFocus());
  });

  it('closes the phone sheet when the phone media query stops matching', async () => {
    const phoneMedia = createPhoneMediaQuery();
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) =>
        query === '(max-width: 767px)'
          ? phoneMedia
          : {
              matches: false,
              media: query,
              addEventListener: vi.fn(),
              removeEventListener: vi.fn(),
            },
      ),
    );
    setAuth();
    renderMobileNav('/dashboard');
    const more = screen.getByRole('button', { name: 'Mais' });
    fireEvent.click(more);
    expect(await screen.findByRole('dialog', { name: 'Mais' })).toBeInTheDocument();

    act(() => phoneMedia.dispatch(false));

    await waitFor(() => expect(more).toHaveAttribute('aria-expanded', 'false'));
    expect(screen.queryByRole('dialog', { name: 'Mais' })).toBeNull();
  });

  it('opens the shared global search dialog from the Buscar row and closes the sheet', async () => {
    setAuth();
    renderMobileNav('/dashboard');

    const sheet = openMore();
    expect(screen.queryByTestId('global-search-dialog')).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Buscar' }));

    expect(screen.getByTestId('global-search-dialog')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Mais' })).toBeNull());
  });

  it('navigates from more sheet and closes it', async () => {
    setAuth();
    renderMobileNav('/dashboard');

    const sheet = openMore();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Configurações' }));

    await waitFor(() => {
      expect(screen.getByTestId('path').textContent).toBe('/configuracao');
    });
    expect(document.getElementById('mobile-more-btn')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog', { name: 'Mais' })).toBeNull();
  });

  it.each([
    ['Novidades', '/novidades'],
    ['Privacidade', '/politica-de-privacidade'],
  ])(
    'opens %s (a page outside the shell) in a new tab instead of leaving the app',
    async (label, route) => {
      setAuth();
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      renderMobileNav('/dashboard');

      const sheet = openMore();
      fireEvent.click(within(sheet).getByRole('button', { name: `${label} (abre em nova aba)` }));

      expect(open).toHaveBeenCalledWith(route, '_blank', 'noopener,noreferrer');
      expect(screen.getByTestId('path').textContent).toBe('/dashboard');
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Mais' })).toBeNull());
      open.mockRestore();
    },
  );

  it('includes the sidebar routes that are not on the bar in the more sheet', () => {
    setAuth();
    renderMobileNav('/dashboard');
    openMore();
    const rows = moreRows();

    expect(rows).toContain('Calendário');
    expect(rows).toContain('Leads');
    expect(rows).toContain('Ideias');
    expect(rows).toContain('Arquivos');
    expect(rows).toContain('Fluxos');
    expect(rows).toContain('Privacidade');
    // On the bar, so not repeated in Mais.
    expect(rows).not.toContain('Entregas');
    expect(rows).not.toContain('Mensagens');
  });

  it('does not render the TikTok analytics placeholder (spec B4)', () => {
    setAuth();
    renderMobileNav('/dashboard');
    openMore();

    const rows = moreRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((label) => label.includes('TikTok'))).toBe(false);
  });

  it('toggles theme and signs out', async () => {
    const signOut = vi.fn();
    setAuth({ signOut });
    renderMobileNav('/dashboard');

    openMore();
    const themeSwitch = screen.getByRole('switch', { name: 'Modo Escuro' });
    expect(themeSwitch).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(document.getElementById('mobile-theme-toggle')!);

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(screen.getByRole('switch', { name: 'Modo Escuro' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    fireEvent.click(document.getElementById('mobile-logout-btn')!);
    expect(signOut).toHaveBeenCalled();
  });

  it('hides feature-gated items in the more sheet when their flag is false', () => {
    setAuth();
    setLimits({
      features: { feature_leads: false, feature_financial: false, feature_contracts: false },
    });
    renderMobileNav('/dashboard');
    openMore();
    const rows = moreRows();

    expect(rows).not.toContain('Leads');
    expect(rows).not.toContain('Financeiro');
    expect(rows).not.toContain('Contratos');
    // Ungated more-sheet items remain.
    expect(rows).toContain('Calendário');
  });

  it('shows feature-gated items in the more sheet when their flag is true', () => {
    setAuth();
    setLimits({
      features: { feature_leads: true, feature_financial: true, feature_contracts: true },
    });
    renderMobileNav('/dashboard');
    openMore();
    const rows = moreRows();

    expect(rows).toContain('Leads');
    expect(rows).toContain('Financeiro');
    expect(rows).toContain('Contratos');
  });

  it('renders Automações dimmed with a lock icon in the more sheet when the feature flag is false', () => {
    setAuth();
    setLimits({ features: { feature_instagram_automation: false } });
    renderMobileNav('/dashboard');
    openMore();

    const locked = screen.getByTestId('mobile-nav-locked-automacoes');
    expect(locked).toBeInTheDocument();
    expect(within(locked).getByLabelText('Bloqueado')).toBeInTheDocument();
    expect(locked).toHaveClass('mobile-more-item--locked');
    expect(locked.textContent).toContain('Automações');
  });

  it('navigates to /automacoes when the locked item in the more sheet is clicked', async () => {
    setAuth();
    setLimits({ features: { feature_instagram_automation: false } });
    renderMobileNav('/dashboard');
    openMore();

    fireEvent.click(screen.getByTestId('mobile-nav-locked-automacoes'));

    await waitFor(() => {
      expect(screen.getByTestId('path').textContent).toBe('/automacoes');
    });
  });

  describe('Mensagens unread badge on the tab', () => {
    it('shows the count and names it', () => {
      setAuth();
      setLimits({ features: { feature_mensagens: true } });
      mockedUseMensagensUnread.mockReturnValue(5);
      renderMobileNav('/dashboard');

      expect(screen.getByTestId('mensagens-tab-badge')).toHaveTextContent('5');
      expect(screen.getByRole('button', { name: 'Mensagens, 5 não lidas' })).toBeInTheDocument();
    });

    it('is hidden at 0', () => {
      setAuth();
      setLimits({ features: { feature_mensagens: true } });
      renderMobileNav('/dashboard');

      expect(screen.queryByTestId('mensagens-tab-badge')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Mensagens' })).toBeInTheDocument();
    });

    it('caps at 99+', () => {
      setAuth();
      setLimits({ features: { feature_mensagens: true } });
      mockedUseMensagensUnread.mockReturnValue(150);
      renderMobileNav('/dashboard');

      expect(screen.getByTestId('mensagens-tab-badge')).toHaveTextContent('99+');
    });

    it('sums the clientes and equipe unread counts', () => {
      setAuth();
      setLimits({ features: { feature_mensagens: true, feature_team_chat: true } });
      mockedUseMensagensUnread.mockReturnValue(3);
      mockedUseEquipeChatUnread.mockReturnValue(4);
      renderMobileNav('/dashboard');

      expect(screen.getByTestId('mensagens-tab-badge')).toHaveTextContent('7');
    });

    it('keeps the Mensagens tab with only the team chat (feature_mensagens off)', () => {
      setAuth();
      setLimits({ features: { feature_mensagens: false, feature_team_chat: true } });
      mockedUseEquipeChatUnread.mockReturnValue(4);
      renderMobileNav('/dashboard');

      expect(screen.getByTestId('mensagens-tab-badge')).toHaveTextContent('4');
    });
  });

  /** D18: Início, Entregas, Agenda, Mensagens, Mais, with Clientes then Analytics
   *  taking the slot of a tab the plan or the role doesn't have. */
  describe('tab bar and fallbacks', () => {
    it('shows Início, Entregas, Agenda, Mensagens, Mais with the Agenda on', () => {
      setAuth();
      setLimits({ features: { feature_agenda: true, feature_mensagens: true } });
      renderMobileNav('/dashboard');

      expect(tabLabels()).toEqual(['Início', 'Entregas', 'Agenda', 'Mensagens', 'Mais']);
    });

    it('puts Clientes and Analytics at the top of Mais and drops the Calendário row (it is the Agenda tab)', () => {
      setAuth();
      setLimits({ features: { feature_agenda: true, feature_mensagens: true } });
      renderMobileNav('/dashboard');
      openMore();
      const rows = moreRows();

      expect(rows.slice(0, 2)).toEqual(['Clientes', 'Analytics']);
      expect(rows).not.toContain('Calendário');
      expect(rows).not.toContain('Agenda');
    });

    it('marks the Agenda tab active on /calendario', () => {
      setAuth();
      setLimits({ features: { feature_agenda: true } });
      renderMobileNav('/calendario');

      expect(screen.getByRole('button', { name: 'Agenda' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(screen.getByRole('button', { name: 'Mais' })).not.toHaveAttribute('aria-current');
    });

    it('gives the Agenda slot to Clientes on a plan without feature_agenda (Free), keeping the editorial Calendário in Mais', () => {
      setAuth();
      setLimits({ features: { feature_agenda: false, feature_mensagens: true } });
      renderMobileNav('/dashboard');

      expect(tabLabels()).toEqual(['Início', 'Entregas', 'Clientes', 'Mensagens', 'Mais']);
      openMore();
      const rows = moreRows();
      expect(rows[0]).toBe('Analytics');
      expect(rows).toContain('Calendário');
    });

    it('fills both free slots with Clientes then Analytics when Agenda and Mensagens are off', () => {
      setAuth();
      setLimits({ features: { feature_agenda: false, feature_mensagens: false } });
      renderMobileNav('/dashboard');

      expect(tabLabels()).toEqual(['Início', 'Entregas', 'Clientes', 'Analytics', 'Mais']);
      openMore();
      expect(moreRows()).not.toContain('Clientes');
      expect(moreRows()).not.toContain('Analytics');
    });

    it('keeps the default bar while the plan is loading (no tab flip on boot)', () => {
      setAuth();
      setLimits({ features: null, isLoading: true });
      renderMobileNav('/dashboard');

      expect(tabLabels()).toEqual(['Início', 'Entregas', 'Agenda', 'Mensagens', 'Mais']);
    });

    it('treats a loaded but missing plan like CalendarioPage does: no Agenda tab', () => {
      setAuth();
      setLimits({ features: null, isLoading: false });
      renderMobileNav('/dashboard');

      expect(tabLabels()).toEqual(['Início', 'Entregas', 'Clientes', 'Mensagens', 'Mais']);
    });

    it('drops Agenda without calendario.ver even with feature_agenda on', () => {
      setCustomRole({ entregas: 'ver', clientes: 'ver', analytics: 'ver', calendario: 'none' });
      setLimits({ features: { feature_agenda: true, feature_mensagens: true } });
      renderMobileNav('/dashboard');

      expect(tabLabels()).toEqual(['Início', 'Entregas', 'Clientes', 'Mensagens', 'Mais']);
    });

    it('falls through to Analytics when clientes.ver is missing (Mensagens and Clientes both need it)', () => {
      setCustomRole({ entregas: 'ver', calendario: 'ver', analytics: 'ver', clientes: 'none' });
      setLimits({ features: { feature_agenda: true, feature_mensagens: true } });
      renderMobileNav('/dashboard');

      expect(tabLabels()).toEqual(['Início', 'Entregas', 'Agenda', 'Analytics', 'Mais']);
    });
  });

  /**
   * Task 14, revisão externa round 4 (P2): primary items are gated on the same
   * NAV_MODULE table `getNavGroups` uses, so a denied module never shows a tab.
   */
  describe('primary bar gated on NAV_MODULE/can()', () => {
    it('hides Clientes for a custom role with clientes:none, keeping Início', () => {
      setCustomRole({ clientes: 'none' });
      renderMobileNav('/dashboard');

      expect(screen.getByRole('button', { name: 'Início' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Clientes' })).not.toBeInTheDocument();
    });

    it('keeps Início even with no permissions granted at all', () => {
      setCustomRole({});
      renderMobileNav('/dashboard');

      expect(tabLabels()).toEqual(['Início', 'Mais']);
      expect(screen.queryByRole('button', { name: 'Clientes' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Analytics' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Entregas' })).not.toBeInTheDocument();
    });

    it("keeps every legacy agent's tabs (preset grants clientes/analytics/entregas) — no regression", () => {
      setAuth({ role: 'agent' });
      renderMobileNav('/dashboard');

      expect(tabLabels()).toEqual(['Início', 'Entregas', 'Clientes', 'Mensagens', 'Mais']);
      openMore();
      expect(moreRows()[0]).toBe('Analytics');
    });

    it('shows a custom role with clientes:ver the Clientes tab (ver satisfies the nav gate)', () => {
      setCustomRole({ clientes: 'ver' });
      renderMobileNav('/dashboard');

      expect(screen.getByRole('button', { name: 'Clientes' })).toBeInTheDocument();
    });
  });
});
