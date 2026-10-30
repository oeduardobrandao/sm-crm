import { useState } from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BoardCard } from '../../hooks/useEntregasData';
import { makeCan, fakeMembership } from '@/test/makeCan';

// ── Mocks ─────────────────────────────────────────────────────────────────────
// WorkflowDrawer has no prior test harness (EntregasPage.test.tsx mocks WorkflowDrawer
// itself away entirely — see apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx).
// This file builds a minimal one: stub every heavy leaf component (editor, media gallery,
// TipTap, dnd-kit, etc.) so the drawer's own logic — the query wiring under test — is the
// only thing actually exercised. Patterns follow WorkflowCalendarView.test.tsx (dnd-kit +
// store mocking) and LandingPage.test.tsx (AuthContext mocking).

// Desktop layout; the phone branch has its own suite (WorkflowDrawerPhone.test.tsx).
// Feedback em mídia: the drawers fetch client notes by path (not through the mocked '@/store').
vi.mock('@/store/mediaNotes', () => ({
  getMediaNotes: async () => [],
  mediaNotesKey: (ids: number[]) => ['media-notes', ids.join(',')],
  replyToMediaNote: async () => undefined,
  setMediaNoteStatus: async () => undefined,
}));

vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));

// Desktop editor: jsdom's matchMedia reports no match, which would render the phone editor.
vi.mock('@/pages/entregas/components/postEditorPhone/useIsPhoneEditor', () => ({
  useIsPhoneEditor: () => false,
}));
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

// Mutable so the Task-11-fix "manter etapas" test can flip feature_post_processes
// on for just that describe block; every other test keeps the flag off (default null).
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

// Inert stand-ins so useSortable/DndContext don't require a real drag provider in jsdom.
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  closestCenter: () => null,
  PointerSensor: class {},
  MouseSensor: class {},
  TouchSensor: class {},
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
  isFinalClientApprovalCycle: vi.fn(() => true),
  cardAutoScheduleGates: vi.fn(() => ({ autoPublishOnApproval: true, isFinalApprovalCycle: true })),
  removeWorkflowPost: vi.fn(),
  reorderWorkflowPosts: vi.fn(),
  sendPostsToCliente: vi.fn(),
  sendSelectedPostsToCliente: vi.fn(),
  isSendableFromSelection: (s: string) =>
    !['enviado_cliente', 'aprovado_cliente', 'agendado', 'postado', 'falha_publicacao'].includes(s),
  getPostApprovals: vi.fn(async () => []),
  getPostStatusEvents: vi.fn(async () => []),
  getPostProcessEvents: vi.fn(async () => []),
  replyToPostApproval: vi.fn(),
  completeEtapa: vi.fn(),
  getPostCommentThreads: vi.fn(async () => []),
  getDiscussaoNaoLidas: vi.fn(async () => []),
  createCommentThread: vi.fn(),
  saveIgCaption: vi.fn(),
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

// The suggestion move guard reads this by path (not through the '@/store' barrel).
vi.mock('@/store/posts', () => ({ hasPendingEditSuggestion: vi.fn(async () => false) }));
// PostEditorBody and WorkflowDrawer read client references from this module by path.
vi.mock('@/store/postReferences', () => ({
  getPostReferences: vi.fn(async () => []),
  getPostReferenceCounts: vi.fn(async () => ({})),
  deletePostReference: vi.fn(),
}));

// extractR2Keys/injectSignedUrls are pure doc-walking helpers -- use the real
// implementations so the R2-image-mount-gating test below exercises actual TipTap
// inlineImage nodes instead of a hand-rolled fake. Only the network call
// (resolveInlineImageUrls) and the upload call stay mocked.
vi.mock('@/services/inlineImage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/inlineImage')>();
  return {
    uploadInlineImage: vi.fn(),
    extractR2Keys: actual.extractR2Keys,
    injectSignedUrls: actual.injectSignedUrls,
    stripSignedUrls: actual.stripSignedUrls,
    resolveInlineImageUrls: vi.fn(async () => ({})),
  };
});

