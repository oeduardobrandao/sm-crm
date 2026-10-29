import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';

// jsdom's matchMedia reports no match: useIsDesktop(768) is false, so the Status
// board renders its phone face (PLAN C3.4).

vi.mock('@/hooks/useStatusRegistry', async () => {
  const { buildStatusRegistry } = await import('../../statusRegistry');
  return {
    useStatusRegistry: () =>
      buildStatusRegistry([
        {
          id: 'c1',
          conta_id: 'x',
          nome: 'Em gravação',
          cor: '#0ea5e9',
          icone: null,
          behaves_as: 'revisao_interna',
          ordem: 0,
          arquivado: false,
          created_at: '',
          updated_at: '',
        },
      ]),
  };
});

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock('@/store/posts', () => ({ hasPendingEditSuggestion: vi.fn(async () => false) }));

vi.mock('@/store', () => ({
  updateWorkflowPost: vi.fn(async () => ({})),
  reorderBoardPosts: vi.fn(async () => undefined),
  isFinalClientApprovalCycle: vi.fn(() => true),
  cardAutoScheduleGates: vi.fn(() => ({ autoPublishOnApproval: true, isFinalApprovalCycle: true })),
}));

const dnd = vi.hoisted(() => ({
  onDragEnd: undefined as ((e: unknown) => void) | undefined,
  onDragStart: undefined as ((e: unknown) => void) | undefined,
  onDragOver: undefined as ((e: unknown) => void) | undefined,
  sortable: new Map<string, { disabled?: boolean }>(),
}));

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({
    children,
    onDragEnd,
    onDragStart,
    onDragOver,
  }: {
    children: React.ReactNode;
    onDragEnd?: (e: unknown) => void;
    onDragStart?: (e: unknown) => void;
    onDragOver?: (e: unknown) => void;
  }) => {
    dnd.onDragEnd = onDragEnd;
    dnd.onDragStart = onDragStart;
    dnd.onDragOver = onDragOver;
    return <>{children}</>;
  },
  DragOverlay: ({ children }: { children?: React.ReactNode }) => <>{children ?? null}</>,
  PointerSensor: class {},
  MouseSensor: class {},
  TouchSensor: class {},
  useSensor: () => ({}),
  useSensors: (...sensors: unknown[]) => sensors,
  useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
  pointerWithin: () => [],
  closestCenter: () => [],
}));

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSortable: (opts: { id: string; disabled?: boolean }) => {
    dnd.sortable.set(opts.id, opts);
    return {
      attributes: {},
      listeners: opts.disabled ? undefined : {},
      setNodeRef: () => {},
      transform: null,
      transition: undefined,
      isDragging: false,
    };
  },
  verticalListSortingStrategy: 'vertical',
}));

import { PostsKanbanView } from '../PostsKanbanView';
import { updateWorkflowPost } from '@/store';
import { hasPendingEditSuggestion } from '@/store/posts';
import type { ActivePost } from '@/store';

let nextId = 1;
function makePost(overrides: Partial<ActivePost> = {}): ActivePost {
  return {
    id: nextId++,
    workflow_id: null,
    cliente_id: 1,
    cliente_nome: 'Aurora',
    workflow_titulo: null,
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
    ig_trial_strategy: null,
    board_ordem: null,
    ...overrides,
  } as ActivePost;
}

function renderBoard(props: Record<string, unknown> = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const posts = (props.posts as ActivePost[]) ?? [
    makePost({ titulo: 'Rascunho A' }),
    makePost({ titulo: 'Rascunho B' }),
    makePost({ titulo: 'Já agendado', status: 'agendado', scheduled_at: '2026-12-01T12:00:00Z' }),
  ];
  const all = {
    posts,
    isLoading: false,
    openableWorkflowIds: new Set<number>(),
    onPostClick: vi.fn(),
    cardsByWorkflowId: new Map(),
    filtersActive: false,
    onCreateAvulso: vi.fn(),
    onColumnSortChange: vi.fn(),
    ...props,
  };
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PostsKanbanView {...(all as never)} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...all, posts };
}

beforeEach(() => {
  dnd.sortable.clear();
  vi.mocked(updateWorkflowPost).mockClear();
  vi.mocked(toast).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(hasPendingEditSuggestion).mockReset();
  vi.mocked(hasPendingEditSuggestion).mockResolvedValue(false);
});

