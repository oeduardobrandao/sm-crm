import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../../../context/AuthContext';

vi.mock('../../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../../hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: vi.fn(),
}));

import MobileNav from '../MobileNav';
import { useWorkspaceLimits } from '../../../hooks/useWorkspaceLimits';

const mockedUseAuth = vi.mocked(useAuth);
const mockedUseWorkspaceLimits = vi.mocked(useWorkspaceLimits);

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

function setAuth(overrides: Record<string, unknown> = {}) {
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
    role: (overrides.role as string) || 'owner',
    loading: false,
    signOut: (overrides.signOut as any) || vi.fn(),
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

describe('MobileNav', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    localStorage.clear();
    setLimits();
  });

  it('renders a stable active route without canvas chrome', () => {
    setAuth();
    renderMobileNav('/analytics');

    const analytics = screen.getByRole('button', { name: 'Analytics' });
    expect(analytics).toHaveAttribute('aria-current', 'page');
    expect(analytics).toHaveClass('active');
    expect(document.querySelector('canvas')).not.toBeInTheDocument();
    expect(document.querySelector('.mobile-nav-bubble-circle')).not.toBeInTheDocument();
  });

  it('exposes the Mais sheet state', () => {
    setAuth();
    renderMobileNav('/dashboard');

    const more = screen.getByRole('button', { name: 'Mais' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(more).toHaveAttribute('aria-controls', 'mobile-more-sheet');
    expect(document.getElementById('mobile-avatar')?.textContent).toBe('AM');
    expect(document.getElementById('mobile-user-name')?.textContent).toBe('Ana Maria');
  });

  it('navigates from more sheet and closes it', async () => {
    setAuth();
    renderMobileNav('/dashboard');

    fireEvent.click(document.getElementById('mobile-more-btn')!);

    const configBtn = Array.from(document.querySelectorAll('.mobile-more-item')).find((el) =>
      el.textContent?.includes('Configurações'),
    );
    expect(configBtn).toBeTruthy();
    fireEvent.click(configBtn!);

    await waitFor(() => {
      expect(screen.getByTestId('path').textContent).toBe('/configuracao');
    });
    expect(document.querySelector('.mobile-more-overlay.visible')).toBeNull();
  });

  it('includes all sidebar routes in more sheet', () => {
    setAuth();
    renderMobileNav('/dashboard');
    fireEvent.click(document.getElementById('mobile-more-btn')!);

    const items = Array.from(document.querySelectorAll('.mobile-more-item')).map((el) =>
      el.textContent?.trim(),
    );

    expect(items).toContain('Calendário');
    expect(items).toContain('Leads');
    expect(items).toContain('Ideias');
    expect(items).toContain('Arquivos');
    expect(items).toContain('Fluxos');
    expect(items).toContain('Privacidade');
  });

  it('toggles theme and signs out', async () => {
    const signOut = vi.fn();
    setAuth({ signOut });
    renderMobileNav('/dashboard');

    fireEvent.click(document.getElementById('mobile-more-btn')!);
    fireEvent.click(document.getElementById('mobile-theme-toggle')!);

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');

    fireEvent.click(document.getElementById('mobile-logout-btn')!);
    expect(signOut).toHaveBeenCalled();
  });

  it('hides feature-gated items in the more sheet when their flag is false', () => {
    setAuth();
    setLimits({
      features: { feature_leads: false, feature_financial: false, feature_contracts: false },
    });
    renderMobileNav('/dashboard');
    fireEvent.click(document.getElementById('mobile-more-btn')!);

    const items = Array.from(document.querySelectorAll('.mobile-more-item')).map((el) =>
      el.textContent?.trim(),
    );

    expect(items).not.toContain('Leads');
    expect(items).not.toContain('Financeiro');
    expect(items).not.toContain('Contratos');
    // Ungated more-sheet items remain.
    expect(items).toContain('Calendário');
  });

  it('shows feature-gated items in the more sheet when their flag is true', () => {
    setAuth();
    setLimits({
      features: { feature_leads: true, feature_financial: true, feature_contracts: true },
    });
    renderMobileNav('/dashboard');
    fireEvent.click(document.getElementById('mobile-more-btn')!);

    const items = Array.from(document.querySelectorAll('.mobile-more-item')).map((el) =>
      el.textContent?.trim(),
    );

    expect(items).toContain('Leads');
    expect(items).toContain('Financeiro');
    expect(items).toContain('Contratos');
  });
});
