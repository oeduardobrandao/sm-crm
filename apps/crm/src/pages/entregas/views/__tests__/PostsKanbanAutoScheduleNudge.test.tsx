import { act, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest';
import { toast } from 'sonner';

// Task 3 — piece 1 of the auto-schedule nudge spec: the kanban drag path.
// Follows PostsKanbanView.test.tsx's harness verbatim (dnd-kit / sonner / @/store
// mocks, dropdown-menu flattening) and adds only the nudge-specific plumbing.

vi.mock('@/hooks/useStatusRegistry', async () => {
  const { buildStatusRegistry } = await import('../../statusRegistry');
  return { useStatusRegistry: () => buildStatusRegistry([]) };
});

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

// `isFinalClientApprovalCycle` is the REAL implementation here (not a stubbed
// `vi.fn(() => true)` like the other six harnesses fixed in Step 1): this file's
// dual-approval test (below) exercises the actual allEtapas-counting rule, so a
// hardcoded true would make that assertion meaningless. Every BoardCard fixture
// below therefore carries a real `allEtapas` array -- the gate-input object in
// PostsKanbanView's onSuccess is built (and calls this function) eagerly for any
// drop that resolves a card, even when the target status isn't aprovado_cliente.
vi.mock('@/store', async () => {
  const { isFinalClientApprovalCycle } = await import('@/store/workflows');
  return {
    updateWorkflowPost: vi.fn(),
    reorderBoardPosts: vi.fn(),
    isFinalClientApprovalCycle,
  };
});

// Stub the dialog: Task 2 already covers its own rendering/eligibility logic.
// This file only proves whether it is opened, and with which post.
vi.mock('../../components/AutoSchedulePromptDialog', () => ({
  AutoSchedulePromptDialog: ({ post }: { post: { id: number } | null }) =>
    post ? <div data-testid="nudge">{post.id}</div> : null,
}));

const dndHandlers = vi.hoisted(() => ({
  onDragEnd: undefined as ((e: unknown) => void) | undefined,
  onDragStart: undefined as ((e: unknown) => void) | undefined,
  onDragOver: undefined as ((e: unknown) => void) | undefined,
  onDragCancel: undefined as (() => void) | undefined,
}));
const draggableCalls = vi.hoisted(() => new Map<string, { disabled?: boolean }>());

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({
    children,
    onDragEnd,
    onDragStart,
    onDragOver,
    onDragCancel,
  }: {
    children: React.ReactNode;
    onDragEnd?: (e: unknown) => void;
    onDragStart?: (e: unknown) => void;
    onDragOver?: (e: unknown) => void;
    onDragCancel?: () => void;
  }) => {
    dndHandlers.onDragEnd = onDragEnd;
    dndHandlers.onDragStart = onDragStart;
    dndHandlers.onDragOver = onDragOver;
    dndHandlers.onDragCancel = onDragCancel;
    return <>{children}</>;
  },
  DragOverlay: ({ children }: { children?: React.ReactNode }) => <>{children ?? null}</>,
  PointerSensor: class {},
  TouchSensor: class {},
  useSensor: () => ({}),
  useSensors: (...sensors: unknown[]) => sensors,
  useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
}));

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSortable: (opts: { id: string; disabled?: boolean }) => {
    draggableCalls.set(opts.id, opts);
    return {
      listeners: opts.disabled ? undefined : {},
      setNodeRef: () => {},
      transform: null,
      transition: undefined,
      isDragging: false,
    };
  },
  verticalListSortingStrategy: 'vertical',
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => undefined } },
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
  }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  ),
}));

import { PostsKanbanView } from '../PostsKanbanView';
import { updateWorkflowPost, reorderBoardPosts } from '@/store';
import type { ActivePost } from '@/store';
import type { WorkflowEtapa } from '@/store/workflows';
import type { BoardCard } from '../../hooks/useEntregasData';
import { ACTIVE_POSTS_KEY } from '../../hooks/useUpdatePostStatus';

const mockUpdate = vi.mocked(updateWorkflowPost);
const mockReorder = vi.mocked(reorderBoardPosts);

beforeAll(() => {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () =>
    false;
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

beforeEach(() => {
  draggableCalls.clear();
  dndHandlers.onDragEnd = undefined;
  dndHandlers.onDragStart = undefined;
  dndHandlers.onDragOver = undefined;
  dndHandlers.onDragCancel = undefined;
  mockUpdate.mockReset();
  mockReorder.mockReset();
  mockReorder.mockResolvedValue(undefined);
  vi.mocked(toast).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.info).mockClear();
});

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return { ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>), qc };
}