describe('PostsKanbanView on phones', () => {
  it('shows one status column behind chips (custom statuses included) and opens a post on tap', () => {
    const { onPostClick, posts } = renderBoard();
    expect(screen.getByTestId('phone-status-board')).toBeInTheDocument();
    const chips = screen.getByRole('tablist', { name: 'Status' });
    expect(within(chips).getByRole('tab', { name: /Em gravação/ })).toBeInTheDocument();
    expect(within(chips).getByRole('tab', { name: /Rascunho/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getAllByTestId('phone-status-card')).toHaveLength(2);
    fireEvent.click(screen.getByRole('article', { name: 'Rascunho A' }));
    expect(onPostClick).toHaveBeenCalledWith(posts[0]);
  });

  it('Reordenar switches the column to Manual and shows handles; nothing drags outside it', () => {
    const onColumnSortChange = vi.fn();
    renderBoard({ columnSorts: { rascunho: 'data' }, onColumnSortChange });
    expect(screen.queryByRole('button', { name: 'Arrastar para mover' })).toBeNull();
    expect([...dnd.sortable.values()].every((o) => o.disabled)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Reordenar' }));
    expect(onColumnSortChange).toHaveBeenCalledWith('rascunho', 'manual');
    expect(screen.getAllByRole('button', { name: 'Arrastar para mover' })).toHaveLength(2);
  });

  it('drag start expands the chips into a grid of drop targets; a drop on a status writes it with an undo toast', async () => {
    const { posts } = renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Reordenar' }));
    act(() => {
      dnd.onDragStart?.({ active: { id: String(posts[0].id), rect: { current: {} } } });
    });
    expect(screen.queryByRole('tablist', { name: 'Status' })).toBeNull();
    expect(screen.getByText('Arraste até um status')).toBeInTheDocument();
    expect(screen.getByText('Em gravação')).toBeInTheDocument();
    act(() => {
      dnd.onDragOver?.({
        active: { id: String(posts[0].id), rect: { current: {} } },
        over: { id: 'col:revisao_interna', rect: {} },
      });
    });
    expect(screen.getByText('Solte para mover para Em revisão')).toBeInTheDocument();
    act(() => {
      dnd.onDragEnd?.({
        active: { id: String(posts[0].id), rect: { current: {} } },
        over: { id: 'col:revisao_interna', rect: {} },
      });
    });
    await waitFor(() => expect(updateWorkflowPost).toHaveBeenCalled());
    expect(vi.mocked(updateWorkflowPost).mock.calls[0][0]).toBe(posts[0].id);
    expect(toast).toHaveBeenCalledWith(
      'Post movido para "Em revisão".',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Desfazer' }) }),
    );
    // Grid closes with the drag.
    expect(screen.getByRole('tablist', { name: 'Status' })).toBeInTheDocument();
  });

  it('a locked status refuses the drop with the desktop message', () => {
    const { posts } = renderBoard();
    act(() => {
      dnd.onDragStart?.({ active: { id: String(posts[0].id), rect: { current: {} } } });
    });
    act(() => {
      dnd.onDragEnd?.({
        active: { id: String(posts[0].id), rect: { current: {} } },
        over: { id: 'col:postado', rect: {} },
      });
    });
    expect(toast.error).toHaveBeenCalledWith('Post já publicado');
    expect(updateWorkflowPost).not.toHaveBeenCalled();
  });

  it('the card menu "Mover para…" runs the same status change without dragging', async () => {
    const { posts } = renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações de Rascunho A' }));
    const menu = await screen.findByRole('menu', { name: 'Ações do post' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Mover para…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Mover para' });
    expect(within(sheet).getByRole('button', { name: 'Postado (automático)' })).toBeDisabled();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Em gravação' }));
    await waitFor(() => expect(updateWorkflowPost).toHaveBeenCalled());
    expect(vi.mocked(updateWorkflowPost).mock.calls[0][0]).toBe(posts[0].id);
  });

  describe('suggestion move guard (phone)', () => {
    const openMoveSheet = async () => {
      const posts = [makePost({ titulo: 'Em revisão A', status: 'revisao_interna' })];
      renderBoard({ posts });
      fireEvent.click(
        within(screen.getByRole('tablist', { name: 'Status' })).getByRole('tab', {
          name: /Em revisão/,
        }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Mais ações de Em revisão A' }));
      const menu = await screen.findByRole('menu', { name: 'Ações do post' });
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Mover para…' }));
      const sheet = await screen.findByRole('dialog', { name: 'Mover para' });
      fireEvent.click(within(sheet).getByRole('button', { name: 'Aprovado pelo cliente' }));
      return posts;
    };

    it('asks before moving a post with a pending suggestion into Aprovado pelo cliente; Cancelar does not write', async () => {
      vi.mocked(hasPendingEditSuggestion).mockResolvedValue(true);
      await openMoveSheet();

      expect(await screen.findByText('Mover para Aprovado pelo cliente?')).toBeInTheDocument();
      expect(updateWorkflowPost).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
      await waitFor(() =>
        expect(screen.queryByText('Mover para Aprovado pelo cliente?')).not.toBeInTheDocument(),
      );
      expect(updateWorkflowPost).not.toHaveBeenCalled();
    });

    it('"Mover mesmo assim" writes the status', async () => {
      vi.mocked(hasPendingEditSuggestion).mockResolvedValue(true);
      const posts = await openMoveSheet();

      await screen.findByText('Mover para Aprovado pelo cliente?');
      fireEvent.click(screen.getByRole('button', { name: 'Mover mesmo assim' }));

      await waitFor(() => expect(updateWorkflowPost).toHaveBeenCalled());
      expect(vi.mocked(updateWorkflowPost).mock.calls[0][0]).toBe(posts[0].id);
      expect(vi.mocked(updateWorkflowPost).mock.calls[0][1]).toMatchObject({
        status: 'aprovado_cliente',
      });
    });
  });

  it('a locked post has no drag handle and its menu explains the lock', async () => {
    renderBoard();
    fireEvent.click(
      within(screen.getByRole('tablist', { name: 'Status' })).getByRole('tab', {
        name: /Agendado/,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reordenar' }));
    expect(screen.queryByRole('button', { name: 'Arrastar para mover' })).toBeNull();
    expect(screen.getByRole('img', { name: 'Status travado' })).toBeInTheDocument();
  });
});
