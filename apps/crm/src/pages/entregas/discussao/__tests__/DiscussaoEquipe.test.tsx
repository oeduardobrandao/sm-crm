import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommentThreadWithComments, Membro, PostComment } from '@/store';
import type { UseDiscussaoResult } from '../useDiscussao';
import { setEditorText } from '@/test/mentionEditor';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock('@mesaas/app-lifecycle', () => ({
  useUnsavedWork: vi.fn(),
  trackUnsavedWork: vi.fn((p: Promise<unknown>) => p),
}));
vi.mock('@/lib/supabase');

const limitsMock = vi.hoisted(() => ({
  features: null as Record<string, boolean> | null,
  isUnlimited: false,
}));
vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({
    features: limitsMock.features,
    isUnlimited: limitsMock.isUnlimited,
    limits: null,
    isLoading: false,
  }),
}));
vi.mock('@/store/comments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/comments')>()),
  updatePostComment: vi.fn(async () => {}),
  deletePostComment: vi.fn(async () => {}),
  deleteCommentThread: vi.fn(async () => {}),
  resolveCommentThread: vi.fn(async () => {}),
}));
// MentionEditor's @-search loads these through useQuery; never reached in these tests.
vi.mock('@/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store')>()),
  getMembros: vi.fn(async () => []),
  getClientes: vi.fn(async () => []),
  getTarefas: vi.fn(async () => []),
}));

import { toast } from 'sonner';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import * as comments from '@/store/comments';
import { DiscussaoEquipe } from '../DiscussaoEquipe';

const ME = 'user-me';
const ANA = 'user-ana';
const BRUNO = 'user-bruno';

const workspaceUsers = [
  { id: ME, nome: 'Eu Mesmo', avatar_url: null },
  { id: ANA, nome: 'Ana Lima', avatar_url: null },
  { id: BRUNO, nome: 'Bruno Costa', avatar_url: null },
];
const membros: Membro[] = [];

const at = (h: number, m: number) => new Date(2026, 9, 21, h, m).toISOString();

function msg(id: number, threadId: number, author: string, content: string, when: string) {
  return {
    id,
    thread_id: threadId,
    author_id: author,
    content,
    created_at: when,
    updated_at: null,
  } satisfies PostComment;
}

function thread(
  id: number,
  over: Partial<CommentThreadWithComments> & { post_comments: PostComment[] },
): CommentThreadWithComments {
  return {
    id,
    post_id: 42,
    conta_id: 'ws',
    quoted_text: '',
    status: 'active',
    created_by: ANA,
    resolved_by: null,
    created_at: at(9, 0),
    resolved_at: null,
    field: 'geral',
    anchor_start: null,
    anchor_end: null,
    orphaned: false,
    ...over,
  };
}

const geral = (comments: PostComment[]) => thread(1, { post_comments: comments });

const GERAL_MSGS = [
  msg(
    10,
    1,
    ANA,
    'Primeira versão no ar. @[Bruno Costa](membro:2) a capa precisa da logo.',
    at(16, 20),
  ),
  msg(11, 1, ME, 'Minha mensagem', at(16, 30)),
  msg(12, 1, BRUNO, 'Logo aplicada.', at(17, 30)),
];

const passage = thread(5, {
  field: 'ig_caption',
  quoted_text: 'mesmo em dia nublado',
  created_by: BRUNO,
  created_at: at(17, 5),
  post_comments: [
    msg(20, 5, BRUNO, 'Vale citar o FPS 30 aqui?', at(17, 5)),
    msg(21, 5, ANA, 'Sim', at(17, 6)),
    msg(22, 5, BRUNO, 'Ok', at(17, 7)),
  ],
});

function fakeDiscussao(over: Partial<UseDiscussaoResult> = {}): UseDiscussaoResult {
  return {
    participacao: { seguindo: true, lastSeenCommentId: 0, implicito: false },
    isParticipant: true,
    naoLidas: 0,
    unreadAnchorId: null,
    send: vi.fn(async () => {}),
    sending: false,
    toggleSeguir: vi.fn(async () => {}),
    sectionRef: vi.fn(),
    ...over,
  };
}

let qc: QueryClient;
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}

function setup(
  over: {
    discussao?: Partial<UseDiscussaoResult>;
    threads?: CommentThreadWithComments[];
    chatBridge?: ReactNode;
  } = {},
) {
  const discussao = fakeDiscussao(over.discussao);
  const onThreadClick = vi.fn();
  const props = {
    discussao,
    threads: over.threads ?? [geral(GERAL_MSGS), passage],
    membros,
    workspaceUsers,
    currentUserId: ME,
    onThreadClick,
    chatBridge: over.chatBridge,
  };
  const utils = render(<DiscussaoEquipe {...props} />, { wrapper: Wrapper });
  return { ...utils, discussao, onThreadClick, props };
}

