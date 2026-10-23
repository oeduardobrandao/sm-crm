import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommentThreadWithComments, PostApproval, PostComment } from '@/store';
import type { UseDiscussaoResult } from '../../../discussao/useDiscussao';
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
  reopenCommentThread: vi.fn(async () => {}),
}));
// MentionEditor's @-search loads these through useQuery; never reached in these tests.
vi.mock('@/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store')>()),
  getMembros: vi.fn(async () => []),
  getClientes: vi.fn(async () => []),
  getTarefas: vi.fn(async () => []),
}));

import * as comments from '@/store/comments';
import { PhoneComments } from '../PhoneComments';
import { makeNote } from '../../mediaNotes/__tests__/fixtures';

const ME = 'user-me';
const ANA = 'user-ana';
const workspaceUsers = [
  { id: ME, nome: 'Eu Mesmo', avatar_url: null },
  { id: ANA, nome: 'Ana Lima', avatar_url: null },
];

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

const GERAL = thread(1, {
  post_comments: [
    msg(10, 1, ANA, 'Primeira versão no ar.', at(16, 20)),
    msg(11, 1, ME, 'Minha mensagem', at(16, 30)),
  ],
});

function approval(id: number, team: boolean, when: string): PostApproval {
  return {
    id,
    post_id: 42,
    token: 't',
    action: 'mensagem',
    comentario: team ? 'Resposta da equipe' : 'Mensagem do cliente',
    is_workspace_user: team,
    author_user_id: team ? ME : null,
    media_note_ids: [],
    created_at: when,
  };
}

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

type Props = Partial<React.ComponentProps<typeof PhoneComments>>;

function build(over: Props = {}, discussao: UseDiscussaoResult = fakeDiscussao()) {
  return {
    postId: 42,
    currentUserId: ME,
    discussao,
    approvals: [],
    notes: [],
    media: [],
    onNoteReply: vi.fn(async () => {}),
    onNoteStatus: vi.fn(async () => {}),
    references: [],
    onOpenReference: vi.fn(),
    clientName: 'Padaria Sol',
    replyText: '',
    sendingReply: false,
    onReplyChange: vi.fn(),
    onReplySend: vi.fn(),
    threads: [GERAL],
    membros: [],
    workspaceUsers,
    onThreadClick: vi.fn(),
    suggestion: null,
    active: true,
    ...over,
  } satisfies React.ComponentProps<typeof PhoneComments>;
}

function setup(over: Props = {}, discussaoOver: Partial<UseDiscussaoResult> = {}) {
  const discussao = fakeDiscussao(discussaoOver);
  const props = build(over, discussao);
  const utils = render(<PhoneComments {...props} />, { wrapper: Wrapper });
  return { ...utils, discussao, props };
}

const equipePill = () => screen.getByRole('button', { name: /^Equipe/ });
const clientePill = () => screen.getByRole('button', { name: 'Cliente' });
const teamComposer = () =>
  screen.getByRole('textbox', { name: 'Mensagem para a equipe', hidden: true });
const clientComposer = () => screen.getByPlaceholderText('Responder ao cliente…');

beforeEach(() => {
  vi.clearAllMocks();
  limitsMock.features = { feature_team_chat: false };
  limitsMock.isUnlimited = false;
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PhoneComments pills', () => {
  it('labels Equipe with the unread count and keeps Cliente plain', () => {
    setup({}, { naoLidas: 3 });
    expect(equipePill()).toHaveTextContent('Equipe · 3 novas');
    expect(clientePill()).toHaveTextContent('Cliente');
  });

  it('says "1 nova" for a single unread message and plain "Equipe" for none', () => {
    const { unmount } = setup({}, { naoLidas: 1 });
    expect(equipePill()).toHaveTextContent('Equipe · 1 nova');
    unmount();
    setup({}, { naoLidas: 0 });
    expect(equipePill()).toHaveTextContent(/^Equipe$/);
  });
});

