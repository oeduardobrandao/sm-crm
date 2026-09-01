import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BoardCard } from '../../hooks/useEntregasData';

// ── Mocks ─────────────────────────────────────────────────────────────────────
// WorkflowDrawer has no prior test harness (EntregasPage.test.tsx mocks WorkflowDrawer
// itself away entirely — see apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx).
// This file builds a minimal one: stub every heavy leaf component (editor, media gallery,
// TipTap, dnd-kit, etc.) so the drawer's own logic — the query wiring under test — is the
// only thing actually exercised. Patterns follow WorkflowCalendarView.test.tsx (dnd-kit +
// store mocking) and LandingPage.test.tsx (AuthContext mocking).

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, role: 'owner', loading: false, profile: null }),
}));

vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({
    limits: null,
    features: null,
    planName: null,
    isLoading: false,
    isUnlimited: true,
  }),
}));

// Inert stand-ins so useSortable/DndContext don't require a real drag provider in jsdom.
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

// WorkflowDrawer reads instagram_accounts/tiktok_accounts directly via the supabase client
// (not through store.ts) — no account of either kind for this test.
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

vi.mock('@/store', () => ({
  getWorkflowPostsWithProperties: vi.fn(),
  addWorkflowPost: vi.fn(),
  updateWorkflowPost: vi.fn(),
  removeWorkflowPost: vi.fn(),
  reorderWorkflowPosts: vi.fn(),
  sendPostsToCliente: vi.fn(),
  getPostApprovals: vi.fn(async () => []),
  getPostStatusEvents: vi.fn(async () => []),
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
  getWorkflows: vi.fn(async () => []),
  movePostsToNewFlow: vi.fn(),
  movePostsToExistingFlow: vi.fn(),
}));

// Real Radix DropdownMenu needs pointer-event machinery jsdom doesn't provide well;
// same convention as ClientesPage.test.tsx / WorkflowCard.badge.test.tsx -- render
// DropdownMenuContent unconditionally (no need to "open" the trigger) and turn
// DropdownMenuItem into a plain clickable button.
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

vi.mock('@/services/inlineImage', () => ({
  uploadInlineImage: vi.fn(),
  extractR2Keys: vi.fn(() => []),
  injectSignedUrls: vi.fn((content: unknown) => content),
  resolveInlineImageUrls: vi.fn(async () => ({})),
}));

// Heavy leaf components — stubbed out so only WorkflowDrawer's own logic runs.
vi.mock('@/pages/entregas/components/PostEditor', () => ({
  PostEditor: () => <div data-testid="post-editor-stub" />,
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
import {
  getWorkflowPostsWithProperties,
  updateWorkflowPost,
  getPostEditSuggestions,
  acceptEditSuggestion,
  syncMentions,
  detachPostsFromWorkflow,
  movePostsToNewFlow,
} from '@/store';

const mockGetPosts = vi.mocked(getWorkflowPostsWithProperties);
const mockUpdate = vi.mocked(updateWorkflowPost);
const mockGetEditSuggestions = vi.mocked(getPostEditSuggestions);
const mockAcceptEditSuggestion = vi.mocked(acceptEditSuggestion);
const mockSyncMentions = vi.mocked(syncMentions);
const mockDetach = vi.mocked(detachPostsFromWorkflow);
const mockMoveToNewFlow = vi.mocked(movePostsToNewFlow);

function renderDrawer(
  qc: QueryClient,
  overrides: {
    onClose?: () => void;
    onRefresh?: () => void;
    initialPostId?: number;
    onOpenWorkflow?: (workflowId: number) => void;
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
    },
    membro: undefined,
    deadline: null,
    totalEtapas: 1,
    etapaIdx: 0,
    allEtapas: [],
  } as unknown as BoardCard;

  return render(
    <QueryClientProvider client={qc}>
      <WorkflowDrawer
        card={card}
        membros={[]}
        onClose={overrides.onClose ?? vi.fn()}
        onRefresh={overrides.onRefresh ?? vi.fn()}
        initialPostId={overrides.initialPostId ?? 1}
        onOpenWorkflow={overrides.onOpenWorkflow}
      />
    </QueryClientProvider>,
  );
}

describe('WorkflowDrawer refresh() query invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    mockUpdate.mockResolvedValue({} as never);
  });

  it('invalidates the clientePosts query (day-dot markers) after a field change', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    renderDrawer(qc);

    // Post A is expanded via initialPostId; its "Tipo" select shows the current tipo label.
    const tipoSelect = await screen.findByDisplayValue('Feed');
    fireEvent.change(tipoSelect, { target: { value: 'reels' } });

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith(1, { tipo: 'reels' }));

    // The concrete failure this guards: without this invalidation, a sibling row's date
    // picker keeps showing stale/missing day-dot markers after this post's field changes
    // (incl. scheduled_at), because ['clientePosts', clienteId] never refetches while the
    // drawer stays open.
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clientePosts', 42] }),
    );
  });
});

