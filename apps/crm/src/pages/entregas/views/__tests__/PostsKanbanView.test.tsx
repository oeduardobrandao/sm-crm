import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PostsKanbanView } from '../PostsKanbanView';
import { POST_STATUS_ORDER, STATUS_LABELS } from '../../postLabels';
import type { ActivePost } from '@/store';
import type { BoardCard } from '../../hooks/useEntregasData';

let nextId = 1;
function makePost(overrides: Partial<ActivePost> = {}): ActivePost {
  return {
    id: nextId++,
    workflow_id: 10,
    cliente_id: 1,
    cliente_nome: 'Aurora',
    workflow_titulo: 'Fluxo Base',
    titulo: 'Post Base',
    tipo: 'feed',
    status: 'rascunho',
    scheduled_at: null,
    published_at: null,
    ig_caption: null,
    instagram_permalink: null,
    publish_error: null,
    ordem: 0,
    responsavel_id: null,
    platform: 'instagram',
    tiktok_publish_status: null,
    tiktok_publish_error: null,
    tiktok_post_url: null,
    instagram_media_id: null,
    ...overrides,
  };
}

function makeBoardCard(overrides: Record<string, unknown> = {}): BoardCard {
  return {
    etapa: { nome: 'Design' },
    membro: { id: 7, nome: 'Ana Silva' },
    cliente: { id: 1, nome: 'Aurora', cor: '#0f766e' },
    clienteAvatarUrl: undefined,
    deadline: { estourado: false, urgente: false, diasRestantes: 2, horasRestantes: 0 },
    ...overrides,
  } as BoardCard;
}

const baseProps = {
  isLoading: false,
  openableWorkflowIds: new Set([10]),
  onPostClick: vi.fn(),
  cardsByWorkflowId: new Map([[10, makeBoardCard()]]),
};

describe('PostsKanbanView', () => {
  it('shows a spinner while loading', () => {
    const { container } = render(<PostsKanbanView {...baseProps} posts={[]} isLoading />);
    expect(container.querySelector('.board-container')).toBeNull();
  });

  it('renders the global empty state when there are no posts', () => {
    render(<PostsKanbanView {...baseProps} posts={[]} />);
    expect(screen.getByText('Nenhum post encontrado. Ajuste os filtros.')).toBeInTheDocument();
  });

  it('renders all 9 status columns in pipeline order with counts', () => {
    const posts = [
      makePost({ status: 'rascunho', titulo: 'Draft A' }),
      makePost({ status: 'rascunho', titulo: 'Draft B' }),
      makePost({ status: 'postado', titulo: 'Published', scheduled_at: '2026-07-01T12:00:00Z' }),
    ];
    const { container } = render(<PostsKanbanView {...baseProps} posts={posts} />);

    const titles = Array.from(container.querySelectorAll('.board-column-title')).map(
      (el) => el.textContent,
    );
    expect(titles).toEqual(POST_STATUS_ORDER.map((s) => STATUS_LABELS[s]));

    const counts = Array.from(container.querySelectorAll('.board-column-count')).map(
      (el) => el.textContent,
    );
    expect(counts).toEqual(['2', '0', '0', '0', '0', '0', '0', '1', '0']);

    // Empty columns show their own empty state
    expect(screen.getAllByText('Nenhum post')).toHaveLength(7);
  });

  it('opens the post on click only when its workflow is openable', () => {
    const onPostClick = vi.fn();
    const posts = [
      makePost({ id: 100, workflow_id: 10, titulo: 'Openable' }),
      makePost({ id: 101, workflow_id: 99, titulo: 'Concluded WF post' }),
    ];
    render(<PostsKanbanView {...baseProps} posts={posts} onPostClick={onPostClick} />);

    fireEvent.click(screen.getByText('Openable'));
    expect(onPostClick).toHaveBeenCalledWith(10, 100);

    onPostClick.mockClear();
    fireEvent.click(screen.getByText('Concluded WF post'));
    expect(onPostClick).not.toHaveBeenCalled();
  });

  it('always shows the status chip, with Publicando… for a due agendado post', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const posts = [
      makePost({ status: 'agendado', titulo: 'Due', scheduled_at: past }),
      makePost({ status: 'agendado', titulo: 'Not due', scheduled_at: future }),
      makePost({ status: 'rascunho', titulo: 'Draft' }),
    ];
    const { container } = render(<PostsKanbanView {...baseProps} posts={posts} />);

    const chips = Array.from(container.querySelectorAll('.post-status-chip')).map(
      (el) => el.textContent,
    );
    expect(chips).toHaveLength(3);
    expect(chips.filter((c) => c === 'Publicando…')).toHaveLength(1);
    expect(chips.filter((c) => c === 'Agendado')).toHaveLength(1);
    expect(chips.filter((c) => c === 'Rascunho')).toHaveLength(1);
  });

  it('shows the client avatar (img when cached, initials fallback otherwise)', () => {
    const withAvatar = new Map([
      [10, makeBoardCard({ clienteAvatarUrl: 'https://cdn.example/avatar.jpg' })],
    ]);
    const { container, rerender } = render(
      <PostsKanbanView {...baseProps} posts={[makePost()]} cardsByWorkflowId={withAvatar} />,
    );
    expect(container.querySelector('img.board-post-cliente-avatar')).toHaveAttribute(
      'src',
      'https://cdn.example/avatar.jpg',
    );

    rerender(
      <PostsKanbanView
        {...baseProps}
        posts={[makePost()]}
        cardsByWorkflowId={new Map([[10, makeBoardCard()]])}
      />,
    );
    expect(container.querySelector('img.board-post-cliente-avatar')).toBeNull();
    expect(screen.getByText('A')).toBeInTheDocument(); // initials of "Aurora"
    expect(screen.queryByText('Aurora')).toBeNull(); // name lives in the hover tooltip only
  });

  it('shows the etapa responsible with the etapa deadline, colored by urgency', () => {
    render(<PostsKanbanView {...baseProps} posts={[makePost()]} />);
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('AS')).toBeInTheDocument();
    expect(screen.getByText('2d')).toBeInTheDocument();
  });

  it('shows which etapa the post is in', () => {
    const { container } = render(<PostsKanbanView {...baseProps} posts={[makePost()]} />);
    expect(container.querySelector('.board-post-etapa')?.textContent).toBe('Design');
  });

  it('shows an overdue etapa deadline in red shorthand', () => {
    const overdue = new Map([
      [
        10,
        makeBoardCard({
          deadline: { estourado: true, urgente: false, diasRestantes: -3, horasRestantes: 0 },
        }),
      ],
    ]);
    render(<PostsKanbanView {...baseProps} posts={[makePost()]} cardsByWorkflowId={overdue} />);
    const prazo = screen.getByText('3d atr.');
    expect(prazo).toHaveStyle({ color: '#ef4444' });
  });

  it('falls back for missing titulo, date and workflow card', () => {
    render(
      <PostsKanbanView
        {...baseProps}
        posts={[makePost({ titulo: '', workflow_id: 99, cliente_id: null, scheduled_at: null })]}
        openableWorkflowIds={new Set()}
      />,
    );
    expect(screen.getByText('Post sem título')).toBeInTheDocument();
    expect(screen.getByText('Sem data')).toBeInTheDocument();
  });
});