// Heavy leaf components — stubbed out so only WorkflowDrawer's own logic runs.
vi.mock('@/pages/entregas/components/PostEditor', () => ({
  // Real PostEditor hydrates TipTap's `content` once at mount (useEditor has no deps array;
  // see PostEditor.tsx) and never syncs it again on prop changes -- only a full remount (new
  // `key`) re-hydrates it. Mirror that here with useState's lazy initializer, captured once
  // per mount, so the suggestion-acceptance race test below can tell "remounted with stale
  // content" apart from "re-rendered with fresh content" the way the real editor would.
  PostEditor: ({
    initialContent,
    onDeleteComment,
  }: {
    initialContent: unknown;
    onDeleteComment?: (commentId: number, threadId: number) => Promise<void>;
  }) => {
    const [frozenContent] = useState(initialContent);
    return (
      <div data-testid="post-editor-stub" data-content={JSON.stringify(frozenContent)}>
        <button type="button" onClick={() => void onDeleteComment?.(10, 1)}>
          delete comment stub
        </button>
      </div>
    );
  },
}));
vi.mock('@/pages/entregas/components/PropertyPanel', () => ({
  PropertyPanel: () => <div data-testid="property-panel-stub" />,
}));
vi.mock('@/pages/entregas/components/PostCommentSummary', () => ({
  default: () => <div data-testid="post-comment-summary-stub" />,
}));
// The post's team discussion mounts a MentionEditor (needs getMembros on the @/store mock)
// and useDiscussao opens a realtime channel (this supabase stub has no channel/rpc):
// stub both, they have their own suites.
vi.mock('@/pages/entregas/discussao/DiscussaoEquipe', () => ({
  DiscussaoEquipe: ({
    focusRequest,
    onFocusHandled,
  }: {
    focusRequest?: number;
    onFocusHandled?: () => void;
  }) => (
    <div data-testid="discussao-equipe-stub" data-autofocus={String(!!focusRequest)}>
      <button type="button" onClick={onFocusHandled}>
        stub focused
      </button>
    </div>
  ),
  DiscussaoTimeline: () => null,
}));
vi.mock('@/pages/entregas/discussao/useDiscussao', () => ({
  useDiscussao: () => ({
    participacao: undefined,
    isParticipant: false,
    naoLidas: 0,
    unreadAnchorId: null,
    send: async () => {},
    sending: false,
    toggleSeguir: async () => {},
    sectionRef: () => {},
  }),
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
  useScheduleActions: () => ({}),
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
  detachPostsKeepingProcess,
  movePostsToNewFlow,
  addWorkflowPost,
  sendSelectedPostsToCliente,
  getPostCommentThreads,
  getDiscussaoNaoLidas,
  deleteCommentThread,
  deletePostComment,
} from '@/store';
import { hasPendingEditSuggestion } from '@/store/posts';
import { resolveInlineImageUrls } from '@/services/inlineImage';
import { POST_STATUS_DEFINITIONS_QUERY_KEY } from '@/hooks/useStatusRegistry';

const mockGetPosts = vi.mocked(getWorkflowPostsWithProperties);
const mockResolveInlineImageUrls = vi.mocked(resolveInlineImageUrls);
const mockUpdate = vi.mocked(updateWorkflowPost);
const mockHasPending = vi.mocked(hasPendingEditSuggestion);
const mockGetEditSuggestions = vi.mocked(getPostEditSuggestions);
const mockAcceptEditSuggestion = vi.mocked(acceptEditSuggestion);
const mockSyncMentions = vi.mocked(syncMentions);
const mockDetach = vi.mocked(detachPostsFromWorkflow);
const mockDetachKeepingProcess = vi.mocked(detachPostsKeepingProcess);
const mockMoveToNewFlow = vi.mocked(movePostsToNewFlow);
const mockAddPost = vi.mocked(addWorkflowPost);
const mockSendSelected = vi.mocked(sendSelectedPostsToCliente);
const mockGetThreads = vi.mocked(getPostCommentThreads);
const mockGetNaoLidas = vi.mocked(getDiscussaoNaoLidas);

function renderDrawer(
  qc: QueryClient,
  overrides: {
    onClose?: () => void;
    onRefresh?: () => void;
    initialPostId?: number;
    focusRequest?: number;
    onDiscussaoFocused?: () => void;
    onOpenWorkflow?: (workflowId: number) => void;
    onDetachedKeepingProcess?: (postIds: number[]) => void;
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
    },
    membro: undefined,
    deadline: null,
    totalEtapas: 1,
    etapaIdx: 0,
    allEtapas: [],
    ...overrides.card,
  } as unknown as BoardCard;

  const onClose = overrides.onClose ?? vi.fn();
  const onRefresh = overrides.onRefresh ?? vi.fn();
  const tree = (o: typeof overrides) => (
    <QueryClientProvider client={qc}>
      <WorkflowDrawer
        card={card}
        membros={[]}
        onClose={onClose}
        onRefresh={onRefresh}
        initialPostId={o.initialPostId ?? 1}
        focusRequest={o.focusRequest}
        onDiscussaoFocused={o.onDiscussaoFocused}
        onOpenWorkflow={o.onOpenWorkflow}
        onDetachedKeepingProcess={o.onDetachedKeepingProcess}
      />
    </QueryClientProvider>
  );
  const utils = render(tree(overrides));
  /** Re-renders the SAME drawer instance with other props (no remount). */
  const rerenderWith = (o: typeof overrides) => utils.rerender(tree({ ...overrides, ...o }));
  return { ...utils, rerenderWith };
}

// mockFeatures is set true only inside the "handleDetachedKeepingProcess" describe
// below; reset it after every test so that flag can't leak into unrelated ones.
afterEach(() => {
  mockFeatures = null;
});

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

    // Post A is expanded via initialPostId; its "Tipo" toggle has the current tipo checked.
    await screen.findByRole('radio', { name: 'Imagem', checked: true });
    fireEvent.click(screen.getByRole('radio', { name: 'Vídeo vertical' }));

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
    // The base the client started from: equal to the live post below, so nothing conflicts
    // (a NULL base would read as '' and still match here, but state it).
    original_conteudo: null,
    original_conteudo_plain: '',
    original_ig_caption: null,
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

    await waitFor(() =>
      expect(mockAcceptEditSuggestion).toHaveBeenCalledWith(
        200,
        '2026-08-01T00:00:00Z',
        ['texto'],
        [],
      ),
    );
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

    await waitFor(() =>
      expect(mockAcceptEditSuggestion).toHaveBeenCalledWith(
        200,
        '2026-08-01T00:00:00Z',
        ['legenda'],
        [],
      ),
    );
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

    await waitFor(() =>
      // `conteudo` with a NULL doc is not a texto change: only the legenda is offered.
      expect(mockAcceptEditSuggestion).toHaveBeenCalledWith(
        200,
        '2026-08-01T00:00:00Z',
        ['legenda'],
        [],
      ),
    );
    expect(mockSyncMentions).not.toHaveBeenCalled();
  });

  it('accepts without a dialog when nothing conflicts', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);

    fireEvent.click(await screen.findByRole('button', { name: 'Aceitar' }));

    await waitFor(() => expect(mockAcceptEditSuggestion).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog', { name: 'Aceitar a sugestão?' })).toBeNull();
  });

  it('a no-conflict accept that the server rejects as suggestion_conflict shows the review-again toast and refetches', async () => {
    // The drawer's post prop was stale: another member edited the caption after it opened, so the
    // card showed no conflict and sent no acknowledgement. The server re-checks and refuses.
    const { toast } = await import('sonner');
    mockAcceptEditSuggestion.mockRejectedValue({ message: 'suggestion_conflict' });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    renderDrawer(qc);

    fireEvent.click(await screen.findByRole('button', { name: 'Aceitar' }));

    await waitFor(() =>
      expect(mockAcceptEditSuggestion).toHaveBeenCalledWith(
        200,
        '2026-08-01T00:00:00Z',
        ['texto'],
        [],
      ),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'O post mudou desde que você abriu. Revise a sugestão de novo.',
      ),
    );
    expect(toast.error).not.toHaveBeenCalledWith('Erro ao aceitar sugestão');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['post-edit-suggestions'] });
    expect(mockSyncMentions).not.toHaveBeenCalled();
  });

  describe('when the team edited a field the client also changed', () => {
    // texto: the client added a mention; the team edited the legenda since. Aceitar… asks first.
    const captionClash = {
      ...suggestion,
      suggested_ig_caption: 'Legenda do cliente',
      original_ig_caption: 'Legenda base',
      changed_fields: ['conteudo', 'ig_caption'],
    };
    const teamPost = (over: Record<string, unknown>) =>
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
          ig_caption: 'Legenda da equipe',
          platform: 'instagram',
          ...over,
        } as never,
      ]);

    it('opens the dialog from "Aceitar…" and sends only the non-conflicting field by default', async () => {
      teamPost({});
      mockGetEditSuggestions.mockResolvedValue([captionClash] as never);
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      renderDrawer(qc);

      fireEvent.click(await screen.findByRole('button', { name: 'Aceitar…' }));
      expect(mockAcceptEditSuggestion).not.toHaveBeenCalled();
      const dialog = await screen.findByRole('dialog', { name: 'Aceitar a sugestão?' });
      expect(
        within(dialog).getByRole('radio', { name: 'Manter a versão da equipe' }),
      ).toBeChecked();

      fireEvent.click(within(dialog).getByRole('button', { name: 'Aceitar sugestão' }));
      await waitFor(() =>
        expect(mockAcceptEditSuggestion).toHaveBeenCalledWith(
          200,
          '2026-08-01T00:00:00Z',
          ['texto'],
          [],
        ),
      );
      // texto was applied, so the mention from the client's doc is synced.
      await waitFor(() => expect(mockSyncMentions).toHaveBeenCalledWith('workflow_post', 1, [7]));
    });

    it('sends the conflicting field too when the reviewer picks the client version', async () => {
      teamPost({});
      mockGetEditSuggestions.mockResolvedValue([captionClash] as never);
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      renderDrawer(qc);

      fireEvent.click(await screen.findByRole('button', { name: 'Aceitar…' }));
      const dialog = await screen.findByRole('dialog', { name: 'Aceitar a sugestão?' });
      fireEvent.click(within(dialog).getByRole('radio', { name: 'Usar a versão do cliente' }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Aceitar sugestão' }));

      await waitFor(() =>
        expect(mockAcceptEditSuggestion).toHaveBeenCalledWith(
          200,
          '2026-08-01T00:00:00Z',
          ['texto', 'legenda'],
          ['legenda'],
        ),
      );
    });

    it('does not sync mentions when the team texto is kept', async () => {
      // Both fields clash and the reviewer keeps the team's texto: the live doc (and its
      // mentions) stays, so syncing from the suggestion's doc would wipe them.
      teamPost({ conteudo_plain: 'Texto da equipe' });
      mockGetEditSuggestions.mockResolvedValue([
        { ...captionClash, original_conteudo_plain: 'Texto base' },
      ] as never);
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      renderDrawer(qc);

      fireEvent.click(await screen.findByRole('button', { name: 'Aceitar…' }));
      const dialog = await screen.findByRole('dialog', { name: 'Aceitar a sugestão?' });
      // Texto keeps the team version (default); legenda goes to the client.
      fireEvent.click(
        within(dialog).getAllByRole('radio', { name: 'Usar a versão do cliente' })[1],
      );
      fireEvent.click(within(dialog).getByRole('button', { name: 'Aceitar sugestão' }));

      await waitFor(() =>
        expect(mockAcceptEditSuggestion).toHaveBeenCalledWith(
          200,
          '2026-08-01T00:00:00Z',
          ['legenda'],
          ['legenda'],
        ),
      );
      expect(mockSyncMentions).not.toHaveBeenCalled();
    });

    it('shows the review-again toast and refetches when the server reports suggestion_conflict', async () => {
      const { toast } = await import('sonner');
      teamPost({});
      mockGetEditSuggestions.mockResolvedValue([captionClash] as never);
      mockAcceptEditSuggestion.mockRejectedValue({ message: 'suggestion_conflict' });
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      renderDrawer(qc);

      fireEvent.click(await screen.findByRole('button', { name: 'Aceitar…' }));
      const dialog = await screen.findByRole('dialog', { name: 'Aceitar a sugestão?' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Aceitar sugestão' }));

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          'O post mudou desde que você abriu. Revise a sugestão de novo.',
        ),
      );
      expect(toast.error).not.toHaveBeenCalledWith('Erro ao aceitar sugestão');
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['post-edit-suggestions'] });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['workflow-posts-with-props', expect.anything()],
      });
      expect(mockSyncMentions).not.toHaveBeenCalled();
    });
  });

  it('remounts the editor with the accepted content, not the stale pre-suggestion doc', async () => {
    // Regression test: accepting a suggestion used to bump editorVersions (which remounts
    // <PostEditor> via its key) before the ['workflow-posts-with-props'] refetch it triggers
    // had actually landed. PostEditor only ever reads `initialContent` once, at mount (see
    // PostEditor.tsx), so that remount could hydrate the editor from the query cache's still-
    // stale pre-suggestion post.conteudo -- and the next autosave would write that stale doc
    // back over the suggestion that was just accepted. See CLAUDE.md-adjacent debugging notes:
    // client "Enviado ao cliente" -> "via sugestão aceita" -> content reverts, no user edit.
    //
    // The diff-card-vs-<PostEditor> swap is gated by `editSuggestion` clearing (the
    // post-edit-suggestions query going empty), not directly by the editorVersions bump --
    // see PostEditorBody.tsx's `editSuggestion ? <diff card> : <PostEditor .../>`. In
    // production post-edit-suggestions is a lean single-table query that resolves well
    // before the heavier joined workflow-posts-with-props, so the mocks below deliberately
    // let suggestions clear fast while holding the posts refetch pending -- mirroring that
    // ordering instead of coincidentally matching it, so this test actually fails without
    // the WorkflowDrawer await (see git history) rather than passing by mock-timing luck.
    const oldContent = { type: 'doc', content: [{ type: 'paragraph', content: [] }] };
    const acceptedContent = suggestion.suggested_conteudo;
    const oldPost = {
      id: 1,
      workflow_id: 10,
      titulo: 'Post A',
      conteudo: oldContent,
      conteudo_plain: '',
      tipo: 'feed',
      ordem: 0,
      status: 'rascunho',
      responsavel_id: null,
      scheduled_at: null,
      ig_caption: null,
      platform: 'instagram',
    };
    const acceptedPost = { ...oldPost, conteudo: acceptedContent, conteudo_plain: '@Ana confere' };

    let resolvePostsRefetch!: (posts: unknown) => void;
    const postsRefetchPromise = new Promise((resolve) => {
      resolvePostsRefetch = resolve;
    });

    mockGetPosts
      .mockResolvedValueOnce([oldPost] as never)
      .mockImplementationOnce(() => postsRefetchPromise as never)
      .mockResolvedValue([acceptedPost] as never);
    mockGetEditSuggestions.mockResolvedValueOnce([suggestion] as never).mockResolvedValue([]);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);

    const acceptButton = await screen.findByRole('button', { name: 'Aceitar' });
    fireEvent.click(acceptButton);

    await waitFor(() =>
      expect(mockAcceptEditSuggestion).toHaveBeenCalledWith(
        200,
        '2026-08-01T00:00:00Z',
        ['texto'],
        [],
      ),
    );

    // While the posts refetch that handleAcceptSuggestion explicitly awaits is still
    // pending, refresh() (which invalidates post-edit-suggestions) must not have fired
    // yet either -- so the diff card, gated on editSuggestion, is still up. This is the
    // assertion that fails without the WorkflowDrawer await: without it, editorVersions
    // bumps and refresh() fires immediately, suggestions clears, and <PostEditor> mounts
    // here against the still-stale cached post.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByRole('button', { name: 'Aceitar' })).toBeInTheDocument();

    resolvePostsRefetch([acceptedPost]);

    // Re-query inside waitFor (not a captured reference) -- the diff card only swaps to
    // <PostEditor> once suggestions clears, which replaces this DOM node entirely.
    await waitFor(() => {
      const editorStub = screen.getByTestId('post-editor-stub');
      expect(JSON.parse(editorStub.getAttribute('data-content') ?? 'null')).toEqual(
        acceptedContent,
      );
    });
  });

  it('withholds the editor mount until inline R2 image URLs resolve, instead of freezing on unsigned refs', async () => {
    // Same freeze-at-mount hazard as the test above, one layer down: PostEditorBody's
    // R2 signed-URL resolution is genuinely async (unlike the plain-content path, which
    // is now synchronous), so a <PostEditor> mount landing before resolveInlineImageUrls
    // settles would freeze with the raw, unsigned r2Key and never show the image. This
    // isn't specific to the accept-suggestion flow -- it's the general "PostEditor never
    // re-syncs after mount" hazard -- but accepting a suggestion is the easiest way to
    // force a fresh mount in this test harness.
    const oldContent = { type: 'doc', content: [{ type: 'paragraph', content: [] }] };
    const acceptedContentWithImage = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [] },
        { type: 'inlineImage', attrs: { r2Key: 'img-abc', src: null } },
      ],
    };
    const suggestionWithImage = { ...suggestion, suggested_conteudo: acceptedContentWithImage };
    const oldPost = {
      id: 1,
      workflow_id: 10,
      titulo: 'Post A',
      conteudo: oldContent,
      conteudo_plain: '',
      tipo: 'feed',
      ordem: 0,
      status: 'rascunho',
      responsavel_id: null,
      scheduled_at: null,
      ig_caption: null,
      platform: 'instagram',
    };
    const acceptedPost = {
      ...oldPost,
      conteudo: acceptedContentWithImage,
      conteudo_plain: '@Ana confere',
    };

    mockGetPosts
      .mockResolvedValueOnce([oldPost] as never)
      .mockResolvedValue([acceptedPost] as never);
    mockGetEditSuggestions
      .mockResolvedValueOnce([suggestionWithImage] as never)
      .mockResolvedValue([]);

    let resolveSignedUrls!: (urls: Record<string, string>) => void;
    const signedUrlsPromise = new Promise<Record<string, string>>((resolve) => {
      resolveSignedUrls = resolve;
    });
    mockResolveInlineImageUrls.mockReturnValue(signedUrlsPromise);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);

    const acceptButton = await screen.findByRole('button', { name: 'Aceitar' });
    fireEvent.click(acceptButton);

    await waitFor(() =>
      expect(mockAcceptEditSuggestion).toHaveBeenCalledWith(
        200,
        '2026-08-01T00:00:00Z',
        ['texto'],
        [],
      ),
    );

    // The diff card clears once posts + suggestions settle, but the signed-URL fetch is
    // still pending -- the editor must not mount yet with the unsigned content.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Aceitar' })).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId('post-editor-stub')).not.toBeInTheDocument();
    expect(screen.getByText('Carregando conteúdo…')).toBeInTheDocument();

    resolveSignedUrls({ 'img-abc': 'https://signed.example/img-abc' });

    await waitFor(() => {
      const editorStub = screen.getByTestId('post-editor-stub');
      const content = JSON.parse(editorStub.getAttribute('data-content') ?? 'null');
      expect(content.content[1].attrs.src).toBe('https://signed.example/img-abc');
    });
  });

  it('asks to review again, and refetches, when the client updated the suggestion meanwhile', async () => {
    const { toast } = await import('sonner');
    mockAcceptEditSuggestion.mockRejectedValue({ message: 'suggestion_changed' });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    renderDrawer(qc);

    fireEvent.click(await screen.findByRole('button', { name: 'Aceitar' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'A sugestão foi atualizada pelo cliente. Revise a nova versão.',
      ),
    );
    expect(toast.error).not.toHaveBeenCalledWith('Erro ao aceitar sugestão');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['post-edit-suggestions'] });
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

  it('disables the tipo toggle and the PlatformSelector, and the warning names them', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);

    const tipoItem = await screen.findByRole('radio', { name: 'Imagem' });
    expect(tipoItem).toBeDisabled();

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

    const tipoItem = await screen.findByRole('radio', { name: 'Imagem' });
    expect(tipoItem).not.toBeDisabled();
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

    await screen.findByRole('radio', { name: 'Imagem', checked: true });
    // Exact match: the expanded post row also renders a "Histórico de versões"
    // button (PostVersionHistorySheet's entry point), which a loose /Histórico/i
    // regex would ambiguously match too.
    fireEvent.click(screen.getByRole('button', { name: 'Histórico' }));

    expect(await screen.findByTestId('workflow-history-view-stub')).toHaveTextContent('history-10');
  });
});

