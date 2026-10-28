import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Membro, TarefaEvento, TarefaWithRelations } from '../../../store';

const {
  deleteTarefaMock,
  deleteSerieMock,
  definirEstadoMock,
  getSubtarefasMock,
  toastSuccessMock,
  toastErrorMock,
  getTarefaEventosMock,
  getTarefaComentariosMock,
  updateTarefaMock,
} = vi.hoisted(() => ({
  getTarefaEventosMock: vi.fn(),
  getTarefaComentariosMock: vi.fn(),
  updateTarefaMock: vi.fn(),
  deleteTarefaMock: vi.fn(),
  deleteSerieMock: vi.fn(),
  definirEstadoMock: vi.fn(),
  getSubtarefasMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('../../../store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../store')>();
  return {
    ...actual,
    deleteTarefa: deleteTarefaMock,
    deleteTarefaSerieCompleta: deleteSerieMock,
    definirEstadoSerie: definirEstadoMock,
    getSubtarefas: getSubtarefasMock,
    updateTarefa: updateTarefaMock,
    getTarefaEventos: getTarefaEventosMock,
    // The comments section (TarefaComentarios.test.tsx covers it): an empty thread, so no
    // own-comment "Editar"/"Excluir" buttons collide with the header's.
    getTarefaComentarios: getTarefaComentariosMock,
    getWorkspaceUsers: vi.fn(async () => []),
    getMembros: vi.fn(async () => []),
    getClientes: vi.fn(async () => []),
    getTarefas: vi.fn(async () => []),
  };
});
vi.mock('sonner', () => ({ toast: { success: toastSuccessMock, error: toastErrorMock } }));
vi.mock('@/lib/supabase');
vi.mock('@mesaas/app-lifecycle', () => ({
  useUnsavedWork: vi.fn(),
  trackUnsavedWork: vi.fn((p: Promise<unknown>) => p),
}));
vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({
    features: null,
    isUnlimited: false,
    limits: null,
    isLoading: false,
  }),
}));
vi.mock('@/context/AuthContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/context/AuthContext')>()),
  useAuth: () => ({ user: { id: 'user-me' }, profile: { conta_id: 'conta-1' } }),
}));
// Same reasoning as TarefaCard.test.tsx: Radix DropdownMenu does not open under jsdom.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

import { TarefaDetailSheet } from '../components/TarefaDetailSheet';

const SERIE = {
  id: 9,
  freq: 'weekly' as const,
  intervalo: 1,
  dias_semana: [1],
  dia_mes: null,
  mes: null,
  modo: 'ao_concluir' as const,
  fim: null,
  inicio: '2026-01-05',
  pausada: false,
  encerrada_em: null,
  proxima_data: null,
};

function makeTarefa(overrides: Partial<TarefaWithRelations> = {}): TarefaWithRelations {
  return {
    id: 42,
    titulo: 'Relatório',
    descricao: null,
    descricao_rich: null,
    status: 'pendente',
    responsavel_id: null,
    cliente_id: null,
    data_limite: '2026-01-12',
    concluida_em: null,
    created_at: '2026-01-01T10:00:00',
    tags: [],
    subtarefas_total: 0,
    subtarefas_concluidas: 0,
    comentarios_total: 0,
    cliente_nome: null,
    cliente_cor: null,
    serie: null,
    ...overrides,
  };
}

function renderSheet(
  tarefa: TarefaWithRelations,
  onRefresh = vi.fn(),
  extra: Partial<React.ComponentProps<typeof TarefaDetailSheet>> = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TarefaDetailSheet
          tarefa={tarefa}
          membros={[]}
          onClose={() => {}}
          onEdit={() => {}}
          onRefresh={onRefresh}
          {...extra}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return onRefresh;
}

const scrollIntoViewMock = vi.fn();
const originalScrollIntoView = Element.prototype.scrollIntoView;

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = scrollIntoViewMock;
  getSubtarefasMock.mockResolvedValue([]);
  getTarefaEventosMock.mockResolvedValue([]);
  getTarefaComentariosMock.mockResolvedValue([]);
  updateTarefaMock.mockResolvedValue(undefined);
  deleteTarefaMock.mockResolvedValue(undefined);
  deleteSerieMock.mockResolvedValue(undefined);
  definirEstadoMock.mockResolvedValue(undefined);
});

