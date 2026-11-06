import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCan, fakeMembership } from '@/test/makeCan';
import { planilha } from '../../financeiro/v2/__tests__/fixtures/planilha';

const { useAuthMock, store, toastMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
  store: {
    urlContratoAcordo: vi.fn(),
    getRentabilidade: vi.fn(),
    getAcordoVersoes: vi.fn(),
    getFuncoes: vi.fn(),
    getPeriodosEditaveis: vi.fn(),
  },
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store')>()),
  ...store,
}));

import type { AcordoVersao, Membro } from '@/store';
import { AcordoCard } from '../AcordoCard';

const ANA: Membro = {
  id: 3,
  nome: 'Ana',
  cargo: 'Designer',
  tipo: 'clt',
  custo_mensal: 3900,
  data_pagamento: 5,
  avatar_url: null,
};

const versao = (id: number, vale_desde: string, valor: number): AcordoVersao => ({
  id,
  membro_id: 3,
  vale_desde,
  funcao_id: 2,
  modelo: 'mensal_meta',
  valor,
  unidade: 'arte',
  meta_quantidade: 8,
  meta_periodo: 'dia_util',
  limite_clientes: null,
  dia_pagamento: 5,
  vigencia_inicio: null,
  vigencia_fim: null,
  arquivo_path: null,
  created_by: null,
});

function setAuth(podeEditar: boolean) {
  useAuthMock.mockReturnValue({
    canSeeFinancials: true,
    can: makeCan(
      fakeMembership({
        role: podeEditar ? 'owner' : 'agent',
        can_see_financials: podeEditar,
      }),
    ),
    profile: { conta_id: 'w1' },
  });
}

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AcordoCard membro={ANA} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setAuth(true);
  store.getRentabilidade.mockResolvedValue(planilha);
  store.getFuncoes.mockResolvedValue(planilha.funcoes);
  store.getPeriodosEditaveis.mockResolvedValue([]);
  store.getAcordoVersoes.mockResolvedValue([
    versao(3, '2026-11-01', 5000),
    versao(2, '2026-10-01', 3900),
    versao(1, '2026-09-01', 3500),
  ]);
});

describe('AcordoCard', () => {
  it('shows the version in force at the current period, its clients and the history', async () => {
    renderCard();

    expect(await screen.findByText('Mensal com meta')).toBeVisible();
    expect(screen.getByText('Design')).toBeVisible();
    expect(screen.getByText(/R\$\s3\.900,00 por mês/)).toBeVisible();
    expect(screen.getByText('8 artes por dia útil, cerca de 176 por mês')).toBeVisible();
    expect(screen.getByText('Nenhum arquivo')).toBeVisible();

    const clientes = screen.getByRole('heading', { name: 'Clientes atendidos' }).parentElement!;
    // Ana serves all 15 clients: R$ 3.900 / 15 = R$ 260 each.
    expect(within(clientes).getAllByRole('listitem')).toHaveLength(15);
    expect(within(clientes).getByText('Cinara')).toBeVisible();
    expect(within(clientes).getAllByText(/R\$\s260,00/)).toHaveLength(15);

    // Only the earlier version: the Nov one has not started yet.
    const historico = screen.getByRole('heading', { name: 'Histórico' }).parentElement!;
    expect(within(historico).getAllByRole('listitem')).toHaveLength(1);
    expect(within(historico).getByText('set 2026')).toBeVisible();
    expect(within(historico).getByText(/R\$\s3\.500,00/)).toBeVisible();
  });

  it('lists a paused client as Pausado instead of a cost', async () => {
    const data = structuredClone(planilha);
    const cinara = data.clientes.find((c) => c.nome === 'Cinara')!;
    cinara.status = 'pausado';
    cinara.pessoas = cinara.pessoas.map((p) => ({ ...p, valor: 0 }));
    store.getRentabilidade.mockResolvedValue(data);
    renderCard();

    await screen.findByText('Mensal com meta');
    const clientes = screen.getByRole('heading', { name: 'Clientes atendidos' }).parentElement!;
    expect(within(clientes).getAllByRole('listitem')).toHaveLength(15);
    const linha = within(clientes).getByText('Cinara').closest('li')!;
    expect(within(linha).getByText('Pausado')).toBeVisible();
    expect(within(clientes).getAllByText(/R\$\s260,00/)).toHaveLength(14);
  });

  it('offers to register an acordo when none is in force', async () => {
    store.getAcordoVersoes.mockResolvedValue([]);
    renderCard();

    expect(await screen.findByText('Sem acordo cadastrado.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Cadastrar acordo' })).toBeVisible();
  });

  it('hides the edit button without financeiro/editar', async () => {
    setAuth(false);
    renderCard();

    await screen.findByText('Mensal com meta');
    expect(screen.queryByRole('button', { name: 'Editar acordo' })).not.toBeInTheDocument();
  });

  it('opens the signed contract url in a new tab from "Abrir"', async () => {
    const user = userEvent.setup();
    store.getAcordoVersoes.mockResolvedValue([
      { ...versao(2, '2026-10-01', 3900), arquivo_path: 'w1/3/abc.pdf' },
    ]);
    store.urlContratoAcordo.mockResolvedValue('https://storage/assinada?token=1');
    const aba = { location: { href: '' }, opener: {} as unknown, close: vi.fn() };
    const abrir = vi.spyOn(window, 'open').mockReturnValue(aba as unknown as Window);
    renderCard();

    expect(await screen.findByText('Contrato.pdf')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Abrir' }));

    await waitFor(() => expect(store.urlContratoAcordo).toHaveBeenCalledWith('w1/3/abc.pdf'));
    // The tab opens synchronously on the click, then is pointed at the signed url.
    expect(abrir).toHaveBeenCalledWith('', '_blank');
    await waitFor(() => expect(aba.location.href).toBe('https://storage/assinada?token=1'));
    expect(aba.opener).toBeNull();
    abrir.mockRestore();
  });

  it('closes the blank tab and toasts when the signed url fails', async () => {
    const user = userEvent.setup();
    store.getAcordoVersoes.mockResolvedValue([
      { ...versao(2, '2026-10-01', 3900), arquivo_path: 'w1/3/abc.pdf' },
    ]);
    store.urlContratoAcordo.mockRejectedValue(new Error('Object not found'));
    const aba = { location: { href: '' }, opener: {} as unknown, close: vi.fn() };
    const abrir = vi.spyOn(window, 'open').mockReturnValue(aba as unknown as Window);
    renderCard();

    await user.click(await screen.findByRole('button', { name: 'Abrir' }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(aba.close).toHaveBeenCalled();
    expect(aba.location.href).toBe('');
    abrir.mockRestore();
  });
});
