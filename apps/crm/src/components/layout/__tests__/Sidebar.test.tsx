import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../../hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: vi.fn(),
}));

// Passthrough: the flag-OR-count widening itself is covered by
// useEffectiveNavFeatures.test.ts's pure-function tests. Mocking it here
// keeps Sidebar's existing feature-flag assertions exercising exactly the
// `features` object they pass in, and avoids needing a QueryClientProvider
// in this test tree (the real hook calls useQuery).
vi.mock('../../../hooks/useEffectiveNavFeatures', () => ({
  useEffectiveNavFeatures: vi.fn((features: unknown) => features),
}));

vi.mock('../../../hooks/useMensagensUnread', () => ({
  useMensagensUnread: vi.fn(() => 0),
}));

vi.mock('../../../lib/supabase');

// No QueryClientProvider in this tree: the real palette runs useQuery. Like the real Radix
// dialog, the stand-in renders through a portal and focuses its field on open.
vi.mock('../GlobalSearchDialog', async () => {
  const { createPortal } = await import('react-dom');
  return {
    default: ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) =>
      open
        ? createPortal(
            <div role="dialog">
              <input aria-label="Campo de busca" autoFocus />
              <button type="button" onClick={() => onOpenChange(false)}>
                Fechar busca
              </button>
            </div>,
            document.body,
          )
        : null,
  };
});

vi.mock('@/store/workspace', () => ({
  switchWorkspace: vi.fn().mockResolvedValue(undefined),
}));

import { useAuth } from '../../../context/AuthContext';
import { useWorkspaceLimits } from '../../../hooks/useWorkspaceLimits';
import { useMensagensUnread } from '../../../hooks/useMensagensUnread';
import * as supabaseModule from '../../../lib/supabase';
import Sidebar from '../Sidebar';
import { makeCan, fakeMembership } from '@/test/makeCan';

const mockedUseWorkspaceLimits = vi.mocked(useWorkspaceLimits);
const mockedUseMensagensUnread = vi.mocked(useMensagensUnread);

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

type MockedSupabaseModule = typeof supabaseModule & {
  __resetSupabaseMock: () => void;
  __queueSupabaseResult: (
    table: string,
    operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert',
    ...responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>
  ) => void;
};

const mockedUseAuth = vi.mocked(useAuth);
const mockedSupabase = supabaseModule as MockedSupabaseModule;

function PathProbe() {
  const location = useLocation();
  return <div data-testid="current-path">{location.pathname}</div>;
}

function setAuth(overrides: Record<string, unknown> = {}) {
  // `can` mirrors whichever role this call is simulating -- default 'owner',
  // or the `role` override (this file only ever exercises legacy roles, not
  // custom role_id/permissions memberships).
  const role = (overrides.role as 'owner' | 'admin' | 'agent' | undefined) ?? 'owner';
  mockedUseAuth.mockReturnValue({
    user: { id: 'user-1' } as never,
    profile: {
      id: 'user-1',
      nome: 'Ana Maria',
      role: 'owner',
      conta_id: 'w-1',
      active_workspace_id: 'w-1',
    } as never,
    role: 'owner',
    workspaceRole: role,
    canSeeFinancials: true,
    can: makeCan(fakeMembership({ role })),
    loading: false,
    refetchProfile: vi.fn(),
    signOut: vi.fn(),
    ...overrides,
  });
}