let nextId = 1;
function makePost(overrides: Partial<ActivePost> = {}): ActivePost {
  return {
    id: nextId++,
    workflow_id: 7,
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
    ig_trial_strategy: null,
    board_ordem: null,
    ...overrides,
  };
}

/** Mirrors store/__tests__/finalApprovalCycle.test.ts's fixture builder --
 *  only `tipo`/`status` matter to isFinalClientApprovalCycle, the rest is
 *  filler required by the (non-optional) WorkflowEtapa shape. */
function etapa(
  ordem: number,
  tipo: WorkflowEtapa['tipo'],
  status: WorkflowEtapa['status'],
): WorkflowEtapa {
  return {
    id: ordem * 10,
    workflow_id: 7,
    nome: `Etapa ${ordem}`,
    ordem,
    prazo_dias: 3,
    tipo_prazo: 'uteis',
    tipo,
    status,
  };
}

/** Single OPEN aprovacao_cliente etapa -> isFinalClientApprovalCycle true. */
const ONE_OPEN_APPROVAL: WorkflowEtapa[] = [etapa(1, 'aprovacao_cliente', 'ativo')];
/** Two OPEN aprovacao_cliente etapas (dual-approval, first cycle) -> false --
 *  the PR #400 regression this whole feature has to not reintroduce. */
const TWO_OPEN_APPROVALS: WorkflowEtapa[] = [
  etapa(1, 'aprovacao_cliente', 'ativo'),
  etapa(2, 'aprovacao_cliente', 'pendente'),
];

function makeCard(overrides: Record<string, unknown> = {}): BoardCard {
  return {
    etapa: { nome: 'Design' },
    membro: { id: 7, nome: 'Ana Silva' },
    cliente: { id: 1, nome: 'Aurora', cor: '#0f766e', auto_publish_on_approval: true },
    clienteAvatarUrl: undefined,
    deadline: { estourado: false, urgente: false, diasRestantes: 2, horasRestantes: 0 },
    allEtapas: ONE_OPEN_APPROVAL,
    ...overrides,
  } as BoardCard;
}

const baseProps = {
  isLoading: false,
  openableWorkflowIds: new Set([7]),
  onPostClick: vi.fn(),
  cardsByWorkflowId: new Map([[7, makeCard()]]),
  filtersActive: true,
  onCreateAvulso: vi.fn(),
};

/** Resolves updateWorkflowPost with an updated row shaped like the real
 *  Supabase write's return value -- only the fields the gate/nudge care about. */
function resolvedRow(overrides: Record<string, unknown> = {}) {
  return { status: 'aprovado_cliente', platform: 'instagram', scheduled_at: null, ...overrides };
}