afterEach(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

describe('TarefaDetailSheet series', () => {
  it('shows the Repetição row with summary, mode and hint under Subtarefas', async () => {
    renderSheet(makeTarefa({ serie: { ...SERIE, fim: '2099-12-31' } }));
    expect(
      screen.getByText('Repete: Toda segunda até 31/12/2099 · cria a próxima ao concluir'),
    ).toBeInTheDocument();
    expect(screen.getByText('Termina em 31/12/2099')).toBeInTheDocument();
    expect(
      screen.getByText(
        'As próximas ocorrências usam a lista da série. Para mudar, edite a tarefa e escolha Esta e as próximas.',
      ),
    ).toBeInTheDocument();
  });

  it('offers Pausar/Encerrar when active, calling definirEstadoSerie', async () => {
    const onRefresh = renderSheet(makeTarefa({ serie: SERIE }));
    fireEvent.click(screen.getByRole('button', { name: 'Pausar série' }));
    await waitFor(() => expect(definirEstadoMock).toHaveBeenCalledWith(9, 'pausar'));
    expect(onRefresh).toHaveBeenCalled();
    expect(toastSuccessMock).toHaveBeenCalledWith('Série pausada!');
    expect(screen.getByRole('button', { name: 'Encerrar série' })).toBeInTheDocument();
  });

  it('paused: Retomar calls retomar; Encerrar asks for confirmation first', async () => {
    renderSheet(makeTarefa({ serie: { ...SERIE, pausada: true } }));
    expect(screen.getByText('Pausada')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retomar série' }));
    await waitFor(() => expect(definirEstadoMock).toHaveBeenCalledWith(9, 'retomar'));
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar série' }));
    expect(await screen.findByText('Encerrar série?')).toBeInTheDocument();
    expect(
      screen.getByText('As ocorrências já criadas continuam como estão. Nenhuma nova será criada.'),
    ).toBeInTheDocument();
    expect(definirEstadoMock).not.toHaveBeenCalledWith(9, 'encerrar');
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar' }));
    await waitFor(() => expect(definirEstadoMock).toHaveBeenCalledWith(9, 'encerrar'));
  });

  it('ended series shows no actions', () => {
    renderSheet(makeTarefa({ serie: { ...SERIE, encerrada_em: '2026-01-01T00:00:00Z' } }));
    expect(screen.getByText('Encerrada')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pausar série' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retomar série' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Encerrar série' })).not.toBeInTheDocument();
  });

  it('delete dialog for an occurrence: "Somente esta" deletes the task, not the series', async () => {
    renderSheet(makeTarefa({ serie: SERIE }));
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(await screen.findByText('Excluir tarefa recorrente?')).toBeInTheDocument();
    expect(screen.getByText('A próxima ocorrência será criada normalmente.')).toBeInTheDocument();
    expect(
      screen.getByText('Remove a série e as ocorrências abertas. As concluídas ficam.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Somente esta' }));
    await waitFor(() => expect(deleteTarefaMock).toHaveBeenCalledWith(42));
    expect(deleteSerieMock).not.toHaveBeenCalled();
  });

  it('"Toda a série" calls deleteTarefaSerieCompleta with the series id', async () => {
    renderSheet(makeTarefa({ serie: SERIE }));
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    await screen.findByText('Excluir tarefa recorrente?');
    fireEvent.click(screen.getByRole('button', { name: 'Toda a série' }));
    await waitFor(() => expect(deleteSerieMock).toHaveBeenCalledWith(9));
    expect(toastSuccessMock).toHaveBeenCalledWith('Série excluída!');
    expect(deleteTarefaMock).not.toHaveBeenCalled();
  });

  it('standalone task keeps the current delete dialog', async () => {
    renderSheet(makeTarefa());
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(await screen.findByText('Excluir tarefa?')).toBeInTheDocument();
    expect(screen.queryByText('Toda a série')).not.toBeInTheDocument();
  });

  it('"Toda a série" fires once when clicked twice while the request is pending', async () => {
    let resolve!: () => void;
    deleteSerieMock.mockReturnValueOnce(new Promise<void>((r) => (resolve = r)));
    renderSheet(makeTarefa({ serie: SERIE }));
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    await screen.findByText('Excluir tarefa recorrente?');
    const btn = screen.getByRole('button', { name: 'Toda a série' });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(deleteSerieMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Somente esta' })).toBeDisabled();
    resolve();
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith('Série excluída!'));
  });

  it('shows the "próxima ocorrência" hint only while the series is active', async () => {
    renderSheet(makeTarefa({ serie: { ...SERIE, pausada: true } }));
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    await screen.findByText('Excluir tarefa recorrente?');
    expect(
      screen.queryByText('A próxima ocorrência será criada normalmente.'),
    ).not.toBeInTheDocument();
  });
});

const ANA_UID = 'user-ana';
const MEMBROS = [{ id: 1, nome: 'Ana', crm_user_id: ANA_UID }] as unknown as Membro[];

function evento(overrides: Partial<TarefaEvento>): TarefaEvento {
  return {
    id: 1,
    tarefa_id: 42,
    tipo: 'status',
    actor_user_id: ANA_UID,
    actor_nome: 'Ana',
    de: 'pendente',
    para: 'em_andamento',
    txid: 1,
    created_at: '2026-10-28T12:00:00Z',
    ...overrides,
  };
}

describe('TarefaDetailSheet header, history and comments', () => {
  it('header has Histórico, Editar, Excluir buttons by name and no bottom action row', async () => {
    const onEdit = vi.fn();
    renderSheet(makeTarefa(), vi.fn(), { onEdit });
    const actions = screen.getByRole('group', { name: 'Ações da tarefa' });
    expect(within(actions).getByRole('button', { name: 'Histórico' })).toBeInTheDocument();
    expect(within(actions).getByRole('button', { name: 'Editar' })).toBeInTheDocument();
    expect(within(actions).getByRole('button', { name: 'Excluir' })).toBeInTheDocument();
    // The old Edit/Delete row at the bottom is gone: one of each, in the header.
    expect(screen.getAllByRole('button', { name: 'Editar' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Excluir' })).toHaveLength(1);
    fireEvent.click(within(actions).getByRole('button', { name: 'Editar' }));
    expect(onEdit).toHaveBeenCalled();
  });

  it('Histórico swaps the body to the timeline and Voltar returns', async () => {
    getTarefaEventosMock.mockResolvedValue([evento({})]);
    renderSheet(makeTarefa(), vi.fn(), { membros: MEMBROS });
    expect(getTarefaEventosMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Histórico' }));

    expect(
      await screen.findByText('Ana mudou o status de A fazer para Em andamento'),
    ).toBeInTheDocument();
    expect(getTarefaEventosMock).toHaveBeenCalledWith(42);
    expect(screen.getByRole('heading', { name: 'Histórico' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Em andamento' })).not.toBeInTheDocument();
    expect(document.getElementById('tarefa-comentarios')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(screen.getByRole('button', { name: 'Em andamento' })).toBeInTheDocument();
    expect(
      screen.queryByText('Ana mudou o status de A fazer para Em andamento'),
    ).not.toBeInTheDocument();
  });

  it('history shows loading then nodes, and an error line with Tentar novamente on failure', async () => {
    let resolve!: (v: TarefaEvento[]) => void;
    getTarefaEventosMock.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    renderSheet(makeTarefa(), vi.fn(), { membros: MEMBROS });
    fireEvent.click(screen.getByRole('button', { name: 'Histórico' }));
    expect(screen.getByRole('status', { name: 'Carregando histórico' })).toBeInTheDocument();
    resolve([evento({})]);
    expect(
      await screen.findByText('Ana mudou o status de A fazer para Em andamento'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Carregando histórico' })).not.toBeInTheDocument();
  });

  it('history error shows a retry that refetches', async () => {
    getTarefaEventosMock
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([evento({})]);
    renderSheet(makeTarefa(), vi.fn(), { membros: MEMBROS });
    fireEvent.click(screen.getByRole('button', { name: 'Histórico' }));
    expect(await screen.findByText('Não foi possível carregar o histórico.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(
      await screen.findByText('Ana mudou o status de A fazer para Em andamento'),
    ).toBeInTheDocument();
    expect(getTarefaEventosMock).toHaveBeenCalledTimes(2);
  });

  it('reopening the history after a change made from the sheet shows the new entry', async () => {
    getTarefaEventosMock.mockResolvedValue([evento({})]);
    renderSheet(makeTarefa(), vi.fn(), { membros: MEMBROS });
    fireEvent.click(screen.getByRole('button', { name: 'Histórico' }));
    await screen.findByText('Ana mudou o status de A fazer para Em andamento');
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Em andamento' }));
    await waitFor(() =>
      expect(updateTarefaMock).toHaveBeenCalledWith(42, { status: 'em_andamento' }),
    );
    getTarefaEventosMock.mockResolvedValue([
      evento({ id: 2, de: 'em_andamento', para: 'concluida', created_at: '2026-10-28T13:00:00Z' }),
      evento({}),
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Histórico' }));
    expect(
      await screen.findByText('Ana mudou o status de Em andamento para Concluída'),
    ).toBeInTheDocument();
  });

  it('comments section renders last', async () => {
    renderSheet(makeTarefa());
    expect(
      await screen.findByText('Nenhum comentário ainda. Use @ para mencionar alguém.'),
    ).toBeInTheDocument();
    const section = document.getElementById('tarefa-comentarios');
    expect(section).not.toBeNull();
    expect(section!.parentElement!.lastElementChild).toBe(section);
    // After the checklist.
    const subtaskInput = screen.getByPlaceholderText('Nova subtarefa...');
    expect(
      subtaskInput.compareDocumentPosition(section!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('focusComments scrolls to the comments once; Histórico and Voltar do not refocus', async () => {
    renderSheet(makeTarefa(), vi.fn(), { focusComments: true });
    await waitFor(() => expect(scrollIntoViewMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Histórico' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Voltar' }));
    await screen.findByText('Nenhum comentário ainda. Use @ para mencionar alguém.');
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
  });

  it('without focusComments nothing scrolls', async () => {
    renderSheet(makeTarefa());
    await screen.findByText('Nenhum comentário ainda. Use @ para mencionar alguém.');
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });
});
