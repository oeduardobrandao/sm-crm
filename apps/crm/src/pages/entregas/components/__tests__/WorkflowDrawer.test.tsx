import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
  PlatformSelector: () => <div data-testid="platform-selector-stub" />,
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
} from '@/store';

const mockGetPosts = vi.mocked(getWorkflowPostsWithProperties);
const mockUpdate = vi.mocked(updateWorkflowPost);
const mockGetEditSuggestions = vi.mocked(getPostEditSuggestions);
const mockAcceptEditSuggestion = vi.mocked(acceptEditSuggestion);
const mockSyncMentions = vi.mocked(syncMentions);

function renderDrawer(qc: QueryClient) {
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
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        initialPostId={1}
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