/** Flushes every pending microtask (the mutation promise chain, however many
 *  hops react-query's mutate() takes internally) before asserting a nudge did
 *  NOT open -- a bare `queryByTestId` right after the drag would pass
 *  trivially before onSuccess has had a chance to run. */
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('PostsKanbanView auto-schedule nudge (drag path)', () => {
  it('opens the nudge after a drag into Aprovado pelo cliente when every gate passes', async () => {
    mockUpdate.mockResolvedValue(resolvedRow() as never);
    const post = makePost({ id: 900, status: 'rascunho' });
    renderWithQuery(<PostsKanbanView {...baseProps} posts={[post]} schedulingEnabled />);

    dndHandlers.onDragEnd?.({ active: { id: '900' }, over: { id: 'col:aprovado_cliente' } });

    expect(await screen.findByTestId('nudge')).toHaveTextContent('900');
  });

  it('does not open the nudge when the client has auto_publish_on_approval false', async () => {
    mockUpdate.mockResolvedValue(resolvedRow() as never);
    const post = makePost({ id: 901, status: 'rascunho' });
    const cards = new Map([
      [
        7,
        makeCard({
          cliente: { id: 1, nome: 'Aurora', cor: '#0f766e', auto_publish_on_approval: false },
        }),
      ],
    ]);
    renderWithQuery(
      <PostsKanbanView {...baseProps} posts={[post]} cardsByWorkflowId={cards} schedulingEnabled />,
    );

    dndHandlers.onDragEnd?.({ active: { id: '901' }, over: { id: 'col:aprovado_cliente' } });

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    await flush();
    expect(screen.queryByTestId('nudge')).toBeNull();
  });

  it('does not open the nudge when schedulingEnabled is false', async () => {
    mockUpdate.mockResolvedValue(resolvedRow() as never);
    const post = makePost({ id: 902, status: 'rascunho' });
    renderWithQuery(<PostsKanbanView {...baseProps} posts={[post]} schedulingEnabled={false} />);

    dndHandlers.onDragEnd?.({ active: { id: '902' }, over: { id: 'col:aprovado_cliente' } });

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    await flush();
    expect(screen.queryByTestId('nudge')).toBeNull();
  });

  // PR #400 regression on a brand-new surface.
  it('does not open the nudge in the first cycle of a dual-approval fluxo', async () => {
    mockUpdate.mockResolvedValue(resolvedRow() as never);
    const post = makePost({ id: 903, status: 'rascunho' });
    const cards = new Map([[7, makeCard({ allEtapas: TWO_OPEN_APPROVALS })]]);
    renderWithQuery(
      <PostsKanbanView {...baseProps} posts={[post]} cardsByWorkflowId={cards} schedulingEnabled />,
    );

    dndHandlers.onDragEnd?.({ active: { id: '903' }, over: { id: 'col:aprovado_cliente' } });

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    await flush();
    expect(screen.queryByTestId('nudge')).toBeNull();
  });

  it('does not open the nudge for a drag into any other status', async () => {
    mockUpdate.mockResolvedValue(resolvedRow({ status: 'revisao_interna' }) as never);
    const post = makePost({ id: 904, status: 'rascunho' });
    renderWithQuery(<PostsKanbanView {...baseProps} posts={[post]} schedulingEnabled />);

    dndHandlers.onDragEnd?.({ active: { id: '904' }, over: { id: 'col:revisao_interna' } });

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    await flush();
    expect(screen.queryByTestId('nudge')).toBeNull();
  });

  it('does not open the nudge for a post avulso (no BoardCard)', async () => {
    mockUpdate.mockResolvedValue(resolvedRow() as never);
    const post = makePost({ id: 905, status: 'rascunho', workflow_id: null });
    renderWithQuery(
      <PostsKanbanView
        {...baseProps}
        posts={[post]}
        cardsByWorkflowId={new Map()}
        openableWorkflowIds={new Set()}
        schedulingEnabled
      />,
    );

    dndHandlers.onDragEnd?.({ active: { id: '905' }, over: { id: 'col:aprovado_cliente' } });

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    await flush();
    expect(screen.queryByTestId('nudge')).toBeNull();
  });

  it('closes an open nudge when Desfazer moves the post back out of aprovado_cliente', async () => {
    mockUpdate.mockResolvedValue(resolvedRow() as never);
    const post = makePost({ id: 906, status: 'rascunho' });
    const { qc } = renderWithQuery(
      <PostsKanbanView {...baseProps} posts={[post]} schedulingEnabled />,
    );
    // Mirrors production: useActivePosts already holds this list in the
    // ['active-posts'] cache before PostsKanbanView receives it as a prop --
    // resolveUndoGuard reads that cache and no-ops (guard === 'stale') without it.
    act(() => {
      qc.setQueryData<ActivePost[]>(ACTIVE_POSTS_KEY, [post]);
    });

    dndHandlers.onDragEnd?.({ active: { id: '906' }, over: { id: 'col:aprovado_cliente' } });

    expect(await screen.findByTestId('nudge')).toHaveTextContent('906');

    const [, options] = vi.mocked(toast).mock.calls[0] as [
      string,
      { action: { onClick: () => void } },
    ];
    options.action.onClick();

    await waitFor(() => expect(screen.queryByTestId('nudge')).toBeNull());
  });

  // Decisão 5 da spec: tiktok-publish/handler.ts:85-89 exige feature_tiktok além de
  // feature_post_scheduling, e decisão 6 manda `both` pelo endpoint do TikTok -- os
  // dois valores de platform precisam do add-on.
  it('does not open the nudge for a tiktok post when tiktokEnabled is false', async () => {
    mockUpdate.mockResolvedValue(resolvedRow({ platform: 'tiktok' }) as never);
    const post = makePost({ id: 907, status: 'rascunho', platform: 'tiktok' });
    renderWithQuery(
      <PostsKanbanView {...baseProps} posts={[post]} schedulingEnabled tiktokEnabled={false} />,
    );

    dndHandlers.onDragEnd?.({ active: { id: '907' }, over: { id: 'col:aprovado_cliente' } });

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    await flush();
    expect(screen.queryByTestId('nudge')).toBeNull();
  });

  it('does not open the nudge for a both post when tiktokEnabled is false', async () => {
    mockUpdate.mockResolvedValue(resolvedRow({ platform: 'both' }) as never);
    const post = makePost({ id: 908, status: 'rascunho', platform: 'both' });
    renderWithQuery(
      <PostsKanbanView {...baseProps} posts={[post]} schedulingEnabled tiktokEnabled={false} />,
    );

    dndHandlers.onDragEnd?.({ active: { id: '908' }, over: { id: 'col:aprovado_cliente' } });

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    await flush();
    expect(screen.queryByTestId('nudge')).toBeNull();
  });

  it('opens the nudge for a both post when tiktokEnabled is true', async () => {
    mockUpdate.mockResolvedValue(resolvedRow({ platform: 'both' }) as never);
    const post = makePost({ id: 909, status: 'rascunho', platform: 'both' });
    renderWithQuery(
      <PostsKanbanView {...baseProps} posts={[post]} schedulingEnabled tiktokEnabled />,
    );

    dndHandlers.onDragEnd?.({ active: { id: '909' }, over: { id: 'col:aprovado_cliente' } });

    expect(await screen.findByTestId('nudge')).toHaveTextContent('909');
  });

  it('opens the nudge for an instagram post when tiktokEnabled is false', async () => {
    // O gate é condicional: platform 'instagram' não passa por tiktok-publish.
    mockUpdate.mockResolvedValue(resolvedRow({ platform: 'instagram' }) as never);
    const post = makePost({ id: 910, status: 'rascunho', platform: 'instagram' });
    renderWithQuery(
      <PostsKanbanView {...baseProps} posts={[post]} schedulingEnabled tiktokEnabled={false} />,
    );

    dndHandlers.onDragEnd?.({ active: { id: '910' }, over: { id: 'col:aprovado_cliente' } });

    expect(await screen.findByTestId('nudge')).toHaveTextContent('910');
  });
});

