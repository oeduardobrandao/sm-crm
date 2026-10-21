import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createBrowserRouter, MemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhoneLayoutProvider } from '@/components/layout/PhoneLayoutContext';

const {
  getTarefasMock,
  getMembrosMock,
  getClientesMock,
  updateTarefaMock,
  deleteTarefaMock,
  deleteSerieMock,
} = vi.hoisted(() => ({
  getTarefasMock: vi.fn(),
  getMembrosMock: vi.fn(),
  getClientesMock: vi.fn(),
  updateTarefaMock: vi.fn(),
  deleteTarefaMock: vi.fn(),
  deleteSerieMock: vi.fn(),
}));

vi.mock('../../../store', () => ({
  getTarefas: getTarefasMock,
  getTarefaTags: async () => [],
  getMembros: getMembrosMock,
  getClientes: getClientesMock,
  getSubtarefas: async () => [],
  addTarefa: vi.fn(),
  updateTarefa: updateTarefaMock,
  deleteTarefa: deleteTarefaMock,
  deleteTarefaSerieCompleta: deleteSerieMock,
  definirEstadoSerie: vi.fn(),
  setTarefaTags: vi.fn(),
  addSubtarefa: vi.fn(),
  toggleSubtarefa: vi.fn(),
  deleteSubtarefa: vi.fn(),
  addTarefaTag: vi.fn(),
  isSerieDateConflict: () => false,
  getInitials: (nome: string) => nome.slice(0, 2).toUpperCase(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// The shell's bell and help links need the KB query and notifications; their suites cover them.
vi.mock('@/components/layout/PhoneShellHeader', () => ({
  PhoneShellActions: () => <button type="button" aria-label="Notificações" />,
}));

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock('@/context/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/AuthContext')>();
  return { ...actual, useAuth: useAuthMock };
});

import TarefasPage from '../TarefasPage';
import type { TarefaWithRelations } from '../../../store';

const toDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = toDate(new Date());
const yesterday = toDate(new Date(Date.now() - 86_400_000));

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
    serie: null,
    ...overrides,
  };
}

function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <PhoneLayoutProvider isPhone>{children}</PhoneLayoutProvider>
    </QueryClientProvider>
  );
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/tarefas']}>
      <Providers>
        <TarefasPage />
      </Providers>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  getTarefasMock.mockReset().mockResolvedValue([]);
  getMembrosMock.mockReset().mockResolvedValue([]);
  getClientesMock.mockReset().mockResolvedValue([]);
  updateTarefaMock.mockReset().mockResolvedValue(undefined);
  deleteTarefaMock.mockReset().mockResolvedValue(undefined);
  deleteSerieMock.mockReset().mockResolvedValue(undefined);
  useAuthMock.mockReturnValue({ user: { id: 'user-1' }, profile: { conta_id: 'conta-1' } });
});

