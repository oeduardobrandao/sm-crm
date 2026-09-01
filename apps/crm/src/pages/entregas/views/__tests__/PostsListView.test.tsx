import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Canonical-only registry (what the real hook returns while definitions load),
// without dragging TanStack Query / the supabase client into this test.
vi.mock('@/hooks/useStatusRegistry', async () => {
  const { buildStatusRegistry } = await import('../../statusRegistry');
  return { useStatusRegistry: () => buildStatusRegistry([]) };
});

import { PostsListView } from '../PostsListView';
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
    ig_trial_strategy: null,
    board_ordem: null,
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
  onFluxoClick: vi.fn(),
  cardsByWorkflowId: new Map([[10, makeBoardCard()]]),
  filtersActive: true,
  onCreateAvulso: vi.fn(),
};

function getRenderedTitles(container: HTMLElement) {
  return Array.from(container.querySelectorAll('tbody tr')).map(
    (row) => row.querySelector('td')?.textContent,
  );
}

describe('PostsListView', () => {
  it('renders the filtered empty state when a filter narrows the list to nothing', () => {
    render(<PostsListView {...baseProps} posts={[]} filtersActive />);
    expect(screen.getByText('Nenhum post encontrado. Ajuste os filtros.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Criar post avulso' })).toBeNull();
  });

  it('renders a "Criar post avulso" CTA when the list is empty with no filters active', () => {
    const onCreateAvulso = vi.fn();
    render(
      <PostsListView
        {...baseProps}
        posts={[]}
        filtersActive={false}
        onCreateAvulso={onCreateAvulso}
      />,
    );
    expect(screen.queryByText('Nenhum post encontrado. Ajuste os filtros.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Criar post avulso' }));
    expect(onCreateAvulso).toHaveBeenCalledTimes(1);
  });

  it('renders all columns including Etapa atual, Responsável and Prazo da etapa', () => {
    const { container } = render(<PostsListView {...baseProps} posts={[makePost()]} />);
    const headers = Array.from(container.querySelectorAll('th')).map((el) => el.textContent);
    expect(headers).toEqual([
      'Título',
      'Cliente',
      'Fluxo',
      'Etapa atual',
      'Tipo',
      'Status',
      'Responsável',
      'Prazo da etapa',
      'Agendado para',
    ]);
  });

  it('shows the workflow current etapa per post, sortable, with — fallback', () => {
    const cards = new Map([
      [10, makeBoardCard()], // etapa Design
      [11, makeBoardCard({ etapa: { nome: 'Aprovação' } })],
    ]);
    const posts = [
      makePost({ titulo: 'Em design', workflow_id: 10 }),
      makePost({ titulo: 'Em aprovação', workflow_id: 11 }),
      makePost({ titulo: 'Sem card', workflow_id: 99 }),
    ];
    const { container } = render(
      <PostsListView {...baseProps} posts={posts} cardsByWorkflowId={cards} />,
    );

    expect(screen.getByText('Design')).toBeInTheDocument();
    expect(screen.getByText('Aprovação')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Etapa atual'));
    // asc: '' (sem card) < 'Aprovação' < 'Design'
    expect(getRenderedTitles(container)).toEqual(['Sem card', 'Em aprovação', 'Em design']);
    fireEvent.click(screen.getByText('Etapa atual'));
    expect(getRenderedTitles(container)).toEqual(['Em design', 'Em aprovação', 'Sem card']);
  });

  it('sorts by scheduled date by default with unscheduled posts last', () => {
    const posts = [
      makePost({ titulo: 'Sem data' }),
      makePost({ titulo: 'Depois', scheduled_at: '2026-07-20T12:00:00Z' }),
      makePost({ titulo: 'Antes', scheduled_at: '2026-07-01T12:00:00Z' }),
    ];
    const { container } = render(<PostsListView {...baseProps} posts={posts} />);
    expect(getRenderedTitles(container)).toEqual(['Antes', 'Depois', 'Sem data']);
  });

  it('keeps unscheduled posts last when sorting descending too', () => {
    const posts = [
      makePost({ titulo: 'Sem data' }),
      makePost({ titulo: 'Depois', scheduled_at: '2026-07-20T12:00:00Z' }),
      makePost({ titulo: 'Antes', scheduled_at: '2026-07-01T12:00:00Z' }),
    ];
    const { container } = render(<PostsListView {...baseProps} posts={posts} />);

    fireEvent.click(screen.getByText('Agendado para'));
    expect(getRenderedTitles(container)).toEqual(['Depois', 'Antes', 'Sem data']);
  });

  it('sorts by other columns on header click and flips direction on re-click', () => {
    const posts = [
      makePost({ titulo: 'Beta', cliente_nome: 'Zeta' }),
      makePost({ titulo: 'Alpha', cliente_nome: 'Aurora' }),
    ];
    const { container } = render(<PostsListView {...baseProps} posts={posts} />);

    fireEvent.click(screen.getByText('Título'));
    expect(getRenderedTitles(container)).toEqual(['Alpha', 'Beta']);

    fireEvent.click(screen.getByText('Título'));
    expect(getRenderedTitles(container)).toEqual(['Beta', 'Alpha']);
  });

  it('shows the etapa responsible per workflow, sortable, with — fallback', () => {
    const cards = new Map([
      [10, makeBoardCard()],
      [11, makeBoardCard({ membro: undefined, etapa: { nome: 'Copy' } })],
    ]);
    const posts = [
      makePost({ titulo: 'Com responsável', workflow_id: 10 }),
      makePost({ titulo: 'Sem responsável', workflow_id: 11 }),
    ];
    const { container } = render(
      <PostsListView {...baseProps} posts={posts} cardsByWorkflowId={cards} />,
    );

    expect(screen.getByText('Ana Silva')).toBeInTheDocument();
    expect(screen.getByTitle('Etapa: Design')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Responsável'));
    // asc: '' (—) sorts before 'Ana Silva'
    expect(getRenderedTitles(container)).toEqual(['Sem responsável', 'Com responsável']);
    fireEvent.click(screen.getByText('Responsável'));
    expect(getRenderedTitles(container)).toEqual(['Com responsável', 'Sem responsável']);
  });

  it('shows the client as an avatar only, with the name in the tooltip', () => {
    const { container } = render(<PostsListView {...baseProps} posts={[makePost()]} />);
    expect(screen.queryByText('Aurora')).toBeNull(); // name lives in the hover tooltip only
    const avatar = container.querySelector('.board-post-cliente-avatar');
    expect(avatar?.textContent).toBe('A');

    const withUrl = new Map([
      [10, makeBoardCard({ clienteAvatarUrl: 'https://cdn.example/a.jpg' })],
    ]);
    const { container: c2 } = render(
      <PostsListView {...baseProps} posts={[makePost()]} cardsByWorkflowId={withUrl} />,
    );
    expect(c2.querySelector('img.board-post-cliente-avatar')).toHaveAttribute(
      'src',
      'https://cdn.example/a.jpg',
    );
  });

  it('shows and sorts the etapa deadline, no-deadline rows last in both directions', () => {
    const cards = new Map([
      [
        10,
        makeBoardCard({
          etapa: { nome: 'Design', data_limite: '2026-07-20' },
          deadline: { estourado: true, urgente: false, diasRestantes: -1, horasRestantes: 0 },
        }),
      ],
      [
        11,
        makeBoardCard({
          deadline: { estourado: false, urgente: false, diasRestantes: 4, horasRestantes: 2 },
        }),
      ],
    ]);
    const posts = [
      makePost({ titulo: 'Sem card', workflow_id: 99 }),
      makePost({ titulo: 'Folgado', workflow_id: 11 }),
      makePost({ titulo: 'Atrasado', workflow_id: 10 }),
    ];
    const { container } = render(
      <PostsListView {...baseProps} posts={posts} cardsByWorkflowId={cards} />,
    );

    expect(screen.getByText('1d atrasado')).toBeInTheDocument();
    expect(screen.getByText('4d restantes')).toBeInTheDocument();
    // The calendar date rides along with the relative label when resolvable
    expect(screen.getByText('1d atrasado').closest('td')?.textContent).toContain('20 jul');

    fireEvent.click(screen.getByText('Prazo da etapa'));
    expect(getRenderedTitles(container)).toEqual(['Atrasado', 'Folgado', 'Sem card']);
    fireEvent.click(screen.getByText('Prazo da etapa'));
    expect(getRenderedTitles(container)).toEqual(['Folgado', 'Atrasado', 'Sem card']);
  });

  it('renders the fluxo as a clickable tag that opens the workflow, not the post', () => {
    const onPostClick = vi.fn();
    const onFluxoClick = vi.fn();
    render(
      <PostsListView
        {...baseProps}
        posts={[makePost({ workflow_titulo: 'Fluxo Clicável' })]}
        onPostClick={onPostClick}
        onFluxoClick={onFluxoClick}
      />,
    );

    const tag = screen.getByRole('button', { name: 'Fluxo Clicável' });
    expect(tag).toHaveClass('post-fluxo-tag');
    fireEvent.click(tag);
    expect(onFluxoClick).toHaveBeenCalledWith(10);
    expect(onPostClick).not.toHaveBeenCalled(); // stopPropagation shields the row click
  });

  it('renders a static (non-clickable) fluxo tag when the workflow has no card', () => {
    const onFluxoClick = vi.fn();
    render(
      <PostsListView
        {...baseProps}
        posts={[makePost({ workflow_id: 99, workflow_titulo: 'Sem Card' })]}
        onFluxoClick={onFluxoClick}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Sem Card' })).toBeNull();
    fireEvent.click(screen.getByText('Sem Card'));
    expect(onFluxoClick).not.toHaveBeenCalled();
  });

  it('renders tipo badge and status chip labels', () => {
    render(
      <PostsListView
        {...baseProps}
        posts={[
          makePost({ tipo: 'reels', status: 'enviado_cliente' }),
          makePost({ tipo: 'carrossel', status: 'postado' }),
        ]}
      />,
    );
    expect(screen.getByText('Reels')).toBeInTheDocument();
    expect(screen.getByText('Carrossel')).toBeInTheDocument();
    expect(screen.getByText('Enviado ao cliente')).toBeInTheDocument();
    expect(screen.getByText('Postado')).toBeInTheDocument();
  });

  it('opens the post on row click only when its workflow is openable', () => {
    const onPostClick = vi.fn();
    const posts = [
      makePost({ id: 100, workflow_id: 10, titulo: 'Openable' }),
      makePost({ id: 101, workflow_id: 99, titulo: 'Locked' }),
    ];
    render(<PostsListView {...baseProps} posts={posts} onPostClick={onPostClick} />);

    fireEvent.click(screen.getByText('Openable'));
    expect(onPostClick).toHaveBeenCalledWith(posts[0]);

    onPostClick.mockClear();
    fireEvent.click(screen.getByText('Locked'));
    expect(onPostClick).not.toHaveBeenCalled();
  });

  it('a post avulso (workflow_id null) is always openable, regardless of openableWorkflowIds', () => {
    const onPostClick = vi.fn();
    const posts = [makePost({ id: 102, workflow_id: null, titulo: 'Post avulso' })];
    render(
      <PostsListView
        {...baseProps}
        posts={posts}
        onPostClick={onPostClick}
        openableWorkflowIds={new Set()}
      />,
    );

    fireEvent.click(screen.getByText('Post avulso'));
    expect(onPostClick).toHaveBeenCalledWith(posts[0]);
  });

  it('shows the discreet "Avulso" tag (not a clickable fluxo button) in the Fluxo cell for a post avulso', () => {
    const onFluxoClick = vi.fn();
    render(
      <PostsListView
        {...baseProps}
        posts={[makePost({ workflow_id: null, workflow_titulo: null, titulo: 'Post avulso' })]}
        onFluxoClick={onFluxoClick}
      />,
    );

    const tag = screen.getByText('Avulso');
    expect(tag).toHaveClass('post-fluxo-tag');
    expect(tag).toHaveClass('post-fluxo-tag--avulso');
    expect(screen.queryByRole('button', { name: 'Avulso' })).toBeNull();
    fireEvent.click(tag);
    expect(onFluxoClick).not.toHaveBeenCalled();
  });

  it('leaves Etapa atual and Prazo da etapa blank for a post avulso', () => {
    const posts = [
      makePost({ id: 103, workflow_id: null, workflow_titulo: null, titulo: 'Post avulso' }),
    ];
    render(<PostsListView {...baseProps} posts={posts} />);

    const row = screen.getByText('Post avulso').closest('tr')!;
    const cells = Array.from(row.querySelectorAll('td')).map((td) => td.textContent);
    // Columns: Título, Cliente, Fluxo, Etapa atual, Tipo, Status, Responsável, Prazo da etapa, Agendado para
    expect(cells[3]).toBe('—'); // Etapa atual
    expect(cells[7]).toBe('—'); // Prazo da etapa
  });

  it('groups posts avulsos together when sorting by Fluxo, in both directions', () => {
    const posts = [
      makePost({ titulo: 'Avulso 1', workflow_id: null, workflow_titulo: null }),
      makePost({ titulo: 'Avulso 2', workflow_id: null, workflow_titulo: null }),
      makePost({ titulo: 'Post A', workflow_id: 10, workflow_titulo: 'Fluxo A' }),
      makePost({ titulo: 'Post B', workflow_id: 11, workflow_titulo: 'Fluxo B' }),
    ];
    const { container } = render(<PostsListView {...baseProps} posts={posts} />);

    fireEvent.click(screen.getByText('Fluxo'));
    expect(getRenderedTitles(container)).toEqual(['Avulso 1', 'Avulso 2', 'Post A', 'Post B']);

    fireEvent.click(screen.getByText('Fluxo'));
    expect(getRenderedTitles(container)).toEqual(['Post B', 'Post A', 'Avulso 1', 'Avulso 2']);
  });

  it('mostra o selo Teste em reels de teste', () => {
    render(
      <PostsListView
        {...baseProps}
        posts={[makePost({ tipo: 'reels', ig_trial_strategy: 'auto' })]}
      />,
    );
    expect(screen.getByText('Teste')).toBeTruthy();
  });

  it('não mostra o selo em post normal', () => {
    render(<PostsListView {...baseProps} posts={[makePost({ ig_trial_strategy: null })]} />);
    expect(screen.queryByText('Teste')).toBeNull();
  });
});
