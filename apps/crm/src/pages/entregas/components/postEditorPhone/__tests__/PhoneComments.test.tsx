import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PhoneComments } from '../PhoneComments';
import { makeApproval, makeNote } from '../../mediaNotes/__tests__/fixtures';
import type { MediaNote } from '@/store/mediaNotes';
import type { PostApproval } from '@/store/posts';

function setup(approvals: PostApproval[], notes: MediaNote[]) {
  render(
    <PhoneComments
      approvals={approvals}
      notes={notes}
      media={[]}
      onNoteReply={vi.fn(async () => {})}
      onNoteStatus={vi.fn(async () => {})}
      references={[]}
      onOpenReference={vi.fn()}
      clientName="Maria"
      replyText=""
      sendingReply={false}
      onReplyChange={vi.fn()}
      onReplySend={vi.fn()}
      threads={[]}
      membros={[]}
      workspaceUsers={[]}
      onThreadClick={vi.fn()}
      active
    />,
  );
}

const internal = (id: number) =>
  makeNote({ id, visibility: 'internal', author_kind: 'team', body: 'Interna' });

describe('PhoneComments client channel', () => {
  it('shows the empty state when only internal notes exist', () => {
    setup([], [internal(1)]);
    expect(screen.getByText('Nenhuma mensagem com o cliente ainda.')).toBeInTheDocument();
  });

  it('hides the empty state when a client note exists, even resolved', () => {
    setup([], [makeNote({ id: 1, status: 'resolved' })]);
    expect(screen.queryByText('Nenhuma mensagem com o cliente ainda.')).not.toBeInTheDocument();
  });

  it('counts approvals plus OPEN client notes in the segment', () => {
    setup(
      [makeApproval({ id: 1, action: 'mensagem', comentario: 'oi' })],
      [
        makeNote({ id: 1 }),
        makeNote({ id: 2 }),
        makeNote({ id: 3, status: 'resolved' }),
        internal(4),
      ],
    );
    expect(screen.getByText('Com o cliente 3')).toBeInTheDocument();
  });
});