describe('WorkflowDrawer edit-suggestion acceptance mention sync', () => {
  // accept_edit_suggestion writes workflow_posts.conteudo server-side, bypassing
  // updateWorkflowPost entirely -- this is the one call site where mention sync has to be
  // wired at the component call site instead of inside store.ts (see task-7 brief).
  const suggestion = {
    id: 200,
    post_id: 1,
    suggested_conteudo: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'mention',
              attrs: { entityType: 'membro', id: 7, label: 'Ana', parentId: null },
            },
          ],
        },
      ],
    },
    suggested_conteudo_plain: '@Ana confere',
    suggested_ig_caption: null,
    changed_fields: ['conteudo'],
    status: 'pending' as const,
    updated_at: '2026-08-01T00:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
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
    mockUpdate.mockResolvedValue({} as never);
    mockGetEditSuggestions.mockResolvedValue([suggestion] as never);
    mockAcceptEditSuggestion.mockResolvedValue(undefined as never);
  });

  it('syncs mentions from suggested_conteudo against the post id after acceptance', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);

    const acceptButton = await screen.findByRole('button', { name: 'Aceitar' });
    fireEvent.click(acceptButton);

    await waitFor(() => expect(mockAcceptEditSuggestion).toHaveBeenCalledWith(200));
    await waitFor(() => expect(mockSyncMentions).toHaveBeenCalledWith('workflow_post', 1, [7]));
  });

  it('does not sync mentions when the accepted suggestion did not change conteudo', async () => {
    mockGetEditSuggestions.mockResolvedValue([
      { ...suggestion, changed_fields: ['ig_caption'] },
    ] as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);

    const acceptButton = await screen.findByRole('button', { name: 'Aceitar' });
    fireEvent.click(acceptButton);

    await waitFor(() => expect(mockAcceptEditSuggestion).toHaveBeenCalledWith(200));
    expect(mockSyncMentions).not.toHaveBeenCalled();
  });

  it('does not sync mentions when changed_fields includes conteudo but suggested_conteudo is null (caption-only Story suggestion)', async () => {
    // Repro: hub StoryPostCard submits caption-only suggestions with
    // suggested_conteudo: null. upsert_edit_suggestion's IS DISTINCT FROM
    // comparison still puts 'conteudo' in changed_fields for that
    // null-vs-existing-doc diff, but accept_edit_suggestion COALESCEs and
    // keeps the stored conteudo untouched -- syncing from the null doc here
    // would wrongly wipe every mention for a post whose content didn't change.
    mockGetEditSuggestions.mockResolvedValue([
      { ...suggestion, suggested_conteudo: null, changed_fields: ['conteudo', 'ig_caption'] },
    ] as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);

    const acceptButton = await screen.findByRole('button', { name: 'Aceitar' });
    fireEvent.click(acceptButton);

    await waitFor(() => expect(mockAcceptEditSuggestion).toHaveBeenCalledWith(200));
    expect(mockSyncMentions).not.toHaveBeenCalled();
  });
});

