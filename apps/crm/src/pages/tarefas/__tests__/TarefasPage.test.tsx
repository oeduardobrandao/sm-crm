import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../store', () => ({
  getTarefas: vi.fn().mockResolvedValue([]),
  getTarefaTags: vi.fn().mockResolvedValue([]),
  getMembros: vi.fn().mockResolvedValue([]),
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

import TarefasPage from '../TarefasPage';

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
});