describe('WorkflowDrawer posts count', () => {
  const basePost = {
    workflow_id: 10,
    conteudo: null,
    conteudo_plain: '',
    tipo: 'feed',
    status: 'rascunho',
    responsavel_id: null,
    scheduled_at: null,
    ig_caption: null,
    platform: 'instagram',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows how many posts the fluxo has in the section header', async () => {
    mockGetPosts.mockResolvedValue([
      { ...basePost, id: 1, titulo: 'Post A', ordem: 0 },
      { ...basePost, id: 2, titulo: 'Post B', ordem: 1 },
      { ...basePost, id: 3, titulo: 'Post C', ordem: 2 },
    ] as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);

    expect(await screen.findByText('Posts (3)')).toBeInTheDocument();
  });

  it('shows zero for an empty fluxo', async () => {
    mockGetPosts.mockResolvedValue([]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);

    expect(await screen.findByText('Posts (0)')).toBeInTheDocument();
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

  it('"Enviar ao cliente" na barra envia os selecionados (mesmo em rascunho) após confirmar', async () => {
    mockSendSelected.mockResolvedValue(2);
    const onRefresh = vi.fn();
    const { toast } = await import('sonner');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc, { initialPostId: undefined, onRefresh });

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Selecionar Post A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar todos' }));
    await screen.findByText('2 selecionados');
    fireEvent.click(
      within(screen.getByTestId('drawer-selection-bar')).getByRole('button', {
        name: 'Enviar ao cliente',
      }),
    );

    await screen.findByText('Enviar 2 posts ao cliente?');
    expect(mockSendSelected).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar ao cliente' }));

    await waitFor(() => expect(mockSendSelected).toHaveBeenCalledWith(10, [1, 2]));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith('2 posts enviados ao cliente!');
    expect(screen.queryByTestId('drawer-selection-bar')).not.toBeInTheDocument();
  });

  it('"Enviar ao cliente" pula posts já no portal e avisa quando nenhum selecionado pode ir', async () => {
    mockGetPosts.mockResolvedValue([
      { ...(postA as object), status: 'enviado_cliente' },
      { ...(postB as object), status: 'aprovado_cliente' },
    ] as never);
    const { toast } = await import('sonner');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc, { initialPostId: undefined });

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Selecionar Post A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar todos' }));
    await screen.findByText('2 selecionados');
    fireEvent.click(
      within(screen.getByTestId('drawer-selection-bar')).getByRole('button', {
        name: 'Enviar ao cliente',
      }),
    );

    expect(toast.error).toHaveBeenCalledWith(
      'Nenhum dos posts selecionados pode ser enviado. Eles já estão no portal, aprovados ou agendados.',
    );
    expect(screen.queryByText(/ao cliente\?$/)).not.toBeInTheDocument();
    expect(mockSendSelected).not.toHaveBeenCalled();
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

  it('o cabeçalho copia o link do fluxo (?drawer=<workflowId>)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc, { initialPostId: undefined });

    fireEvent.click(await screen.findByRole('button', { name: 'Copiar link do fluxo' }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/entregas?drawer=10`),
    );
  });

  it('o kebab de um post copia o link universal (?post=) do post, não o `?drawer=&post=`', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc, { initialPostId: undefined });

    const checkboxB = await screen.findByRole('checkbox', { name: 'Selecionar Post B' });
    const rowB = checkboxB.closest('.drawer-post-item') as HTMLElement;
    fireEvent.click(within(rowB).getByText('Copiar link do post'));

    // Universal `?post=` form (not `?drawer=<workflowId>&post=<id>`): resolves correctly
    // even if the post is later moved to another fluxo before the link is opened.
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/entregas?post=2`),
    );
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

describe('WorkflowDrawer handleDetachedKeepingProcess (Task 11 fix round 1)', () => {
  // Card wired so DetachPostsDialog's keepStepsAvailability() resolves to
  // available (see DetachPostsDialog.tsx §5.1): fluxo ativo (default card
  // fixture already has workflow.status: 'ativo'), exactly one etapa ativa in
  // allEtapas, and a computable deadline for it (data_limite set, so
  // buildDetachDeadlines() -- detachDeadlines.ts -- doesn't fall back to null).
  const etapaAtiva = {
    id: 1,
    workflow_id: 10,
    ordem: 0,
    nome: 'Produção',
    prazo_dias: 3,
    tipo_prazo: 'uteis',
    status: 'ativo',
    data_limite: '2026-09-20',
  } as never;

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

  beforeEach(() => {
    vi.clearAllMocks();
    mockFeatures = { feature_post_processes: true };
    mockGetPosts.mockResolvedValue([postA]);
  });

  it("extracts post_id (not process_id) from detachPostsKeepingProcess's result.processes and forwards only that to onDetachedKeepingProcess", async () => {
    // Realistic RPC return shape per the migration SQL / DetachKeepingProcessResult
    // (store/postProcesses.ts): processes carries BOTH process_id and post_id, and
    // they deliberately differ here so a handler that grabbed the wrong field
    // would fail this assertion.
    mockDetachKeepingProcess.mockResolvedValue({
      ok: true,
      request_id: 'req-1',
      detached: 1,
      archived_workflow_ids: [],
      processes: [
        {
          process_id: 999,
          post_id: 1,
          etapa_atual: 0,
          revisao: 1,
          board_position: 0,
          assinatura: 'sig',
          origem_workflow_id: 10,
          origem_descricao: 'Campanha Julho',
        },
      ],
      steps: [],
    } as never);

    const onDetachedKeepingProcess = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc, {
      initialPostId: undefined,
      onDetachedKeepingProcess,
      card: { allEtapas: [etapaAtiva] },
    });

    // Single-post kebab flow (same pattern as the Task 15 "kebab de um único
    // post" test above): locate the post row via its checkbox, click the
    // row's own "Desmembrar do fluxo" item.
    const checkboxA = await screen.findByRole('checkbox', { name: 'Selecionar Post A' });
    const rowA = checkboxA.closest('.drawer-post-item') as HTMLElement;
    fireEvent.click(within(rowA).getByText('Desmembrar do fluxo'));

    await screen.findByText('Desmembrar do fluxo?');
    // "Manter etapas" is available (single active step + computable deadline)
    // and selected by default; click it explicitly so this doesn't depend on
    // that default surviving future changes.
    fireEvent.click(screen.getByRole('radio', { name: 'Manter etapas' }));
    fireEvent.click(screen.getByRole('button', { name: 'Desmembrar' }));

    await waitFor(() => expect(mockDetachKeepingProcess).toHaveBeenCalled());
    await waitFor(() => expect(onDetachedKeepingProcess).toHaveBeenCalledWith([1]));
    // The confusable id never reaches the callback.
    expect(onDetachedKeepingProcess).not.toHaveBeenCalledWith([999]);
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

describe('WorkflowDrawer scrolls the targeted post into view', () => {
  const makePost = (id: number, ordem: number) =>
    ({
      id,
      workflow_id: 10,
      titulo: `Post ${id}`,
      conteudo: null,
      conteudo_plain: '',
      tipo: 'feed',
      ordem,
      status: 'rascunho',
      responsavel_id: null,
      scheduled_at: null,
      ig_caption: null,
      platform: 'instagram',
    }) as never;

  // jsdom has no layout: fake a 500px-tall drawer body at y=100 and push the
  // post with `targetId` 800px below its top edge. jsdom's scrollTop is also
  // inert, so back it with a map to read what the drawer wrote.
  let restore: () => void;
  const scrollTops = new WeakMap<Element, number>();
  const stubLayout = (targetId: number) => {
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        const scrolled = (top: number, height: number) => {
          const body = this.closest('.drawer-body');
          const t = top - (body ? (scrollTops.get(body) ?? 0) : 0);
          return { top: t, bottom: t + height } as DOMRect;
        };
        if (this.classList.contains('drawer-body')) return { top: 100, bottom: 600 } as DOMRect;
        if (this.dataset.postId === String(targetId)) return scrolled(900, 1000);
        return scrolled(120, 40);
      });
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
    Object.defineProperty(Element.prototype, 'scrollTop', {
      configurable: true,
      get(this: Element) {
        return scrollTops.get(this) ?? 0;
      },
      set(this: Element, v: number) {
        scrollTops.set(this, v);
      },
    });
    restore = () => {
      rectSpy.mockRestore();
      if (desc) Object.defineProperty(Element.prototype, 'scrollTop', desc);
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => restore?.());

  it('aligns a deep-linked post with the top of the drawer body', async () => {
    mockGetPosts.mockResolvedValue([makePost(1, 0), makePost(2, 1)]);
    stubLayout(2);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = renderDrawer(qc, { initialPostId: 2 });

    const body = container.querySelector('.drawer-body')!;
    await waitFor(() => expect(body.scrollTop).toBe(800));
  });

  it('leaves the scroll alone when no post was targeted', async () => {
    mockGetPosts.mockResolvedValue([makePost(1, 0), makePost(2, 1)]);
    stubLayout(2);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = renderDrawer(qc, { initialPostId: undefined });

    await screen.findByText('Post 2');
    expect(container.querySelector('.drawer-body')!.scrollTop).toBe(0);
  });

  it('creates the new post after the highest ordem, even with gaps in the list', async () => {
    // Deletes and moves leave gaps: 2 posts whose ordem is 0 and 5. posts.length (2) would
    // sort the new post between them.
    mockGetPosts.mockResolvedValue([makePost(1, 0), makePost(2, 5)]);
    mockAddPost.mockResolvedValue(makePost(3, 6));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc, { initialPostId: undefined });
    await screen.findByText('Post 2');

    fireEvent.click(screen.getAllByRole('button', { name: /Novo Post/ })[1]);

    await waitFor(() =>
      expect(mockAddPost).toHaveBeenCalledWith(expect.objectContaining({ ordem: 6 })),
    );
  });

  it('scrolls to the post "Novo Post" just created once it renders', async () => {
    mockGetPosts.mockResolvedValue([makePost(1, 0)]);
    mockAddPost.mockResolvedValue(makePost(3, 1));
    stubLayout(3);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = renderDrawer(qc, { initialPostId: undefined });
    await screen.findByText('Post 1');

    mockGetPosts.mockResolvedValue([makePost(1, 0), makePost(3, 1)]);
    // Header button and the full-width one after the last post both create a post; use the latter.
    const addButtons = screen.getAllByRole('button', { name: /Novo Post/ });
    expect(addButtons).toHaveLength(2);
    expect(addButtons[1]).toHaveClass('drawer-add-post-btn--row');
    fireEvent.click(addButtons[1]);

    const body = container.querySelector('.drawer-body')!;
    await waitFor(() => expect(body.scrollTop).toBe(800));
  });
});

describe('WorkflowDrawer deleting a comment', () => {
  const post = {
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
  const thread = (field: string) =>
    ({
      id: 1,
      post_id: 1,
      field,
      post_comments: [{ id: 10, thread_id: 1, content: 'x' }],
    }) as never;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPosts.mockResolvedValue([post]);
    mockGetNaoLidas.mockResolvedValue([]);
  });

  it('deletes only the comment when the last message belongs to the general thread', async () => {
    mockGetThreads.mockResolvedValue([thread('geral')]);
    renderDrawer(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    await waitFor(() => expect(mockGetThreads).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: 'delete comment stub' }));
    await waitFor(() => expect(vi.mocked(deletePostComment)).toHaveBeenCalledWith(10));
    expect(vi.mocked(deleteCommentThread)).not.toHaveBeenCalled();
  });

  it('still deletes a passage thread together with its last message', async () => {
    mockGetThreads.mockResolvedValue([thread('conteudo')]);
    renderDrawer(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    await waitFor(() => expect(mockGetThreads).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: 'delete comment stub' }));
    await waitFor(() => expect(vi.mocked(deleteCommentThread)).toHaveBeenCalledWith(1));
    expect(vi.mocked(deletePostComment)).not.toHaveBeenCalled();
  });
});

describe('WorkflowDrawer discussao=1 deep link', () => {
  const mkPost = (id: number) =>
    ({
      id,
      workflow_id: 10,
      titulo: `Post ${id}`,
      conteudo: null,
      conteudo_plain: '',
      tipo: 'feed',
      ordem: id,
      status: 'rascunho',
      responsavel_id: null,
      scheduled_at: null,
      ig_caption: null,
      platform: 'instagram',
    }) as never;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPosts.mockResolvedValue([mkPost(1), mkPost(2)]);
    mockGetThreads.mockResolvedValue([]);
    mockGetNaoLidas.mockResolvedValue([]);
  });

  const qcNew = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

  it('hands the focus request to the linked post only, expanded, and relays the report', async () => {
    const onDiscussaoFocused = vi.fn();
    renderDrawer(qcNew(), { initialPostId: 2, focusRequest: 1, onDiscussaoFocused });
    await screen.findByText('Post 2');
    // Only the linked post is expanded, so it is the only row with a discussion section.
    const stubs = await screen.findAllByTestId('discussao-equipe-stub');
    expect(stubs).toHaveLength(1);
    expect(stubs[0]).toHaveAttribute('data-autofocus', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'stub focused' }));
    expect(onDiscussaoFocused).toHaveBeenCalledTimes(1);
  });

  it('re-expands a collapsed linked post on a new request, without remounting', async () => {
    const { rerenderWith } = renderDrawer(qcNew(), { initialPostId: 2, focusRequest: 1 });
    expect(await screen.findAllByTestId('discussao-equipe-stub')).toHaveLength(1);

    // The user collapses the post (its row toggle is the post title).
    fireEvent.click(screen.getByText('Post 2'));
    await waitFor(() => expect(screen.queryByTestId('discussao-equipe-stub')).toBeNull());

    rerenderWith({ focusRequest: 2 });
    const stub = await screen.findByTestId('discussao-equipe-stub');
    expect(stub).toHaveAttribute('data-autofocus', 'true');
  });

  it('a new request while on Histórico returns to Posts with the post expanded', async () => {
    const { rerenderWith } = renderDrawer(qcNew(), { initialPostId: 2, focusRequest: 1 });
    await screen.findByTestId('discussao-equipe-stub');

    fireEvent.click(screen.getByRole('button', { name: 'Histórico' }));
    expect(await screen.findByTestId('workflow-history-view-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('discussao-equipe-stub')).toBeNull();

    rerenderWith({ focusRequest: 2 });
    await waitFor(() => expect(screen.queryByTestId('workflow-history-view-stub')).toBeNull());
    const stub = await screen.findByTestId('discussao-equipe-stub');
    expect(stub).toHaveAttribute('data-autofocus', 'true');
  });

  it('does not ask for focus without the flag', async () => {
    renderDrawer(qcNew(), { initialPostId: 2 });
    const stub = await screen.findByTestId('discussao-equipe-stub');
    expect(stub).toHaveAttribute('data-autofocus', 'false');
  });
});

