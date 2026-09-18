import { useState } from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BoardCard } from '../../hooks/useEntregasData';
import { makeCan, fakeMembership } from '@/test/makeCan';

// Task 3 — piece 1 of the auto-schedule nudge spec: the drawer's two status
// write sites (handleFieldChange's status branch and handleConfirmStatusChange).
// Reuses WorkflowDrawer.test.tsx's harness verbatim (same mocks, same
// renderDrawer shape) and adds only the nudge-specific plumbing.

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1' },
    role: 'owner',
    loading: false,
    profile: null,
    can: makeCan(fakeMembership({ role: 'owner' })),
  }),
}));

// Mutable so each test can set the feature flags it needs; reset after every test.
let mockFeatures: Record<string, boolean> | null = null;
vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({
    limits: null,
    get features() {
      return mockFeatures;
    },
    planName: null,
    isLoading: false,
    isUnlimited: true,
  }),
}));

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  closestCenter: () => null,
  PointerSensor: class {},
  useSensor: () => ({}),
  useSensors: (...sensors: unknown[]) => sensors,
}));
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
  verticalListSortingStrategy: () => null,
  arrayMove: (arr: unknown[]) => arr,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null }),
        }),
      }),
    }),
  },
}));

// `isFinalClientApprovalCycle` is the REAL implementation here (not a stubbed
// `vi.fn(() => true)` like WorkflowDrawer.test.tsx): this file's dual-approval
// test exercises the actual allEtapas-counting rule, so a hardcoded true would
// make that assertion meaningless. Every BoardCard fixture below therefore
// carries a real `allEtapas` array.
vi.mock('@/store', async () => {
  const { isFinalClientApprovalCycle, cardAutoScheduleGates } = await import('@/store/workflows');
  return {
    getWorkflowPostsWithProperties: vi.fn(),
    addWorkflowPost: vi.fn(),
    updateWorkflowPost: vi.fn(),
    isFinalClientApprovalCycle,
    cardAutoScheduleGates,
    removeWorkflowPost: vi.fn(),
    reorderWorkflowPosts: vi.fn(),
    sendPostsToCliente: vi.fn(),
    getPostApprovals: vi.fn(async () => []),
    getPostStatusEvents: vi.fn(async () => []),
    getPostProcessEvents: vi.fn(async () => []),
    replyToPostApproval: vi.fn(),
    completeEtapa: vi.fn(),
    getPostCommentThreads: vi.fn(async () => []),
    createCommentThread: vi.fn(),
    addPostComment: vi.fn(),
    updatePostComment: vi.fn(),
    deletePostComment: vi.fn(),
    resolveCommentThread: vi.fn(),
    reopenCommentThread: vi.fn(),
    deleteCommentThread: vi.fn(),
    getWorkspaceUsers: vi.fn(async () => []),
    getPostEditSuggestions: vi.fn(async () => []),
    acceptEditSuggestion: vi.fn(),
    rejectEditSuggestion: vi.fn(),
    getClientePosts: vi.fn(async () => []),
    createDesign: vi.fn(),
    getDesignForPost: vi.fn(async () => null),
    syncMentions: vi.fn(),
    detachPostsFromWorkflow: vi.fn(),
    detachPostsKeepingProcess: vi.fn(),
    getWorkflows: vi.fn(async () => []),
    movePostsToNewFlow: vi.fn(),
    movePostsToExistingFlow: vi.fn(),
  };
});

// Stub the dialog: Task 2 already covers its own rendering/eligibility logic.
// This file only proves whether it is opened, and with which post.
vi.mock('../AutoSchedulePromptDialog', () => ({
  AutoSchedulePromptDialog: ({ post }: { post: { id: number } | null }) =>
    post ? <div data-testid="nudge">{post.id}</div> : null,
}));

