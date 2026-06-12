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

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

import { useAuth } from '../../../context/AuthContext';
import { UpgradeLockedScreen } from '../UpgradeLockedScreen';

const mockedUseAuth = vi.mocked(useAuth);

function setRole(role: 'owner' | 'admin' | 'agent') {
  mockedUseAuth.mockReturnValue({ role } as never);
}

function renderScreen(featureLabel = 'Relatórios') {
  render(
    <MemoryRouter>
      <UpgradeLockedScreen featureLabel={featureLabel} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockNavigate.mockReset();
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