describe('WorkflowDrawer schedule lock (status agendado)', () => {
  // The publish cron builds the Instagram container up to 1h before scheduled_at.
  // A tipo/platform change after that leaves the container in the old format, so
  // both controls must be locked alongside the date and caption while armed.
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPosts.mockResolvedValue([
      {
        id: 1,
        workflow_id: 10,
        titulo: 'Post A',
        conteudo: null,
        conteudo_plain: '',
        tipo: 'feed',
        ordem: 0,
        status: 'agendado',
        responsavel_id: null,
        scheduled_at: '2099-01-01T12:00:00Z',
        ig_caption: null,
        platform: 'instagram',
      } as never,
    ]);
    mockGetEditSuggestions.mockResolvedValue([] as never);
    mockUpdate.mockResolvedValue({} as never);
  });

  it('disables the tipo select and the PlatformSelector, and the warning names them', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);

    const tipoSelect = (await screen.findByDisplayValue('Feed')) as HTMLSelectElement;
    expect(tipoSelect.disabled).toBe(true);

    expect(screen.getByTestId('platform-selector-stub').getAttribute('data-disabled')).toBe('true');

    expect(screen.getByText(/Data, tipo, plataforma e legenda do Instagram/)).toBeTruthy();
  });

  it('keeps both editable while the post is not agendado', async () => {
    mockGetPosts.mockResolvedValue([
      {
        id: 1,
        workflow_id: 10,
        titulo: 'Post A',
        conteudo: null,
        conteudo_plain: '',
        tipo: 'feed',
        ordem: 0,
        status: 'aprovado_cliente',
        responsavel_id: null,
        scheduled_at: '2099-01-01T12:00:00Z',
        ig_caption: null,
        platform: 'instagram',
      } as never,
    ]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);

    const tipoSelect = (await screen.findByDisplayValue('Feed')) as HTMLSelectElement;
    expect(tipoSelect.disabled).toBe(false);
    expect(screen.getByTestId('platform-selector-stub').getAttribute('data-disabled')).toBe(
      'false',
    );
  });
});

describe('WorkflowDrawer Histórico tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  it('renders WorkflowHistoryView with the workflow id when the Histórico toggle is clicked', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);

    await screen.findByDisplayValue('Feed');
    fireEvent.click(screen.getByRole('button', { name: /Histórico/i }));

    expect(await screen.findByTestId('workflow-history-view-stub')).toHaveTextContent('history-10');
  });
});

