import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  useAuthMock,
  getMembrosMock,
  getClientesMock,
  getTarefasMock,
  getEtapasMock,
  getScheduledMock,
  getAwaitingMock,
  getPendingMock,
  getDatasMock,
  updateTarefaMock,
  toastSuccessMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  getMembrosMock: vi.fn(),
  getClientesMock: vi.fn(),
  getTarefasMock: vi.fn(),
  getEtapasMock: vi.fn(),
  getScheduledMock: vi.fn(),
  getAwaitingMock: vi.fn(),
  getPendingMock: vi.fn(),
  getDatasMock: vi.fn(),
  updateTarefaMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: toastSuccessMock, error: toastErrorMock } }));

vi.mock('../../../../store', () => ({
  getMembros: getMembrosMock,
  getClientes: getClientesMock,
  getTarefas: getTarefasMock,
  getAllActiveEtapas: getEtapasMock,
  getScheduledPosts: getScheduledMock,
  getAwaitingClientePosts: getAwaitingMock,
  getAssignedPendingPosts: getPendingMock,
  getAllClienteDatas: getDatasMock,
  updateTarefa: updateTarefaMock,
}));

vi.mock('../../../../context/AuthContext', () => ({
  useAuth: useAuthMock,
}));

import { TodayCard } from '../TodayCard';

// Monday 2026-08-17 10:00 local
const NOW = new Date(2026, 7, 17, 10, 0, 0);

const OWNER_AUTH = {
  user: { id: 'user-owner' },
  workspaceRole: 'owner',
  membershipResolved: true,
  canSeeFinancials: true,
};
const AGENT_AUTH = {
  user: { id: 'user-agent' },
  workspaceRole: 'agent',
  membershipResolved: true,
  canSeeFinancials: false,
};

const MEMBROS = [
  { id: 10, nome: 'Matilda Kristin', crm_user_id: 'user-agent' },
  { id: 11, nome: 'Caio Dias', crm_user_id: 'user-owner' },
];

