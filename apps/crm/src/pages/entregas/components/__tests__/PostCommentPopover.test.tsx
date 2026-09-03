import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommentThreadWithComments, Membro } from '@/store';
import { makeCan, fakeMembership } from '@/test/makeCan';

const { mockUseAuth } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(() => ({ can: makeCan(fakeMembership({ role: 'owner' })) })),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: mockUseAuth,
}));

import PostCommentPopover from '../PostCommentPopover';

// PostCommentPopover's comment/reply textareas render MentionTextarea (Task 5 of the
// at-mentions feature), which pulls membros/clientes/tarefas through useMentionSearch
// -> useQuery -- so every render here needs a QueryClient ancestor. Shadowing `render`
// with a wrapped version (rather than touching each of this file's many call sites)
// keeps every existing `render(<PostCommentPopover ... />)` call working unchanged.
function render(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

vi.mock('@/store', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getMembros: vi.fn(),
    getClientes: vi.fn(),
    getTarefas: vi.fn(),
  };
});
vi.mock('@/store/posts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    searchPostsForMention: vi.fn(),
  };
});

const membros: Membro[] = [
  {
    id: 1,
    conta_id: 'conta-1',
    user_id: 'user-1',
    nome: 'Eduardo Souza',
    email: 'edu@test.com',
    papel: 'owner',
    avatar_url: null,
    created_at: '2026-01-01',
  } as Membro,
  {
    id: 2,
    conta_id: 'conta-1',
    user_id: 'user-2',
    nome: 'Ana Costa',
    email: 'ana@test.com',
    papel: 'agent',
    avatar_url: 'https://example.com/ana.jpg',
    created_at: '2026-01-01',
  } as Membro,
];

function makeThread(overrides?: Partial<CommentThreadWithComments>): CommentThreadWithComments {
  return {
    id: 1,
    post_id: 10,
    conta_id: 'conta-1',
    quoted_text: 'highlighted text',
    status: 'active',
    created_by: 'user-1',
    resolved_by: null,
    created_at: '2026-04-20T10:00:00Z',
    resolved_at: null,
    post_comments: [
      {
        id: 100,
        thread_id: 1,
        author_id: 'user-1',
        content: 'First comment',
        created_at: '2026-04-20T10:00:00Z',
        updated_at: null,
      },
    ],
    ...overrides,
  };
}

const defaultProps = {
  membros,
  currentUserId: 'user-1',
  onReply: vi.fn().mockResolvedValue(undefined),
  onResolve: vi.fn().mockResolvedValue(undefined),
  onReopen: vi.fn().mockResolvedValue(undefined),
  onEditComment: vi.fn().mockResolvedValue(undefined),
  onDeleteComment: vi.fn().mockResolvedValue(undefined),
  onClose: vi.fn(),
};