describe('WorkflowDrawer desmembrar do fluxo (Task 15)', () => {
  // Two posts so partial vs. total selection is actually distinguishable --
  // the archive-empty-flow checkbox in the confirm dialog only shows when the
  // pending batch covers every post of this workflow (ids.length === posts.length).
  const postA = {
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
  } as never;

  const postB = {
    id: 2,
    workflow_id: 10,
    titulo: 'Post B',
    conteudo: null,
    conteudo_plain: '',
    tipo: 'feed',
    ordem: 1,
    status: 'rascunho',
    responsavel_id: null,
    scheduled_at: null,
    ig_caption: null,
    platform: 'instagram',
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPosts.mockResolvedValue([postA, postB]);
  });

  it('seleciona múltiplos posts e atualiza a contagem da barra de seleção', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc, { initialPostId: undefined });

    const checkboxA = await screen.findByRole('checkbox', { name: 'Selecionar Post A' });
    fireEvent.click(checkboxA);
    expect(await screen.findByText('1 selecionado')).toBeInTheDocument();

    const checkboxB = screen.getByRole('checkbox', { name: 'Selecionar Post B' });
    fireEvent.click(checkboxB);
    expect(await screen.findByText('2 selecionados')).toBeInTheDocument();
  });

  it('"Selecionar todos" marca todos os posts do fluxo', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc, { initialPostId: undefined });

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Selecionar Post A' }));
    await screen.findByText('1 selecionado');

    fireEvent.click(screen.getByRole('button', { name: 'Selecionar todos' }));

    expect(await screen.findByText('2 selecionados')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Selecionar Post A' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('checkbox', { name: 'Selecionar Post B' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('"Limpar" desmarca toda a seleção', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc, { initialPostId: undefined });

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Selecionar Post A' }));
    await screen.findByText('1 selecionado');

    fireEvent.click(screen.getByRole('button', { name: 'Limpar' }));

    await waitFor(() =>
      expect(screen.queryByTestId('drawer-selection-bar')).not.toBeInTheDocument(),
    );
  });

  it('o confirm só mostra o checkbox de arquivar quando a seleção cobre todos os posts do fluxo', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc, { initialPostId: undefined });

    // Partial selection: só Post A.
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Selecionar Post A' }));
    fireEvent.click(
      within(screen.getByTestId('drawer-selection-bar')).getByRole('button', {
        name: 'Desmembrar do fluxo',
      }),
    );

    await screen.findByText('Desmembrar do fluxo?');
    expect(screen.queryByText('Arquivar o fluxo depois de desmembrar')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByText('Desmembrar do fluxo?')).not.toBeInTheDocument());

    // Total selection: os dois posts.
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar todos' }));
    fireEvent.click(
      within(screen.getByTestId('drawer-selection-bar')).getByRole('button', {
        name: 'Desmembrar do fluxo',
      }),
    );

    await screen.findByText('Desmembrar do fluxo?');
    expect(screen.getByText('Arquivar o fluxo depois de desmembrar')).toBeInTheDocument();
  });

  it('chama o RPC com os ids selecionados e o boolean de arquivar quando o checkbox está marcado', async () => {
    mockDetach.mockResolvedValue({ ok: true, detached: 2, archived_workflow_ids: [10] } as never);
    const onClose = vi.fn();
    const onRefresh = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc, { initialPostId: undefined, onClose, onRefresh });

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Selecionar Post A' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar Post B' }));
    fireEvent.click(
      within(screen.getByTestId('drawer-selection-bar')).getByRole('button', {
        name: 'Desmembrar do fluxo',
      }),
    );

    await screen.findByText('Desmembrar do fluxo?');
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Arquivar o fluxo depois de desmembrar' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Desmembrar' }));

    await waitFor(() => expect(mockDetach).toHaveBeenCalledWith([1, 2], true));
    // Archived path: closes the drawer instead of refreshing its own (now pointless) queries.
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onRefresh).toHaveBeenCalled();
  });

  it('o kebab de um único post cai no mesmo confirm e desmembra só aquele post (sem checkbox de arquivar)', async () => {
    mockDetach.mockResolvedValue({ ok: true, detached: 1, archived_workflow_ids: [] } as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc, { initialPostId: undefined });

    const checkboxB = await screen.findByRole('checkbox', { name: 'Selecionar Post B' });
    const rowB = checkboxB.closest('.drawer-post-item') as HTMLElement;
    fireEvent.click(within(rowB).getByText('Desmembrar do fluxo'));

    await screen.findByText('Desmembrar do fluxo?');
    // Only 1 of 2 posts targeted -- not a total selection, so no archive option.
    expect(screen.queryByText('Arquivar o fluxo depois de desmembrar')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Desmembrar' }));

    await waitFor(() => expect(mockDetach).toHaveBeenCalledWith([2], false));
  });

  it('ao concluir sem arquivar: toasta, limpa a seleção e chama refresh() + onRefresh()', async () => {
    mockDetach.mockResolvedValue({ ok: true, detached: 1, archived_workflow_ids: [] } as never);
    const onRefresh = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    renderDrawer(qc, { initialPostId: undefined, onRefresh });

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Selecionar Post A' }));
    fireEvent.click(
      within(screen.getByTestId('drawer-selection-bar')).getByRole('button', {
        name: 'Desmembrar do fluxo',
      }),
    );
    await screen.findByText('Desmembrar do fluxo?');
    fireEvent.click(screen.getByRole('button', { name: 'Desmembrar' }));

    await waitFor(() => expect(mockDetach).toHaveBeenCalledWith([1], false));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    // refresh()'s own invalidation must cover ['active-posts'] -- every Publicações
    // surface reads that key, and a detached post's workflow_id just changed.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['active-posts'] });
    expect(screen.queryByTestId('drawer-selection-bar')).not.toBeInTheDocument();
  });

  it('toasta erro genérico quando a RPC rejeita com um identificador desconhecido, sem limpar a seleção', async () => {
    mockDetach.mockRejectedValue({ message: 'post_not_found' });
    const { toast } = await import('sonner');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc, { initialPostId: undefined });

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Selecionar Post A' }));
    fireEvent.click(
      within(screen.getByTestId('drawer-selection-bar')).getByRole('button', {
        name: 'Desmembrar do fluxo',
      }),
    );
    await screen.findByText('Desmembrar do fluxo?');
    // AlertDialogAction closes the confirm dialog on click regardless of the async
    // outcome (same as every other confirm in this file -- confirmDeletePost et al.
    // clear their pending state up front too), so the failure signal to assert on is
    // the toast, plus the selection itself surviving (only a *successful* detach
    // clears selectedPostIds) so the bar is still there for the user to retry.
    fireEvent.click(screen.getByRole('button', { name: 'Desmembrar' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Um ou mais posts não foram encontrados.'),
    );
    expect(await screen.findByText('1 selecionado')).toBeInTheDocument();
  });
});