function tarefa(over: Record<string, unknown>) {
  return {
    id: 1,
    titulo: 'Tarefa',
    status: 'pendente',
    responsavel_id: 10,
    cliente_nome: 'Cliente X',
    data_limite: '2026-08-17',
    tags: [],
    subtarefas_total: 0,
    subtarefas_concluidas: 0,
    ...over,
  };
}

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TodayCard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TodayCard', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    for (const m of [
      useAuthMock,
      getMembrosMock,
      getClientesMock,
      getTarefasMock,
      getEtapasMock,
      getScheduledMock,
      getAwaitingMock,
      getPendingMock,
      getDatasMock,
      updateTarefaMock,
      toastSuccessMock,
      toastErrorMock,
    ])
      m.mockReset();
    getMembrosMock.mockResolvedValue(MEMBROS);
    getClientesMock.mockResolvedValue([]);
    getTarefasMock.mockResolvedValue([]);
    getEtapasMock.mockResolvedValue([]);
    getScheduledMock.mockResolvedValue([]);
    getAwaitingMock.mockResolvedValue([]);
    getPendingMock.mockResolvedValue([]);
    getDatasMock.mockResolvedValue([]);
    updateTarefaMock.mockResolvedValue({});
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fails closed: fetches nothing while the workspace role is unresolved', async () => {
    useAuthMock.mockReturnValue({
      user: { id: 'user-owner' },
      workspaceRole: null,
      membershipResolved: false,
      canSeeFinancials: 'unknown',
    });
    renderCard();
    expect(screen.getByText('Hoje')).toBeInTheDocument();
    // Let any effect/query settle
    await new Promise((r) => setTimeout(r, 20));
    expect(getTarefasMock).not.toHaveBeenCalled();
    expect(getAwaitingMock).not.toHaveBeenCalled();
    expect(getClientesMock).not.toHaveBeenCalled();
    expect(getPendingMock).not.toHaveBeenCalled();
  });

  it('agent scope never touches workspace-only sources and hides finance rows', async () => {
    useAuthMock.mockReturnValue(AGENT_AUTH);
    getTarefasMock.mockResolvedValue([
      tarefa({ id: 1, titulo: 'Minha tarefa', responsavel_id: 10 }),
      tarefa({ id: 2, titulo: 'Tarefa do Caio', responsavel_id: 11 }),
    ]);
    getPendingMock.mockResolvedValue([
      {
        id: 5,
        workflow_id: 3,
        titulo: 'Carrossel sono',
        status: 'correcao_cliente',
        workflow_titulo: 'Pack',
        cliente_nome: 'Dra. Ana',
      },
    ]);
    renderCard();

    expect(await screen.findByText('Minha tarefa')).toBeInTheDocument();
    expect(screen.getByText('Carrossel sono')).toBeInTheDocument();
    expect(screen.queryByText('Tarefa do Caio')).not.toBeInTheDocument();
    expect(screen.getByText(/atribuídos a você/)).toBeInTheDocument();
    expect(getAwaitingMock).not.toHaveBeenCalled();
    expect(getClientesMock).not.toHaveBeenCalled();
    expect(getDatasMock).not.toHaveBeenCalled();
    expect(getPendingMock).toHaveBeenCalledWith(10);
    // Agent rows carry no "who" column
    expect(document.querySelector('.today-row-who')).toBeNull();
  });

  it('shows the unlinked-membro message for an agent without a membro row', async () => {
    useAuthMock.mockReturnValue({ ...AGENT_AUTH, user: { id: 'nobody' } });
    renderCard();
    expect(
      await screen.findByText(/ainda não está vinculado a um membro da equipe/),
    ).toBeInTheDocument();
    expect(getPendingMock).not.toHaveBeenCalled();
  });

  it('owner: groups by bucket, chips toggle visibility, Próximos hidden by default', async () => {
    useAuthMock.mockReturnValue(OWNER_AUTH);
    getTarefasMock.mockResolvedValue([
      tarefa({ id: 1, titulo: 'Atrasada', data_limite: '2026-08-15', responsavel_id: 10 }),
      tarefa({ id: 2, titulo: 'De hoje', data_limite: '2026-08-17', responsavel_id: 11 }),
      tarefa({ id: 3, titulo: 'Da semana', data_limite: '2026-08-20', responsavel_id: 11 }),
    ]);
    getClientesMock.mockResolvedValue([
      { id: 1, nome: 'Cliente Pagante', status: 'ativo', data_pagamento: 17 },
    ]);
    renderCard();

    expect(await screen.findByText('Atrasada')).toBeInTheDocument();
    expect(screen.getByText('De hoje')).toBeInTheDocument();
    expect(screen.getByText('Cliente Pagante')).toBeInTheDocument();
    expect(screen.getByText('Recebimento')).toBeInTheDocument();
    expect(screen.queryByText('Da semana')).not.toBeInTheDocument();

    // Owner sees who is responsible
    expect(screen.getByText('Matilda')).toBeInTheDocument();
    expect(screen.getByText('Caio')).toBeInTheDocument();

    const proximos = screen.getByRole('button', { name: /Próximos 7 dias/ });
    expect(proximos).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(proximos);
    expect(await screen.findByText('Da semana')).toBeInTheDocument();

    const atrasado = screen.getByRole('button', { name: /^Atrasado/ });
    expect(atrasado).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(atrasado);
    await waitFor(() => expect(screen.queryByText('Atrasada')).not.toBeInTheDocument());

    // Rows deep-link
    expect(screen.getByRole('link', { name: /De hoje/ })).toHaveAttribute(
      'href',
      '/tarefas?tarefa=2',
    );
    expect(screen.getByRole('link', { name: /Cliente Pagante/ })).toHaveAttribute(
      'href',
      '/clientes/1',
    );
  });

  it('checkbox completes the task optimistically and undo restores the prior status', async () => {
    useAuthMock.mockReturnValue(OWNER_AUTH);
    const row42 = tarefa({
      id: 42,
      titulo: 'Em andamento',
      status: 'em_andamento',
      responsavel_id: 10,
    });
    getTarefasMock.mockResolvedValue([row42]);
    // The refetch after the mutation returns what the DB would now hold.
    updateTarefaMock.mockImplementation(async (_id: number, patch: { status: string }) => {
      getTarefasMock.mockResolvedValue([{ ...row42, status: patch.status }]);
      return {};
    });
    renderCard();

    const row = (await screen.findByText('Em andamento')).closest('a')!;
    const checkbox = within(row).getByRole('checkbox');
    fireEvent.click(checkbox);

    await waitFor(() => expect(updateTarefaMock).toHaveBeenCalledWith(42, { status: 'concluida' }));
    await waitFor(() => expect(screen.queryByText('Em andamento')).not.toBeInTheDocument());
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalled());

    const opts = toastSuccessMock.mock.calls[0][1] as { action: { onClick: () => void } };
    opts.action.onClick();
    await waitFor(() =>
      expect(updateTarefaMock).toHaveBeenLastCalledWith(42, { status: 'em_andamento' }),
    );
  });

  it('expands overflow in place instead of navigating', async () => {
    useAuthMock.mockReturnValue(OWNER_AUTH);
    getTarefasMock.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) =>
        tarefa({
          id: i + 1,
          titulo: `Tarefa ${String(i + 1).padStart(2, '0')}`,
          data_limite: '2026-08-15',
        }),
      ),
    );
    renderCard();

    expect(await screen.findByText('Tarefa 08')).toBeInTheDocument();
    expect(screen.queryByText('Tarefa 09')).not.toBeInTheDocument();

    const more = screen.getByRole('button', { name: /Mostrar mais 20 · 22 restantes/ });
    fireEvent.click(more);
    expect(await screen.findByText('Tarefa 28')).toBeInTheDocument();
    expect(screen.queryByText('Tarefa 29')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Mostrar mais 2 · 2 restantes/ }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar menos' }));
    await waitFor(() => expect(screen.queryByText('Tarefa 09')).not.toBeInTheDocument());
    // No navigation link is involved
    expect(screen.queryByRole('link', { name: /Mostrar mais/ })).toBeNull();
  });

  it('shows the empty state when nothing is due', async () => {
    useAuthMock.mockReturnValue(OWNER_AUTH);
    renderCard();
    expect(await screen.findByText('Nada para hoje.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver calendário' })).toHaveAttribute(
      'href',
      '/calendario',
    );
  });
});
