import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OpenNotesBadge } from '../OpenNotesBadge';
import { makeApproval, makeNote } from './fixtures';

describe('OpenNotesBadge', () => {
  it('is hidden without a snapshot', () => {
    render(
      <OpenNotesBadge
        approvals={[makeApproval({ media_note_ids: [] })]}
        notes={[makeNote({ id: 1 })]}
      />,
    );
    expect(screen.queryByText(/em aberto/)).not.toBeInTheDocument();
  });

  it('shows the live count of open client notes', () => {
    render(
      <OpenNotesBadge
        approvals={[makeApproval({ media_note_ids: [1, 2, 3] })]}
        notes={[
          makeNote({ id: 1 }),
          makeNote({ id: 2, status: 'resolved' }),
          makeNote({ id: 3 }),
          makeNote({ id: 4 }),
          makeNote({ id: 5, visibility: 'internal', author_kind: 'team' }),
        ]}
      />,
    );
    expect(screen.getByText('Aprovado com 3 comentários em aberto')).toBeInTheDocument();
  });

  it('uses the singular for one open note', () => {
    render(
      <OpenNotesBadge
        approvals={[makeApproval({ media_note_ids: [1] })]}
        notes={[makeNote({ id: 1 })]}
      />,
    );
    expect(screen.getByText('Aprovado com 1 comentário em aberto')).toBeInTheDocument();
  });

  it('is hidden when every note is resolved', () => {
    render(
      <OpenNotesBadge
        approvals={[makeApproval({ media_note_ids: [1] })]}
        notes={[makeNote({ id: 1, status: 'resolved' })]}
      />,
    );
    expect(screen.queryByText(/em aberto/)).not.toBeInTheDocument();
  });

  it('only looks at the latest client approval', () => {
    render(
      <OpenNotesBadge
        approvals={[
          makeApproval({ id: 1, media_note_ids: [1], created_at: '2026-10-22T10:00:00Z' }),
          makeApproval({ id: 2, media_note_ids: [], created_at: '2026-10-23T10:00:00Z' }),
        ]}
        notes={[makeNote({ id: 1 })]}
      />,
    );
    expect(screen.queryByText(/em aberto/)).not.toBeInTheDocument();
  });

  it('ignores corrections and team messages', () => {
    render(
      <OpenNotesBadge
        approvals={[
          makeApproval({ id: 1, action: 'correcao', media_note_ids: [1] }),
          makeApproval({ id: 2, action: 'aprovado', is_workspace_user: true, media_note_ids: [1] }),
        ]}
        notes={[makeNote({ id: 1 })]}
      />,
    );
    expect(screen.queryByText(/em aberto/)).not.toBeInTheDocument();
  });

  it('is hidden when the latest client decision is a correction', () => {
    render(
      <OpenNotesBadge
        approvals={[
          makeApproval({ id: 1, media_note_ids: [1], created_at: '2026-10-22T10:00:00Z' }),
          makeApproval({
            id: 2,
            action: 'correcao',
            media_note_ids: [1],
            created_at: '2026-10-22T11:00:00Z',
          }),
        ]}
        notes={[makeNote({ id: 1 })]}
      />,
    );
    expect(screen.queryByText(/em aberto/)).not.toBeInTheDocument();
  });

  it('shows again when the client approves after a correction', () => {
    render(
      <OpenNotesBadge
        approvals={[
          makeApproval({
            id: 1,
            action: 'correcao',
            media_note_ids: [],
            created_at: '2026-10-22T10:00:00Z',
          }),
          makeApproval({ id: 2, media_note_ids: [1], created_at: '2026-10-22T11:00:00Z' }),
        ]}
        notes={[makeNote({ id: 1 })]}
      />,
    );
    expect(screen.getByText('Aprovado com 1 comentário em aberto')).toBeInTheDocument();
  });
});
