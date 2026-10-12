import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { mockPhone } from '../../__tests__/phone';

vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  listPlans: vi.fn(),
  createPlan: vi.fn(),
  updatePlan: vi.fn(),
  deletePlan: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { createPlan, listPlans, updatePlan } from '../../lib/api';
import { PLANS_FIXTURE } from './plans-fixture';
import PlansPage from '../PlansPage';

let restore: () => void;
beforeEach(() => {
  restore = mockPhone();
  vi.mocked(listPlans).mockResolvedValue({ plans: PLANS_FIXTURE } as never);
  vi.mocked(createPlan).mockResolvedValue({ plan: PLANS_FIXTURE[0] } as never);
  vi.mocked(updatePlan).mockResolvedValue({ plan: PLANS_FIXTURE[1] } as never);
});
afterEach(() => {
  restore();
  vi.clearAllMocks();
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

describe('PlansPage (phone)', () => {
  it('shows the large title and one tappable row per plan', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Planos', level: 1 })).toBeInTheDocument();
    const free = await screen.findByRole('button', { name: /Free/ });
    expect(free).toHaveTextContent('PADRÃO');
    expect(free).toHaveTextContent('2 clientes');
    expect(screen.getByRole('button', { name: /Pro/ })).toHaveTextContent('R$ 297/mês');
    expect(screen.getByRole('button', { name: /Lifetime/ })).toHaveTextContent('INATIVO');
  });

  it('the + button opens the create sheet and submitting calls createPlan', async () => {
    renderPage();
    await screen.findByRole('button', { name: /Free/ });
    fireEvent.click(screen.getByRole('button', { name: 'Novo plano' }));
    const sheet = await screen.findByRole('dialog', { name: 'Novo plano' });
    fireEvent.change(within(sheet).getByLabelText('Nome'), { target: { value: 'Gold' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Criar' }));
    await waitFor(() => expect(createPlan).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createPlan).mock.calls[0][0]).toMatchObject({ name: 'Gold' });
  });

  it('tapping a plan opens the edit sheet and Atualizar calls updatePlan', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Starter/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Editar: Starter' });
    expect(within(sheet).getByLabelText('Nome')).toHaveValue('Starter');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Atualizar' }));
    await waitFor(() =>
      expect(updatePlan).toHaveBeenCalledWith(expect.objectContaining({ plan_id: 'starter' })),
    );
  });
});
