import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../../lib/supabase');

import { useAuth } from '../../../context/AuthContext';
import * as supabaseModule from '../../../lib/supabase';
import Sidebar from '../Sidebar';

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
          element={(
            <>
              <Sidebar {...props} />
              <PathProbe />
            </>
          )}
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
    expect(screen.getByText('Equipe')).toBeInTheDocument();
    expect(screen.getByText('Instagram').closest('a')).toHaveClass('active');
  });

  it('toggles the theme and closes the drawer with Escape when opened as a drawer', () => {
    const onClose = vi.fn();
    setAuth();

    renderSidebar('/dashboard', { isDrawer: true, isOpen: true, onClose });

    fireEvent.click(screen.getByTitle('Alternar Tema'));

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
        { workspace_id: 'w-1', role: 'owner', workspaces: { id: 'w-1', name: 'Workspace Principal' } },
        { workspace_id: 'w-2', role: 'owner', workspaces: { id: 'w-2', name: 'Workspace Secundario' } },
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
});