function renderSidebar(
  pathname = '/dashboard',
  props: {
    isDrawer?: boolean;
    isOpen?: boolean;
    onClose?: () => void;
    collapsible?: boolean;
    pinned?: boolean;
    onTogglePinned?: () => void;
    vidroShell?: boolean;
    look?: { enabled: boolean; optedOut: boolean; onToggle: () => void };
  } = {},
) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <Sidebar {...props} />
              <PathProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Sidebar', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
    document.documentElement.removeAttribute('data-theme');
    localStorage.clear();
    setLimits();
    mockedUseMensagensUnread.mockReturnValue(0);
  });

  it('filters restricted navigation items for agents and marks the active route', () => {
    setAuth({
      role: 'agent',
      profile: {
        id: 'user-1',
        nome: 'Ana Maria',
        role: 'agent',
        conta_id: 'w-1',
        active_workspace_id: 'w-1',
      } as never,
    });

    renderSidebar('/analytics');

    expect(screen.queryByText('Leads')).not.toBeInTheDocument();
    expect(screen.queryByText('Financeiro')).not.toBeInTheDocument();
    expect(screen.queryByText('Contratos')).not.toBeInTheDocument();
    expect(screen.getByText('Clientes')).toBeInTheDocument();
    // Agents are route-blocked from /equipe by ProtectedRoute, so the link
    // must not render here either (previously it did, bouncing them back).
    expect(screen.queryByText('Equipe')).not.toBeInTheDocument();
    expect(screen.getByText('Instagram').closest('a')).toHaveClass('active');
  });

  it('toggles the theme and closes the drawer with Escape when opened as a drawer', () => {
    const onClose = vi.fn();
    setAuth();

    renderSidebar('/dashboard', { isDrawer: true, isOpen: true, onClose });

    // Open user menu, then click the theme toggle button inside it
    fireEvent.click(screen.getByText('Ana Maria'));
    fireEvent.click(screen.getByText('Modo Escuro'));

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(screen.getByText('Modo Claro')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows workspace options in the user menu and lets the user sign out', async () => {
    const signOut = vi.fn();
    setAuth({ signOut });
    mockedSupabase.__queueSupabaseResult('workspace_members', 'select', {
      data: [
        {
          workspace_id: 'w-1',
          role: 'owner',
          workspaces: { id: 'w-1', name: 'Workspace Principal' },
        },
        {
          workspace_id: 'w-2',
          role: 'owner',
          workspaces: { id: 'w-2', name: 'Workspace Secundario' },
        },
      ],
      error: null,
    });

    renderSidebar('/dashboard');
    fireEvent.click(screen.getByText('Ana Maria'));

    expect(await screen.findByText('Opções da Conta')).toBeInTheDocument();
    expect(await screen.findByText('Workspace Principal')).toBeInTheDocument();
    expect(screen.getByText('Workspace Secundario')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Sair'));
    expect(signOut).toHaveBeenCalled();
  });

  it('collapses the language options into a submenu that expands on click', async () => {
    setAuth();

    renderSidebar('/dashboard');
    fireEvent.click(screen.getByText('Ana Maria'));

    const languageToggle = await screen.findByText('Idioma');
    // Collapsed by default: no selectable language rows in the DOM yet.
    expect(screen.queryByText('English')).not.toBeInTheDocument();

    fireEvent.click(languageToggle);

    expect(await screen.findByText('English')).toBeInTheDocument();
    expect(screen.getAllByText('Português').length).toBeGreaterThan(0);

    fireEvent.click(languageToggle);
    expect(screen.queryByText('English')).not.toBeInTheDocument();
  });

  it('navigates to the selected route and closes the drawer after a nav click', async () => {
    const onClose = vi.fn();
    setAuth();

    renderSidebar('/dashboard', { isDrawer: true, isOpen: true, onClose });
    fireEvent.click(screen.getByText('Clientes'));

    await waitFor(() => {
      expect(screen.getByTestId('current-path')).toHaveTextContent('/clientes');
    });

    expect(onClose).toHaveBeenCalled();
  });

  it('opens the Novidades changelog in a new tab from the account menu', () => {
    setAuth();

    renderSidebar('/dashboard');
    fireEvent.click(screen.getByText('Ana Maria'));

    const link = screen.getByText('Novidades').closest('a');
    expect(link).toHaveAttribute('href', '/novidades');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('hides feature-gated nav items when their feature flag is explicitly false', () => {
    setAuth();
    setLimits({
      features: {
        feature_leads: false,
        feature_financial: false,
        feature_contracts: false,
      },
    });

    renderSidebar('/dashboard');

    // Gated items whose flag is false are removed from the DOM.
    expect(screen.queryByText('Leads')).not.toBeInTheDocument();
    expect(screen.queryByText('Financeiro')).not.toBeInTheDocument();
    expect(screen.queryByText('Contratos')).not.toBeInTheDocument();
    // Ungated items remain visible.
    expect(screen.getByText('Clientes')).toBeInTheDocument();
    expect(screen.getByText('Equipe')).toBeInTheDocument();
  });

  it('does not render the TikTok analytics placeholder (spec B4)', () => {
    setAuth();

    renderSidebar('/dashboard', { isDrawer: true, isOpen: true, onClose: vi.fn() });

    expect(screen.getByText('Instagram')).toBeInTheDocument();
    expect(screen.queryByText('TikTok')).not.toBeInTheDocument();
  });

  it('shows feature-gated nav items when their feature flag is true', () => {
    setAuth();
    setLimits({
      features: {
        feature_leads: true,
        feature_financial: true,
        feature_contracts: true,
      },
    });

    renderSidebar('/dashboard');

    expect(screen.getByText('Leads')).toBeInTheDocument();
    expect(screen.getByText('Financeiro')).toBeInTheDocument();
    expect(screen.getByText('Contratos')).toBeInTheDocument();
  });

  it('renders Automações dimmed with a lock icon when the feature flag is false', () => {
    setAuth();
    setLimits({ features: { feature_instagram_automation: false } });

    renderSidebar('/dashboard');

    const locked = screen.getByTestId('nav-locked-automacoes');
    expect(locked).toBeInTheDocument();
    expect(locked.querySelector('.ph-lock')).not.toBeNull();
    expect(locked).toHaveClass('sidebar-sub-link--locked');
    expect(screen.getByText('Automações')).toBeInTheDocument();
  });

  it('navigates to /automacoes when the locked item is clicked', async () => {
    setAuth();
    setLimits({ features: { feature_instagram_automation: false } });

    renderSidebar('/dashboard');

    fireEvent.click(screen.getByTestId('nav-locked-automacoes'));

    await waitFor(() => {
      expect(screen.getByTestId('current-path')).toHaveTextContent('/automacoes');
    });
  });

  it('renders the Mensagens unread badge when count > 0', () => {
    setAuth();
    setLimits({ features: { feature_mensagens: true } });
    mockedUseMensagensUnread.mockReturnValue(5);

    renderSidebar('/dashboard');

    const badge = screen.getByTestId('mensagens-nav-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('5');
  });

  it('hides the Mensagens badge when count is 0', () => {
    setAuth();
    setLimits({ features: { feature_mensagens: true } });
    mockedUseMensagensUnread.mockReturnValue(0);

    renderSidebar('/dashboard');

    expect(screen.queryByTestId('mensagens-nav-badge')).not.toBeInTheDocument();
  });

  describe('collapsible desktop sidebar', () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    function hoverIn(nav: HTMLElement) {
      fireEvent.mouseEnter(nav);
      act(() => {
        vi.advanceTimersByTime(200);
      });
    }

    it('is a rail by default and expands over the content on hover', () => {
      vi.useFakeTimers();
      setAuth();
      renderSidebar('/dashboard', { collapsible: true });
      const nav = document.getElementById('sidebar')!;

      expect(nav).toHaveClass('sidebar--rail');
      // Labels fade, they don't leave: still the links' accessible names.
      expect(screen.getByRole('link', { name: 'Clientes' })).toBeInTheDocument();

      // A pass across the rail shorter than the hover-intent delay does nothing.
      fireEvent.mouseEnter(nav);
      act(() => {
        vi.advanceTimersByTime(50);
      });
      fireEvent.mouseLeave(nav);
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(nav).toHaveClass('sidebar--rail');

      hoverIn(nav);
      expect(nav).not.toHaveClass('sidebar--rail');
      expect(nav).toHaveClass('sidebar--overlay');

      fireEvent.mouseLeave(nav);
      expect(nav).toHaveClass('sidebar--rail');
    });

    it('stays expanded and not overlaid when pinned, and the toggle reports pin state', () => {
      setAuth();
      const onTogglePinned = vi.fn();
      renderSidebar('/dashboard', { collapsible: true, pinned: true, onTogglePinned });
      const nav = document.getElementById('sidebar')!;

      expect(nav).not.toHaveClass('sidebar--rail');
      expect(nav).not.toHaveClass('sidebar--overlay');

      const toggle = screen.getByRole('button', { name: 'Recolher menu lateral' });
      expect(toggle).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(toggle);
      expect(onTogglePinned).toHaveBeenCalledTimes(1);
    });

    it('offers to pin when unpinned', () => {
      setAuth();
      renderSidebar('/dashboard', { collapsible: true });

      expect(screen.getByRole('button', { name: 'Fixar menu lateral aberto' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });

    it('collapses after a mouse click on a link once the pointer leaves', () => {
      vi.useFakeTimers();
      setAuth();
      renderSidebar('/dashboard', { collapsible: true });
      const nav = document.getElementById('sidebar')!;

      hoverIn(nav);
      const link = screen.getByRole('link', { name: 'Clientes' });
      // jsdom matches :focus-visible on every focus; a real mouse click doesn't.
      const realMatches = Element.prototype.matches;
      vi.spyOn(Element.prototype, 'matches').mockImplementation(function (
        this: Element,
        selector: string,
      ) {
        return selector === ':focus-visible' ? false : realMatches.call(this, selector);
      });
      act(() => {
        link.focus();
      });
      fireEvent.click(link);
      fireEvent.mouseLeave(nav);

      expect(nav).toHaveClass('sidebar--rail');
    });

    it('holds the overlay open while the account menu is open', () => {
      vi.useFakeTimers();
      setAuth();
      renderSidebar('/dashboard', { collapsible: true });
      const nav = document.getElementById('sidebar')!;

      hoverIn(nav);
      fireEvent.click(document.getElementById('user-menu-wrap')!);
      fireEvent.mouseLeave(nav);

      expect(nav).toHaveClass('sidebar--overlay');
    });

    it('expands on keyboard focus', () => {
      setAuth();
      renderSidebar('/dashboard', { collapsible: true });
      const nav = document.getElementById('sidebar')!;

      // jsdom treats this focus as :focus-visible, i.e. keyboard modality.
      act(() => {
        screen.getByRole('link', { name: 'Clientes' }).focus();
      });
      expect(nav).toHaveClass('sidebar--overlay');
    });

    it('has no rail or toggle when not collapsible', () => {
      setAuth();
      renderSidebar('/dashboard');
      const nav = document.getElementById('sidebar')!;

      expect(nav).not.toHaveClass('sidebar--rail');
      expect(nav).not.toHaveClass('sidebar--overlay');
      expect(screen.queryByRole('button', { name: /menu lateral/ })).not.toBeInTheDocument();
    });
  });

  it('shows "99+" in the Mensagens badge when count > 99', () => {
    setAuth();
    setLimits({ features: { feature_mensagens: true } });
    mockedUseMensagensUnread.mockReturnValue(150);

    renderSidebar('/dashboard');

    const badge = screen.getByTestId('mensagens-nav-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('99+');
  });

  describe('Vidro shell', () => {
    const realLocation = window.location;

    afterEach(() => {
      Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
      vi.useRealTimers();
    });

    it('shows the workspace name and plan in the glass header', async () => {
      setAuth();
      setLimits({ planName: 'Pro' });
      mockedSupabase.__queueSupabaseResult('workspace_members', 'select', {
        data: [
          { workspace_id: 'w-1', role: 'owner', workspaces: { id: 'w-1', name: 'Agência Norte' } },
        ],
        error: null,
      });

      renderSidebar('/dashboard', { collapsible: true, vidroShell: true });

      expect(await screen.findByText('Agência Norte')).toBeInTheDocument();
      expect(screen.getByText('Pro')).toBeInTheDocument();
      expect(document.querySelector('.vidro-sidebar-head')).not.toBeNull();

      // One workspace: the account menu still has no switcher section.
      fireEvent.click(screen.getByText('Ana Maria'));
      expect(await screen.findByText('Opções da Conta')).toBeInTheDocument();
      expect(screen.queryByText('Workspace')).not.toBeInTheDocument();
    });

    it('renders no glass header or sidebar search without vidroShell', async () => {
      setAuth();
      setLimits({ planName: 'Pro' });
      mockedSupabase.__queueSupabaseResult('workspace_members', 'select', {
        data: [
          { workspace_id: 'w-1', role: 'owner', workspaces: { id: 'w-1', name: 'Agência Norte' } },
          { workspace_id: 'w-2', role: 'owner', workspaces: { id: 'w-2', name: 'Outra Agência' } },
        ],
        error: null,
      });

      renderSidebar('/dashboard', { collapsible: true });
      fireEvent.click(screen.getByText('Ana Maria'));
      expect(await screen.findByText('Outra Agência')).toBeInTheDocument();

      // The active workspace's name shows only in the account-menu switcher.
      expect(screen.getAllByText('Agência Norte')).toHaveLength(1);
      expect(document.querySelector('.vidro-sidebar-head')).toBeNull();
      expect(screen.queryByText('Pro')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Buscar' })).not.toBeInTheDocument();
    });

    it('carries one search button that opens the palette', () => {
      setAuth();
      renderSidebar('/dashboard', { collapsible: true, vidroShell: true });

      const buttons = screen.getAllByRole('button', { name: 'Buscar' });
      expect(buttons).toHaveLength(1);
      expect(buttons[0]).toHaveClass('search-trigger--sidebar');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      fireEvent.click(buttons[0]);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('keeps the rail collapsed when focus lands in the portaled search dialog', () => {
      setAuth();
      renderSidebar('/dashboard', { collapsible: true, vidroShell: true });
      const nav = document.getElementById('sidebar')!;
      expect(nav).toHaveClass('sidebar--rail');

      fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));

      // The field lives outside the nav's DOM; its focus still bubbles to the nav through React.
      const field = screen.getByRole('textbox', { name: 'Campo de busca' });
      expect(field).toHaveFocus();
      expect(nav).not.toContainElement(field);
      expect(nav).toHaveClass('sidebar--rail');
      expect(nav).not.toHaveClass('sidebar--overlay');
    });

    it('collapses the rail when keyboard focus moves from the nav into the portaled dialog', () => {
      setAuth();
      renderSidebar('/dashboard', { collapsible: true, vidroShell: true });
      const nav = document.getElementById('sidebar')!;
      const trigger = screen.getByRole('button', { name: 'Buscar' });

      // jsdom treats this focus as :focus-visible, i.e. keyboard modality.
      act(() => {
        trigger.focus();
      });
      expect(nav).toHaveClass('sidebar--overlay');

      fireEvent.click(trigger);

      expect(screen.getByRole('textbox', { name: 'Campo de busca' })).toHaveFocus();
      expect(nav).toHaveClass('sidebar--rail');
    });

    it('does not expand the rail when the pointer is over the portaled search overlay', () => {
      vi.useFakeTimers();
      setAuth();
      renderSidebar('/dashboard', { collapsible: true, vidroShell: true });
      const nav = document.getElementById('sidebar')!;

      // ⌘K opens the palette without the pointer ever touching the nav.
      fireEvent.keyDown(document, { key: 'k', metaKey: true });
      const dialog = screen.getByRole('dialog');
      expect(nav).not.toContainElement(dialog);

      // The overlay appears under a stationary pointer: React bubbles this to the nav.
      fireEvent.mouseEnter(dialog);
      fireEvent.mouseOver(dialog);
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(nav).toHaveClass('sidebar--rail');

      fireEvent.click(screen.getByRole('button', { name: 'Fechar busca' }));
      expect(nav).toHaveClass('sidebar--rail');
    });

    it('collapses the hover overlay when the search opened from the rail closes', () => {
      vi.useFakeTimers();
      setAuth();
      renderSidebar('/dashboard', { collapsible: true, vidroShell: true });
      const nav = document.getElementById('sidebar')!;

      // Hover the rail, then click its search button.
      fireEvent.mouseEnter(nav);
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(nav).toHaveClass('sidebar--overlay');
      fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));

      // The pointer moves off the nav onto the modal overlay: in React's tree that is still
      // inside the nav, so no mouseleave ever reaches it, and closing removes the overlay
      // without one either.
      fireEvent.mouseOver(screen.getByRole('dialog'), { relatedTarget: nav });
      fireEvent.click(screen.getByRole('button', { name: 'Fechar busca' }));

      expect(nav).toHaveClass('sidebar--rail');
    });

    it('offers "Visual clássico" in the account menu and toggles the look', () => {
      setAuth();
      const onToggle = vi.fn();
      renderSidebar('/dashboard', {
        collapsible: true,
        look: { enabled: true, optedOut: false, onToggle },
      });

      fireEvent.click(screen.getByText('Ana Maria'));
      fireEvent.click(screen.getByText('Visual clássico'));
      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('offers "Visual novo" once the user opted out', () => {
      setAuth();
      renderSidebar('/dashboard', {
        collapsible: true,
        look: { enabled: true, optedOut: true, onToggle: vi.fn() },
      });

      fireEvent.click(screen.getByText('Ana Maria'));
      expect(screen.getByText('Visual novo')).toBeInTheDocument();
      expect(screen.queryByText('Visual clássico')).not.toBeInTheDocument();
    });

    it('has no look item in the drawer', () => {
      setAuth();
      renderSidebar('/dashboard', {
        isDrawer: true,
        isOpen: true,
        look: { enabled: true, optedOut: false, onToggle: vi.fn() },
      });

      fireEvent.click(screen.getByText('Ana Maria'));
      expect(screen.getByText('Opções da Conta')).toBeInTheDocument();
      expect(screen.queryByText('Visual clássico')).not.toBeInTheDocument();
      expect(screen.queryByText('Visual novo')).not.toBeInTheDocument();
    });

    it('has no look item when the workspace flag is off', () => {
      setAuth();
      renderSidebar('/dashboard', {
        collapsible: true,
        look: { enabled: false, optedOut: false, onToggle: vi.fn() },
      });

      fireEvent.click(screen.getByText('Ana Maria'));
      expect(screen.getByText('Opções da Conta')).toBeInTheDocument();
      expect(screen.queryByText('Visual clássico')).not.toBeInTheDocument();
    });

    it('clears the look cache before reloading into another workspace', async () => {
      let keyAtReload: string | null | undefined;
      const reload = vi.fn(() => {
        keyAtReload = localStorage.getItem('look-vidro');
      });
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...realLocation, reload },
      });
      localStorage.setItem('look-vidro', 'u1');
      setAuth();
      mockedSupabase.__queueSupabaseResult('workspace_members', 'select', {
        data: [
          {
            workspace_id: 'w-1',
            role: 'owner',
            workspaces: { id: 'w-1', name: 'Workspace Principal' },
          },
          {
            workspace_id: 'w-2',
            role: 'owner',
            workspaces: { id: 'w-2', name: 'Workspace Secundario' },
          },
        ],
        error: null,
      });

      renderSidebar('/dashboard');
      fireEvent.click(screen.getByText('Ana Maria'));
      fireEvent.click(await screen.findByText('Workspace Secundario'));

      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      expect(keyAtReload).toBeNull();
    });
  });
});
