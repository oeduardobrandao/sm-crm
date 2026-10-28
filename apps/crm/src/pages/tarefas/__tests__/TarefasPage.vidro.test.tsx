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

// Desktop layout (the phone branch has its own suite); jsdom's matchMedia reports false.
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));
// The comments section has its own suite (TarefaComentarios.test.tsx).
vi.mock('../components/TarefaComentarios', () => ({
  TarefaComentarios: () => <section id="tarefa-comentarios" />,
}));

import TarefasPage from '../TarefasPage';
import { VidroToolbarHarness } from '@/test/vidroToolbar';
import * as store from '../../../store';
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
    comentarios_total: 0,
    cliente_nome: null,
    cliente_cor: null,
    serie: null,
    ...overrides,
  };
}

function renderPage(vidroShell: boolean) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/tarefas']}>
        <VidroToolbarHarness vidroShell={vidroShell}>
          <TarefasPage />
        </VidroToolbarHarness>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TarefasPage in the Vidro toolbar', () => {
  beforeEach(() => {
    localStorage.clear();
    getTarefasMock.mockReset().mockResolvedValue([]);
    getMembrosMock.mockReset().mockResolvedValue([]);
    // vitest.setup.ts restores mocks after each test, wiping the factory's resolved values.
    vi.mocked(store.getTarefaTags).mockResolvedValue([]);
    vi.mocked(store.getClientes).mockResolvedValue([]);
    useAuthMock.mockReturnValue({ user: { id: 'user-1' }, profile: { conta_id: 'conta-1' } });
    getMembrosMock.mockResolvedValue([{ id: 7, nome: 'Ana', crm_user_id: 'user-1' }]);
    getTarefasMock.mockResolvedValue([
      makeTarefa({ titulo: 'Minha tarefa', responsavel_id: 7 }),
      makeTarefa({ titulo: 'Tarefa de outro membro', responsavel_id: 99 }),
    ]);
  });

  it('puts the title, counts and primary action in the toolbar, once', async () => {
    renderPage(true);

    const h1s = await screen.findAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0].closest('.vidro-toolbar')).not.toBeNull();
    expect(h1s[0]).toHaveTextContent('Tarefas');

    const toolbar = document.querySelector('.vidro-toolbar') as HTMLElement;
    expect(toolbar).toHaveTextContent(/2 abertas/);
    const novas = screen.getAllByRole('button', { name: /Nova tarefa/ });
    expect(novas).toHaveLength(1);
    expect(novas[0].closest('.vidro-toolbar')).not.toBeNull();
    expect(document.querySelector('.header.animate-up')).toBeNull();
  });

  it('renders the scope switch once, inside the toolbar, as a .vidro-seg', async () => {
    renderPage(true);

    const minhas = await screen.findByRole('button', { name: 'Minhas tarefas' });
    expect(screen.getAllByRole('button', { name: 'Minhas tarefas' })).toHaveLength(1);
    expect(minhas.closest('.vidro-toolbar')).not.toBeNull();
    const seg = minhas.closest('.vidro-seg');
    expect(seg).not.toBeNull();
    expect(minhas).toHaveClass('vidro-seg-btn');
    expect(minhas).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Todas as tarefas' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(minhas).not.toHaveAttribute('style');
  });

  it('the scope switch still filters and updates aria-pressed', async () => {
    const ue = userEvent.setup();
    renderPage(true);
    await screen.findByText('Minha tarefa');
    expect(screen.getByText('Tarefa de outro membro')).toBeInTheDocument();

    await ue.click(screen.getByRole('button', { name: 'Minhas tarefas' }));

    expect(screen.queryByText('Tarefa de outro membro')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Minhas tarefas' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('renders the view tabs in content as .vidro-seg without inline backgrounds, and switching works', async () => {
    const ue = userEvent.setup();
    renderPage(true);
    await screen.findByText('Minha tarefa');

    const lista = screen.getByRole('button', { name: /Lista/ });
    const kanban = screen.getByRole('button', { name: /Kanban/ });
    expect(lista.closest('.vidro-toolbar')).toBeNull();
    expect(lista.closest('.vidro-seg')).not.toBeNull();
    expect(lista).toHaveClass('vidro-seg-btn');
    expect(lista).not.toHaveAttribute('style');
    expect(lista).toHaveAttribute('aria-pressed', 'true');
    expect(kanban).toHaveAttribute('aria-pressed', 'false');

    await ue.click(kanban);

    expect(screen.getByRole('button', { name: /Kanban/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Lista/ })).toHaveAttribute('aria-pressed', 'false');
    // StatusKanbanView renders its fixed status columns.
    expect(
      screen.queryByText('Nenhuma tarefa ainda. Crie a primeira tarefa da equipe.'),
    ).toBeNull();
  });

  it('flag off: keeps the in-page header and the inline-styled switchers', async () => {
    renderPage(false);

    const h1s = await screen.findAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0].closest('.header')).not.toBeNull();
    expect(h1s[0]).toHaveTextContent('Tarefas');
    expect(document.querySelector('.vidro-toolbar')).toBeNull();
    expect(document.querySelector('.vidro-seg')).toBeNull();

    const minhas = screen.getByRole('button', { name: 'Minhas tarefas' });
    expect(minhas).toHaveAttribute('style');
    expect(minhas).not.toHaveAttribute('aria-pressed');
    expect(screen.getAllByRole('button', { name: /Nova tarefa/ })).toHaveLength(1);
  });
});
