import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AfiliadosPage from '../AfiliadosPage';
import {
  buildCommissionTable,
  formatRate,
  headlineFor,
  monthsPhrase,
  simulateCommission,
} from '../simulator';
import { affiliateSendLink, affiliateSignup, listCommissionRules } from '@/services/affiliates';
import { listPublicPricingPlans } from '@/services/billing';

vi.mock('@/services/affiliates', async (orig) => ({
  ...(await orig<typeof import('@/services/affiliates')>()),
  affiliateSignup: vi.fn(),
  affiliateSendLink: vi.fn(),
  listCommissionRules: vi.fn(),
}));
vi.mock('@/services/billing', () => ({ listPublicPricingPlans: vi.fn() }));

const PLANS = [
  { id: 'free', name: 'Free', price_brl: 0 },
  { id: 'start', name: 'Start', price_brl: 4990 },
  { id: 'pro', name: 'Pro', price_brl: 9990 },
  { id: 'max', name: 'Max', price_brl: 19990 },
];
const RULES = [
  { plan_id: 'start', rate_bps: 3000, months: 3 },
  { plan_id: 'pro', rate_bps: 2500, months: 3 },
  { plan_id: 'max', rate_bps: 2000, months: 3 },
];

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

describe('commission table logic', () => {
  const rows = buildCommissionTable(PLANS, RULES);

  it('keeps paid plans with a rule, in plan order, with per-referral totals', () => {
    expect(rows.map((r) => [r.planId, r.perMonthCents, r.perReferralCents])).toEqual([
      ['start', 1497, 4491],
      ['pro', 2497, 7491],
      ['max', 3998, 11994],
    ]);
  });

  it('drops plans without a rule or with rate 0', () => {
    expect(
      buildCommissionTable(PLANS, [
        { plan_id: 'pro', rate_bps: 2500, months: 3 },
        { plan_id: 'max', rate_bps: 0, months: 3 },
      ]).map((r) => r.planId),
    ).toEqual(['pro']);
  });

  it('simulates a portfolio', () => {
    expect(simulateCommission(rows, { start: 2, pro: 5, max: -1 })).toEqual({
      totalCents: 4491 * 2 + 7491 * 5,
      firstMonthCents: 1497 * 2 + 2497 * 5,
    });
  });

  it('formats rate, months and the headline', () => {
    expect(formatRate(3000)).toBe('30%');
    expect(formatRate(1250)).toBe('12,5%');
    expect(monthsPhrase(3)).toBe('nos 3 primeiros meses');
    expect(monthsPhrase(1)).toBe('no primeiro mês');
    expect(headlineFor(rows)).toBe('Ganhe até 30% de cada assinatura nos 3 primeiros meses');
    expect(headlineFor([])).toBeNull();
  });
});

describe('AfiliadosPage', () => {
  beforeEach(() => {
    vi.mocked(affiliateSignup).mockReset().mockResolvedValue({ ok: true });
    vi.mocked(affiliateSendLink).mockReset().mockResolvedValue({ ok: true });
    vi.mocked(listPublicPricingPlans).mockResolvedValue(PLANS as never);
    vi.mocked(listCommissionRules).mockResolvedValue(RULES);
  });

  it('shows the commission table and a headline built from it', async () => {
    renderPage();
    expect(
      await screen.findByRole('heading', {
        name: 'Ganhe até 30% de cada assinatura nos 3 primeiros meses',
      }),
    ).toBeInTheDocument();
    const table = within(screen.getAllByRole('table')[0]);
    expect(table.getByText('Start')).toBeInTheDocument();
    expect(table.getByText('30%')).toBeInTheDocument();
    expect(table.getByText('25%')).toBeInTheDocument();
    expect(table.getByText('20%')).toBeInTheDocument();
    expect(table.queryByText('Free')).not.toBeInTheDocument();
  });

  it('simulates with the table (Pro starts at 5 referrals)', async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('sim-total').textContent?.replace(/\s/g, ' ')).toContain('374,55'),
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