const composer = () =>
  screen.getByRole('textbox', { name: 'Escreva para a equipe. Use @ para mencionar.' });

beforeEach(() => {
  vi.clearAllMocks();
  limitsMock.features = { feature_team_chat: false };
  limitsMock.isUnlimited = false;
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DiscussaoEquipe header', () => {
  it('shows the title and the team-only badge', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Discussão da equipe' })).toBeInTheDocument();
    expect(screen.getByText('Só a equipe vê')).toBeInTheDocument();
  });

  it('labels the bell "Seguindo" when following and toggles on click', () => {
    const { discussao } = setup();
    const bell = screen.getByRole('button', { name: 'Seguindo' });
    // The label carries the state; aria-pressed on top would read "Seguindo, pressed".
    expect(bell).not.toHaveAttribute('aria-pressed');
    fireEvent.click(bell);
    expect(discussao.toggleSeguir).toHaveBeenCalledTimes(1);
  });

  it('labels the bell "Seguir" when not following', () => {
    setup({
      discussao: {
        isParticipant: false,
        participacao: { seguindo: false, lastSeenCommentId: 0, implicito: false },
      },
    });
    expect(screen.getByRole('button', { name: 'Seguir' })).toBeInTheDocument();
  });

  it('shows no bell until participation loads (no "Seguir" flash for followers)', () => {
    setup({ discussao: { participacao: undefined, isParticipant: false } });
    expect(screen.queryByRole('button', { name: /^Segui/ })).toBeNull();
  });

  it('hides the chat bridge without feature_team_chat (and while limits are unknown)', () => {
    const bridge = <button type="button">Discutir no chat</button>;
    const { unmount } = setup({ chatBridge: bridge });
    expect(screen.queryByRole('button', { name: 'Discutir no chat' })).toBeNull();
    unmount();
    limitsMock.features = null;
    setup({ chatBridge: bridge });
    expect(screen.queryByRole('button', { name: 'Discutir no chat' })).toBeNull();
  });

  it('shows the chat bridge with feature_team_chat or on an unlimited workspace', () => {
    const bridge = <button type="button">Discutir no chat</button>;
    limitsMock.features = { feature_team_chat: true };
    const { unmount } = setup({ chatBridge: bridge });
    expect(screen.getByRole('button', { name: 'Discutir no chat' })).toBeInTheDocument();
    unmount();
    limitsMock.features = null;
    limitsMock.isUnlimited = true;
    setup({ chatBridge: bridge });
    expect(screen.getByRole('button', { name: 'Discutir no chat' })).toBeInTheDocument();
  });
});

describe('DiscussaoEquipe read-marker target', () => {
  it('observes the composer area, not the whole (unbounded) panel', () => {
    const { discussao } = setup();
    const observed = vi
      .mocked(discussao.sectionRef)
      .mock.calls.map(([el]) => el)
      .filter((el): el is HTMLElement => el instanceof HTMLElement)
      .at(-1);
    expect(observed).toBeDefined();
    expect(observed).toContainElement(composer());
    expect(observed).not.toContainElement(screen.getByTestId('discussao-message-10'));
  });
});

