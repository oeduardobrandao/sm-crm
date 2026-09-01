import React from 'react';
import { render, screen } from '@testing-library/react';
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

  it('shows the unlinked-membro message when crm_user_id does not match', async () => {
    getMembrosMock.mockResolvedValue([{ id: 7, nome: 'Ana', crm_user_id: null }]);

    renderSection();

    expect(
      await screen.findByText(/ainda não está vinculado a um membro da equipe/),
    ).toBeInTheDocument();
    expect(getPostsMock).not.toHaveBeenCalled();
  });

  it('lists my tasks, etapas and pending posts when the membro is linked', async () => {
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
      },
      // Someone else's task must NOT show
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
      },
      // My concluded task must NOT show
      {
        id: 3,
        titulo: 'Tarefa concluída',
        status: 'concluida',
        responsavel_id: 7,
        cliente_nome: null,
        data_limite: null,
        tags: [],
        subtarefas_total: 0,
        subtarefas_concluidas: 0,
      },
    ]);
    getEtapasMock.mockResolvedValue([
      {
        id: 21,
        workflow_id: 5,
        nome: 'Design',
        status: 'ativo',
        responsavel_id: 7,
        prazo_dias: 3,
        tipo_prazo: 'uteis',
        ordem: 1,
        workflow_titulo: 'Julho',
        cliente_nome: 'Dra. Marina',
      },
      {
        id: 22,
        workflow_id: 5,
        nome: 'Etapa de outro',
        status: 'ativo',
        responsavel_id: 9,
        prazo_dias: 3,
        tipo_prazo: 'uteis',
        ordem: 2,
        workflow_titulo: 'Julho',
        cliente_nome: 'Dra. Marina',
      },
    ]);
    getPostsMock.mockResolvedValue([
      {
        id: 31,
        workflow_id: 5,
        titulo: 'Carrossel amamentação',
        status: 'rascunho',
        workflow_titulo: 'Julho',
        cliente_nome: 'Dra. Marina',
      },
    ]);

    renderSection();

    expect(await screen.findByText('Minhas pendências')).toBeInTheDocument();
    expect(await screen.findByText('Gravar reels')).toBeInTheDocument();
    expect(screen.getByText('Design')).toBeInTheDocument();
    expect(screen.getByText('Carrossel amamentação')).toBeInTheDocument();
    expect(screen.queryByText('Tarefa de outro membro')).not.toBeInTheDocument();
    expect(screen.queryByText('Tarefa concluída')).not.toBeInTheDocument();
    expect(screen.queryByText('Etapa de outro')).not.toBeInTheDocument();
    expect(getPostsMock).toHaveBeenCalledWith(7);
  });

  // A pending POST has to land on that post, not just on the fluxo that contains it.
  // /entregas takes &post=<id> alongside ?drawer=<workflowId> and expands it in the drawer.
  it('links a pending post to the post itself, not just to its fluxo', async () => {
    getMembrosMock.mockResolvedValue([{ id: 7, nome: 'Ana', crm_user_id: 'user-1' }]);
    getPostsMock.mockResolvedValue([
      {
        id: 31,
        workflow_id: 5,
        titulo: 'Carrossel amamentação',
        status: 'rascunho',
        workflow_titulo: 'Julho',
        cliente_nome: 'Dra. Marina',
      },
    ]);

    renderSection();

    const link = await screen.findByRole('link', { name: /Carrossel amamentação/ });
    expect(link).toHaveAttribute('href', '/entregas?drawer=5&post=31');
  });

  // Same universal ?post= form every other post link producer uses for an avulso.
  it('links a pending post avulso (workflow_id null) via the universal ?post= form', async () => {
    getMembrosMock.mockResolvedValue([{ id: 7, nome: 'Ana', crm_user_id: 'user-1' }]);
    getPostsMock.mockResolvedValue([
      {
        id: 42,
        workflow_id: null,
        titulo: 'Post fora de fluxo',
        status: 'rascunho',
        workflow_titulo: null,
        cliente_nome: 'Dra. Marina',
      },
    ]);

    renderSection();

    const link = await screen.findByRole('link', { name: /Post fora de fluxo/ });
    expect(link).toHaveAttribute('href', '/entregas?post=42');
  });
});
