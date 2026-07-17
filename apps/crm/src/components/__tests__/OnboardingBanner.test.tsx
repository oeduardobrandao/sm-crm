import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingBanner } from '../OnboardingBanner';

const { useAuthMock, useEntitlementsMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useEntitlementsMock: vi.fn(),
}));

vi.mock('../../context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('../../hooks/useEntitlements', () => ({ useEntitlements: useEntitlementsMock }));

const EMPTY = {
  clientes: [],
  leads: [],
  membros: [],
  portfolioAccounts: [],
  workflows: [],
} as never;

function renderBanner(features: Record<string, boolean>) {
  useEntitlementsMock.mockReturnValue({
    hasFeature: (flag: string) => features[flag] !== false,
  });
  return render(
    <MemoryRouter>
      <OnboardingBanner {...EMPTY} />
    </MemoryRouter>,
  );
}

describe('OnboardingBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useAuthMock.mockReturnValue({ profile: { role: 'owner', conta_id: 'ws-1' } });
  });

  it('shows every step on a plan that has every feature', () => {
    renderBanner({ feature_leads: true, feature_analytics_reports: true });
    expect(screen.getByText('Criar primeiro lead')).toBeInTheDocument();
    expect(screen.getByText('Conectar conta do Instagram')).toBeInTheDocument();
    expect(screen.getByText(/de 6/)).toBeInTheDocument();
  });

  it('hides steps the plan cannot complete', () => {
    // On Free these routes are nav-hidden and gated: offering them makes two of six steps
    // permanently uncompletable and walks a new user into a paywall.
    renderBanner({ feature_leads: false, feature_analytics_reports: false });
    expect(screen.queryByText('Criar primeiro lead')).not.toBeInTheDocument();
    expect(screen.queryByText('Conectar conta do Instagram')).not.toBeInTheDocument();
  });

  it('counts progress against the steps the plan actually offers', () => {
    renderBanner({ feature_leads: false, feature_analytics_reports: false });
    // 6 steps minus the 2 gated ones; "Conta criada" is already done.
    expect(screen.getByText('1 de 4')).toBeInTheDocument();
  });

  it('reaches 100% and auto-dismisses once a Free-plan user completes every offered step', async () => {
    const features: Record<string, boolean> = {
      feature_leads: false,
      feature_analytics_reports: false,
    };
    useEntitlementsMock.mockReturnValue({
      hasFeature: (flag: string) => features[flag] !== false,
    });

    // Only 4 steps are offered on Free (leads + analytics are gated out). Complete all 4:
    // "Conta criada" is always done; the rest need a non-empty array to flip to done.
    const { container } = render(
      <MemoryRouter>
        <OnboardingBanner
          {...EMPTY}
          clientes={[{}] as never}
          membros={[{}] as never}
          workflows={[{}] as never}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(localStorage.getItem('onboarding_dismissed_ws-1')).toBe('true');
    });
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('Bem-vindo ao Mesaas!')).not.toBeInTheDocument();
  });
});
