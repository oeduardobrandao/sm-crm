import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PeriodoFinanceiro, RentabilidadeSeeded } from '@/store/financeiroV2';
import { planilha } from './fixtures/planilha';

beforeAll(() => {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () =>
    false;
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

const { useAuthMock, store, toastMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
  store: {
    getPeriodosEditaveis: vi.fn(),
    getRentabilidade: vi.fn(),
    salvarAtribuicoes: vi.fn(),
  },
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store')>()),
  ...store,
}));

import AtribuicaoPage from '../AtribuicaoPage';

const EDITAVEIS: PeriodoFinanceiro[] = [
  {
    inicio: '2026-09-01',
    fim: '2026-10-01',
    rotulo: 'set 2026',
    status: 'reaberto',
    transicao: false,
  },
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
];

function variante(edit: (r: RentabilidadeSeeded) => void): RentabilidadeSeeded {
  const r = structuredClone(planilha);
  edit(r);
  return r;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AtribuicaoPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { invalidate };
}

const celula = (membro: string, cliente: string) =>
  screen.findByRole('checkbox', { name: `${membro} atende ${cliente}` });

function adiado() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** The fixture without the given `[membro_id, cliente_id]` assignments. */
const sem = (...pares: Array<[number, number]>) =>
  variante((r) => {
    for (const [m, c] of pares) {
      const cliente = r.clientes.find((x) => x.cliente_id === c)!;
      cliente.pessoas = cliente.pessoas.filter((p) => p.membro_id !== m);
    }
  });

beforeEach(() => {
  vi.clearAllMocks();
  useAuthMock.mockReturnValue({
    profile: { conta_id: 'w1' },
    can: () => true,
    canSeeFinancials: true,
  });
  store.getPeriodosEditaveis.mockResolvedValue(structuredClone(EDITAVEIS));
  store.getRentabilidade.mockImplementation(async () => structuredClone(planilha));
  store.salvarAtribuicoes.mockResolvedValue(undefined);
});