// Stub the batch dialog too: Task 4 already covers its own fetch/partition
// logic. This file only proves whether the drawer's header action opens it,
// and for which workflow.
vi.mock('../AutoScheduleBatchDialog', () => ({
  AutoScheduleBatchDialog: ({ workflowId }: { workflowId: number | null }) =>
    workflowId != null ? <div data-testid="batch-dialog">{workflowId}</div> : null,
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock('@/services/postMedia', () => ({ listPostMedia: vi.fn(async () => []) }));

vi.mock('@/services/inlineImage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/inlineImage')>();
  return {
    uploadInlineImage: vi.fn(),
    extractR2Keys: actual.extractR2Keys,
    injectSignedUrls: actual.injectSignedUrls,
    resolveInlineImageUrls: vi.fn(async () => ({})),
  };
});

// Heavy leaf components — stubbed out so only WorkflowDrawer's own logic runs.
// PostEditorBody itself is NOT stubbed: the native "Status" <select> this file
// drives lives inline in PostEditorBody.tsx, not in one of these leaves.
vi.mock('@/pages/entregas/components/PostEditor', () => ({
  PostEditor: ({ initialContent }: { initialContent: unknown }) => {
    const [frozenContent] = useState(initialContent);
    return <div data-testid="post-editor-stub" data-content={JSON.stringify(frozenContent)} />;
  },
}));
vi.mock('@/pages/entregas/components/PropertyPanel', () => ({
  PropertyPanel: () => <div data-testid="property-panel-stub" />,
}));
vi.mock('@/pages/entregas/components/PostCommentSummary', () => ({
  default: () => <div data-testid="post-comment-summary-stub" />,
}));
vi.mock('@/pages/entregas/components/PostTimelinePopover', () => ({
  PostTimelinePopover: () => <div data-testid="post-timeline-popover-stub" />,
}));
vi.mock('@/pages/entregas/components/PostMediaGallery', () => ({
  PostMediaGallery: () => <div data-testid="post-media-gallery-stub" />,
  hasVideoMissingThumbnail: () => false,
}));
vi.mock('@/pages/estudio/ImportToEstudioDialog', () => ({
  ImportToEstudioDialog: () => null,
}));
vi.mock('@/pages/entregas/components/InstagramCaptionField', () => ({
  InstagramCaptionField: () => <div data-testid="ig-caption-stub" />,
}));
vi.mock('@/pages/entregas/components/PlatformSelector', () => ({
  PlatformSelector: ({ disabled }: { disabled?: boolean }) => (
    <div data-testid="platform-selector-stub" data-disabled={disabled ? 'true' : 'false'} />
  ),
}));
vi.mock('@/pages/entregas/components/TikTokSettingsPanel', () => ({
  TikTokSettingsPanel: () => <div data-testid="tiktok-settings-stub" />,
}));
vi.mock('@/pages/entregas/components/ScheduleButton', () => ({
  ScheduleButton: () => <div data-testid="schedule-button-stub" />,
}));
vi.mock('@/components/ui/date-time-picker', () => ({
  DateTimePicker: () => <div data-testid="date-time-picker-stub" />,
}));
vi.mock('@/pages/entregas/components/WorkflowCalendarView', () => ({
  WorkflowCalendarView: () => <div data-testid="workflow-calendar-view-stub" />,
}));
vi.mock('@/pages/entregas/components/WorkflowHistoryView', () => ({
  WorkflowHistoryView: ({ workflowId }: { workflowId: number }) => (
    <div data-testid="workflow-history-view-stub">history-{workflowId}</div>
  ),
}));
vi.mock('@/components/CopyPostLinkButton', () => ({
  CopyPostLinkButton: () => <div data-testid="copy-post-link-stub" />,
}));
vi.mock('@/pages/entregas/components/DiffView', () => ({
  DiffView: () => <div data-testid="diff-view-stub" />,
}));
vi.mock('@/pages/entregas/components/ReadOnlyTipTap', () => ({
  ReadOnlyTipTap: () => <div data-testid="read-only-tiptap-stub" />,
}));

import { WorkflowDrawer } from '../WorkflowDrawer';
import { getWorkflowPostsWithProperties, updateWorkflowPost } from '@/store';
import type { WorkflowEtapa } from '@/store/workflows';

const mockGetPosts = vi.mocked(getWorkflowPostsWithProperties);
const mockUpdate = vi.mocked(updateWorkflowPost);

/** Mirrors store/__tests__/finalApprovalCycle.test.ts's fixture builder. */
function etapa(
  ordem: number,
  tipo: WorkflowEtapa['tipo'],
  status: WorkflowEtapa['status'],
): WorkflowEtapa {
  return {
    id: ordem * 10,
    workflow_id: 10,
    nome: `Etapa ${ordem}`,
    ordem,
    prazo_dias: 3,
    tipo_prazo: 'uteis',
    tipo,
    status,
  };
}

const ONE_OPEN_APPROVAL: WorkflowEtapa[] = [etapa(1, 'aprovacao_cliente', 'ativo')];
const TWO_OPEN_APPROVALS: WorkflowEtapa[] = [
  etapa(1, 'aprovacao_cliente', 'ativo'),
  etapa(2, 'aprovacao_cliente', 'pendente'),
];

function renderDrawer(
  qc: QueryClient,
  overrides: {
    onClose?: () => void;
    onRefresh?: () => void;
    initialPostId?: number;
    card?: Partial<BoardCard>;
  } = {},
) {
  const card = {
    workflow: {
      id: 10,
      cliente_id: 42,
      titulo: 'Campanha Julho',
      template_id: null,
      status: 'ativo',
      etapa_atual: 0,
      recorrente: false,
    },
    etapa: {
      id: 1,
      workflow_id: 10,
      ordem: 0,
      nome: 'Produção',
      prazo_dias: 3,
      tipo_prazo: 'uteis',
      status: 'ativo',
    },
    cliente: {
      id: 42,
      nome: 'Marca X',
      sigla: 'MX',
      cor: '#000',
      plano: 'pro',
      email: '',
      telefone: '',
      status: 'ativo',
      valor_mensal: 0,
      auto_publish_on_approval: true,
    },
    membro: undefined,
    deadline: null,
    totalEtapas: 1,
    etapaIdx: 0,
    allEtapas: ONE_OPEN_APPROVAL,
    ...overrides.card,
  } as unknown as BoardCard;

  return render(
    <QueryClientProvider client={qc}>
      <WorkflowDrawer
        card={card}
        membros={[]}
        onClose={overrides.onClose ?? vi.fn()}
        onRefresh={overrides.onRefresh ?? vi.fn()}
        initialPostId={overrides.initialPostId ?? 1}
      />
    </QueryClientProvider>,
  );
}

/** Locates the native "Status" <select> inline in PostEditorBody -- there is no
 *  htmlFor/aria-labelledby link to its <label>, so getByLabelText can't find
 *  it. DOM order for the expanded post is fixed: Título (input), Tipo
 *  (select #0), Platform (mocked away, not a <select>), Status (select #1). */
function getStatusSelect(container: HTMLElement): HTMLSelectElement {
  return container.querySelectorAll('select.drawer-select')[1] as HTMLSelectElement;
}

function resolvedPost(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    titulo: 'Post A',
    status: 'aprovado_cliente',
    platform: 'instagram',
    scheduled_at: null,
    custom_status_id: null,
    ...overrides,
  };
}