describe('WorkflowDrawer discussion badge on the post trigger', () => {
  const post = {
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

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPosts.mockResolvedValue([post]);
    mockGetThreads.mockResolvedValue([]);
    mockGetNaoLidas.mockResolvedValue([]);
  });

  const renderOne = () =>
    renderDrawer(new QueryClient({ defaultOptions: { queries: { retry: false } } }), {
      initialPostId: undefined,
    });

  it('asks the RPC once for the drawer posts', async () => {
    renderOne();
    await screen.findByText('Post A');
    await waitFor(() => expect(mockGetNaoLidas).toHaveBeenCalledTimes(1));
    expect(mockGetNaoLidas).toHaveBeenCalledWith({ postIds: [1], workflowIds: [] });
  });

  it('shows the unread count with the dot class when the participant has unread messages', async () => {
    mockGetNaoLidas.mockResolvedValue([{ postId: 1, workflowId: 10, total: 9, naoLidas: 3 }]);
    renderOne();
    const badge = await screen.findByLabelText('3 mensagens novas na discussão');
    expect(badge).toHaveTextContent('3');
    expect(badge).toHaveClass('drawer-post-comment-badge--unread');
  });

  it('shows the plain total, with no dot, when nothing is unread', async () => {
    mockGetNaoLidas.mockResolvedValue([{ postId: 1, workflowId: 10, total: 9, naoLidas: 0 }]);
    renderOne();
    const badge = await screen.findByLabelText('9 mensagens na discussão');
    expect(badge).toHaveTextContent('9');
    expect(badge).not.toHaveClass('drawer-post-comment-badge--unread');
  });

  it('counts comments, not threads: two threads, five messages', async () => {
    // Used to show "2" (commentThreads.length); the badge now reports messages (RPC total).
    mockGetThreads.mockResolvedValue([
      { id: 1, post_id: 1, comments: [] },
      { id: 2, post_id: 1, comments: [] },
    ] as never);
    mockGetNaoLidas.mockResolvedValue([{ postId: 1, workflowId: 10, total: 5, naoLidas: 0 }]);
    renderOne();
    expect(await screen.findByLabelText('5 mensagens na discussão')).toHaveTextContent('5');
    expect(screen.queryByLabelText('2 mensagens na discussão')).not.toBeInTheDocument();
  });

  it('shows no badge until the count arrives (threads never stand in as messages)', async () => {
    mockGetThreads.mockResolvedValue([
      { id: 1, post_id: 1, field: 'geral', comments: [] },
      { id: 2, post_id: 1, field: 'conteudo', comments: [] },
    ] as never);
    mockGetNaoLidas.mockReturnValue(new Promise(() => {}));
    renderOne();
    await screen.findByText('Post A');
    await waitFor(() => expect(mockGetThreads).toHaveBeenCalled());
    expect(screen.queryByLabelText(/na discussão/)).not.toBeInTheDocument();
  });

  it('announces the badge to screen readers as an image with its label', async () => {
    mockGetNaoLidas.mockResolvedValue([{ postId: 1, workflowId: 10, total: 9, naoLidas: 3 }]);
    renderOne();
    expect(
      await screen.findByRole('img', { name: '3 mensagens novas na discussão' }),
    ).toHaveTextContent('3');
  });

  it('shows nothing when there is no discussion and no thread', async () => {
    renderOne();
    await screen.findByText('Post A');
    await waitFor(() => expect(mockGetNaoLidas).toHaveBeenCalled());
    expect(screen.queryByLabelText(/na discussão/)).not.toBeInTheDocument();
  });
});

