import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest';
import { toast } from 'sonner';

// Canonical-only registry (what the real hook returns while definitions load),
// without dragging TanStack Query / the supabase client into this test.
vi.mock('@/hooks/useStatusRegistry', async () => {
  const { buildStatusRegistry } = await import('../../statusRegistry');
  return { useStatusRegistry: () => buildStatusRegistry([]) };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock('@/store', () => ({ updateWorkflowPost: vi.fn() }));

// Mock dnd-kit so tests don't need to simulate real pointer/touch events in
// jsdom (same approach as WorkflowCalendarView.test.tsx / CalendarGrid.test.tsx):
// capture the handlers DndContext is given, and record what each card's
// useDraggable was called with so "is this card's drag disabled" is assertable.
const dndHandlers = vi.hoisted(() => ({
  onDragEnd: undefined as ((e: unknown) => void) | undefined,
  onDragStart: undefined as ((e: unknown) => void) | undefined,
}));
const draggableCalls = vi.hoisted(() => new Map<string, { disabled?: boolean }>());

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({
    children,
    onDragEnd,
    onDragStart,
  }: {
    children: React.ReactNode;
    onDragEnd?: (e: unknown) => void;
    onDragStart?: (e: unknown) => void;
  }) => {
    dndHandlers.onDragEnd = onDragEnd;
    dndHandlers.onDragStart = onDragStart;
    return <>{children}</>;
  },
  DragOverlay: ({ children }: { children?: React.ReactNode }) => <>{children ?? null}</>,
  PointerSensor: class {},
  TouchSensor: class {},
  useSensor: () => ({}),
  useSensors: (...sensors: unknown[]) => sensors,
  useDraggable: (opts: { id: string; disabled?: boolean }) => {
    draggableCalls.set(opts.id, opts);
    return {
      listeners: opts.disabled ? undefined : {},
      setNodeRef: () => {},
      isDragging: false,
    };
  },
  useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
}));

import { PostsKanbanView } from '../PostsKanbanView';
import { POST_STATUS_ORDER, STATUS_LABELS } from '../../postLabels';
import { updateWorkflowPost } from '@/store';
import type { ActivePost } from '@/store';
import type { BoardCard } from '../../hooks/useEntregasData';

const mockUpdate = vi.mocked(updateWorkflowPost);

beforeAll(() => {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () =>
    false;
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

beforeEach(() => {
  draggableCalls.clear();
  dndHandlers.onDragEnd = undefined;
  dndHandlers.onDragStart = undefined;
  mockUpdate.mockReset();
  vi.mocked(toast.error).mockClear();
});

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const result = render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  return {
    ...result,
    qc,
    rerender: (nextUi: React.ReactElement) =>
      result.rerender(<QueryClientProvider client={qc}>{nextUi}</QueryClientProvider>),
  };
}

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
    custom_status_id: null,
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
  filtersActive: true,
  onCreateAvulso: vi.fn(),
};

