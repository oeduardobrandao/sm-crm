import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { planilha } from '../../financeiro/v2/__tests__/fixtures/planilha';

beforeAll(() => {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () =>
    false;
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

const { useAuthMock, store, toastMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
  store: {
    getRentabilidade: vi.fn(),
    getAcordoVersoes: vi.fn(),
    getPeriodosEditaveis: vi.fn(),
    getEntregasManuais: vi.fn(),
    salvarEntregas: vi.fn(),
  },
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store')>()),
  ...store,
}));

import type { AcordoVersao, RentabilidadeSeeded } from '@/store';
import { EntregasManuaisCard } from '../EntregasManuaisCard';

/** Ana (membro 3) paid per delivery: every client lists her with regra 'entrega'. */
function anaPorEntrega(): RentabilidadeSeeded {
  const rent = structuredClone(planilha);
  for (const c of rent.clientes) {
    for (const p of c.pessoas) {
      if (p.membro_id !== 3) continue;
      p.regra = 'entrega';
      p.quantidade = null;
      p.valor_unitario = 45;
      p.valor = 0;
    }
    c.a_informar = true;
  }
  return rent;
}

const versao = (modelo: AcordoVersao['modelo']): AcordoVersao => ({
  id: 1,
  membro_id: 3,
  vale_desde: '2026-10-01',
  funcao_id: 2,
  modelo,
  valor: 45,
  unidade: modelo === 'por_entrega' ? null : 'arte',
  meta_quantidade: modelo === 'mensal_meta' ? 8 : null,
  meta_periodo: modelo === 'mensal_meta' ? 'dia_util' : null,
  limite_clientes: null,
  dia_pagamento: 5,
  vigencia_inicio: null,
  vigencia_fim: null,
  arquivo_path: null,
  created_by: null,
});

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <EntregasManuaisCard membroId={3} />
    </QueryClientProvider>,
  );
  return { invalidate };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthMock.mockReturnValue({ profile: { conta_id: 'w1' }, canSeeFinancials: true });
  store.getRentabilidade.mockResolvedValue(anaPorEntrega());
  store.getAcordoVersoes.mockResolvedValue([versao('por_entrega')]);
  store.getPeriodosEditaveis.mockResolvedValue([
    {
      inicio: '2026-10-01',
      fim: '2026-11-01',
      rotulo: 'out 2026',
      status: 'aberto',
      transicao: false,
    },
    {
      inicio: '2026-11-01',
      fim: '2026-12-01',
      rotulo: 'nov 2026',
      status: 'futuro',
      transicao: false,
    },
  ]);
  store.getEntregasManuais.mockResolvedValue([]);
  store.salvarEntregas.mockResolvedValue(undefined);
});

describe('EntregasManuaisCard', () => {
  it('entregas_save_payload', async () => {
    const user = userEvent.setup();
    const { invalidate } = renderCard();

    const cinara = await screen.findByRole('spinbutton', { name: 'Entregas de Cinara' });
    expect(
      screen.getByText('Informe quantas entregas cada cliente recebeu neste período.'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Salvar entregas' })).toBeDisabled();

    await user.type(cinara, '10');
    // 10 x R$ 45,00
    expect(screen.getByText(/R\$\s450,00/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Salvar entregas' }));

    await waitFor(() =>
      expect(store.salvarEntregas).toHaveBeenCalledWith('2026-10-01', 3, [
        { cliente_id: 1, quantidade: 10 },
      ]),
    );
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['financeiro-v2'] }));
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('prefills the saved quantities and sends null when an input is emptied', async () => {
    const user = userEvent.setup();
    store.getEntregasManuais.mockResolvedValue([
      { cliente_id: 1, quantidade: 4 },
      { cliente_id: 2, quantidade: 7 },
    ]);
    renderCard();

    const cinara = await screen.findByRole('spinbutton', { name: 'Entregas de Cinara' });
    await waitFor(() => expect(cinara).toHaveValue(4));
    expect(screen.getByRole('spinbutton', { name: 'Entregas de Roberta' })).toHaveValue(7);

    await user.clear(cinara);
    await user.click(screen.getByRole('button', { name: 'Salvar entregas' }));

    await waitFor(() =>
      expect(store.salvarEntregas).toHaveBeenCalledWith('2026-10-01', 3, [
        { cliente_id: 1, quantidade: null },
      ]),
    );
  });

  it('lists only the clients the member serves', async () => {
    const rent = anaPorEntrega();
    // Roberta (2) is not Ana's client.
    rent.clientes.find((c) => c.cliente_id === 2)!.pessoas = [];
    store.getRentabilidade.mockResolvedValue(rent);
    renderCard();

    await screen.findByRole('spinbutton', { name: 'Entregas de Cinara' });
    expect(
      screen.queryByRole('spinbutton', { name: 'Entregas de Roberta' }),
    ).not.toBeInTheDocument();
  });

  it('keeps a paused client in the list, marked Pausado and not "a informar"', async () => {
    const rent = anaPorEntrega();
    const roberta = rent.clientes.find((c) => c.cliente_id === 2)!;
    roberta.status = 'pausado';
    roberta.a_informar = false;
    store.getRentabilidade.mockResolvedValue(rent);
    renderCard();

    const input = await screen.findByRole('spinbutton', { name: 'Entregas de Roberta' });
    const linha = input.closest('li')!;
    expect(within(linha).getByText('Pausado')).toBeVisible();
    expect(within(linha).queryByText('A informar')).not.toBeInTheDocument();
    const cinara = screen.getByRole('spinbutton', { name: 'Entregas de Cinara' }).closest('li')!;
    expect(within(cinara).getByText('A informar')).toBeVisible();
  });

  it('renders nothing for a member who is not paid per delivery', async () => {
    store.getAcordoVersoes.mockResolvedValue([versao('mensal_meta')]);
    const { invalidate } = renderCard();

    await waitFor(() => expect(store.getAcordoVersoes).toHaveBeenCalled());
    await waitFor(() => expect(store.getRentabilidade).toHaveBeenCalled());
    expect(screen.queryByText('Entregas do período')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salvar entregas' })).not.toBeInTheDocument();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('toasts and keeps the edits when the save fails', async () => {
    const user = userEvent.setup();
    store.salvarEntregas.mockRejectedValueOnce(new Error('boom'));
    renderCard();

    const cinara = await screen.findByRole('spinbutton', { name: 'Entregas de Cinara' });
    await user.type(cinara, '3');
    await user.click(screen.getByRole('button', { name: 'Salvar entregas' }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(cinara).toHaveValue(3);
  });
});