describe('TarefasPage on phones', () => {
  it('renders the page header with counts, the header buttons and the view picker; no stat tiles', async () => {
    getTarefasMock.mockResolvedValue([
      makeTarefa({ titulo: 'Atrasada', data_limite: yesterday }),
      makeTarefa({ titulo: 'Para hoje', data_limite: today }),
    ]);
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Tarefas', level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/2 abertas/)).toBeInTheDocument();
    expect(screen.getByText(/1 atrasada/)).toBeInTheDocument();
    expect(screen.getByText(/1 vence hoje/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buscar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filtros' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nova tarefa' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Visualização: Lista. Trocar visualização' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Concluídas hoje')).not.toBeInTheDocument();
    // Lista grouped by bucket.
    expect(screen.getByRole('heading', { name: /Atrasadas/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Hoje/ })).toBeInTheDocument();
  });

  it('shows the empty workspace state with Nova tarefa', async () => {
    renderPage();
    expect(
      await screen.findByText('Nenhuma tarefa ainda. Crie a primeira tarefa da equipe.'),
    ).toBeInTheDocument();
  });

  it('completes a task from the list circle', async () => {
    const user = userEvent.setup();
    const t = makeTarefa({ titulo: 'Atualizar bio' });
    getTarefasMock.mockResolvedValue([t]);
    renderPage();
    await screen.findByText('Atualizar bio');
    await user.click(screen.getByRole('checkbox', { name: 'Concluir tarefa' }));
    await waitFor(() =>
      expect(updateTarefaMock).toHaveBeenCalledWith(t.id, { status: 'concluida' }),
    );
  });

  it('Minhas/Todas filters by the linked membro', async () => {
    const user = userEvent.setup();
    getMembrosMock.mockResolvedValue([{ id: 7, nome: 'Ana', crm_user_id: 'user-1' }]);
    getTarefasMock.mockResolvedValue([
      makeTarefa({ titulo: 'Minha tarefa', responsavel_id: 7 }),
      makeTarefa({ titulo: 'De outro', responsavel_id: 99 }),
    ]);
    renderPage();
    await screen.findByText('Minha tarefa');
    await user.click(screen.getByRole('radio', { name: 'Minhas' }));
    expect(screen.queryByText('De outro')).not.toBeInTheDocument();
    expect(localStorage.getItem('tarefas_escopo_conta-1_user-1')).toBe('minhas');
  });

  it('Kanban renders one status column at a time and moves a card through its menu', async () => {
    const user = userEvent.setup();
    const a = makeTarefa({ titulo: 'Gravar bastidores' });
    const b = makeTarefa({ titulo: 'Revisar legendas', status: 'em_andamento' });
    getTarefasMock.mockResolvedValue([a, b]);
    renderPage();
    await screen.findByText('Gravar bastidores');

    await user.click(screen.getByRole('button', { name: /Visualização: Lista/ }));
    const views = await screen.findByRole('dialog', { name: 'Visualização' });
    await user.click(within(views).getByRole('button', { name: /Kanban/ }));

    const tabs = await screen.findByRole('tablist', { name: 'Status' });
    expect(within(tabs).getByRole('tab', { name: /A fazer/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // Only the active column is rendered.
    expect(screen.getByText('Gravar bastidores')).toBeInTheDocument();
    expect(screen.queryByText('Revisar legendas')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Mais ações de Gravar bastidores' }));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: /Mover para/ }));
    const picker = await screen.findByRole('dialog', { name: 'Mover para' });
    await user.click(within(picker).getByRole('button', { name: 'Em andamento' }));
    await waitFor(() =>
      expect(updateTarefaMock).toHaveBeenCalledWith(a.id, { status: 'em_andamento' }),
    );

    await user.click(within(tabs).getByRole('tab', { name: /Em andamento/ }));
    expect(screen.getByText('Revisar legendas')).toBeInTheDocument();
  });

  it('applies filters from the sheet and shows them as removable chips', async () => {
    const user = userEvent.setup();
    getTarefasMock.mockResolvedValue([
      makeTarefa({ titulo: 'Aberta' }),
      makeTarefa({ titulo: 'Andando', status: 'em_andamento' }),
    ]);
    renderPage();
    await screen.findByText('Aberta');
    await user.click(screen.getByRole('button', { name: 'Filtros' }));
    const sheet = await screen.findByRole('dialog', { name: 'Filtros' });
    await user.click(within(sheet).getByRole('button', { name: 'Em andamento' }));
    await user.click(within(sheet).getByRole('button', { name: 'Ver 1' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Filtros' })).toBeNull());

    expect(screen.queryByText('Aberta')).not.toBeInTheDocument();
    const chip = screen.getByRole('button', { name: 'Remover filtro Status: Em andamento' });
    expect(screen.getByRole('button', { name: 'Filtros, 1 ativo' })).toBeInTheDocument();
    await user.click(chip);
    expect(await screen.findByText('Aberta')).toBeInTheDocument();
  });

  it('opens the detail as a pushed screen and closes it with Voltar', async () => {
    const user = userEvent.setup();
    getTarefasMock.mockResolvedValue([makeTarefa({ titulo: 'Reunião de pauta' })]);
    renderPage();
    await user.click(await screen.findByText('Reunião de pauta'));
    const region = await screen.findByRole('region', { name: 'Tarefa: Reunião de pauta' });
    await user.click(within(region).getByRole('button', { name: 'Voltar para Tarefas' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: /Tarefa:/ })).toBeNull());
  });

  it('swipe Excluir on a series occurrence offers the series scope', async () => {
    const user = userEvent.setup();
    const serie = {
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
    const t = makeTarefa({ titulo: 'Responder DMs', data_limite: today, serie });
    getTarefasMock.mockResolvedValue([t]);
    renderPage();
    await screen.findByText('Responder DMs');
    // The swipe actions are real buttons (keyboard path); a click runs the action.
    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    const sheet = await screen.findByRole('dialog', { name: 'Excluir tarefa recorrente?' });
    await user.click(within(sheet).getByRole('button', { name: /^Somente esta/ }));
    await waitFor(() => expect(deleteTarefaMock).toHaveBeenCalledWith(t.id));
    expect(deleteSerieMock).not.toHaveBeenCalled();
  });
});

describe('TarefasPage on phones: history', () => {
  it('?tarefa= opens the detail screen and Back closes it, staying on /tarefas', async () => {
    const t = makeTarefa({ titulo: 'Deep link' });
    getTarefasMock.mockResolvedValue([t]);
    window.history.replaceState(null, '', `/tarefas?tarefa=${t.id}`);
    const router = createBrowserRouter([
      {
        path: '*',
        element: (
          <Providers>
            <TarefasPage />
          </Providers>
        ),
      },
    ]);
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole('region', { name: 'Tarefa: Deep link' })).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toBe(''));

    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByRole('region', { name: /Tarefa:/ })).toBeNull());
    expect(window.location.pathname).toBe('/tarefas');
    expect(screen.getByRole('heading', { name: 'Tarefas', level: 1 })).toBeInTheDocument();
  });
});