describe('WorkflowDrawer suggestion move guard', () => {
  const CUSTOM_ID = '11111111-2222-3333-4444-555555555555';
  const post = (status: string) =>
    ({
      id: 1,
      workflow_id: 10,
      titulo: 'Post A',
      conteudo: null,
      conteudo_plain: '',
      tipo: 'feed',
      ordem: 0,
      status,
      responsavel_id: null,
      scheduled_at: null,
      ig_caption: null,
      platform: 'instagram',
    }) as never;
  const statusSelect = () => document.querySelector('select.drawer-select') as HTMLSelectElement;

  afterEach(() => {
    mockHasPending.mockResolvedValue(false);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPosts.mockResolvedValue([post('rascunho')]);
    mockGetEditSuggestions.mockResolvedValue([] as never);
    mockUpdate.mockResolvedValue({} as never);
    mockHasPending.mockResolvedValue(false);
  });

  it('writes straight away when the post has no pending suggestion', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);
    await screen.findByRole('radio', { name: 'Imagem', checked: true });
    fireEvent.change(statusSelect(), { target: { value: 'agendado' } });
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(1, { status: 'agendado', custom_status_id: null }),
    );
    expect(screen.queryByText('Mover para Agendado?')).toBeNull();
  });

  it('asks before moving to agendado and only writes after "Mover mesmo assim"', async () => {
    mockHasPending.mockResolvedValue(true);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);
    await screen.findByRole('radio', { name: 'Imagem', checked: true });
    fireEvent.change(statusSelect(), { target: { value: 'agendado' } });
    expect(await screen.findByText('Mover para Agendado?')).toBeTruthy();
    expect(mockHasPending).toHaveBeenCalledWith(1);
    expect(mockUpdate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Mover mesmo assim' }));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(1, { status: 'agendado', custom_status_id: null }),
    );
  });

  it('Cancelar leaves the post where it was', async () => {
    mockHasPending.mockResolvedValue(true);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);
    await screen.findByRole('radio', { name: 'Imagem', checked: true });
    fireEvent.change(statusSelect(), { target: { value: 'postado' } });
    expect(await screen.findByText('Mover para Postado?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByText('Mover para Postado?')).toBeNull());
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('a custom status that behaves as aprovado_cliente awaits the guard before the write', async () => {
    mockHasPending.mockResolvedValue(true);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(POST_STATUS_DEFINITIONS_QUERY_KEY, [
      {
        id: CUSTOM_ID,
        conta_id: 'conta-1',
        nome: 'Pronto para cliente',
        cor: '#7c5cff',
        icone: null,
        behaves_as: 'aprovado_cliente',
        ordem: 0,
        arquivado: false,
        created_at: '2026-08-05T00:00:00Z',
        updated_at: '2026-08-05T00:00:00Z',
      },
    ]);
    renderDrawer(qc);
    await screen.findByRole('radio', { name: 'Imagem', checked: true });
    fireEvent.change(statusSelect(), { target: { value: `custom:${CUSTOM_ID}` } });
    expect(await screen.findByText('Mover para Aprovado pelo cliente?')).toBeTruthy();
    expect(mockUpdate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Mover mesmo assim' }));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(1, { custom_status_id: CUSTOM_ID }),
    );
  });

  it('runs after the "post aprovado" confirm, not instead of it', async () => {
    mockGetPosts.mockResolvedValue([post('aprovado_cliente')]);
    mockHasPending.mockResolvedValue(true);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);
    await screen.findByRole('radio', { name: 'Imagem', checked: true });
    fireEvent.change(statusSelect(), { target: { value: 'agendado' } });
    // First dialog: the existing approved-post confirm. No lookup yet.
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText('Mover para Agendado?')).toBeTruthy();
    expect(mockUpdate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Mover mesmo assim' }));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(1, { status: 'agendado', custom_status_id: null }),
    );
  });
});
