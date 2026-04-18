import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from '../../../context/AuthContext';
import ProtectedRoute from '../ProtectedRoute';

const mockedUseAuth = vi.mocked(useAuth);

function renderRoute(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route
          path="*"
          element={(
            <ProtectedRoute>
              <div>Área protegida</div>
            </ProtectedRoute>
          )}
        />
        <Route path="/login" element={<div>Tela de login</div>} />
        <Route path="/dashboard" element={<div>Dashboard</div>} />
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

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });
});