describe('AtribuicaoPage', () => {
  it('checkbox_reflects_pessoas', async () => {
    renderPage();

    expect(await celula('Caio', 'Talitha')).not.toBeChecked();
    expect(await celula('Lia', 'Talitha')).toBeChecked();
    expect(await celula('Caio', 'Cinara')).toBeChecked();
    expect(await celula('Lia', 'Cinara')).not.toBeChecked();
    expect(store.getRentabilidade).toHaveBeenCalledWith('2026-10-01');
    expect(screen.getByRole('heading', { name: 'Equipe por cliente' })).toBeVisible();
    // Grouped under the função names, in `funcoes` order; Copy has no member, so no column.
    const grupos = screen.getAllByRole('columnheader').map((th) => th.textContent);
    expect(grupos).toEqual(
      expect.arrayContaining(['Videomaker', 'Design', 'Edição de vídeo', 'Gestão de projetos']),
    );
    expect(grupos).not.toContain('Copy');
  });

  it('toggle_calls_rpc_once', async () => {
    const user = userEvent.setup();
    const { invalidate } = renderPage();
    const depois = variante((r) => {
      const cinara = r.clientes.find((c) => c.cliente_id === 1)!;
      cinara.pessoas = cinara.pessoas.filter((p) => p.membro_id !== 3);
    });

    const cb = await celula('Ana', 'Cinara');
    expect(cb).toBeChecked();
    store.getRentabilidade.mockImplementation(async () => structuredClone(depois));
    await user.click(cb);

    expect(cb).not.toBeChecked();
    expect(store.salvarAtribuicoes).toHaveBeenCalledTimes(1);
    expect(store.salvarAtribuicoes).toHaveBeenCalledWith('2026-10-01', [
      { membro_id: 3, cliente_id: 1, ativo: false },
    ]);
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['financeiro-v2'] }));
    await waitFor(() => expect(store.getRentabilidade).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(cb).toBeEnabled());
    expect(cb).not.toBeChecked();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('toggle_failure_rolls_back', async () => {
    const user = userEvent.setup();
    store.salvarAtribuicoes.mockRejectedValueOnce(new Error('boom'));
    const { invalidate } = renderPage();

    const cb = await celula('Ana', 'Cinara');
    await user.click(cb);

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Não foi possível salvar'));
    await waitFor(() => expect(cb).toBeChecked());
    expect(cb).toBeEnabled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('clears the override on success: a refetch with the old state flips the cell back', async () => {
    const user = userEvent.setup();
    renderPage();

    const cb = await celula('Ana', 'Cinara');
    await user.click(cb);
    expect(store.salvarAtribuicoes).toHaveBeenCalledTimes(1);

    // The refetch still says Ana atende Cinara: once it lands, the server wins.
    await waitFor(() => expect(store.getRentabilidade).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(cb).toBeChecked());
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('keeps two in-flight toggles on different cells', async () => {
    const user = userEvent.setup();
    const primeiro = adiado();
    const segundo = adiado();
    store.salvarAtribuicoes
      .mockImplementationOnce(() => primeiro.promise)
      .mockImplementationOnce(() => segundo.promise);
    renderPage();

    const ana = await celula('Ana', 'Cinara');
    const bruno = await celula('Bruno', 'Roberta');
    await user.click(ana);
    await user.click(bruno);
    expect(ana).not.toBeChecked();
    expect(bruno).not.toBeChecked();
    expect(store.salvarAtribuicoes).toHaveBeenNthCalledWith(1, '2026-10-01', [
      { membro_id: 3, cliente_id: 1, ativo: false },
    ]);
    expect(store.salvarAtribuicoes).toHaveBeenNthCalledWith(2, '2026-10-01', [
      { membro_id: 4, cliente_id: 2, ativo: false },
    ]);

    // The first save lands; its refetch does not have the second change yet.
    store.getRentabilidade.mockImplementation(async () => sem([3, 1]));
    primeiro.resolve();
    await waitFor(() => expect(store.getRentabilidade).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(ana).toBeEnabled());
    expect(ana).not.toBeChecked();
    expect(bruno).not.toBeChecked();
    expect(bruno).toBeDisabled();

    store.getRentabilidade.mockImplementation(async () => sem([3, 1], [4, 2]));
    segundo.resolve();
    await waitFor(() => expect(store.getRentabilidade).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(bruno).toBeEnabled());
    expect(ana).not.toBeChecked();
    expect(bruno).not.toBeChecked();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('disables a cell only while its own save is in flight', async () => {
    const user = userEvent.setup();
    const save = adiado();
    store.salvarAtribuicoes.mockImplementationOnce(() => save.promise);
    renderPage();

    const cb = await celula('Ana', 'Cinara');
    await user.click(cb);
    expect(cb).toBeDisabled();
    expect(await celula('Ana', 'Roberta')).toBeEnabled();
    expect(await celula('Bruno', 'Cinara')).toBeEnabled();

    store.getRentabilidade.mockImplementation(async () => sem([3, 1]));
    save.resolve();
    await waitFor(() => expect(cb).toBeEnabled());
    await waitFor(() => expect(store.getRentabilidade).toHaveBeenCalledTimes(2));
    expect(cb).not.toBeChecked();
  });

  it('keeps the grid and the saved state when the refetch after a save fails', async () => {
    const user = userEvent.setup();
    renderPage();

    const cb = await celula('Ana', 'Cinara');
    store.getRentabilidade.mockRejectedValue(new Error('rede'));
    await user.click(cb);

    expect(
      await screen.findByText(
        'Não foi possível atualizar os dados. Os valores podem estar desatualizados.',
      ),
    ).toBeVisible();
    expect(screen.queryByText('Não foi possível carregar a equipe por cliente.')).toBeNull();
    // The write landed: the cached data predates it, so the cell keeps the new state.
    expect(await celula('Ana', 'Cinara')).not.toBeChecked();
    expect(toastMock.error).not.toHaveBeenCalled();

    store.getRentabilidade.mockImplementation(async () => sem([3, 1]));
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() =>
      expect(
        screen.queryByText(
          'Não foi possível atualizar os dados. Os valores podem estar desatualizados.',
        ),
      ).toBeNull(),
    );
    expect(await celula('Ana', 'Cinara')).not.toBeChecked();
  });

  it('drops a kept override once a later fetch answers, even with a different state', async () => {
    const user = userEvent.setup();
    renderPage();

    const cb = await celula('Ana', 'Cinara');
    store.getRentabilidade.mockRejectedValue(new Error('rede'));
    await user.click(cb);
    await screen.findByText(
      'Não foi possível atualizar os dados. Os valores podem estar desatualizados.',
    );
    // Kept: the write landed but the refetch failed.
    expect(cb).not.toBeChecked();

    // Meanwhile a teammate put Ana back on Cinara: the retry returns that, not the override.
    store.getRentabilidade.mockImplementation(async () => structuredClone(planilha));
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    await waitFor(() => expect(cb).toBeChecked());
    expect(
      screen.queryByText(
        'Não foi possível atualizar os dados. Os valores podem estar desatualizados.',
      ),
    ).toBeNull();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('marcar_todos_sends_all_active', async () => {
    const user = userEvent.setup();
    // Roberta pausada: out of "Marcar todos". Caio lacks Cinara and Talitha (both active).
    const antes = variante((r) => {
      r.clientes.find((c) => c.cliente_id === 2)!.status = 'pausado';
      const cinara = r.clientes.find((c) => c.cliente_id === 1)!;
      cinara.pessoas = cinara.pessoas.filter((p) => p.membro_id !== 1);
    });
    // What the database returns once the save lands: Caio on every active client.
    const depois = variante((r) => {
      r.clientes.find((c) => c.cliente_id === 2)!.status = 'pausado';
      const caio = r.clientes.find((c) => c.cliente_id === 2)!.pessoas[0];
      r.clientes.find((c) => c.cliente_id === 9)!.pessoas.unshift(structuredClone(caio));
    });
    store.getRentabilidade.mockImplementation(async () => structuredClone(antes));
    renderPage();

    const botao = await screen.findByRole('button', { name: 'Marcar todos para Caio' });
    store.getRentabilidade.mockImplementation(async () => structuredClone(depois));
    await user.click(botao);

    expect(store.salvarAtribuicoes).toHaveBeenCalledTimes(1);
    expect(store.salvarAtribuicoes).toHaveBeenCalledWith('2026-10-01', [
      { membro_id: 1, cliente_id: 1, ativo: true },
      { membro_id: 1, cliente_id: 9, ativo: true },
    ]);
    expect(await celula('Caio', 'Talitha')).toBeChecked();
    expect(await celula('Caio', 'Roberta')).toBeDisabled();
    await waitFor(() => expect(store.getRentabilidade).toHaveBeenCalledTimes(2));
    // Nothing left to mark once the refetch lands.
    await waitFor(() => expect(botao).toBeDisabled());
    expect(await celula('Caio', 'Talitha')).toBeChecked();
    expect(await celula('Caio', 'Cinara')).toBeChecked();
  });

  it('limite_badge_over_20', async () => {
    store.getRentabilidade.mockImplementation(async () =>
      variante((r) => {
        r.membros.find((m) => m.membro_id === 5)!.n_clientes = 21;
      }),
    );
    renderPage();

    expect(await screen.findByText('21 de 20')).toBeVisible();
    expect(screen.getByText('Acima do limite')).toBeVisible();
    expect(screen.getByRole('progressbar', { name: '21 de 20 clientes' })).toBeVisible();
  });

  it('limite_progress_within', async () => {
    renderPage();

    expect(await screen.findByText('15 de 20')).toBeVisible();
    expect(screen.queryByText('Acima do limite')).toBeNull();
    // Por cliente footer and column header money.
    const rodape = screen.getByRole('row', { name: /Por cliente/ });
    expect(within(rodape).getAllByText(/R\$\s160,00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/R\$\s2\.400,00 por mês/).length).toBe(1);
  });

  it('sem_funcao_banner', async () => {
    store.getRentabilidade.mockImplementation(async () =>
      variante((r) => {
        r.membros.find((m) => m.membro_id === 4)!.funcao_id = null;
      }),
    );
    renderPage();

    expect(await screen.findByText('1 pessoa sem função não entra no rateio')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Bruno' })).toHaveAttribute('href', '/equipe/4');
    await celula('Ana', 'Cinara');
    expect(screen.queryByRole('checkbox', { name: 'Bruno atende Cinara' })).toBeNull();
  });

  it('sem_funcao_banner plural', async () => {
    store.getRentabilidade.mockImplementation(async () =>
      variante((r) => {
        r.membros.find((m) => m.membro_id === 4)!.funcao_id = null;
        r.membros.find((m) => m.membro_id === 5)!.funcao_id = null;
      }),
    );
    renderPage();

    expect(await screen.findByText('2 pessoas sem função não entram no rateio')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Duda' })).toHaveAttribute('href', '/equipe/5');
  });

  it('pausado rows are disabled with a badge', async () => {
    store.getRentabilidade.mockImplementation(async () =>
      variante((r) => {
        r.clientes.find((c) => c.cliente_id === 2)!.status = 'pausado';
      }),
    );
    renderPage();

    expect(await celula('Ana', 'Roberta')).toBeDisabled();
    expect(await celula('Ana', 'Cinara')).toBeEnabled();
    const linha = screen.getByRole('row', { name: /Roberta/ });
    expect(within(linha).getByText('Pausado')).toBeVisible();
  });

  it('is read-only without financeiro/editar', async () => {
    useAuthMock.mockReturnValue({
      profile: { conta_id: 'w1' },
      can: () => false,
      canSeeFinancials: true,
    });
    renderPage();

    expect(await celula('Ana', 'Cinara')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Marcar todos/ })).toBeNull();
  });

  it('shows the reopened help line when a reaberto period is chosen', async () => {
    const user = userEvent.setup();
    renderPage();

    await celula('Ana', 'Cinara');
    expect(screen.queryByText('Os períodos seguintes já fechados não mudam')).toBeNull();
    await user.click(screen.getByRole('combobox', { name: 'Alterações valem a partir de' }));
    await user.click(await screen.findByRole('option', { name: /set 2026/ }));

    expect(await screen.findByText('Os períodos seguintes já fechados não mudam')).toBeVisible();
    await waitFor(() => expect(store.getRentabilidade).toHaveBeenCalledWith('2026-09-01'));
    await celula('Ana', 'Cinara');
  });

  it('keeps the period select and a way back when another period fails to load', async () => {
    const user = userEvent.setup();
    store.getRentabilidade.mockImplementation(async (inicio?: string) => {
      if (inicio === '2026-09-01') throw new Error('periodo_invalido');
      return structuredClone(planilha);
    });
    renderPage();

    await celula('Ana', 'Cinara');
    await user.click(screen.getByRole('combobox', { name: 'Alterações valem a partir de' }));
    await user.click(await screen.findByRole('option', { name: /set 2026/ }));

    expect(
      await screen.findByText('Não foi possível carregar a equipe por cliente.'),
    ).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Alterações valem a partir de' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() =>
      expect(
        store.getRentabilidade.mock.calls.filter(([i]) => i === '2026-09-01').length,
      ).toBeGreaterThanOrEqual(2),
    );
    expect(
      await screen.findByText('Não foi possível carregar a equipe por cliente.'),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Voltar ao período atual' }));
    expect(await celula('Ana', 'Cinara')).toBeChecked();
    expect(screen.queryByText('Não foi possível carregar a equipe por cliente.')).toBeNull();
  });

  it('shows an error line when the grid fails to load', async () => {
    store.getRentabilidade.mockRejectedValue(new Error('x'));
    renderPage();

    expect(
      await screen.findByText('Não foi possível carregar a equipe por cliente.'),
    ).toBeVisible();
  });
});
