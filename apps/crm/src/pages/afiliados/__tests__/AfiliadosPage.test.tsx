import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AfiliadosPage from '../AfiliadosPage';
import { simulateCommission, formatRate } from '../simulator';
import { affiliateSendLink, affiliateSignup } from '@/services/affiliates';
import { listPublicPricingPlans } from '@/services/billing';

vi.mock('@/services/affiliates', async (orig) => ({
  ...(await orig<typeof import('@/services/affiliates')>()),
  affiliateSignup: vi.fn(),
  affiliateSendLink: vi.fn(),
}));
vi.mock('@/services/billing', () => ({ listPublicPricingPlans: vi.fn() }));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AfiliadosPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('simulateCommission', () => {
  it('sums 20% of each monthly price per referral', () => {
    expect(
      simulateCommission([
        { priceCents: 9990, count: 5 },
        { priceCents: 4990, count: 2 },
      ]),
    ).toEqual({ monthlyCents: 1998 * 5 + 998 * 2, yearlyCents: (1998 * 5 + 998 * 2) * 12 });
  });

  it('ignores free plans, negatives and NaN', () => {
    expect(
      simulateCommission([
        { priceCents: 0, count: 10 },
        { priceCents: 9990, count: -1 },
        { priceCents: Number.NaN, count: 1 },
      ]).monthlyCents,
    ).toBe(0);
  });

  it('formats the rate', () => {
    expect(formatRate(2000)).toBe('20%');
    expect(formatRate(1250)).toBe('12,5%');
  });
});

describe('AfiliadosPage', () => {
  beforeEach(() => {
    vi.mocked(affiliateSignup).mockReset().mockResolvedValue({ ok: true });
    vi.mocked(affiliateSendLink).mockReset().mockResolvedValue({ ok: true });
    vi.mocked(listPublicPricingPlans).mockResolvedValue([
      { id: 'free', name: 'Free', price_brl: 0 },
      { id: 'pro', name: 'Pro', price_brl: 9990 },
    ] as never);
  });

  it('simulates with real plan prices (Pro starts at 5 referrals)', async () => {
    renderPage();
    expect(await screen.findByText('Pro')).toBeInTheDocument();
    expect(screen.queryByText('Free')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('sim-monthly').textContent?.replace(/\s/g, ' ')).toContain('99,90'),
    );
  });

  it('requires the rules checkbox before signing up', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('Nome'), 'Ana');
    await user.type(screen.getByLabelText('E-mail'), 'ana@x.com');
    await user.click(screen.getByRole('button', { name: 'Cadastrar e receber meu link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('aceite as regras');
    expect(affiliateSignup).not.toHaveBeenCalled();
  });

  it('signs up and shows the check-your-email state', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('Nome'), 'Ana');
    await user.type(screen.getByLabelText('E-mail'), 'ana@x.com');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Cadastrar e receber meu link' }));
    await waitFor(() =>
      expect(affiliateSignup).toHaveBeenCalledWith({
        nome: 'Ana',
        email: 'ana@x.com',
        telefone: undefined,
        aceite_termos: true,
      }),
    );
    expect(await screen.findByText('Confira seu e-mail')).toBeInTheDocument();
  });

  it('existing affiliates can ask for a new access link', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /Já sou afiliado/ }));
    await user.type(screen.getByLabelText('E-mail'), 'ana@x.com');
    await user.click(screen.getByRole('button', { name: 'Enviar link de acesso' }));
    await waitFor(() => expect(affiliateSendLink).toHaveBeenCalledWith('ana@x.com'));
  });

  it('shows the server error message', async () => {
    vi.mocked(affiliateSignup).mockRejectedValue(new Error('Muitas tentativas.'));
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('Nome'), 'Ana');
    await user.type(screen.getByLabelText('E-mail'), 'ana@x.com');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Cadastrar e receber meu link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Muitas tentativas.');
  });
});
