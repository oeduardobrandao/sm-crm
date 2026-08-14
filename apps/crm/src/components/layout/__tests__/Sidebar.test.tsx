import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { useAuth } from '../../../context/AuthContext';
import { useWorkspaceLimits } from '../../../hooks/useWorkspaceLimits';
import { useMensagensUnread } from '../../../hooks/useMensagensUnread';
import * as supabaseModule from '../../../lib/supabase';
import Sidebar from '../Sidebar';

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
    canSeeFinancials: true,
    loading: false,
    refetchProfile: vi.fn(),
    signOut: vi.fn(),
    ...overrides,
  });
}

function renderSidebar(
  pathname = '/dashboard',
  props: { isDrawer?: boolean; isOpen?: boolean; onClose?: () => void } = {},
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

  it('opens the Novidades changelog in a new tab', () => {
    setAuth();

    renderSidebar('/dashboard');

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

  it('renders the TikTok analytics item as disabled with a coming-soon badge', async () => {
    const onClose = vi.fn();
    setAuth();

    renderSidebar('/dashboard', { isDrawer: true, isOpen: true, onClose });

    const tiktokRow = screen.getByText('TikTok').closest('div');
    expect(tiktokRow).toHaveAttribute('aria-disabled', 'true');
    expect(tiktokRow?.tagName).toBe('DIV');
    expect(screen.getByText('Em breve')).toBeInTheDocument();

    fireEvent.click(tiktokRow!);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('current-path')).toHaveTextContent('/dashboard');
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

  it('shows "99+" in the Mensagens badge when count > 99', () => {
    setAuth();
    setLimits({ features: { feature_mensagens: true } });
    mockedUseMensagensUnread.mockReturnValue(150);

    renderSidebar('/dashboard');

    const badge = screen.getByTestId('mensagens-nav-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('99+');
  });
});