// Task 5 fix round 1 (external review): the persistent card-face badge and the
// DragOverlay clone (spec piece 3) re-derive the same shouldOfferAutoSchedule gate
// independently inside PostBoardCardContent, rather than sharing a tested helper
// with WorkflowDrawer's copy. The review confirmed the gate is wired correctly
// today, but nothing on this surface caught it if it weren't -- these two cases
// close that hole. Every fixture sets post.status directly to aprovado_cliente (no
// drag-triggered write): the badge has to reach the existing backlog, not just
// newly-approved posts.
describe('persistent indicator on the card face (spec piece 3, kanban surface)', () => {
  // The direct kanban-side mirror of
  // WorkflowDrawerAutoScheduleNudge.test.tsx's "hides the badge in the first cycle
  // of a dual-approval fluxo" -- the PR #400 regression surface, now checked on
  // this surface too.
  it('hides the badge on the card face in the first cycle of a dual-approval fluxo', async () => {
    const post = makePost({ id: 950, status: 'aprovado_cliente' });
    const cards = new Map([[7, makeCard({ allEtapas: TWO_OPEN_APPROVALS })]]);
    renderWithQuery(
      <PostsKanbanView {...baseProps} posts={[post]} cardsByWorkflowId={cards} schedulingEnabled />,
    );

    // Confirms the card actually rendered (so the absence below isn't just a
    // render failure) before asserting the badge itself is missing.
    await screen.findByText('Post Base');
    expect(screen.queryByRole('button', { name: /Agendar/ })).toBeNull();
  });

  it('renders the DragOverlay clone as the static (non-button) badge variant, not the interactive one', async () => {
    const post = makePost({ id: 951, status: 'aprovado_cliente' });
    const { container } = renderWithQuery(
      <PostsKanbanView {...baseProps} posts={[post]} schedulingEnabled />,
    );

    // Live card: every gate passes (default ONE_OPEN_APPROVAL + auto_publish_on_approval
    // true + schedulingEnabled) -> the interactive <button> badge renders on the card face.
    expect(await screen.findByRole('button', { name: /Agendar/ })).toBeInTheDocument();

    // Starting a drag mounts the DragOverlay clone -- a second PostBoardCardContent for
    // the same post, rendered by PostsKanbanView without onAutoScheduleClick -- alongside
    // the still-mounted live card (dnd-kit itself is mocked, so nothing unmounts it here).
    act(() => {
      dndHandlers.onDragStart?.({ active: { id: '951', rect: { current: null } } });
    });

    const overlay = container.querySelector('.board-post-card--overlay');
    expect(overlay).not.toBeNull();
    expect(within(overlay as HTMLElement).getByText(/Agendar/)).toBeInTheDocument();
    expect(within(overlay as HTMLElement).queryByRole('button', { name: /Agendar/ })).toBeNull();

    // The live card's own badge is unaffected by the drag start -- still the
    // clickable button, and still the only <button> badge in the document.
    expect(screen.getAllByRole('button', { name: /Agendar/ })).toHaveLength(1);
  });
});