describe('PostsKanbanView', () => {
  it('shows a spinner while loading', () => {
    const { container } = renderWithQuery(<PostsKanbanView {...baseProps} posts={[]} isLoading />);
    expect(container.querySelector('.board-container')).toBeNull();
  });

  it('renders the filtered empty state when a filter narrows the board to nothing', () => {
    renderWithQuery(<PostsKanbanView {...baseProps} posts={[]} filtersActive />);
    expect(screen.getByText('Nenhum post encontrado. Ajuste os filtros.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Criar post avulso' })).toBeNull();
  });

  it('renders a "Criar post avulso" CTA when the board is empty with no filters active', () => {
    const onCreateAvulso = vi.fn();
    renderWithQuery(
      <PostsKanbanView
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

  it('renders all 9 status columns in pipeline order with counts', () => {
    const posts = [
      makePost({ status: 'rascunho', titulo: 'Draft A' }),
      makePost({ status: 'rascunho', titulo: 'Draft B' }),
      makePost({ status: 'postado', titulo: 'Published', scheduled_at: '2026-07-01T12:00:00Z' }),
    ];
    const { container } = renderWithQuery(<PostsKanbanView {...baseProps} posts={posts} />);

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
    renderWithQuery(<PostsKanbanView {...baseProps} posts={posts} onPostClick={onPostClick} />);

    fireEvent.click(screen.getByText('Openable'));
    expect(onPostClick).toHaveBeenCalledWith(posts[0]);

    onPostClick.mockClear();
    fireEvent.click(screen.getByText('Concluded WF post'));
    expect(onPostClick).not.toHaveBeenCalled();
  });

  it('a post avulso (workflow_id null) is always openable, regardless of openableWorkflowIds', () => {
    const onPostClick = vi.fn();
    const posts = [makePost({ id: 102, workflow_id: null, titulo: 'Post avulso' })];
    renderWithQuery(
      <PostsKanbanView
        {...baseProps}
        posts={posts}
        onPostClick={onPostClick}
        openableWorkflowIds={new Set()}
      />,
    );

    fireEvent.click(screen.getByText('Post avulso'));
    expect(onPostClick).toHaveBeenCalledWith(posts[0]);
  });

  it('omits the redundant status chip but keeps the derived Publicando… pill', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const posts = [
      makePost({ status: 'agendado', titulo: 'Due', scheduled_at: past }),
      makePost({ status: 'agendado', titulo: 'Not due', scheduled_at: future }),
      makePost({ status: 'rascunho', titulo: 'Draft' }),
    ];
    const { container } = renderWithQuery(<PostsKanbanView {...baseProps} posts={posts} />);

    // The column already names the status; cards carry no per-card status chip.
    expect(container.querySelector('.board-post-card .post-status-chip')).toBeNull();
    // But "publicando" is derived (agendado + due), which the column can't
    // convey, so exactly the due card keeps a pill.
    const pills = Array.from(container.querySelectorAll('.board-post-publicando')).map(
      (el) => el.textContent,
    );
    expect(pills).toEqual(['Publicando…']);
  });

  it('shows the client avatar (img when cached, initials fallback otherwise)', () => {
    const withAvatar = new Map([
      [10, makeBoardCard({ clienteAvatarUrl: 'https://cdn.example/avatar.jpg' })],
    ]);
    const { container, rerender } = renderWithQuery(
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
    renderWithQuery(<PostsKanbanView {...baseProps} posts={[makePost()]} />);
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('AS')).toBeInTheDocument();
    expect(screen.getByText('2d')).toBeInTheDocument();
  });

  it('shows which etapa the post is in', () => {
    const { container } = renderWithQuery(<PostsKanbanView {...baseProps} posts={[makePost()]} />);
    expect(container.querySelector('.board-post-card .post-fluxo-tag--static')?.textContent).toBe(
      'Design',
    );
  });

  it('shows an "Avulso" chip instead of an etapa for a post avulso', () => {
    const { container } = renderWithQuery(
      <PostsKanbanView
        {...baseProps}
        posts={[
          makePost({ id: 120, workflow_id: null, workflow_titulo: null, titulo: 'Post avulso' }),
        ]}
      />,
    );
    expect(container.querySelector('.board-post-etapa')).toBeNull();
    const chip = screen.getByText('Avulso');
    expect(chip).toHaveClass('post-fluxo-tag');
    expect(chip).toHaveClass('post-fluxo-tag--avulso');
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
    renderWithQuery(
      <PostsKanbanView {...baseProps} posts={[makePost()]} cardsByWorkflowId={overdue} />,
    );
    const prazo = screen.getByText('3d atr.');
    expect(prazo).toHaveStyle({ color: '#ef4444' });
  });

  it('falls back for missing titulo, date and workflow card', () => {
    renderWithQuery(
      <PostsKanbanView
        {...baseProps}
        posts={[makePost({ titulo: '', workflow_id: 99, cliente_id: null, scheduled_at: null })]}
        openableWorkflowIds={new Set()}
      />,
    );
    expect(screen.getByText('Post sem título')).toBeInTheDocument();
    expect(screen.getByText('Sem data')).toBeInTheDocument();
  });

  describe('drag-and-drop', () => {
    it('disables dragging and shows the lock icon for a card in a locked (system) status', () => {
      const posts = [makePost({ id: 501, status: 'postado', titulo: 'Published' })];
      const { container } = renderWithQuery(<PostsKanbanView {...baseProps} posts={posts} />);

      expect(draggableCalls.get('501')?.disabled).toBe(true);
      expect(container.querySelector('.lucide-lock')).toBeInTheDocument();
    });

    it('leaves an unlocked card draggable', () => {
      const posts = [makePost({ id: 502, status: 'rascunho', titulo: 'Draft' })];
      renderWithQuery(<PostsKanbanView {...baseProps} posts={posts} />);

      expect(draggableCalls.get('502')?.disabled).toBeFalsy();
    });

    it('same-column drop is a no-op', () => {
      const posts = [makePost({ id: 503, status: 'rascunho', titulo: 'Draft' })];
      renderWithQuery(<PostsKanbanView {...baseProps} posts={posts} />);

      dndHandlers.onDragEnd?.({ active: { id: '503' }, over: { id: 'col:rascunho' } });

      expect(mockUpdate).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('rejects a drop onto a system column with a toast, without writing', () => {
      const posts = [makePost({ id: 504, status: 'rascunho', titulo: 'Draft' })];
      renderWithQuery(<PostsKanbanView {...baseProps} posts={posts} />);

      dndHandlers.onDragEnd?.({ active: { id: '504' }, over: { id: 'col:agendado' } });

      expect(toast.error).toHaveBeenCalledWith(
        'Post já agendado no Instagram — cancele o agendamento para mover',
      );
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('writes the target status when dropping an unapproved post on an unlocked column', async () => {
      mockUpdate.mockResolvedValue({} as never);
      const posts = [makePost({ id: 505, status: 'rascunho', titulo: 'Draft' })];
      renderWithQuery(<PostsKanbanView {...baseProps} posts={posts} />);

      dndHandlers.onDragEnd?.({ active: { id: '505' }, over: { id: 'col:revisao_interna' } });

      await waitFor(() =>
        expect(mockUpdate).toHaveBeenCalledWith(505, {
          status: 'revisao_interna',
          custom_status_id: null,
        }),
      );
    });

    it('confirms before moving an approved post to a different status, and writes only after confirming', async () => {
      mockUpdate.mockResolvedValue({} as never);
      const posts = [makePost({ id: 506, status: 'aprovado_interno', titulo: 'Approved' })];
      renderWithQuery(<PostsKanbanView {...baseProps} posts={posts} />);

      dndHandlers.onDragEnd?.({ active: { id: '506' }, over: { id: 'col:rascunho' } });

      expect(await screen.findByText('Post aprovado')).toBeInTheDocument();
      expect(mockUpdate).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

      await waitFor(() =>
        expect(mockUpdate).toHaveBeenCalledWith(506, {
          status: 'rascunho',
          custom_status_id: null,
        }),
      );
    });

    it('cancelling the confirm dialog never writes', async () => {
      const posts = [makePost({ id: 507, status: 'aprovado_cliente', titulo: 'Approved' })];
      renderWithQuery(<PostsKanbanView {...baseProps} posts={posts} />);

      dndHandlers.onDragEnd?.({ active: { id: '507' }, over: { id: 'col:correcao_cliente' } });

      expect(await screen.findByText('Post aprovado')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

      expect(mockUpdate).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByText('Post aprovado')).toBeNull());
    });

    it('rolls back the optimistic move and toasts on a failed write', async () => {
      mockUpdate.mockRejectedValue(new Error('boom'));
      const posts = [makePost({ id: 508, status: 'rascunho', titulo: 'Draft' })];
      renderWithQuery(<PostsKanbanView {...baseProps} posts={posts} />);

      dndHandlers.onDragEnd?.({ active: { id: '508' }, over: { id: 'col:revisao_interna' } });

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Erro ao atualizar status'));
    });
  });
});
