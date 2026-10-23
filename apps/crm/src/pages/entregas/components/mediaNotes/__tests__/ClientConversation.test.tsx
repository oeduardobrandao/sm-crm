import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MediaNote } from '@/store/mediaNotes';
import type { PostApproval, PostMedia } from '@/store/posts';
import { ClientConversation, type ClientConversationProps } from '../ClientConversation';

function note(over: Partial<MediaNote> = {}): MediaNote {
  return {
    id: 1,
    post_id: 10,
    media_kind: 'image',
    visibility: 'client',
    author_kind: 'client',
    author_user_id: null,
    current_link_id: 5,
    current_slide_index: 2,
    slide_index_at_creation: 2,
    is_previous_version: false,
    t_seconds: null,
    x: 0.3,
    y: 0.4,
    body: 'Trocar a cor',
    status: 'open',
    resolved_by: null,
    resolved_at: null,
    created_at: '2026-10-22T10:00:00Z',
    replies: [],
    ...over,
  };
}

const approval: PostApproval = {
  id: 1,
  post_id: 10,
  token: 't',
  action: 'mensagem',
  comentario: 'Mensagem geral',
  is_workspace_user: false,
  author_user_id: null,
  media_note_ids: [],
  created_at: '2026-10-22T09:00:00Z',
};

function setup(over: Partial<ClientConversationProps> = {}) {
  const props: ClientConversationProps = {
    approvals: [approval],
    notes: [
      note({ id: 1, body: 'Nota aberta' }),
      note({
        id: 2,
        body: 'Nota resolvida',
        status: 'resolved',
        created_at: '2026-10-22T11:00:00Z',
      }),
    ],
    media: [{ id: 5 }] as PostMedia[],
    workspaceUsers: [],
    membros: [],
    clientName: 'Maria',
    replyText: '',
    sendingReply: false,
    onReplyChange: vi.fn(),
    onReplySend: vi.fn(),
    onNoteReply: vi.fn().mockResolvedValue(undefined),
    onNoteStatus: vi.fn().mockResolvedValue(undefined),
    onSelectMedia: vi.fn(),
    ...over,
  };
  render(<ClientConversation {...props} />);
  return props;
}

describe('ClientConversation', () => {
  it('Em aberto filter shows only open notes', async () => {
    setup();
    expect(screen.getByText('Mensagem geral')).toBeInTheDocument();
    expect(screen.getByText('Nota resolvida')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Em aberto (1)' }));

    expect(screen.getByText('Nota aberta')).toBeInTheDocument();
    expect(screen.queryByText('Nota resolvida')).not.toBeInTheDocument();
    expect(screen.queryByText('Mensagem geral')).not.toBeInTheDocument();
  });

  it('Na mídia filter hides approvals but keeps resolved notes', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Na mídia' }));
    expect(screen.getByText('Nota resolvida')).toBeInTheDocument();
    expect(screen.queryByText('Mensagem geral')).not.toBeInTheDocument();
  });

  it('Marcar como resolvido calls onNoteStatus([id], resolved)', async () => {
    const props = setup({ notes: [note({ id: 7 })] });
    await userEvent.click(screen.getByRole('button', { name: /Marcar como resolvido/ }));
    expect(props.onNoteStatus).toHaveBeenCalledWith([7], 'resolved');
  });

  it('Reabrir calls onNoteStatus([id], open) on a resolved note', async () => {
    const props = setup({ notes: [note({ id: 7, status: 'resolved' })] });
    await userEvent.click(screen.getByRole('button', { name: /Reabrir/ }));
    expect(props.onNoteStatus).toHaveBeenCalledWith([7], 'open');
  });

  it('reply box label is Responder ao cliente', () => {
    setup();
    expect(screen.getByLabelText('Responder ao cliente')).toBeInTheDocument();
  });

  it('sends a reply on a note and clears the field', async () => {
    const props = setup({ notes: [note({ id: 7 })] });
    const field = screen.getByLabelText(/Responder ao cliente sobre Slide 3/);
    await userEvent.type(field, 'Ajustado{Enter}');
    expect(props.onNoteReply).toHaveBeenCalledWith(7, 'Ajustado');
  });

  it('anchor chip selects the media; previous-version anchors do not', async () => {
    const props = setup({
      notes: [
        note({ id: 1 }),
        note({ id: 2, is_previous_version: true, current_link_id: null, x: null, y: null }),
      ],
    });
    await userEvent.click(screen.getByRole('button', { name: 'Slide 3 · ponto 1' }));
    expect(props.onSelectMedia).toHaveBeenCalledWith(5);
    expect(screen.getByText('Slide 3 (versão anterior)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /versão anterior/ })).not.toBeInTheDocument();
  });

  it('hides the filter and thread when there is nothing yet, keeping the reply box', () => {
    setup({ approvals: [], notes: [] });
    expect(screen.queryByRole('group', { name: 'Filtrar conversa' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Responder ao cliente')).toBeInTheDocument();
  });
});