describe('DiscussaoEquipe timeline', () => {
  it('renders messages with author, time and mention chips', () => {
    setup();
    const row = screen.getByTestId('discussao-message-10');
    expect(within(row).getByText('Ana Lima')).toBeInTheDocument();
    expect(within(row).getByText('16:20')).toBeInTheDocument();
    expect(within(row).getByText('@Bruno Costa')).toHaveClass('mention-chip');
  });

  it('renders a passage thread as a card with the quote and the reply count', () => {
    const { onThreadClick } = setup();
    const card = screen.getByRole('button', { name: /comentou no trecho/ });
    expect(within(card).getByText('“mesmo em dia nublado”')).toBeInTheDocument();
    expect(within(card).getByText('2 respostas')).toBeInTheDocument();
    fireEvent.click(within(card).getByText('Ver no texto'));
    expect(onThreadClick).toHaveBeenCalledWith(5);
  });

  it('shows "N novas" instead of the reply count for unread replies', () => {
    setup({ discussao: { unreadAnchorId: 21 } });
    const card = screen.getByRole('button', { name: /comentou no trecho/ });
    expect(within(card).getByText('1 nova')).toBeInTheDocument();
    expect(within(card).queryByText('2 respostas')).toBeNull();
  });

  it('pluralises "novas"', () => {
    setup({ discussao: { unreadAnchorId: 0 } });
    const card = screen.getByRole('button', { name: /comentou no trecho/ });
    // ids 20 and 22 are Bruno's, 21 is Ana's: all three are from others.
    expect(within(card).getByText('3 novas')).toBeInTheDocument();
  });

  it('still renders a passage thread with no comments', () => {
    setup({
      threads: [thread(6, { field: 'conteudo', quoted_text: 'trecho vazio', post_comments: [] })],
    });
    expect(screen.getByText('“trecho vazio”')).toBeInTheDocument();
    expect(screen.getByText('Ver no texto')).toBeInTheDocument();
  });

  it('does not render the general thread as a card', () => {
    setup({ threads: [geral(GERAL_MSGS)] });
    expect(screen.queryByText('Ver no texto')).toBeNull();
  });

  it('collapses resolved passage threads into one expandable row', () => {
    const resolved = thread(7, {
      field: 'conteudo',
      status: 'resolved',
      quoted_text: 'já resolvido',
      post_comments: [msg(30, 7, ANA, 'feito', at(10, 0))],
    });
    setup({ threads: [geral(GERAL_MSGS), resolved] });
    const toggle = screen.getByRole('button', { name: '1 comentário no texto resolvido' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('“já resolvido”')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('“já resolvido”')).toBeInTheDocument();
  });

  it('shows the "Não lidas" divider before the first unread message of others', () => {
    setup({ discussao: { unreadAnchorId: 11 } });
    const divider = screen.getByText('Não lidas');
    const next = screen.getByTestId('discussao-message-12');
    expect(divider.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const before = screen.getByTestId('discussao-message-11');
    expect(divider.compareDocumentPosition(before) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('names the separators so assistive tech reads "Não lidas" and the day', () => {
    setup({ discussao: { unreadAnchorId: 11 } });
    expect(screen.getByRole('separator', { name: 'Não lidas' })).toBeInTheDocument();
    const days = screen
      .getAllByRole('separator')
      .filter((el) => el !== screen.getByRole('separator', { name: 'Não lidas' }));
    expect(days.length).toBeGreaterThan(0);
    for (const d of days) expect(d).toHaveAccessibleName(d.textContent ?? '');
  });

  it('shows no "Não lidas" divider for non-participants (null anchor)', () => {
    setup({ discussao: { unreadAnchorId: null, isParticipant: false } });
    expect(screen.queryByText('Não lidas')).toBeNull();
  });
});

describe('DiscussaoEquipe composer', () => {
  it('keeps the editor editable while a send is in flight', () => {
    setup({ discussao: { sending: true } });
    expect(composer()).toHaveAttribute('contenteditable', 'true');
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
  });

  it('focus stays on the editor after an Enter send', async () => {
    const { discussao } = setup();
    act(() => composer().focus());
    setEditorText(composer(), 'primeira');
    fireEvent.keyDown(composer(), { key: 'Enter' });
    await waitFor(() => expect(discussao.send).toHaveBeenCalledWith('primeira'));
    await waitFor(() => expect(composer().textContent).toBe(''));
    expect(composer()).toHaveFocus();
  });

  it('brings focus back to the editor after a send from the button', async () => {
    const { discussao } = setup();
    setEditorText(composer(), 'pelo botão');
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(discussao.send).toHaveBeenCalledWith('pelo botão'));
    await waitFor(() => expect(composer()).toHaveFocus());
  });

  it('keeps what was typed while the send was in flight', async () => {
    let finish: () => void = () => {};
    const { discussao } = setup({
      discussao: {
        send: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              finish = resolve;
            }),
        ),
      },
    });
    setEditorText(composer(), 'um');
    fireEvent.keyDown(composer(), { key: 'Enter' });
    await waitFor(() => expect(discussao.send).toHaveBeenCalledWith('um'));
    setEditorText(composer(), 'um dois');
    await act(async () => finish());
    await waitFor(() => expect(composer().textContent).toBe('dois'));
  });

  it('Enter sends the trimmed text and clears the draft', async () => {
    const { discussao } = setup();
    setEditorText(composer(), '  Revisei tudo.  ');
    fireEvent.keyDown(composer(), { key: 'Enter' });
    await waitFor(() => expect(discussao.send).toHaveBeenCalledWith('Revisei tudo.'));
    await waitFor(() => expect(composer().textContent).toBe(''));
  });

  it('Shift+Enter does not send', () => {
    const { discussao } = setup();
    setEditorText(composer(), 'linha');
    fireEvent.keyDown(composer(), { key: 'Enter', shiftKey: true });
    expect(discussao.send).not.toHaveBeenCalled();
  });

  it('does not send while an IME composition is in progress', () => {
    const { discussao } = setup();
    setEditorText(composer(), 'かな');
    fireEvent.keyDown(composer(), { key: 'Enter', isComposing: true });
    expect(discussao.send).not.toHaveBeenCalled();
  });

  it('disables send for an empty or whitespace-only draft', () => {
    setup();
    const send = screen.getByRole('button', { name: 'Enviar' });
    expect(send).toBeDisabled();
    setEditorText(composer(), '   ');
    expect(send).toBeDisabled();
    setEditorText(composer(), 'ok');
    expect(send).toBeEnabled();
  });

  it('blocks a message over 4000 characters with a visible hint', () => {
    const { discussao } = setup();
    setEditorText(composer(), 'a'.repeat(4001));
    expect(screen.getByRole('alert')).toHaveTextContent('4000 caracteres');
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
    fireEvent.keyDown(composer(), { key: 'Enter' });
    expect(discussao.send).not.toHaveBeenCalled();
  });

  it('keeps the text and toasts when sending fails', async () => {
    const { discussao } = setup({
      discussao: { send: vi.fn(async () => Promise.reject(new Error('boom'))) },
    });
    setEditorText(composer(), 'não vai');
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Não foi possível enviar. Tente novamente.'),
    );
    expect(discussao.send).toHaveBeenCalledWith('não vai');
    expect(composer().textContent).toBe('não vai');
  });

  it('registers unsaved work while the draft is not empty', () => {
    setup();
    expect(vi.mocked(useUnsavedWork)).not.toHaveBeenCalledWith(true);
    setEditorText(composer(), 'rascunho');
    // Message rows call the hook too (for their own edits), so look for any `true`.
    expect(vi.mocked(useUnsavedWork)).toHaveBeenCalledWith(true);
  });

  it('registers unsaved work while a send is in flight', () => {
    setup({ discussao: { sending: true } });
    expect(vi.mocked(useUnsavedWork)).toHaveBeenCalledWith(true);
  });
});

