import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Membro, TarefaComentario } from '@/store';
import { setEditorText } from '@/test/mentionEditor';

const store = vi.hoisted(() => ({
  getTarefaComentarios: vi.fn(),
  enviarTarefaComentario: vi.fn(),
  updateTarefaComentario: vi.fn(),
  deleteTarefaComentario: vi.fn(),
  getWorkspaceUsers: vi.fn(),
}));

vi.mock('@/lib/supabase');
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
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
const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock('@/context/AuthContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/context/AuthContext')>()),
  useAuth: useAuthMock,
}));
vi.mock('@/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store')>()),
  ...store,
  // MentionEditor's @-search loads these through useQuery; never reached in these tests.
  getMembros: vi.fn(async () => []),
  getClientes: vi.fn(async () => []),
  getTarefas: vi.fn(async () => []),
}));
// Radix DropdownMenu does not open under jsdom (same stub as TarefaDetailSheet.test.tsx).
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
    onSelect,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    onSelect?: () => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        onClick?.();
        onSelect?.();
      }}
    >
      {children}
    </button>
  ),
}));

import { useUnsavedWork } from '@mesaas/app-lifecycle';
import * as supabaseMock from '@/lib/supabase';
import { TarefaComentarios } from '../components/TarefaComentarios';

const removedChannelCalls = (supabaseMock as unknown as { removedChannelCalls: unknown[] })
  .removedChannelCalls;
const resetSupabase = (supabaseMock as unknown as { __resetSupabaseMock: () => void })
  .__resetSupabaseMock;
const getChannelCalls = (supabaseMock as unknown as { __getChannelCalls: () => string[] })
  .__getChannelCalls;

const ME = 'user-me';
const ANA = 'user-ana';

const membros = [
  { id: 5, nome: 'Ana Membro', crm_user_id: ANA, avatar_url: null },
] as unknown as Membro[];

function comentario(overrides: Partial<TarefaComentario>): TarefaComentario {
  return {
    id: 1,
    conta_id: 'conta-1',
    tarefa_id: 42,
    author_id: ME,
    conteudo: 'Oi',
    created_at: new Date().toISOString(),
    edited_at: null,
    ...overrides,
  };
}

function renderComentarios(props: Partial<React.ComponentProps<typeof TarefaComentarios>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TarefaComentarios tarefaId={42} membros={membros} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, qc };
}

