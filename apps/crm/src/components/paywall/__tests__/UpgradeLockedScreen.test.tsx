import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../../lib/paywall-report', () => ({
  reportPaywallHit: vi.fn(),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

import { useAuth } from '../../../context/AuthContext';
import { reportPaywallHit } from '../../../lib/paywall-report';
import { UpgradeLockedScreen } from '../UpgradeLockedScreen';

const mockedUseAuth = vi.mocked(useAuth);
const mockedReport = vi.mocked(reportPaywallHit);

function setRole(role: 'owner' | 'admin' | 'agent', contaId: string | null = 'ws-1') {
  mockedUseAuth.mockReturnValue({ role, profile: contaId ? { conta_id: contaId } : null } as never);
}

function renderScreen(featureLabel = 'Relatórios', feature?: string) {
  render(
    <MemoryRouter>
      <UpgradeLockedScreen featureLabel={featureLabel} feature={feature} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockNavigate.mockReset();
  mockedReport.mockReset();
});

describe('UpgradeLockedScreen', () => {
  it('shows the upgrade CTA for owners and navigates to billing', () => {
    setRole('owner');
    renderScreen('Relatórios');

    expect(screen.getByText('Relatórios não está no seu plano')).toBeInTheDocument();
    expect(screen.getByText('Faça upgrade para desbloquear este recurso.')).toBeInTheDocument();

    const cta = screen.getByRole('button', { name: 'Fazer upgrade' });
    fireEvent.click(cta);
    expect(mockNavigate).toHaveBeenCalledWith('/configuracao/cobranca');
  });

  it('shows the contact-owner message for non-owners and no upgrade CTA', () => {
    setRole('agent');
    renderScreen('Relatórios');

    expect(
      screen.getByText('Fale com o dono do workspace para liberar este recurso.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fazer upgrade' })).not.toBeInTheDocument();
    expect(
      screen.queryByText('Faça upgrade para desbloquear este recurso.'),
    ).not.toBeInTheDocument();
  });
});

// ProtectedRoute redirects a user whose flag is off to this screen BEFORE they
// can reach the page that performs the gated write, so for /leads, /financeiro,
// /contratos and /ideias this render is the paywall_hit that actually happens.
// Without these, the `feature` prop can be dropped from ProtectedRoute and four
// of the six trigger-gated features silently stop reporting again.
describe('UpgradeLockedScreen paywall reporting', () => {
  it('reports the denial on render when a feature flag is supplied', () => {
    setRole('owner');
    renderScreen('Ideias', 'feature_ideas');

    expect(mockedReport).toHaveBeenCalledWith({ workspaceId: 'ws-1', feature: 'feature_ideas' });
  });

  it('reports for non-owners too, who see no CTA at all', () => {
    setRole('agent');
    renderScreen('Financeiro', 'feature_financial');

    expect(mockedReport).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      feature: 'feature_financial',
    });
  });

  it('sends the higher-intent click signal when the CTA is pressed', () => {
    setRole('owner');
    renderScreen('Contratos', 'feature_contracts');
    mockedReport.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Fazer upgrade' }));

    expect(mockedReport).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      feature: 'feature_contracts',
      clickedUpgrade: true,
    });
    expect(mockNavigate).toHaveBeenCalledWith('/configuracao/cobranca');
  });

  it('reports nothing without a workspace id, and nothing without a feature', () => {
    setRole('owner', null);
    renderScreen('Leads', 'feature_leads');
    expect(mockedReport).not.toHaveBeenCalled();

    mockedReport.mockClear();
    setRole('owner');
    renderScreen('Leads');
    expect(mockedReport).not.toHaveBeenCalled();
  });
});
