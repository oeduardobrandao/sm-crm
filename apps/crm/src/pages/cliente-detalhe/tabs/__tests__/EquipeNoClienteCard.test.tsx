import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { planilha } from '../../../financeiro/v2/__tests__/fixtures/planilha';
import type { ClienteRentabilidade, PeriodoFinanceiro } from '@/store/financeiroV2';

beforeAll(() => {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () =>
    false;
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

const { useAuthMock, store, toastMock, entitlementMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
  entitlementMock: vi.fn(),
  store: { getPeriodosEditaveis: vi.fn(), salvarAtribuicoes: vi.fn() },
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@/lib/entitlement-toast', () => ({ handleEntitlementMutationError: entitlementMock }));
vi.mock('@/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store')>()),
  ...store,
}));

import { EquipeNoClienteCard } from '../EquipeNoClienteCard';

const EDITAVEIS: PeriodoFinanceiro[] = [
  {
    inicio: '2026-09-01',
    fim: '2026-10-01',
    rotulo: 'set 2026',
    status: 'reaberto',
    transicao: false,
  },
  {
    inicio: '2026-10-04',
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
];

function talitha(): ClienteRentabilidade {
  return planilha.clientes.find((c) => c.cliente_id === 9)!;
}

function setAuth(canEdit: boolean | 'unknown' = true) {
  useAuthMock.mockReturnValue({
    canSeeFinancials: true,
    can: (modulo: string, acao: string) =>
      modulo === 'financeiro' && acao === 'editar' ? canEdit : true,
    profile: { conta_id: 'w1' },
  });
}

function renderCard(
  opts: { membros?: typeof planilha.membros; cliente?: ClienteRentabilidade } = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <EquipeNoClienteCard
        cliente={opts.cliente ?? talitha()}
        funcoes={planilha.funcoes}
        membros={opts.membros ?? planilha.membros}
        periodoInicio={planilha.periodo.inicio}
      />
    </QueryClientProvider>,
  );
  return { invalidate };
}

const grupo = (nome: string) => screen.getByRole('group', { name: nome });

beforeEach(() => {
  vi.clearAllMocks();
  setAuth(true);
  store.getPeriodosEditaveis.mockResolvedValue(EDITAVEIS.map((p) => ({ ...p })));
  store.salvarAtribuicoes.mockResolvedValue(undefined);
  entitlementMock.mockReturnValue(false);
});