describe('DiscussaoEquipe own messages', () => {
  it('offers edit and delete only on my own messages', () => {
    setup();
    const mine = screen.getByTestId('discussao-message-11');
    expect(within(mine).getByRole('button', { name: 'Editar mensagem' })).toBeInTheDocument();
    expect(within(mine).getByRole('button', { name: 'Excluir mensagem' })).toBeInTheDocument();
    const theirs = screen.getByTestId('discussao-message-10');
    expect(within(theirs).queryByRole('button', { name: 'Editar mensagem' })).toBeNull();
  });

  it('edit: Salvar is disabled for empty text and saves through the comment update', async () => {
    setup();
    const mine = screen.getByTestId('discussao-message-11');
    fireEvent.click(within(mine).getByRole('button', { name: 'Editar mensagem' }));
    const editor = within(mine).getByRole('textbox', { name: 'Editar mensagem' });
    const salvar = within(mine).getByRole('button', { name: 'Salvar' });
    setEditorText(editor, '   ');
    expect(salvar).toBeDisabled();
    setEditorText(editor, 'Mensagem corrigida');
    expect(salvar).toBeEnabled();
    fireEvent.click(salvar);
    await waitFor(() =>
      expect(comments.updatePostComment).toHaveBeenCalledWith(11, 'Mensagem corrigida'),
    );
  });

  it('delete asks "Excluir mensagem?" and deletes only the comment, never the thread', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    setup();
    const mine = screen.getByTestId('discussao-message-11');
    fireEvent.click(within(mine).getByRole('button', { name: 'Excluir mensagem' }));
    expect(confirm).toHaveBeenCalledWith('Excluir mensagem?');
    await waitFor(() => expect(comments.deletePostComment).toHaveBeenCalledWith(11));
    expect(comments.deleteCommentThread).not.toHaveBeenCalled();
  });

  it('does not delete when the confirmation is cancelled', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    setup();
    const mine = screen.getByTestId('discussao-message-11');
    fireEvent.click(within(mine).getByRole('button', { name: 'Excluir mensagem' }));
    expect(comments.deletePostComment).not.toHaveBeenCalled();
  });

  it('deleting the last message leaves only the composer', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const only = msg(11, 1, ME, 'Só esta', at(16, 30));
    const { rerender, props } = setup({ threads: [geral([only])] });
    fireEvent.click(screen.getByRole('button', { name: 'Excluir mensagem' }));
    await waitFor(() => expect(comments.deletePostComment).toHaveBeenCalledWith(11));
    expect(comments.deleteCommentThread).not.toHaveBeenCalled();
    // The refetch brings the general thread back with no comments.
    await act(async () => {
      rerender(<DiscussaoEquipe {...props} threads={[geral([])]} />);
    });
    expect(screen.queryByTestId('discussao-message-11')).toBeNull();
    expect(document.querySelector('.discussao-timeline')).toBeNull();
    expect(composer()).toBeInTheDocument();
  });
});