describe('PostCommentPopover', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(defaultProps).forEach((v) => {
      if (typeof v === 'function') (v as ReturnType<typeof vi.fn>).mockClear();
    });
    defaultProps.onReply.mockResolvedValue(undefined);
    defaultProps.onResolve.mockResolvedValue(undefined);
    defaultProps.onReopen.mockResolvedValue(undefined);
    defaultProps.onEditComment.mockResolvedValue(undefined);
    defaultProps.onDeleteComment.mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue({ can: makeCan(fakeMembership({ role: 'owner' })) });
  });

  // Re-arms the mocks MentionTextarea's useMentionSearch depends on -- the
  // `vi.restoreAllMocks()` above (and the global one in vitest.setup.ts) strips a
  // bare `vi.fn()`'s resolved value back to "returns undefined" between tests.
  beforeEach(async () => {
    const store = await import('@/store');
    (store.getMembros as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (store.getClientes as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (store.getTarefas as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const postsModule = await import('@/store/posts');
    (postsModule.searchPostsForMention as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('renders author avatar with initials when no avatar_url', () => {
    const thread = makeThread();
    render(<PostCommentPopover thread={thread} {...defaultProps} />);

    const avatar = screen.getByText('ES');
    expect(avatar).toBeInTheDocument();
    expect(avatar.className).toContain('comment-avatar--initials');
  });

  it('renders author avatar as image when avatar_url is present', () => {
    const thread = makeThread({
      post_comments: [
        {
          id: 101,
          thread_id: 1,
          author_id: 'user-2',
          content: 'Comment from Ana',
          created_at: '2026-04-20T11:00:00Z',
          updated_at: null,
        },
      ],
    });
    render(<PostCommentPopover thread={thread} {...defaultProps} />);

    const img = screen.getByAltText('Ana Costa');
    expect(img).toBeInTheDocument();
    expect(img.tagName).toBe('IMG');
    expect(img).toHaveAttribute('src', 'https://example.com/ana.jpg');
  });

  it('shows author name and date in the header', () => {
    const thread = makeThread();
    render(<PostCommentPopover thread={thread} {...defaultProps} />);

    expect(screen.getByText('Eduardo Souza')).toBeInTheDocument();
    expect(screen.getByText('Eduardo Souza').className).toContain('comment-item-author');
  });

  it('shows quoted text in the header', () => {
    const thread = makeThread({ quoted_text: 'some selected text' });
    render(<PostCommentPopover thread={thread} {...defaultProps} />);

    expect(screen.getByText('some selected text')).toBeInTheDocument();
  });

  it('shows edit and delete buttons for comment author', () => {
    const thread = makeThread();
    render(<PostCommentPopover thread={thread} {...defaultProps} currentUserId="user-1" />);

    expect(screen.getByTitle('Editar')).toBeInTheDocument();
    expect(screen.getByTitle('Excluir')).toBeInTheDocument();
  });

  it('hides edit button but shows delete for admin viewing another user comment', () => {
    mockUseAuth.mockReturnValue({ can: makeCan(fakeMembership({ role: 'admin' })) });
    const thread = makeThread();
    render(<PostCommentPopover thread={thread} {...defaultProps} currentUserId="user-2" />);

    expect(screen.queryByTitle('Editar')).not.toBeInTheDocument();
    expect(screen.getByTitle('Excluir')).toBeInTheDocument();
  });

  /**
   * Task 14: `currentUserRole === 'owner' || currentUserRole === 'admin'`
   * collapsed onto `can('entregas', 'editar') === true`. Unlike
   * equipe/configuracoes, `AGENT_ROLE_PRESET.entregas` is 'editar' (lib/
   * permissions.ts) -- a legacy agent already has full edit rights
   * throughout the rest of the Entregas module (any post, not just their
   * own), so this specific delete-gate was the one inconsistent holdout that
   * denied it. The conversion is a deliberate widening for legacy agents,
   * not a regression: it brings this gate in line with the rest of the
   * module rather than preserving the old, narrower behaviour.
   */
  it('now shows delete for a legacy agent viewing another user comment too, matching the rest of Entregas', () => {
    mockUseAuth.mockReturnValue({ can: makeCan(fakeMembership({ role: 'agent' })) });
    const thread = makeThread();
    render(<PostCommentPopover thread={thread} {...defaultProps} currentUserId="user-2" />);

    expect(screen.queryByTitle('Editar')).not.toBeInTheDocument();
    expect(screen.getByTitle('Excluir')).toBeInTheDocument();
  });

  it('hides delete for a custom role with entregas:ver only, viewing another user comment', () => {
    mockUseAuth.mockReturnValue({
      can: makeCan(
        fakeMembership({ role: 'agent', role_id: 'role-1', permissions: { entregas: 'ver' } }),
      ),
    });
    const thread = makeThread();
    render(<PostCommentPopover thread={thread} {...defaultProps} currentUserId="user-2" />);

    expect(screen.queryByTitle('Editar')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Excluir')).not.toBeInTheDocument();
  });

  it('shows delete for a custom role with entregas:editar, viewing another user comment (the fix)', () => {
    mockUseAuth.mockReturnValue({
      can: makeCan(
        fakeMembership({ role: 'agent', role_id: 'role-1', permissions: { entregas: 'editar' } }),
      ),
    });
    const thread = makeThread();
    render(<PostCommentPopover thread={thread} {...defaultProps} currentUserId="user-2" />);

    expect(screen.queryByTitle('Editar')).not.toBeInTheDocument();
    expect(screen.getByTitle('Excluir')).toBeInTheDocument();
  });

  it('hides all action buttons in readOnly mode', () => {
    const thread = makeThread();
    render(<PostCommentPopover thread={thread} {...defaultProps} readOnly />);

    expect(screen.queryByTitle('Editar')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Excluir')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Resolver')).not.toBeInTheDocument();
  });

  it('hides reply input in readOnly mode', () => {
    const thread = makeThread();
    render(<PostCommentPopover thread={thread} {...defaultProps} readOnly />);

    expect(screen.queryByPlaceholderText('Responder...')).not.toBeInTheDocument();
  });

  it('shows resolve button for active thread', () => {
    const thread = makeThread({ status: 'active' });
    render(<PostCommentPopover thread={thread} {...defaultProps} />);

    expect(screen.getByTitle('Resolver')).toBeInTheDocument();
    expect(screen.queryByTitle('Reabrir')).not.toBeInTheDocument();
  });

  it('shows reopen button for resolved thread', () => {
    const thread = makeThread({ status: 'resolved' });
    render(<PostCommentPopover thread={thread} {...defaultProps} />);

    expect(screen.getByTitle('Reabrir')).toBeInTheDocument();
    expect(screen.queryByTitle('Resolver')).not.toBeInTheDocument();
  });

  it('calls onReply when submitting a reply', async () => {
    const thread = makeThread();
    render(<PostCommentPopover thread={thread} {...defaultProps} />);

    const input = screen.getByPlaceholderText('Responder...');
    fireEvent.change(input, { target: { value: 'New reply' } });
    fireEvent.click(screen.getByText('Enviar'));

    await waitFor(() => {
      expect(defaultProps.onReply).toHaveBeenCalledWith(1, 'New reply');
    });
  });

  it('calls onReply on Enter key press (without shift)', async () => {
    const thread = makeThread();
    render(<PostCommentPopover thread={thread} {...defaultProps} />);

    const input = screen.getByPlaceholderText('Responder...');
    fireEvent.change(input, { target: { value: 'Enter reply' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    await waitFor(() => {
      expect(defaultProps.onReply).toHaveBeenCalledWith(1, 'Enter reply');
    });
  });

  it('does not submit on Shift+Enter', () => {
    const thread = makeThread();
    render(<PostCommentPopover thread={thread} {...defaultProps} />);

    const input = screen.getByPlaceholderText('Responder...');
    fireEvent.change(input, { target: { value: 'Multiline' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

    expect(defaultProps.onReply).not.toHaveBeenCalled();
  });

  it('calls onClose when close button is clicked', () => {
    const thread = makeThread();
    render(<PostCommentPopover thread={thread} {...defaultProps} />);

    fireEvent.click(screen.getByTitle('Fechar'));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('calls onClose on Escape key', () => {
    const thread = makeThread();
    render(<PostCommentPopover thread={thread} {...defaultProps} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('calls onResolve when resolve button is clicked', async () => {
    const thread = makeThread({ status: 'active' });
    render(<PostCommentPopover thread={thread} {...defaultProps} />);

    fireEvent.click(screen.getByTitle('Resolver'));

    await waitFor(() => {
      expect(defaultProps.onResolve).toHaveBeenCalledWith(1);
    });
  });

  it('enters edit mode and saves edited comment', async () => {
    const thread = makeThread();
    render(<PostCommentPopover thread={thread} {...defaultProps} />);

    fireEvent.click(screen.getByTitle('Editar'));

    const editInput = screen.getByDisplayValue('First comment');
    expect(editInput.tagName).toBe('TEXTAREA');

    fireEvent.change(editInput, { target: { value: 'Edited comment' } });
    fireEvent.click(screen.getByText('Salvar'));

    await waitFor(() => {
      expect(defaultProps.onEditComment).toHaveBeenCalledWith(100, 'Edited comment');
    });
  });

  it('cancels edit mode without saving', () => {
    const thread = makeThread();
    render(<PostCommentPopover thread={thread} {...defaultProps} />);

    fireEvent.click(screen.getByTitle('Editar'));
    fireEvent.click(screen.getByText('Cancelar'));

    expect(defaultProps.onEditComment).not.toHaveBeenCalled();
    expect(screen.getByText('First comment')).toBeInTheDocument();
  });

  it('shows (editado) label for edited comments', () => {
    const thread = makeThread({
      post_comments: [
        {
          id: 100,
          thread_id: 1,
          author_id: 'user-1',
          content: 'Edited content',
          created_at: '2026-04-20T10:00:00Z',
          updated_at: '2026-04-20T12:00:00Z',
        },
      ],
    });
    render(<PostCommentPopover thread={thread} {...defaultProps} />);

    expect(screen.getByText('(editado)')).toBeInTheDocument();
  });

  it('shows confirmation dialog before deleting a comment', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const thread = makeThread();
    render(<PostCommentPopover thread={thread} {...defaultProps} />);

    fireEvent.click(screen.getByTitle('Excluir'));

    expect(confirmSpy).toHaveBeenCalledWith('Excluir este comentário?');
    expect(defaultProps.onDeleteComment).not.toHaveBeenCalled();
  });

  it('calls onDeleteComment when user confirms deletion', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const thread = makeThread();
    render(<PostCommentPopover thread={thread} {...defaultProps} />);

    fireEvent.click(screen.getByTitle('Excluir'));

    expect(defaultProps.onDeleteComment).toHaveBeenCalledWith(100, 1);
  });

  it('renders multiple comments in order', () => {
    const thread = makeThread({
      post_comments: [
        {
          id: 100,
          thread_id: 1,
          author_id: 'user-1',
          content: 'First',
          created_at: '2026-04-20T10:00:00Z',
          updated_at: null,
        },
        {
          id: 101,
          thread_id: 1,
          author_id: 'user-2',
          content: 'Second',
          created_at: '2026-04-20T11:00:00Z',
          updated_at: null,
        },
      ],
    });
    render(<PostCommentPopover thread={thread} {...defaultProps} />);

    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
    expect(screen.getByText('Eduardo Souza')).toBeInTheDocument();
    expect(screen.getByText('Ana Costa')).toBeInTheDocument();
  });

  it('disables send button when reply is empty', () => {
    const thread = makeThread();
    render(<PostCommentPopover thread={thread} {...defaultProps} />);

    const sendBtn = screen.getByText('Enviar');
    expect(sendBtn).toBeDisabled();
  });

  it('falls back to "Membro" when author is not in membros list', () => {
    const thread = makeThread({
      post_comments: [
        {
          id: 100,
          thread_id: 1,
          author_id: 'unknown-user',
          content: 'Mystery comment',
          created_at: '2026-04-20T10:00:00Z',
          updated_at: null,
        },
      ],
    });
    render(<PostCommentPopover thread={thread} {...defaultProps} />);

    expect(screen.getByText('Membro')).toBeInTheDocument();
    expect(screen.getByText('M')).toBeInTheDocument();
  });
});
