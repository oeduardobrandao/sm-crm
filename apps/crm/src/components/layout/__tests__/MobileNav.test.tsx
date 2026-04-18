import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from '../../../context/AuthContext';
import MobileNav from '../MobileNav';

const mockedUseAuth = vi.mocked(useAuth);

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
    } as never,
    role: 'owner',
    loading: false,
    refetchProfile: vi.fn(),
    signOut: vi.fn(),
    ...overrides,
  });
}

function renderMobileNav(pathname = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route
          path="*"
          element={(
            <>
              <MobileNav />
              <PathProbe />
            </>
          )}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('MobileNav', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    localStorage.clear();
  });

  it('marks the current tab as active and shows the current profile in the more sheet', () => {
    setAuth();
    const { container } = renderMobileNav('/analytics');

    expect(container.querySelectorAll('a.mobile-nav-item')[2]).toHaveClass('active');

    fireEvent.click(container.querySelector('#mobile-more-btn')!);

    expect(screen.getByText('Navegação')).toBeInTheDocument();
    expect(screen.getByText('Ana Maria')).toBeInTheDocument();
    expect(screen.getByText('AM')).toBeInTheDocument();
  });

  it('navigates from the more sheet and closes it afterwards', async () => {
    setAuth();
    const { container } = renderMobileNav('/dashboard');

    fireEvent.click(container.querySelector('#mobile-more-btn')!);
    fireEvent.click(screen.getByText('Configurações'));

    await waitFor(() => {
      expect(screen.getByTestId('current-path')).toHaveTextContent('/configuracao');
    });

    expect(screen.queryByText('Navegação')).not.toBeInTheDocument();
  });

  it('toggles the theme and signs out from the more sheet actions', () => {
    const signOut = vi.fn();
    setAuth({ signOut });
    const { container } = renderMobileNav('/dashboard');

    fireEvent.click(container.querySelector('#mobile-more-btn')!);
    fireEvent.click(screen.getByText('Tema'));

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(localStorage.getItem('theme')).toBe('dark');

    fireEvent.click(screen.getByText('Sair da Conta'));
    expect(signOut).toHaveBeenCalled();
  });
});
