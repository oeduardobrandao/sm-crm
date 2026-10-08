import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BoardCard } from '../../hooks/useEntregasData';
import type { ReferenceItem } from '@/store/postReferences';
import { makeCan, fakeMembership } from '@/test/makeCan';

// Client references in the WorkflowDrawer: the collapsed-row badge (counts query) and, on an
// expanded post, the section under the media plus chips on the client's correction bubble.

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

vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({
    limits: null,
    features: null,
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
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
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
  getPostApprovals: vi.fn(async () => []),
  getPostStatusEvents: vi.fn(async () => []),
  getPostProcessEvents: vi.fn(async () => []),
  replyToPostApproval: vi.fn(),
  completeEtapa: vi.fn(),
  getPostCommentThreads: vi.fn(async () => []),
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
  clonePost: vi.fn(),
  cloneWorkflow: vi.fn(),
}));

vi.mock('@/store/postReferences', () => ({
  getPostReferences: vi.fn(async () => []),
  getPostReferenceCounts: vi.fn(async () => ({})),
  deletePostReference: vi.fn(),
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock('@/services/postMedia', () => ({ listPostMedia: vi.fn(async () => []) }));
vi.mock('@/services/inlineImage', () => ({
  uploadInlineImage: vi.fn(),
  extractR2Keys: () => [],
  injectSignedUrls: (doc: unknown) => doc,
  stripSignedUrls: (doc: unknown) => doc,
  resolveInlineImageUrls: vi.fn(async () => ({})),
}));
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
vi.mock('@/pages/estudio/ImportToEstudioDialog', () => ({ ImportToEstudioDialog: () => null }));
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
vi.mock('@/pages/entregas/components/WorkflowHistoryView', () => ({
  WorkflowHistoryView: () => <div data-testid="workflow-history-view-stub" />,
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
import { getPostApprovals, getWorkflowPostsWithProperties } from '@/store';
import { getPostReferenceCounts, getPostReferences } from '@/store/postReferences';

const mockGetPosts = vi.mocked(getWorkflowPostsWithProperties);
const mockGetApprovals = vi.mocked(getPostApprovals);
const mockCounts = vi.mocked(getPostReferenceCounts);
const mockGetReferences = vi.mocked(getPostReferences);

function post(id: number, titulo: string, status = 'rascunho') {
  return {
    id,
    workflow_id: 10,
    titulo,
    conteudo: null,
    conteudo_plain: '',
    tipo: 'feed',
    ordem: id,
    status,
    responsavel_id: null,
    scheduled_at: null,
    ig_caption: null,
    platform: 'instagram',
  } as never;
}

function reference(overrides: Partial<ReferenceItem> & Pick<ReferenceItem, 'id'>): ReferenceItem {
  return {
    kind: 'file',
    file_kind: 'image',
    name: 'foto.jpg',
    mime_type: 'image/jpeg',
    size_bytes: 1024 * 1024,
    duration_seconds: null,
    width: null,
    height: null,
    url: 'https://r2.example.com/full.jpg',
    thumbnail_url: 'https://r2.example.com/thumb.webp',
    blur_data_url: null,
    download_url: 'https://r2.example.com/full.jpg?download=1',
    link_url: null,
    link_title: null,
    link_domain: null,
    note: null,
    post_approval_id: null,
    created_at: new Date().toISOString(),
    can_remove: false,
    ...overrides,
  };
}

const CORRECTION = {
  id: 501,
  post_id: 1,
  token: 't',
  action: 'correcao' as const,
  comentario: 'Trocar a foto da capa',
  is_workspace_user: false,
  created_at: new Date().toISOString(),
};

function renderDrawer(initialPostId?: number) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
      nome: 'Aprovação',
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
        initialPostId={initialPostId}
      />
    </QueryClientProvider>,
  );
}

function rowOf(titulo: string) {
  return screen
    .getByRole('checkbox', { name: `Selecionar ${titulo}` })
    .closest('.drawer-post-item') as HTMLElement;
}

describe('WorkflowDrawer: referências do cliente', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPosts.mockResolvedValue([post(1, 'Post A'), post(2, 'Post B')]);
    mockGetApprovals.mockResolvedValue([]);
    mockCounts.mockResolvedValue({});
    mockGetReferences.mockResolvedValue([]);
  });

  it('shows "N referências" on the collapsed row of posts that have them', async () => {
    mockCounts.mockResolvedValue({ 1: 2 });
    renderDrawer();
    await screen.findByRole('checkbox', { name: 'Selecionar Post A' });

    expect(await within(rowOf('Post A')).findByText('2 referências')).toBeInTheDocument();
    expect(within(rowOf('Post B')).queryByText(/referência/)).toBeNull();
    expect(mockCounts).toHaveBeenCalledWith([1, 2]);
  });

  it('uses the singular for one reference', async () => {
    mockCounts.mockResolvedValue({ 2: 1 });
    renderDrawer();
    await screen.findByRole('checkbox', { name: 'Selecionar Post B' });
    expect(await within(rowOf('Post B')).findByText('1 referência')).toBeInTheDocument();
  });

  it('expanded post: section after the media, chips on the correction, viewer on click', async () => {
    mockGetApprovals.mockResolvedValue([CORRECTION]);
    mockGetReferences.mockResolvedValue([
      reference({ id: 1, name: 'foto-praia.jpg', post_approval_id: 501 }),
      reference({
        id: 2,
        file_kind: 'document',
        name: 'tabela.pdf',
        mime_type: 'application/pdf',
        thumbnail_url: null,
      }),
    ]);
    renderDrawer(1);

    const section = await screen.findByRole('region', { name: 'Referências do cliente' });
    expect(mockGetReferences).toHaveBeenCalledWith(1);
    // Rendered right after the media gallery.
    const gallery = screen.getByTestId('post-media-gallery-stub');
    expect(
      gallery.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const chips = await screen.findByRole('list', { name: 'Referências anexadas' });
    expect(within(chips).getByText('foto-praia.jpg')).toBeInTheDocument();
    expect(within(chips).queryByText('tabela.pdf')).toBeNull();

    fireEvent.click(within(chips).getByRole('button', { name: /foto-praia\.jpg/ }));
    expect(await screen.findByRole('dialog', { name: 'foto-praia.jpg' })).toBeInTheDocument();
  });

  it('no references: no section and no chips', async () => {
    mockGetApprovals.mockResolvedValue([CORRECTION]);
    renderDrawer(1);
    await screen.findByText('Trocar a foto da capa');
    await waitFor(() => expect(mockGetReferences).toHaveBeenCalledWith(1));
    expect(screen.queryByRole('region', { name: 'Referências do cliente' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Referências anexadas' })).toBeNull();
  });
});
