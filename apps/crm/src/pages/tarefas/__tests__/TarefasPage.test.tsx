import React from 'react';
import { render, screen } from '@testing-library/react';
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
});