describe('PhoneComments initial pill', () => {
  it('opens on Equipe when the team has unread messages', () => {
    setup({ approvals: [approval(1, false, at(9, 0))] }, { naoLidas: 2 });
    expect(equipePill()).toHaveAttribute('aria-pressed', 'true');
    expect(clientePill()).toHaveAttribute('aria-pressed', 'false');
  });

  it('opens on Cliente when nothing is unread and the newest approval is the client', () => {
    setup({ approvals: [approval(1, true, at(9, 0)), approval(2, false, at(10, 0))] });
    expect(clientePill()).toHaveAttribute('aria-pressed', 'true');
  });

  it('judges the newest approval by date, not by array position', () => {
    setup({ approvals: [approval(2, false, at(10, 0)), approval(1, true, at(11, 0))] });
    expect(equipePill()).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens on Equipe when the newest approval is from the team or there is none', () => {
    const { unmount } = setup({
      approvals: [approval(1, false, at(9, 0)), approval(2, true, at(10, 0))],
    });
    expect(equipePill()).toHaveAttribute('aria-pressed', 'true');
    unmount();
    setup({ approvals: [] });
    expect(equipePill()).toHaveAttribute('aria-pressed', 'true');
  });

  it('re-decides once when the participation loads after mount, then never again', () => {
    const approvals = [approval(1, false, at(9, 0))];
    const loading = fakeDiscussao({ participacao: undefined, isParticipant: false });
    const { rerender } = render(<PhoneComments {...build({ approvals }, loading)} />, {
      wrapper: Wrapper,
    });
    expect(clientePill()).toHaveAttribute('aria-pressed', 'true');

    const loaded = fakeDiscussao({ naoLidas: 2 });
    rerender(<PhoneComments {...build({ approvals }, loaded)} />);
    expect(equipePill()).toHaveAttribute('aria-pressed', 'true');

    // Reading the messages drops the count to 0; the user stays where they are.
    rerender(<PhoneComments {...build({ approvals }, fakeDiscussao({ naoLidas: 0 }))} />);
    expect(equipePill()).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not yank the user away from a pill they picked', () => {
    const approvals = [approval(1, false, at(9, 0))];
    const loading = fakeDiscussao({ participacao: undefined, isParticipant: false });
    const { rerender } = render(<PhoneComments {...build({ approvals }, loading)} />, {
      wrapper: Wrapper,
    });
    fireEvent.click(clientePill());
    rerender(<PhoneComments {...build({ approvals }, fakeDiscussao({ naoLidas: 5 }))} />);
    expect(clientePill()).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('PhoneComments discussao=1 deep link', () => {
  const clientNewest = [approval(1, true, at(9, 0)), approval(2, false, at(10, 0))];

  it('opens on Equipe even though the newest message is the client, without focusing', () => {
    setup({ approvals: clientNewest, focusRequest: 1 });
    expect(equipePill()).toHaveAttribute('aria-pressed', 'true');
    expect(clientePill()).toHaveAttribute('aria-pressed', 'false');
    // No keyboard on the phone: nothing in the tab takes focus.
    expect(document.body).toHaveFocus();
  });

  it('is not overridden when the participation loads after mount', () => {
    const loading = fakeDiscussao({ participacao: undefined, isParticipant: false });
    const props = { approvals: clientNewest, focusRequest: 1 };
    const { rerender } = render(<PhoneComments {...build(props, loading)} />, {
      wrapper: Wrapper,
    });
    expect(equipePill()).toHaveAttribute('aria-pressed', 'true');
    rerender(<PhoneComments {...build(props, fakeDiscussao({ naoLidas: 0 }))} />);
    expect(equipePill()).toHaveAttribute('aria-pressed', 'true');
    // The host drops the flag once handled: the pill stays where it is.
    rerender(
      <PhoneComments {...build({ approvals: clientNewest }, fakeDiscussao({ naoLidas: 0 }))} />,
    );
    expect(equipePill()).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('PhoneComments discussao=1 re-link while open', () => {
  it('moves from Cliente back to Equipe when a new request arrives', () => {
    const approvals = [approval(1, true, at(9, 0)), approval(2, false, at(10, 0))];
    const { rerender } = render(<PhoneComments {...build({ approvals }, fakeDiscussao())} />, {
      wrapper: Wrapper,
    });
    expect(clientePill()).toHaveAttribute('aria-pressed', 'true');
    rerender(<PhoneComments {...build({ approvals, focusRequest: 3 }, fakeDiscussao())} />);
    expect(equipePill()).toHaveAttribute('aria-pressed', 'true');
    expect(document.body).toHaveFocus();
  });
});

describe('PhoneComments one composer at a time', () => {
  it('shows only the team composer on Equipe', () => {
    setup({}, { naoLidas: 1 });
    expect(teamComposer()).toBeVisible();
    expect(clientComposer()).not.toBeVisible();
  });

  it('shows only the client composer on Cliente', () => {
    setup();
    fireEvent.click(clientePill());
    expect(clientComposer()).toBeVisible();
    expect(teamComposer()).not.toBeVisible();
    fireEvent.click(equipePill());
    expect(teamComposer()).toBeVisible();
    expect(clientComposer()).not.toBeVisible();
  });

  it('keeps both panes mounted and a half-typed team message across pill switches', () => {
    setup();
    setEditorText(teamComposer(), 'rascunho para a equipe');
    fireEvent.click(clientePill());
    expect(screen.getByTestId('discussao-message-10')).toBeInTheDocument();
    expect(teamComposer().textContent).toBe('rascunho para a equipe');
    fireEvent.click(equipePill());
    expect(teamComposer().textContent).toBe('rascunho para a equipe');
    expect(teamComposer()).toBeVisible();
  });

  it('renders neither composer bar while the tab is inactive; the team draft survives', () => {
    const { props, rerender } = setup();
    setEditorText(teamComposer(), 'rascunho para a equipe');
    rerender(<PhoneComments {...props} active={false} />);
    expect(
      screen.queryByRole('textbox', { name: 'Mensagem para a equipe', hidden: true }),
    ).toBeNull();
    expect(screen.queryByPlaceholderText('Responder ao cliente…')).toBeNull();
    rerender(<PhoneComments {...props} active />);
    expect(teamComposer().textContent).toBe('rascunho para a equipe');
  });

  it('does not send the client reply from the team composer or vice versa', async () => {
    const { discussao, props } = setup({ replyText: 'olá cliente' });
    setEditorText(teamComposer(), 'só equipe');
    fireEvent.keyDown(teamComposer(), { key: 'Enter' });
    await waitFor(() => expect(discussao.send).toHaveBeenCalledWith('só equipe'));
    expect(props.onReplySend).not.toHaveBeenCalled();
    fireEvent.click(clientePill());
    fireEvent.keyDown(clientComposer(), { key: 'Enter' });
    expect(props.onReplySend).toHaveBeenCalledTimes(1);
    expect(discussao.send).toHaveBeenCalledTimes(1);
  });
});

describe('PhoneComments Equipe pane', () => {
  it('says only the team sees the conversation and offers the follow bell', () => {
    const { discussao } = setup();
    expect(screen.getByText('Só a equipe vê esta conversa.')).toBeInTheDocument();
    const bell = screen.getByRole('button', { name: 'Seguindo' });
    expect(bell).not.toHaveAttribute('aria-pressed');
    fireEvent.click(bell);
    expect(discussao.toggleSeguir).toHaveBeenCalledTimes(1);
  });

  it('labels the bell "Seguir" for someone who does not follow', () => {
    setup({}, { isParticipant: false });
    expect(screen.getByRole('button', { name: 'Seguir' })).toBeInTheDocument();
  });

  it('shows no bell until participation loads (no "Seguir" flash for followers)', () => {
    setup({}, { participacao: undefined, isParticipant: false });
    expect(screen.queryByRole('button', { name: /^Segui/ })).toBeNull();
  });

  it('keeps the team editor editable while a send is in flight', () => {
    setup({}, { sending: true });
    expect(teamComposer()).toHaveAttribute('contenteditable', 'true');
  });

  it('renders the chat bridge slot only on plans with the team chat', () => {
    const bridge = <button type="button">Discutir no chat</button>;
    const { unmount } = setup({ chatBridge: bridge });
    expect(screen.queryByRole('button', { name: 'Discutir no chat' })).toBeNull();
    unmount();
    limitsMock.features = null;
    const second = setup({ chatBridge: bridge });
    expect(screen.queryByRole('button', { name: 'Discutir no chat' })).toBeNull();
    second.unmount();
    limitsMock.features = { feature_team_chat: true };
    const third = setup({ chatBridge: bridge });
    expect(screen.getByRole('button', { name: 'Discutir no chat' })).toBeInTheDocument();
    third.unmount();
    limitsMock.features = null;
    limitsMock.isUnlimited = true;
    setup({ chatBridge: bridge });
    expect(screen.getByRole('button', { name: 'Discutir no chat' })).toBeInTheDocument();
  });

  it('renders the discussion timeline, with a passage thread as a card', () => {
    const passage = thread(5, {
      field: 'ig_caption',
      quoted_text: 'mesmo em dia nublado',
      post_comments: [msg(20, 5, ANA, 'Vale citar o FPS?', at(17, 5))],
    });
    const { props } = setup({ threads: [GERAL, passage] });
    expect(screen.getByTestId('discussao-message-10')).toHaveTextContent('Primeira versão no ar.');
    const card = screen.getByRole('button', { name: /comentou no trecho/ });
    fireEvent.click(within(card).getByText('Ver no texto'));
    expect(props.onThreadClick).toHaveBeenCalledWith(5);
  });

  it('shows an empty hint without messages', () => {
    setup({ threads: [] });
    expect(screen.getByText(/Nenhuma mensagem ainda/)).toBeInTheDocument();
  });

  it('observes the end of the timeline for the read marker', () => {
    const { discussao } = setup();
    const observed = vi
      .mocked(discussao.sectionRef)
      .mock.calls.map(([el]) => el)
      .filter((el): el is HTMLElement => el instanceof HTMLElement)
      .at(-1);
    expect(observed).toBeDefined();
    expect(observed).not.toContainElement(teamComposer());
    expect(observed).not.toContainElement(screen.getByTestId('discussao-message-10'));
  });

  it('keeps the text and toasts when the send fails', async () => {
    const { toast } = await import('sonner');
    setup({}, { send: vi.fn(async () => Promise.reject(new Error('boom'))) });
    setEditorText(teamComposer(), 'não vai');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem para a equipe' }));
    });
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Não foi possível enviar. Tente novamente.'),
    );
    expect(teamComposer().textContent).toBe('não vai');
  });

  it('blocks a message over 4000 characters', () => {
    const { discussao } = setup();
    setEditorText(teamComposer(), 'a'.repeat(4001));
    expect(screen.getByRole('alert')).toHaveTextContent('4000 caracteres');
    expect(screen.getByRole('button', { name: 'Enviar mensagem para a equipe' })).toBeDisabled();
    fireEvent.keyDown(teamComposer(), { key: 'Enter' });
    expect(discussao.send).not.toHaveBeenCalled();
  });

  it('deletes an own message with deletePostComment, never the thread', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    setup();
    const mine = screen.getByTestId('discussao-message-11');
    fireEvent.click(within(mine).getByRole('button', { name: 'Excluir mensagem' }));
    await waitFor(() => expect(comments.deletePostComment).toHaveBeenCalledWith(11));
    expect(comments.deleteCommentThread).not.toHaveBeenCalled();
    expect(comments.resolveCommentThread).not.toHaveBeenCalled();
  });
});

describe('PhoneComments Cliente pane', () => {
  it('keeps the approval thread and the suggestion card', () => {
    const onOpen = vi.fn();
    setup(
      {
        approvals: [approval(1, false, at(9, 0)), approval(2, true, at(9, 5))],
        suggestion: { when: at(9, 30), onOpen },
      },
      { naoLidas: 1 },
    );
    fireEvent.click(clientePill());
    expect(screen.getByText('Mensagem do cliente', { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Sugestão do cliente/ }));
    expect(onOpen).toHaveBeenCalled();
  });
});

describe('PhoneComments notes pinned to the media', () => {
  const internal = (id: number) =>
    makeNote({ id, visibility: 'internal', author_kind: 'team', body: 'Interna' });

  it('shows the empty state when only internal notes exist', () => {
    setup({ notes: [internal(1)] });
    fireEvent.click(clientePill());
    expect(screen.getByText('Nenhuma mensagem com o cliente ainda.')).toBeInTheDocument();
  });

  it('hides the empty state when a client note exists, even resolved', () => {
    setup({ notes: [makeNote({ id: 1, status: 'resolved' })] });
    fireEvent.click(clientePill());
    expect(screen.queryByText('Nenhuma mensagem com o cliente ainda.')).not.toBeInTheDocument();
  });

  it('counts the OPEN client notes on the Cliente pill', () => {
    setup({
      approvals: [approval(1, false, at(9, 0))],
      notes: [
        makeNote({ id: 1 }),
        makeNote({ id: 2 }),
        makeNote({ id: 3, status: 'resolved' }),
        internal(4),
      ],
    });
    expect(screen.getByRole('button', { name: /^Cliente/ })).toHaveTextContent(
      'Cliente · 2 em aberto',
    );
  });

  it('opens on Cliente when the newest client-side entry is a client note', () => {
    setup({
      approvals: [approval(1, true, at(9, 0))],
      notes: [makeNote({ id: 1, created_at: at(10, 0) })],
    });
    expect(screen.getByRole('button', { name: /^Cliente/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('lists the client note in the Cliente pane and never an internal one', () => {
    setup({ notes: [makeNote({ id: 1, body: 'Trocar a cor' }), internal(2)] });
    fireEvent.click(screen.getByRole('button', { name: /^Cliente/ }));
    expect(screen.getByText('Trocar a cor')).toBeInTheDocument();
    expect(screen.queryByText('Interna')).not.toBeInTheDocument();
  });
});
