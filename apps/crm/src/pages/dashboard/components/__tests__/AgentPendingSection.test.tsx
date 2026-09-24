import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMembrosMock, getTarefasMock, getEtapasMock, getPostsMock } = vi.hoisted(() => ({
  getMembrosMock: vi.fn(),
  getTarefasMock: vi.fn(),
  getEtapasMock: vi.fn(),
  getPostsMock: vi.fn(),
}));

vi.mock('../../../../store', () => ({
  getMembros: getMembrosMock,
  getTarefas: getTarefasMock,
  getAllActiveEtapas: getEtapasMock,
  getAssignedPendingPosts: getPostsMock,
  getDeadlineInfo: () => ({
    diasRestantes: 2,
    horasRestantes: 0,
    estourado: false,
    urgente: false,
  }),
  getInitials: (nome: string) => nome.slice(0, 2).toUpperCase(),
}));

vi.mock('../../../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

import { AgentPendingSection } from '../AgentPendingSection';

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AgentPendingSection />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AgentPendingSection', () => {
  beforeEach(() => {
    getMembrosMock.mockReset();
    getTarefasMock.mockReset();
    getEtapasMock.mockReset();
    getPostsMock.mockReset();
    getTarefasMock.mockResolvedValue([]);
    getEtapasMock.mockResolvedValue([]);
    getPostsMock.mockResolvedValue([]);
  });

  it('renders nothing when the user has no linked membro (the teaser owns that state)', async () => {
    getMembrosMock.mockResolvedValue([{ id: 7, nome: 'Ana', crm_user_id: null }]);

    const { container } = renderSection();

    // While ['membros'] is in flight the spinner card is rendered; the null
    // render only lands once the query resolves.
    await waitFor(() => expect(container.firstChild).toBeNull());
    expect(getTarefasMock).not.toHaveBeenCalled();
    expect(getEtapasMock).not.toHaveBeenCalled();
    expect(getPostsMock).not.toHaveBeenCalled();
  });

  it('lists only my open tasks, and never queries etapas or posts', async () => {
    getMembrosMock.mockResolvedValue([{ id: 7, nome: 'Ana', crm_user_id: 'user-1' }]);
    getTarefasMock.mockResolvedValue([
      {
        id: 1,
        titulo: 'Gravar reels',
        status: 'pendente',
        responsavel_id: 7,
        cliente_nome: 'Dra. Marina',
        data_limite: null,
        tags: [],
        subtarefas_total: 0,
        subtarefas_concluidas: 0,
        serie: null,
      },
      {
        id: 2,
        titulo: 'Tarefa de outro membro',
        status: 'pendente',
        responsavel_id: 9,
        cliente_nome: null,
        data_limite: null,
        tags: [],
        subtarefas_total: 0,
        subtarefas_concluidas: 0,
        serie: null,
      },
    ]);

    renderSection();

    expect(await screen.findByText('Minhas pendências')).toBeInTheDocument();
    expect(await screen.findByText('Gravar reels')).toBeInTheDocument();
    expect(screen.queryByText('Tarefa de outro membro')).not.toBeInTheDocument();
    expect(screen.queryByText(/Entregas · etapas/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Entregas · posts/)).not.toBeInTheDocument();
    expect(getEtapasMock).not.toHaveBeenCalled();
    expect(getPostsMock).not.toHaveBeenCalled();
  });

  it('shows the empty copy when there are no open tasks', async () => {
    getMembrosMock.mockResolvedValue([{ id: 7, nome: 'Ana', crm_user_id: 'user-1' }]);
    renderSection();
    expect(await screen.findByText('Nenhuma tarefa atribuída a você.')).toBeInTheDocument();
  });
});