describe('EquipeNoClienteCard', () => {
  it('rows_per_funcao_with_copy_empty', async () => {
    renderCard();

    for (const [funcao, pessoa] of [
      ['Videomaker', 'Lia'],
      ['Design', 'Ana'],
      ['Edição de vídeo', 'Bruno'],
      ['Gestão de projetos', 'Duda'],
    ]) {
      expect(within(grupo(funcao)).getByText(pessoa)).toBeVisible();
    }
    // Nobody in Copy: the placeholder select, in the função's own group.
    expect(within(grupo('Copy')).getByText('+ Escolher pessoa')).toBeVisible();
    expect(screen.getAllByText('+ Escolher pessoa')).toHaveLength(1);
    // Função order is the payload's.
    expect(screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(
      planilha.funcoes.map((f) => f.nome),
    );
  });

  it('exclusivo_badge_for_lia', () => {
    renderCard();

    expect(within(grupo('Videomaker')).getByText('Só este cliente')).toBeVisible();
    expect(
      within(grupo('Videomaker')).getByText(/Só este cliente: R\$\s550,00 por mês/),
    ).toBeVisible();
    expect(within(grupo('Design')).queryByText('Só este cliente')).not.toBeInTheDocument();
    expect(within(grupo('Design')).getByText(/R\$\s3\.900,00 ÷ 15 clientes/)).toBeVisible();
    expect(within(grupo('Design')).getByText(/^R\$\s260,00$/)).toBeVisible();
  });

  it('shows the client total cost in the header', () => {
    renderCard();
    expect(screen.getByText('Custo total')).toBeVisible();
    expect(screen.getByText(/^R\$\s1\.180,00$/)).toBeVisible();
  });

  it('trocar_sends_swap_in_one_call', async () => {
    const user = userEvent.setup();
    const { invalidate } = renderCard();

    await user.click(within(grupo('Videomaker')).getByRole('combobox', { name: 'Trocar Lia' }));
    // Only the other members of the função are offered.
    expect(screen.queryByRole('option', { name: 'Lia' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('option', { name: 'Caio' }));

    await waitFor(() => expect(store.salvarAtribuicoes).toHaveBeenCalledTimes(1));
    // valeDesde is the 'aberto' period of the editáveis list, not the payload's inicio.
    expect(store.salvarAtribuicoes).toHaveBeenCalledWith('2026-10-04', [
      { membro_id: 2, cliente_id: 9, ativo: false },
      { membro_id: 1, cliente_id: 9, ativo: true },
    ]);
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['financeiro-v2'] }));
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('falls back to the payload period when no editable period is open', async () => {
    store.getPeriodosEditaveis.mockResolvedValue([]);
    const user = userEvent.setup();
    renderCard();

    await user.click(within(grupo('Videomaker')).getByRole('combobox', { name: 'Trocar Lia' }));
    await user.click(await screen.findByRole('option', { name: 'Caio' }));

    await waitFor(() => expect(store.salvarAtribuicoes).toHaveBeenCalledTimes(1));
    expect(store.salvarAtribuicoes.mock.calls[0][0]).toBe('2026-10-01');
  });

  it('escolher_pessoa_assigns_without_removing_anyone', async () => {
    const membros = structuredClone(planilha.membros);
    membros.push({
      membro_id: 7,
      nome: 'Nina',
      funcao_id: 5,
      modelo: 'mensal_meta',
      custo: 1000,
      n_clientes: 0,
      limite_clientes: null,
      por_cliente: null,
      a_informar: false,
    });
    const user = userEvent.setup();
    renderCard({ membros });

    await user.click(
      within(grupo('Copy')).getByRole('combobox', { name: 'Escolher pessoa em Copy' }),
    );
    await user.click(await screen.findByRole('option', { name: 'Nina' }));

    await waitFor(() => expect(store.salvarAtribuicoes).toHaveBeenCalledTimes(1));
    expect(store.salvarAtribuicoes).toHaveBeenCalledWith('2026-10-04', [
      { membro_id: 7, cliente_id: 9, ativo: true },
    ]);
  });

  it('is read-only without financeiro/editar', () => {
    setAuth(false);
    renderCard();

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByText('+ Escolher pessoa')).not.toBeInTheDocument();
    expect(within(grupo('Videomaker')).getByText('Lia')).toBeVisible();
    expect(store.getPeriodosEditaveis).not.toHaveBeenCalled();
  });

  it('shows an error toast and keeps going when the swap fails', async () => {
    store.salvarAtribuicoes.mockRejectedValue(new Error('periodo_fechado'));
    const user = userEvent.setup();
    renderCard();

    await user.click(within(grupo('Videomaker')).getByRole('combobox', { name: 'Trocar Lia' }));
    await user.click(await screen.findByRole('option', { name: 'Caio' }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(entitlementMock).toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it('a paused client keeps its people, says Pausado and offers no edit', () => {
    // Paused: each person costs this client 0 and the assignments wait for the client to resume.
    const base = talitha();
    const pausado: ClienteRentabilidade = {
      ...base,
      status: 'pausado',
      receita: 0,
      custo: 0,
      lucro: 0,
      margem: null,
      pessoas: base.pessoas.map((p) => ({ ...p, valor: 0 })),
    };
    renderCard({ cliente: pausado });

    expect(within(grupo('Videomaker')).getByText('Lia')).toBeVisible();
    // The split rule is computed over active clients: no "Só este cliente" on a paused one.
    expect(within(grupo('Videomaker')).queryByText('Só este cliente')).not.toBeInTheDocument();
    expect(within(grupo('Design')).getByText('Ana')).toBeVisible();
    expect(within(grupo('Design')).getByText('Pausado')).toBeVisible();
    expect(within(grupo('Design')).queryByText(/÷ 15 clientes/)).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByText('+ Escolher pessoa')).not.toBeInTheDocument();
    expect(screen.getByText(/Cliente pausado/)).toBeVisible();
  });
});
