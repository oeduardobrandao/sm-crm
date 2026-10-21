import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  listPlans: vi.fn(),
  createPlan: vi.fn(),
  updatePlan: vi.fn(),
  deletePlan: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { createPlan, deletePlan, FEATURE_FLAG_KEYS, listPlans, updatePlan } from '../../lib/api';
import { PLANS_FIXTURE } from './plans-fixture';
import PlansPage from '../PlansPage';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listPlans).mockResolvedValue({ plans: PLANS_FIXTURE } as never);
  vi.mocked(createPlan).mockResolvedValue({ plan: PLANS_FIXTURE[0] } as never);
  vi.mocked(updatePlan).mockResolvedValue({ plan: PLANS_FIXTURE[1] } as never);
  vi.mocked(deletePlan).mockResolvedValue({ ok: true } as never);
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <PlansPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('PlansPage (desktop)', () => {
  it('renders a card per plan with price, limits, badges and workspace count', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: 'Starter' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Planos', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('4 planos · 84 workspaces')).toBeInTheDocument();
    expect(screen.getByText('R$ 97')).toBeInTheDocument();
    expect(screen.getByText('/mês · R$ 970/ano')).toBeInTheDocument();
    expect(screen.getByText('Grátis')).toBeInTheDocument();
    expect(screen.getByText('PADRÃO')).toBeInTheDocument();
    expect(screen.getByText('12X')).toBeInTheDocument();
    expect(screen.getByText('INATIVO')).toBeInTheDocument();
    expect(screen.getByText('52 workspaces')).toBeInTheDocument();
    expect(screen.getByText('1 workspace')).toBeInTheDocument();
    expect(
      screen.getByText(`2 de ${FEATURE_FLAG_KEYS.length} funcionalidades`),
    ).toBeInTheDocument();
    expect(screen.getByText('∞ clientes')).toBeInTheDocument();
  });

  it('"Novo plano" opens the sheet and submitting calls createPlan', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Starter' });
    fireEvent.click(screen.getByRole('button', { name: 'Novo plano' }));
    const sheet = await screen.findByRole('dialog', { name: 'Novo plano' });
    fireEvent.change(within(sheet).getByLabelText('Nome'), { target: { value: 'Gold' } });
    fireEvent.change(within(sheet).getByLabelText('Preço mensal (R$)'), {
      target: { value: '49,90' },
    });
    fireEvent.change(within(sheet).getByLabelText('ID do produto Stripe'), {
      target: { value: 'prod_123' },
    });
    fireEvent.change(within(sheet).getByLabelText('Máx. de clientes'), {
      target: { value: '7' },
    });
    fireEvent.click(within(sheet).getByRole('switch', { name: 'Leads' }));
    fireEvent.click(within(sheet).getByRole('switch', { name: 'Ativo' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Criar' }));
    await waitFor(() => expect(createPlan).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createPlan).mock.calls[0][0]).toMatchObject({
      name: 'Gold',
      price_brl: 4990,
      is_active: false,
      stripe_product_id: 'prod_123',
      max_clients: 7,
      feature_leads: true,
      feature_instagram: false,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('clicking a card opens the edit sheet with the plan loaded', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Starter' }));
    const sheet = await screen.findByRole('dialog', { name: 'Editar: Starter' });
    expect(within(sheet).getByLabelText('Nome')).toHaveValue('Starter');
    expect(within(sheet).getByLabelText('Preço mensal (R$)')).toHaveValue('97.00');
    fireEvent.change(within(sheet).getByLabelText('Nome'), { target: { value: 'Starter 2' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Atualizar' }));
    await waitFor(() =>
      expect(updatePlan).toHaveBeenCalledWith(
        expect.objectContaining({ plan_id: 'starter', name: 'Starter 2' }),
      ),
    );
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('offers deletion only for a plan with no workspaces', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Starter' }));
    const used = await screen.findByRole('dialog', { name: 'Editar: Starter' });
    expect(within(used).queryByRole('button', { name: 'Excluir plano' })).not.toBeInTheDocument();
    fireEvent.click(within(used).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Lifetime' }));
    const unused = await screen.findByRole('dialog', { name: 'Editar: Lifetime' });
    fireEvent.click(within(unused).getByRole('button', { name: 'Excluir plano' }));
    await waitFor(() => expect(deletePlan).toHaveBeenCalledWith('lifetime'));
  });
});