/** Flushes every pending microtask before asserting a nudge did NOT open -- a
 *  bare queryByTestId right after the write would pass trivially before
 *  maybeNudge has had a chance to run. */
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdate.mockReset();
});

afterEach(() => {
  mockFeatures = null;
});

describe('WorkflowDrawer auto-schedule nudge', () => {
  it('opens the nudge after the status dropdown writes aprovado_cliente', async () => {
    mockFeatures = { feature_post_scheduling: true };
    mockGetPosts.mockResolvedValue([
      {
        id: 1,
        workflow_id: 10,
        titulo: 'Post A',
        conteudo: null,
        conteudo_plain: '',
        tipo: 'feed',
        ordem: 0,
        status: 'rascunho',
        responsavel_id: null,
        scheduled_at: null,
        ig_caption: null,
        platform: 'instagram',
      } as never,
    ]);
    mockUpdate.mockResolvedValue(
      resolvedPost({
        scheduled_at: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
      }) as never,
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = renderDrawer(qc);

    // Waits for mockGetPosts to resolve and Post A's row to expand -- its
    // "Tipo" select (index 0) shows the fixture's tipo, same wait-gate
    // WorkflowDrawer.test.tsx uses before touching any field on this post.
    await screen.findByDisplayValue('Feed');
    fireEvent.change(getStatusSelect(container), { target: { value: 'aprovado_cliente' } });

    expect(await screen.findByTestId('nudge')).toHaveTextContent('1');
  });

  it('opens the nudge from the "post aprovado" confirm path too', async () => {
    mockFeatures = { feature_post_scheduling: true };
    mockGetPosts.mockResolvedValue([
      {
        id: 1,
        workflow_id: 10,
        titulo: 'Post A',
        conteudo: null,
        conteudo_plain: '',
        tipo: 'feed',
        ordem: 0,
        status: 'aprovado_interno',
        responsavel_id: null,
        scheduled_at: null,
        ig_caption: null,
        platform: 'instagram',
      } as never,
    ]);
    mockUpdate.mockResolvedValue(resolvedPost() as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = renderDrawer(qc);

    await screen.findByDisplayValue('Feed');
    fireEvent.change(getStatusSelect(container), { target: { value: 'aprovado_cliente' } });

    expect(await screen.findByText('Post aprovado')).toBeInTheDocument();
    expect(mockUpdate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByTestId('nudge')).toHaveTextContent('1');
  });

  it('does not open the nudge when feature_post_scheduling is off', async () => {
    mockFeatures = { feature_post_scheduling: false };
    mockGetPosts.mockResolvedValue([
      {
        id: 1,
        workflow_id: 10,
        titulo: 'Post A',
        conteudo: null,
        conteudo_plain: '',
        tipo: 'feed',
        ordem: 0,
        status: 'rascunho',
        responsavel_id: null,
        scheduled_at: null,
        ig_caption: null,
        platform: 'instagram',
      } as never,
    ]);
    mockUpdate.mockResolvedValue(resolvedPost() as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = renderDrawer(qc);

    await screen.findByDisplayValue('Feed');
    fireEvent.change(getStatusSelect(container), { target: { value: 'aprovado_cliente' } });

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    await flush();
    expect(screen.queryByTestId('nudge')).toBeNull();
  });

  it('does not open the nudge when the client does not auto-publish', async () => {
    mockFeatures = { feature_post_scheduling: true };
    mockGetPosts.mockResolvedValue([
      {
        id: 1,
        workflow_id: 10,
        titulo: 'Post A',
        conteudo: null,
        conteudo_plain: '',
        tipo: 'feed',
        ordem: 0,
        status: 'rascunho',
        responsavel_id: null,
        scheduled_at: null,
        ig_caption: null,
        platform: 'instagram',
      } as never,
    ]);
    mockUpdate.mockResolvedValue(resolvedPost() as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = renderDrawer(qc, {
      card: {
        cliente: {
          id: 42,
          nome: 'Marca X',
          sigla: 'MX',
          cor: '#000',
          plano: 'pro',
          email: '',
          telefone: '',
          status: 'ativo',
          valor_mensal: 0,
          auto_publish_on_approval: false,
        },
      } as never,
    });

    await screen.findByDisplayValue('Feed');
    fireEvent.change(getStatusSelect(container), { target: { value: 'aprovado_cliente' } });

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    await flush();
    expect(screen.queryByTestId('nudge')).toBeNull();
  });

  // PR #400 regression on this surface too.
  it('does not open the nudge in the first cycle of a dual-approval fluxo', async () => {
    mockFeatures = { feature_post_scheduling: true };
    mockGetPosts.mockResolvedValue([
      {
        id: 1,
        workflow_id: 10,
        titulo: 'Post A',
        conteudo: null,
        conteudo_plain: '',
        tipo: 'feed',
        ordem: 0,
        status: 'rascunho',
        responsavel_id: null,
        scheduled_at: null,
        ig_caption: null,
        platform: 'instagram',
      } as never,
    ]);
    mockUpdate.mockResolvedValue(resolvedPost() as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = renderDrawer(qc, { card: { allEtapas: TWO_OPEN_APPROVALS } });

    await screen.findByDisplayValue('Feed');
    fireEvent.change(getStatusSelect(container), { target: { value: 'aprovado_cliente' } });

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    await flush();
    expect(screen.queryByTestId('nudge')).toBeNull();
  });

  it('does not open the nudge for a write to another status', async () => {
    mockFeatures = { feature_post_scheduling: true };
    mockGetPosts.mockResolvedValue([
      {
        id: 1,
        workflow_id: 10,
        titulo: 'Post A',
        conteudo: null,
        conteudo_plain: '',
        tipo: 'feed',
        ordem: 0,
        status: 'rascunho',
        responsavel_id: null,
        scheduled_at: null,
        ig_caption: null,
        platform: 'instagram',
      } as never,
    ]);
    mockUpdate.mockResolvedValue(resolvedPost({ status: 'revisao_interna' }) as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = renderDrawer(qc);

    await screen.findByDisplayValue('Feed');
    fireEvent.change(getStatusSelect(container), { target: { value: 'revisao_interna' } });

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    await flush();
    expect(screen.queryByTestId('nudge')).toBeNull();
  });

  // Decisão 5 da spec: tiktok-publish exige feature_tiktok além de
  // feature_post_scheduling (tiktok-publish/handler.ts:85-89).
  it('does not open the nudge for a tiktok post when feature_tiktok is off', async () => {
    mockFeatures = { feature_post_scheduling: true, feature_tiktok: false };
    mockGetPosts.mockResolvedValue([
      {
        id: 1,
        workflow_id: 10,
        titulo: 'Post A',
        conteudo: null,
        conteudo_plain: '',
        tipo: 'feed',
        ordem: 0,
        status: 'rascunho',
        responsavel_id: null,
        scheduled_at: null,
        ig_caption: null,
        platform: 'tiktok',
      } as never,
    ]);
    mockUpdate.mockResolvedValue(resolvedPost({ platform: 'tiktok' }) as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = renderDrawer(qc);

    await screen.findByDisplayValue('Feed');
    fireEvent.change(getStatusSelect(container), { target: { value: 'aprovado_cliente' } });

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    await flush();
    expect(screen.queryByTestId('nudge')).toBeNull();
  });

  it('opens the nudge for a tiktok post when feature_tiktok is on', async () => {
    mockFeatures = { feature_post_scheduling: true, feature_tiktok: true };
    mockGetPosts.mockResolvedValue([
      {
        id: 1,
        workflow_id: 10,
        titulo: 'Post A',
        conteudo: null,
        conteudo_plain: '',
        tipo: 'feed',
        ordem: 0,
        status: 'rascunho',
        responsavel_id: null,
        scheduled_at: null,
        ig_caption: null,
        platform: 'tiktok',
      } as never,
    ]);
    mockUpdate.mockResolvedValue(resolvedPost({ platform: 'tiktok' }) as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = renderDrawer(qc);

    await screen.findByDisplayValue('Feed');
    fireEvent.change(getStatusSelect(container), { target: { value: 'aprovado_cliente' } });

    expect(await screen.findByTestId('nudge')).toHaveTextContent('1');
  });

  it('opens the nudge for an instagram post even when feature_tiktok is off', async () => {
    // O gate é condicional à plataforma: um post de Instagram nunca toca
    // tiktok-publish, então feature_tiktok não pode bloqueá-lo.
    mockFeatures = { feature_post_scheduling: true, feature_tiktok: false };
    mockGetPosts.mockResolvedValue([
      {
        id: 1,
        workflow_id: 10,
        titulo: 'Post A',
        conteudo: null,
        conteudo_plain: '',
        tipo: 'feed',
        ordem: 0,
        status: 'rascunho',
        responsavel_id: null,
        scheduled_at: null,
        ig_caption: null,
        platform: 'instagram',
      } as never,
    ]);
    mockUpdate.mockResolvedValue(resolvedPost({ platform: 'instagram' }) as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = renderDrawer(qc);

    await screen.findByDisplayValue('Feed');
    fireEvent.change(getStatusSelect(container), { target: { value: 'aprovado_cliente' } });

    expect(await screen.findByTestId('nudge')).toHaveTextContent('1');
  });
});

// Task 5 — piece 3 of the auto-schedule nudge spec: the persistent indicator
// (drawer row badge + drawer header summary), gated by the exact same
// shouldOfferAutoSchedule call as the nudge dialogs above. Every fixture here
// sets an initial post `status` directly (no status-select write): the badge
// reacts to whatever the drawer already has loaded, which is the whole point
// -- it has to reach the existing backlog, not just newly-approved posts.
describe('persistent indicator (spec piece 3)', () => {
  const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const FUTURE = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();

  function basePost(overrides: Record<string, unknown> = {}) {
    return {
      id: 1,
      workflow_id: 10,
      titulo: 'Post A',
      conteudo: null,
      conteudo_plain: '',
      tipo: 'feed',
      ordem: 0,
      status: 'aprovado_cliente',
      responsavel_id: null,
      scheduled_at: PAST,
      ig_caption: null,
      platform: 'instagram',
      ...overrides,
    };
  }

  it('shows the badge on an aprovado_cliente post when every gate passes', async () => {
    // one open aprovacao_cliente etapa, auto_publish true, feature on,
    // post.status 'aprovado_cliente' with a date in the PAST (the backlog case)
    // -> badge present
    mockFeatures = { feature_post_scheduling: true };
    mockGetPosts.mockResolvedValue([basePost() as never]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);

    expect(await screen.findByRole('button', { name: /agendar/i })).toBeInTheDocument();
  });

  // The P0 the Codex review caught missing from this section of the spec.
  it('hides the badge in the first cycle of a dual-approval fluxo', async () => {
    // card.allEtapas = two OPEN aprovacao_cliente etapas -> no badge
    mockFeatures = { feature_post_scheduling: true };
    mockGetPosts.mockResolvedValue([basePost() as never]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc, { card: { allEtapas: TWO_OPEN_APPROVALS } });

    await screen.findByText('Post A');
    expect(screen.queryByRole('button', { name: /agendar/i })).toBeNull();
  });

  it('hides the badge when feature_post_scheduling is off', async () => {
    mockFeatures = { feature_post_scheduling: false };
    mockGetPosts.mockResolvedValue([basePost() as never]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);

    await screen.findByText('Post A');
    expect(screen.queryByRole('button', { name: /agendar/i })).toBeNull();
  });

  it('hides the badge when the client does not auto-publish on approval', async () => {
    mockFeatures = { feature_post_scheduling: true };
    mockGetPosts.mockResolvedValue([basePost() as never]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc, {
      card: {
        cliente: {
          id: 42,
          nome: 'Marca X',
          sigla: 'MX',
          cor: '#000',
          plano: 'pro',
          email: '',
          telefone: '',
          status: 'ativo',
          valor_mensal: 0,
          auto_publish_on_approval: false,
        },
      } as never,
    });

    await screen.findByText('Post A');
    expect(screen.queryByRole('button', { name: /agendar/i })).toBeNull();
  });

  it('hides the badge for a post in any other status', async () => {
    mockFeatures = { feature_post_scheduling: true };
    mockGetPosts.mockResolvedValue([basePost({ status: 'aprovado_interno' }) as never]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);

    await screen.findByText('Post A');
    expect(screen.queryByRole('button', { name: /agendar/i })).toBeNull();
  });

  // Decisão 5 da spec: o badge usa o MESMO gate do aviso, senão um post tiktok
  // sem o add-on ganharia um badge permanente que 403 a cada clique.
  it('hides the badge for a tiktok post when feature_tiktok is off', async () => {
    // mockFeatures = { feature_post_scheduling: true, feature_tiktok: false }
    // post.platform = 'tiktok' -> no badge
    mockFeatures = { feature_post_scheduling: true, feature_tiktok: false };
    mockGetPosts.mockResolvedValue([basePost({ platform: 'tiktok' }) as never]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);

    await screen.findByText('Post A');
    expect(screen.queryByRole('button', { name: /agendar/i })).toBeNull();
  });

  it('hides the badge for a both post when feature_tiktok is off', async () => {
    mockFeatures = { feature_post_scheduling: true, feature_tiktok: false };
    mockGetPosts.mockResolvedValue([basePost({ platform: 'both' }) as never]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);

    await screen.findByText('Post A');
    expect(screen.queryByRole('button', { name: /agendar/i })).toBeNull();
  });

  it('shows the badge for a tiktok post when feature_tiktok is on', async () => {
    mockFeatures = { feature_post_scheduling: true, feature_tiktok: true };
    mockGetPosts.mockResolvedValue([basePost({ platform: 'tiktok' }) as never]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);

    expect(await screen.findByRole('button', { name: /agendar/i })).toBeInTheDocument();
  });

  it('shows the badge for an instagram post when feature_tiktok is off', async () => {
    mockFeatures = { feature_post_scheduling: true, feature_tiktok: false };
    mockGetPosts.mockResolvedValue([basePost({ platform: 'instagram' }) as never]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);

    expect(await screen.findByRole('button', { name: /agendar/i })).toBeInTheDocument();
  });

  it('clicking the badge opens the same nudge dialog', async () => {
    // -> the AutoSchedulePromptDialog stub receives that post id
    mockFeatures = { feature_post_scheduling: true };
    mockGetPosts.mockResolvedValue([basePost({ scheduled_at: FUTURE }) as never]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);

    fireEvent.click(await screen.findByRole('button', { name: /agendar/i }));

    expect(await screen.findByTestId('nudge')).toHaveTextContent('1');
  });

  it('shows the header summary with the count of waiting posts', async () => {
    // 2 of 3 posts eligible for the indicator -> "2 aguardando agendamento automático"
    mockFeatures = { feature_post_scheduling: true };
    mockGetPosts.mockResolvedValue([
      basePost({ id: 1, titulo: 'Post A' }) as never,
      basePost({ id: 2, titulo: 'Post B' }) as never,
      basePost({ id: 3, titulo: 'Post C', status: 'aprovado_interno' }) as never,
    ]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);

    expect(await screen.findByText(/2 aguardando agendamento automático/)).toBeInTheDocument();
  });

  it('omits the header summary when no post qualifies', async () => {
    mockFeatures = { feature_post_scheduling: false };
    mockGetPosts.mockResolvedValue([basePost() as never]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);

    await screen.findByText('Post A');
    expect(screen.queryByText(/aguardando agendamento automático/)).toBeNull();
  });

  it('the header action opens the batch dialog for this fluxo', async () => {
    // -> AutoScheduleBatchDialog stub receives workflowId
    mockFeatures = { feature_post_scheduling: true };
    mockGetPosts.mockResolvedValue([basePost() as never]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);

    fireEvent.click(await screen.findByText(/aguardando agendamento automático/));

    expect(await screen.findByTestId('batch-dialog')).toHaveTextContent('10');
  });
});
