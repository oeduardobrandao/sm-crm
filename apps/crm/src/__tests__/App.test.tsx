import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../context/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/sonner', () => ({
  Toaster: () => <div>Toaster</div>,
}));

vi.mock('@/components/ui/spinner', () => ({
  Spinner: ({ size }: { size?: string }) => <div>Spinner {size}</div>,
}));

vi.mock('../components/layout/ProtectedRoute', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../components/layout/AppLayout', () => ({
  default: () => (
    <div>
      <div>App layout</div>
      <Outlet />
    </div>
  ),
}));

vi.mock('../pages/login/LoginPage', () => ({
  default: () => <div>Login page</div>,
}));

vi.mock('../pages/landing/LandingPage', () => ({
  default: () => <div>Landing page</div>,
}));

vi.mock('../pages/dashboard/DashboardPage', () => ({
  default: () => <div>Dashboard page</div>,
}));

import App from '../App';

function renderApp(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <App />
    </MemoryRouter>,
  );
}

describe('App', () => {
  it('renders the public landing route at the root path', async () => {
    renderApp('/');

    expect(await screen.findByText('Landing page')).toBeInTheDocument();
    expect(screen.getByText('Toaster')).toBeInTheDocument();
  });

  it('renders protected dashboard routes inside the app layout', async () => {
    renderApp('/dashboard');

    expect(await screen.findByText('App layout')).toBeInTheDocument();
    expect(await screen.findByText('Dashboard page')).toBeInTheDocument();
  });

  it('redirects unknown routes to the login page', async () => {
    renderApp('/rota-inexistente');

    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });
});
