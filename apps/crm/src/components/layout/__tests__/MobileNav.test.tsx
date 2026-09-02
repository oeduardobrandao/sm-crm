import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

import MobileNav from '../MobileNav';
import { useWorkspaceLimits } from '../../../hooks/useWorkspaceLimits';
import { useMensagensUnread } from '../../../hooks/useMensagensUnread';
import { useEquipeChatUnread } from '../../../hooks/useEquipeChatUnread';

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
    canSeeFinancials: overrides.canSeeFinancials ?? true,
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

  it('marks Mais as the current destination for More routes, including primary-prefix collisions', () => {
    setAuth();
    renderMobileNav('/analytics-fluxos');

    expect(screen.getByRole('button', { name: 'Mais' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Mais' })).toHaveClass('active');
    expect(screen.getByRole('button', { name: 'Analytics' })).not.toHaveAttribute('aria-current');
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
    expect(more).toHaveFocus();
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
    expect(document.getElementById('mobile-more-btn')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog', { name: 'Mais' })).toBeNull();
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

  it('renders the TikTok analytics item as an inert row with a coming-soon badge', () => {
    setAuth();
    renderMobileNav('/dashboard');
    fireEvent.click(document.getElementById('mobile-more-btn')!);

    const tiktokRow = Array.from(document.querySelectorAll('.mobile-more-item')).find((el) =>
      el.textContent?.includes('TikTok'),
    );
    expect(tiktokRow).toBeTruthy();
    expect(tiktokRow?.tagName).toBe('DIV');
    expect(tiktokRow).toHaveAttribute('aria-disabled', 'true');
    expect(tiktokRow?.textContent).toContain('Em breve');

    fireEvent.click(tiktokRow!);
    expect(screen.getByTestId('path').textContent).toBe('/dashboard');
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

  it('renders Automações dimmed with a lock icon in the more sheet when the feature flag is false', () => {
    setAuth();
    setLimits({ features: { feature_instagram_automation: false } });
    renderMobileNav('/dashboard');
    fireEvent.click(document.getElementById('mobile-more-btn')!);

    const locked = screen.getByTestId('mobile-nav-locked-automacoes');
    expect(locked).toBeInTheDocument();
    expect(locked.querySelector('.ph-lock')).not.toBeNull();
    expect(locked).toHaveClass('mobile-more-item--locked');
    expect(locked.textContent).toContain('Automações');
  });

  it('navigates to /automacoes when the locked item in the more sheet is clicked', async () => {
    setAuth();
    setLimits({ features: { feature_instagram_automation: false } });
    renderMobileNav('/dashboard');
    fireEvent.click(document.getElementById('mobile-more-btn')!);

    fireEvent.click(screen.getByTestId('mobile-nav-locked-automacoes'));

    await waitFor(() => {
      expect(screen.getByTestId('path').textContent).toBe('/automacoes');
    });
  });

  it('renders the Mensagens unread badge in the more sheet when count > 0', () => {
    setAuth();
    setLimits({ features: { feature_mensagens: true } });
    mockedUseMensagensUnread.mockReturnValue(5);

    renderMobileNav('/dashboard');
    fireEvent.click(document.getElementById('mobile-more-btn')!);

    const badge = screen.getByTestId('mensagens-nav-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('5');
  });

  it('sums the clientes and equipe unread counts into the Mensagens badge in the more sheet', () => {
    setAuth();
    setLimits({ features: { feature_mensagens: true, feature_team_chat: true } });
    mockedUseMensagensUnread.mockReturnValue(3);
    mockedUseEquipeChatUnread.mockReturnValue(4);

    renderMobileNav('/dashboard');
    fireEvent.click(document.getElementById('mobile-more-btn')!);

    const badge = screen.getByTestId('mensagens-nav-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('7');
  });

  it('shows the Mensagens badge from equipe unread alone (team-chat-only workspace)', () => {
    setAuth();
    setLimits({ features: { feature_mensagens: false, feature_team_chat: true } });
    mockedUseMensagensUnread.mockReturnValue(0);
    mockedUseEquipeChatUnread.mockReturnValue(4);

    renderMobileNav('/dashboard');
    fireEvent.click(document.getElementById('mobile-more-btn')!);

    const badge = screen.getByTestId('mensagens-nav-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('4');
  });

  it('hides the Mensagens badge in the more sheet when count is 0', () => {
    setAuth();
    setLimits({ features: { feature_mensagens: true } });
    mockedUseMensagensUnread.mockReturnValue(0);

    renderMobileNav('/dashboard');
    fireEvent.click(document.getElementById('mobile-more-btn')!);

    expect(screen.queryByTestId('mensagens-nav-badge')).not.toBeInTheDocument();
  });

  it('shows "99+" in the Mensagens badge in the more sheet when count > 99', () => {
    setAuth();
    setLimits({ features: { feature_mensagens: true } });
    mockedUseMensagensUnread.mockReturnValue(150);

    renderMobileNav('/dashboard');
    fireEvent.click(document.getElementById('mobile-more-btn')!);

    const badge = screen.getByTestId('mensagens-nav-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('99+');
  });
});
