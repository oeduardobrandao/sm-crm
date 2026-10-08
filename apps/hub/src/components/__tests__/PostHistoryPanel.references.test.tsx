import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostHistoryPanel } from '../PostHistoryPanel';
import type { HubPost, PostHistoryResponse } from '../../types';
import { makeReferenceItem } from '../../hooks/__tests__/postReferencesStub';

const fetchPostHistoryMock = vi.hoisted(() => vi.fn());
vi.mock('../../api', () => ({
  fetchPostHistory: fetchPostHistoryMock,
  submitApproval: vi.fn(),
}));

const POST: HubPost = {
  id: 7,
  titulo: 'Campanha',
  tipo: 'feed',
  status: 'correcao_cliente',
  ordem: 1,
  conteudo: null,
  conteudo_plain: 'texto',
  scheduled_at: null,
  ig_caption: 'legenda',
  instagram_permalink: null,
  published_at: null,
  publish_error: null,
  workflow_id: 1,
  workflow_titulo: 'Editorial',
  workflow_created_at: null,
  media: [],
  cover_media: null,
  pending_suggestion: null,
  suggestion_rejected_at: null,
};

const HISTORY: PostHistoryResponse = {
  events: [],
  approvals: [
    {
      id: 10,
      action: 'correcao',
      comentario: 'ajustar',
      motivo: null,
      is_workspace_user: false,
      created_at: '2026-09-01T12:00:00.000Z',
    },
    {
      id: 11,
      action: 'correcao',
      comentario: 'nota da equipe',
      motivo: null,
      is_workspace_user: true,
      created_at: '2026-09-02T12:00:00.000Z',
    },
  ],
};

describe('PostHistoryPanel reference tiles', () => {
  beforeEach(() => {
    fetchPostHistoryMock.mockReset();
    fetchPostHistoryMock.mockResolvedValue(HISTORY);
  });

  it('shows the references attached to a client correction', async () => {
    const onOpen = vi.fn();
    render(
      <PostHistoryPanel
        post={POST}
        token="t"
        approvals={[]}
        embedded
        onOpenReference={onOpen}
        references={[
          makeReferenceItem(1, { name: 'foto.jpg', post_approval_id: 10 }),
          makeReferenceItem(2, {
            kind: 'link',
            file_kind: null,
            name: null,
            url: null,
            thumbnail_url: null,
            link_url: 'https://exemplo.com/p',
            link_title: 'Post da marca',
            link_domain: 'exemplo.com',
            post_approval_id: 10,
          }),
          makeReferenceItem(3, { name: 'solta.jpg', post_approval_id: null }),
          makeReferenceItem(4, { name: 'equipe.jpg', post_approval_id: 11 }),
        ]}
      />,
    );
    expect(await screen.findByText('2 referências anexadas')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir foto.jpg' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    const link = screen.getByRole('link', { name: 'Abrir Post da marca' });
    expect(link).toHaveAttribute('href', 'https://exemplo.com/p');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByRole('button', { name: 'Abrir solta.jpg' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abrir equipe.jpg' })).not.toBeInTheDocument();
  });

  it('uses the singular for one reference', async () => {
    render(
      <PostHistoryPanel
        post={POST}
        token="t"
        approvals={[]}
        embedded
        references={[makeReferenceItem(1, { post_approval_id: 10 })]}
      />,
    );
    expect(await screen.findByText('1 referência anexada')).toBeInTheDocument();
  });

  it('renders as before without references', async () => {
    render(<PostHistoryPanel post={POST} token="t" approvals={[]} embedded />);
    expect(await screen.findByText('ajustar')).toBeInTheDocument();
    expect(screen.queryByText(/referência/)).not.toBeInTheDocument();
  });
});
