import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { TarefaWithRelations } from '../../../store';

const {
  deleteTarefaMock,
  deleteSerieMock,
  definirEstadoMock,
  getSubtarefasMock,
  toastSuccessMock,
  toastErrorMock,
} = vi.hoisted(() => ({
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
    updateTarefa: vi.fn(),
  };
});
vi.mock('sonner', () => ({ toast: { success: toastSuccessMock, error: toastErrorMock } }));
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
    cliente_nome: null,
    cliente_cor: null,
    serie: null,
    ...overrides,
  };
}

function renderSheet(tarefa: TarefaWithRelations, onRefresh = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <TarefaDetailSheet
        tarefa={tarefa}
        membros={[]}
        onClose={() => {}}
        onEdit={() => {}}
        onRefresh={onRefresh}
      />
    </QueryClientProvider>,
  );
  return onRefresh;
}

beforeEach(() => {
  vi.clearAllMocks();
  getSubtarefasMock.mockResolvedValue([]);
  deleteTarefaMock.mockResolvedValue(undefined);
  deleteSerieMock.mockResolvedValue(undefined);
  definirEstadoMock.mockResolvedValue(undefined);
});

describe('TarefaDetailSheet series', () => {
  it('shows the Repetição row with summary, mode and hint under Subtarefas', async () => {
    renderSheet(makeTarefa({ serie: { ...SERIE, fim: '2026-12-31' } }));
    expect(
      screen.getByText('Repete: Toda segunda até 31/12/2026 · cria a próxima ao concluir'),
    ).toBeInTheDocument();
    expect(screen.getByText('Termina em 31/12/2026')).toBeInTheDocument();
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
    expect(screen.queryByRole('button', { name: 'Retomar série' })).not.toBeInTheDocument();
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
});