describe('WorkflowDrawer mover para outro fluxo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      {
        id: 2,
        workflow_id: 10,
        titulo: 'Post B',
        conteudo: null,
        conteudo_plain: '',
        tipo: 'feed',
        ordem: 1,
        status: 'aprovado_cliente',
        responsavel_id: null,
        scheduled_at: null,
        ig_caption: null,
        platform: 'instagram',
      } as never,
    ]);
  });

  it('o kebab de um post abre o dialog com nome pré-preenchido e sem checkbox de arquivar (seleção parcial)', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc, { initialPostId: undefined });

    const checkboxB = await screen.findByRole('checkbox', { name: 'Selecionar Post B' });
    const rowB = checkboxB.closest('.drawer-post-item') as HTMLElement;
    fireEvent.click(within(rowB).getByText('Mover para outro fluxo'));

    // Dialog open: the "Novo fluxo" destination section is visible, the name
    // field is pre-seeded from the source flow's title.
    expect(await screen.findByText('Novo fluxo')).toBeInTheDocument();
    expect(screen.getByLabelText('Nome do novo fluxo')).toHaveValue('Campanha Julho (continuação)');
    // 1 of 2 posts targeted: not a total selection, so no archive option.
    expect(
      screen.queryByText('Arquivar o fluxo de origem depois de mover'),
    ).not.toBeInTheDocument();
    // Source has no template: the existing-flow destination is unavailable.
    expect(
      screen.getByText('Este fluxo não usa um modelo. Para mover os posts, crie um novo fluxo.'),
    ).toBeInTheDocument();
  });

  it('confirmar "novo fluxo" na barra de seleção move o lote e abre o drawer do destino', async () => {
    const seedWorkflow = { id: 77, cliente_id: 42, titulo: 'Campanha Julho (continuação)' };
    const seedEtapas = [{ id: 900, workflow_id: 77, ordem: 0, nome: 'Produção', status: 'ativo' }];
    mockMoveToNewFlow.mockResolvedValue({
      ok: true,
      moved: 2,
      target_workflow_id: 77,
      archived_workflow_ids: [10],
      workflow: seedWorkflow,
      etapas: seedEtapas,
    } as never);
    const onClose = vi.fn();
    const onRefresh = vi.fn();
    const onOpenWorkflow = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    renderDrawer(qc, { initialPostId: undefined, onClose, onRefresh, onOpenWorkflow });

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Selecionar Post A' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar Post B' }));
    fireEvent.click(
      within(screen.getByTestId('drawer-selection-bar')).getByRole('button', {
        name: 'Mover para outro fluxo',
      }),
    );

    // Total selection: the archive-source checkbox is offered; check it.
    const archive = await screen.findByRole('checkbox', {
      name: 'Arquivar o fluxo de origem depois de mover',
    });
    fireEvent.click(archive);
    fireEvent.click(screen.getByRole('button', { name: 'Mover' }));

    await waitFor(() =>
      expect(mockMoveToNewFlow).toHaveBeenCalledWith([1, 2], 10, {
        titulo: 'Campanha Julho (continuação)',
        startOrdem: 0,
        archiveEmptyFlow: true,
      }),
    );
    // Lands the user where the posts went: close this drawer, open the
    // target's -- carrying the new flow's row + etapas so the page can open
    // it without waiting for the board refetch.
    await waitFor(() =>
      expect(onOpenWorkflow).toHaveBeenCalledWith(77, {
        workflow: seedWorkflow,
        etapas: seedEtapas,
      }),
    );
    expect(onClose).toHaveBeenCalled();
    expect(onRefresh).toHaveBeenCalled();
    // The RPC can create/remap per-flow select options on the destination;
    // with the app's 30s staleTime a recently-opened destination would
    // otherwise render the remapped value as "Vazio" from a stale cache.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workflow-select-options', 77] });
  });
});