function composer(): HTMLElement {
  const root = document.querySelector('#tarefa-comentarios .discussao-composer');
  const editable = root?.querySelector('[contenteditable="true"]');
  if (!editable) throw new Error('composer not found');
  return editable as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetSupabase();
  useAuthMock.mockReturnValue({ user: { id: ME }, profile: { conta_id: 'conta-1' } });
  store.getTarefaComentarios.mockResolvedValue([]);
  store.enviarTarefaComentario.mockResolvedValue(comentario({ id: 99 }));
  store.updateTarefaComentario.mockResolvedValue(undefined);
  store.deleteTarefaComentario.mockResolvedValue(undefined);
  store.getWorkspaceUsers.mockResolvedValue([
    { id: ME, nome: 'Eu Mesmo', avatar_url: null },
    { id: ANA, nome: 'Ana Lima', avatar_url: null },
  ]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TarefaComentarios', () => {
  it('renders comments with day dividers', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    store.getTarefaComentarios.mockResolvedValue([
      comentario({ id: 1, conteudo: 'Ontem eu disse', created_at: yesterday, author_id: ANA }),
      comentario({ id: 2, conteudo: 'Hoje eu digo', edited_at: new Date().toISOString() }),
    ]);
    renderComentarios();

    expect(await screen.findByText('Ontem eu disse')).toBeInTheDocument();
    expect(screen.getByText('Hoje eu digo')).toBeInTheDocument();
    const dividers = screen.getAllByRole('separator').map((el) => el.textContent);
    expect(dividers).toEqual(['Ontem', 'Hoje']);
    // Workspace users win over membros for the author name (same order as the post discussion).
    expect(await screen.findByText('Ana Lima')).toBeInTheDocument();
    expect(screen.getByText('(editado)')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Comentários/ })).toHaveTextContent('2');
    expect(document.getElementById('tarefa-comentarios')).not.toBeNull();
  });

  it('send calls enviarTarefaComentario and clears the editor', async () => {
    renderComentarios();
    await screen.findByText('Nenhum comentário ainda. Use @ para mencionar alguém.');

    setEditorText(composer(), 'Pode revisar @[Ana Membro](membro:5)?');
    expect(useUnsavedWork).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Enviar comentário' }));

    await waitFor(() =>
      expect(store.enviarTarefaComentario).toHaveBeenCalledWith(
        42,
        'Pode revisar @[Ana Membro](membro:5)?',
      ),
    );
    await waitFor(() => expect(composer().textContent).toBe(''));
    // The list refetches after the send.
    await waitFor(() => expect(store.getTarefaComentarios).toHaveBeenCalledTimes(2));
  });

  it('a failed send keeps the text and toasts', async () => {
    const { toast } = await import('sonner');
    store.enviarTarefaComentario.mockRejectedValueOnce(new Error('boom'));
    renderComentarios();
    await screen.findByText('Nenhum comentário ainda. Use @ para mencionar alguém.');

    setEditorText(composer(), 'Texto importante');
    fireEvent.click(screen.getByRole('button', { name: 'Enviar comentário' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Não foi possível enviar o comentário. Tente novamente.',
      ),
    );
    expect(composer().textContent).toBe('Texto importante');
  });

  it('author sees Editar/Excluir, others do not', async () => {
    store.getTarefaComentarios.mockResolvedValue([
      comentario({ id: 1, author_id: ANA, conteudo: 'Da Ana' }),
      comentario({ id: 2, author_id: ME, conteudo: 'Meu' }),
    ]);
    renderComentarios();
    await screen.findByText('Meu');

    const mine = screen.getByTestId('tarefa-comentario-2');
    const theirs = screen.getByTestId('tarefa-comentario-1');
    expect(within(mine).getByRole('button', { name: 'Editar' })).toBeInTheDocument();
    expect(within(mine).getByRole('button', { name: 'Excluir' })).toBeInTheDocument();
    expect(within(theirs).queryByRole('button', { name: 'Editar' })).toBeNull();
    expect(within(theirs).queryByRole('button', { name: 'Excluir' })).toBeNull();
    expect(within(theirs).queryByRole('button', { name: 'Ações do comentário' })).toBeNull();
  });

  it('edits inline and saves through updateTarefaComentario', async () => {
    store.getTarefaComentarios.mockResolvedValue([comentario({ id: 2, conteudo: 'Meu texto' })]);
    renderComentarios();
    await screen.findByText('Meu texto');

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const editor = screen
      .getByTestId('tarefa-comentario-2')
      .querySelector('[contenteditable="true"]') as HTMLElement;
    setEditorText(editor, 'Meu texto novo');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(store.updateTarefaComentario).toHaveBeenCalledWith(2, 'Meu texto novo'),
    );
  });

  it('delete asks for confirmation', async () => {
    store.getTarefaComentarios.mockResolvedValue([comentario({ id: 2, conteudo: 'Apagar' })]);
    renderComentarios();
    await screen.findByText('Apagar');

    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Excluir comentário?')).toBeInTheDocument();
    expect(store.deleteTarefaComentario).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }));
    await waitFor(() => expect(store.deleteTarefaComentario).toHaveBeenCalledWith(2));
    // The thread refetches after the delete.
    await waitFor(() => expect(store.getTarefaComentarios).toHaveBeenCalledTimes(2));
  });

  it('empty state copy', async () => {
    renderComentarios();
    expect(
      await screen.findByText('Nenhum comentário ainda. Use @ para mencionar alguém.'),
    ).toBeInTheDocument();
  });

  it('unknown author shows Usuário removido', async () => {
    store.getTarefaComentarios.mockResolvedValue([
      comentario({ id: 1, author_id: null, conteudo: 'Sem dono' }),
      comentario({ id: 2, author_id: 'user-ghost', conteudo: 'Fantasma' }),
    ]);
    renderComentarios();
    await screen.findByText('Sem dono');
    await waitFor(() => expect(screen.getAllByText('Usuário removido')).toHaveLength(2));
  });

  it('falls back to the membro name when the author is not a workspace user', async () => {
    store.getWorkspaceUsers.mockResolvedValue([]);
    store.getTarefaComentarios.mockResolvedValue([
      comentario({ id: 1, author_id: ANA, conteudo: 'Oi' }),
    ]);
    renderComentarios();
    expect(await screen.findByText('Ana Membro')).toBeInTheDocument();
  });

  it('names the viewer from their own profile when the roster query fails', async () => {
    store.getWorkspaceUsers.mockRejectedValue(new Error('schema cache'));
    useAuthMock.mockReturnValue({
      user: { id: ME },
      profile: { conta_id: 'conta-1', nome: 'Seed Dono', avatar_url: null },
    });
    store.getTarefaComentarios.mockResolvedValue([
      comentario({ id: 1, author_id: ME, conteudo: 'Meu comentário' }),
    ]);
    renderComentarios();
    expect(await screen.findByText('Seed Dono')).toBeInTheDocument();
    expect(screen.queryByText('Usuário removido')).not.toBeInTheDocument();
  });

  it('realtime channel removed on unmount', async () => {
    const { unmount } = renderComentarios();
    await screen.findByText('Nenhum comentário ainda. Use @ para mencionar alguém.');
    const topics = getChannelCalls();
    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatch(/^tarefa-comentarios-42-\d+$/);
    expect(removedChannelCalls).toHaveLength(0);

    unmount();
    expect(removedChannelCalls).toHaveLength(1);
  });

  it('uses a fresh topic on every mount', async () => {
    const first = renderComentarios();
    await screen.findByText('Nenhum comentário ainda. Use @ para mencionar alguém.');
    first.unmount();
    renderComentarios();
    await screen.findByText('Nenhum comentário ainda. Use @ para mencionar alguém.');
    const [a, b] = getChannelCalls();
    expect(a).not.toBe(b);
  });

  it('refetches when the window regains focus', async () => {
    renderComentarios();
    await screen.findByText('Nenhum comentário ainda. Use @ para mencionar alguém.');
    expect(store.getTarefaComentarios).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(store.getTarefaComentarios).toHaveBeenCalledTimes(2));
  });

  it('shows the counter near the cap', async () => {
    renderComentarios();
    await screen.findByText('Nenhum comentário ainda. Use @ para mencionar alguém.');
    setEditorText(composer(), 'x'.repeat(3700));
    expect(screen.getByText('3700/4000')).toBeInTheDocument();
  });
});
