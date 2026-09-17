import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getTarefasMock, getMembrosMock } = vi.hoisted(() => ({
  getTarefasMock: vi.fn().mockResolvedValue([]),
  getMembrosMock: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../store', () => ({
  getTarefas: getTarefasMock,
  getTarefaTags: vi.fn().mockResolvedValue([]),
  getMembros: getMembrosMock,
  getClientes: vi.fn().mockResolvedValue([]),
  getSubtarefas: vi.fn().mockResolvedValue([]),
  addTarefa: vi.fn(),
  updateTarefa: vi.fn(),
  deleteTarefa: vi.fn(),
  setTarefaTags: vi.fn(),
  addSubtarefa: vi.fn(),
  toggleSubtarefa: vi.fn(),
  deleteSubtarefa: vi.fn(),
  addTarefaTag: vi.fn(),
  getInitials: (nome: string) => nome.slice(0, 2).toUpperCase(),
}));

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock('@/context/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/AuthContext')>();
  return { ...actual, useAuth: useAuthMock };
});

import TarefasPage from '../TarefasPage';
import type { TarefaWithRelations } from '../../../store';

let seq = 0;
function makeTarefa(overrides: Partial<TarefaWithRelations> = {}): TarefaWithRelations {
  seq++;
  return {
    id: seq,
    titulo: `Tarefa ${seq}`,
    status: 'pendente',
    responsavel_id: null,
    cliente_id: null,
    data_limite: null,
    concluida_em: null,
    created_at: `2026-07-01T10:00:${String(seq % 60).padStart(2, '0')}`,
    tags: [],
    subtarefas_total: 0,
    subtarefas_concluidas: 0,
    cliente_nome: null,
    cliente_cor: null,
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/tarefas']}>
        <TarefasPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TarefasPage', () => {
  beforeEach(() => {
    localStorage.clear();
    getTarefasMock.mockReset().mockResolvedValue([]);
    getMembrosMock.mockReset().mockResolvedValue([]);
    useAuthMock.mockReturnValue({
      user: { id: 'user-1' },
      profile: { conta_id: 'conta-1' },
    });
  });

  it('renders header, stats, view tabs and the empty state', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Tarefas' })).toBeInTheDocument();

    // Stat cards
    expect(await screen.findByText('Abertas')).toBeInTheDocument();
    expect(screen.getByText('Vencem hoje')).toBeInTheDocument();
    expect(screen.getByText('Atrasadas')).toBeInTheDocument();
    expect(screen.getByText('Concluídas hoje')).toBeInTheDocument();

    // The four view tabs
    expect(screen.getByRole('button', { name: /Lista/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Por membro/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Kanban/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Calendário/ })).toBeInTheDocument();

    // Empty workspace state
    expect(
      await screen.findByText('Nenhuma tarefa ainda. Crie a primeira tarefa da equipe.'),
    ).toBeInTheDocument();
  });

  it('lets an empty workspace reach the Kanban and Calendário tabs instead of trapping it on the generic empty state', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Nenhuma tarefa ainda. Crie a primeira tarefa da equipe.');

    await user.click(screen.getByRole('button', { name: /Kanban/ }));
    expect(
      screen.queryByText('Nenhuma tarefa ainda. Crie a primeira tarefa da equipe.'),
    ).not.toBeInTheDocument();
    // StatusKanbanView renders its fixed status columns even with zero tarefas.
    expect(screen.getAllByText('Nenhuma tarefa').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /Calendário/ }));
    expect(
      screen.queryByText('Nenhuma tarefa ainda. Crie a primeira tarefa da equipe.'),
    ).not.toBeInTheDocument();
    // CalendarView's month grid renders regardless of tarefas count.
    expect(screen.getByText(/Sem data/)).toBeInTheDocument();
  });

  it('hides the Minhas/Todas toggle when the logged-in user has no linked membro', async () => {
    getMembrosMock.mockResolvedValue([{ id: 7, nome: 'Ana', crm_user_id: null }]);
    getTarefasMock.mockResolvedValue([makeTarefa({ titulo: 'Tarefa de Ana', responsavel_id: 7 })]);
    renderPage();

    await screen.findByText('Tarefa de Ana');
    expect(screen.queryByRole('button', { name: 'Minhas tarefas' })).not.toBeInTheDocument();
  });

  it('filters to the current user’s tasks, persists the choice, and restores it on remount', async () => {
    const ue = userEvent.setup();
    getMembrosMock.mockResolvedValue([{ id: 7, nome: 'Ana', crm_user_id: 'user-1' }]);
    getTarefasMock.mockResolvedValue([
      makeTarefa({ titulo: 'Minha tarefa', responsavel_id: 7 }),
      makeTarefa({ titulo: 'Tarefa de outro membro', responsavel_id: 99 }),
    ]);

    const { unmount } = renderPage();

    await screen.findByText('Minha tarefa');
    expect(screen.getByText('Tarefa de outro membro')).toBeInTheDocument();

    await ue.click(screen.getByRole('button', { name: 'Minhas tarefas' }));

    expect(screen.getByText('Minha tarefa')).toBeInTheDocument();
    expect(screen.queryByText('Tarefa de outro membro')).not.toBeInTheDocument();
    expect(localStorage.getItem('tarefas_escopo_conta-1_user-1')).toBe('minhas');

    unmount();
    renderPage();

    await screen.findByText('Minha tarefa');
    expect(screen.queryByText('Tarefa de outro membro')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Minhas tarefas' })).toBeInTheDocument();
  });

  it('keeps the Minhas tarefas filter applied across the Kanban, Por membro and Calendário views', async () => {
    const ue = userEvent.setup();
    getMembrosMock.mockResolvedValue([
      { id: 7, nome: 'Ana', crm_user_id: 'user-1' },
      { id: 99, nome: 'Bruno', crm_user_id: null },
    ]);
    getTarefasMock.mockResolvedValue([
      makeTarefa({ titulo: 'Minha tarefa', responsavel_id: 7 }),
      makeTarefa({ titulo: 'Tarefa de outro membro', responsavel_id: 99 }),
    ]);

    renderPage();
    await screen.findByText('Minha tarefa');
    await ue.click(screen.getByRole('button', { name: 'Minhas tarefas' }));
    expect(screen.queryByText('Tarefa de outro membro')).not.toBeInTheDocument();

    // Kanban: both tasks default to 'pendente', so before the toggle they'd
    // share a column -- confirms StatusKanbanView also respects the filter.
    await ue.click(screen.getByRole('button', { name: /Kanban/ }));
    expect(await screen.findByText('Minha tarefa')).toBeInTheDocument();
    expect(screen.queryByText('Tarefa de outro membro')).not.toBeInTheDocument();

    // Por membro: Bruno has his own column, so without the filter his card
    // would render there -- confirms MembrosBoardView respects it too.
    await ue.click(screen.getByRole('button', { name: /Por membro/ }));
    expect(await screen.findByText('Minha tarefa')).toBeInTheDocument();
    expect(screen.queryByText('Tarefa de outro membro')).not.toBeInTheDocument();
    // Bruno's whole column is gone, not just left empty.
    expect(screen.queryByText('Bruno')).not.toBeInTheDocument();

    // Calendário (defaults to Board mode): both tasks are undated, so
    // they'd share the 'Sem data' column -- confirms BoardView respects it.
    await ue.click(screen.getByRole('button', { name: /Calendário/ }));
    expect(await screen.findByText('Minha tarefa')).toBeInTheDocument();
    expect(screen.queryByText('Tarefa de outro membro')).not.toBeInTheDocument();
  });

  it('Por membro: hides every column except the current user’s and Sem responsável when Minhas tarefas is on', async () => {
    const ue = userEvent.setup();
    getMembrosMock.mockResolvedValue([
      { id: 7, nome: 'Ana', crm_user_id: 'user-1' },
      { id: 99, nome: 'Bruno', crm_user_id: null },
      { id: 100, nome: 'Carla', crm_user_id: null },
    ]);
    getTarefasMock.mockResolvedValue([]);

    renderPage();
    await ue.click(await screen.findByRole('button', { name: /Por membro/ }));

    expect(await screen.findByText('Sem responsável')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Bruno')).toBeInTheDocument();
    expect(screen.getByText('Carla')).toBeInTheDocument();

    await ue.click(screen.getByRole('button', { name: 'Minhas tarefas' }));

    expect(screen.getByText('Sem responsável')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.queryByText('Bruno')).not.toBeInTheDocument();
    expect(screen.queryByText('Carla')).not.toBeInTheDocument();

    await ue.click(screen.getByRole('button', { name: 'Todas as tarefas' }));

    expect(screen.getByText('Bruno')).toBeInTheDocument();
    expect(screen.getByText('Carla')).toBeInTheDocument();
  });
});
