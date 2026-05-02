import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../../hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({
    limits: null,
    features: null,
    planName: null,
    isLoading: false,
    isUnlimited: true,
  }),
}));

import { useAuth } from '../../../context/AuthContext';
import ProtectedRoute from '../ProtectedRoute';

const mockedUseAuth = vi.mocked(useAuth);

function renderRoute(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route path="/login" element={<div>Tela de login</div>} />
        <Route path="/dashboard" element={(
          <ProtectedRoute>
            <div>Área protegida: dashboard</div>
          </ProtectedRoute>
        )} />
        <Route path="/workspace-setup" element={(
          <ProtectedRoute>
            <div>Área protegida: setup</div>
          </ProtectedRoute>
        )} />
        <Route
          path="*"
          element={(
            <ProtectedRoute>
              <div>Área protegida</div>
            </ProtectedRoute>
          )}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  it('redirects unauthenticated users to the login screen', () => {
    mockedUseAuth.mockReturnValue({
      user: null,
      profile: null,
      role: 'agent',
      loading: false,
      refetchProfile: vi.fn(),
      signOut: vi.fn(),
    });

    renderRoute('/financeiro');

    expect(screen.getByText('Tela de login')).toBeInTheDocument();
  });

  it('redirects blocked agent routes back to the dashboard', () => {
    mockedUseAuth.mockReturnValue({
      user: { id: 'user-7' } as never,
      profile: { id: 'user-7', role: 'agent' } as never,
      role: 'agent',
      loading: false,
      refetchProfile: vi.fn(),
      signOut: vi.fn(),
    });

    renderRoute('/equipe');

    expect(screen.getByText('Área protegida: dashboard')).toBeInTheDocument();
  });

  it('renders a loading spinner while the auth session is hydrating', () => {
    mockedUseAuth.mockReturnValue({
      user: null,
      profile: null,
      role: 'agent',
      loading: true,
      refetchProfile: vi.fn(),
      signOut: vi.fn(),
    });

    const { container } = renderRoute('/dashboard');

    // While loading, neither the protected children nor the login redirect render.
    expect(screen.queryByText(/Área protegida/)).not.toBeInTheDocument();
    expect(screen.queryByText('Tela de login')).not.toBeInTheDocument();
    // The loading path renders the Spinner wrapper div.
    expect(container.firstChild).not.toBeNull();
  });

  it.each(['/financeiro', '/contratos', '/leads', '/equipe'])(
    'redirects agent away from %s to the dashboard',
    (blocked) => {
      mockedUseAuth.mockReturnValue({
        user: { id: 'u' } as never,
        profile: { id: 'u', role: 'agent' } as never,
        role: 'agent',
        loading: false,
        refetchProfile: vi.fn(),
        signOut: vi.fn(),
      });

      renderRoute(blocked);

      expect(screen.getByText('Área protegida: dashboard')).toBeInTheDocument();
    },
  );

  it('allows an agent to reach non-blocked routes', () => {
    mockedUseAuth.mockReturnValue({
      user: { id: 'u' } as never,
      profile: { id: 'u', role: 'agent' } as never,
      role: 'agent',
      loading: false,
      refetchProfile: vi.fn(),
      signOut: vi.fn(),
    });

    renderRoute('/dashboard');

    expect(screen.getByText('Área protegida: dashboard')).toBeInTheDocument();
  });

  it('redirects owner without empresa to workspace-setup', () => {
    mockedUseAuth.mockReturnValue({
      user: { id: 'owner-1' } as never,
      profile: { id: 'owner-1', role: 'owner' } as never,
      role: 'owner',
      loading: false,
      refetchProfile: vi.fn(),
      signOut: vi.fn(),
    });

    renderRoute('/dashboard');

    expect(screen.getByText('Área protegida: setup')).toBeInTheDocument();
  });

  it('does not loop owner already on workspace-setup', () => {
    mockedUseAuth.mockReturnValue({
      user: { id: 'owner-1' } as never,
      profile: { id: 'owner-1', role: 'owner' } as never,
      role: 'owner',
      loading: false,
      refetchProfile: vi.fn(),
      signOut: vi.fn(),
    });

    renderRoute('/workspace-setup');

    expect(screen.getByText('Área protegida: setup')).toBeInTheDocument();
  });

  it('lets owner with empresa into the protected area', () => {
    mockedUseAuth.mockReturnValue({
      user: { id: 'owner-1' } as never,
      profile: { id: 'owner-1', role: 'owner', empresa: 'Mesaas' } as never,
      role: 'owner',
      loading: false,
      refetchProfile: vi.fn(),
      signOut: vi.fn(),
    });

    renderRoute('/dashboard');

    expect(screen.getByText('Área protegida: dashboard')).toBeInTheDocument();
  });
});
