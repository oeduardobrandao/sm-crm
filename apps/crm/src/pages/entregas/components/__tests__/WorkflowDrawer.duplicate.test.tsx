import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { BoardCard } from '../../hooks/useEntregasData';
import { makeCan, fakeMembership } from '@/test/makeCan';

// "Duplicar post" no kebab de cada post do WorkflowDrawer. Mesmo harness enxuto de
// WorkflowDrawer.test.tsx: folhas pesadas viram stubs e o DropdownMenu renderiza o
// conteúdo direto (Radix precisa de pointer events que o jsdom não entrega bem).

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

let mockMembershipRole: 'owner' | 'agent' = 'owner';
let mockEntregasPerm: 'editar' | 'ver' | 'nenhum' = 'editar';
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1' },
    role: mockMembershipRole,
    loading: false,
    profile: null,
    can: makeCan(
      fakeMembership({
        role: mockMembershipRole,
        ...(mockMembershipRole === 'agent'
          ? { role_id: 1, permissions: { entregas: mockEntregasPerm } as never }
          : {}),
      }),
    ),
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
// PostEditorBody and WorkflowDrawer read client references from this module by path.
vi.mock('@/store/postReferences', () => ({
  getPostReferences: vi.fn(async () => []),
  getPostReferenceCounts: vi.fn(async () => ({})),
  deletePostReference: vi.fn(),
}));
vi.mock('@/services/inlineImage', () => ({
  uploadInlineImage: vi.fn(),
  extractR2Keys: () => [],
  injectSignedUrls: (doc: unknown) => doc,
  stripSignedUrls: (doc: unknown) => doc,
  resolveInlineImageUrls: vi.fn(async () => ({})),
}));

// O stub expõe um botão que dispara onUpdate, para armar o autosave do conteúdo.
vi.mock('@/pages/entregas/components/PostEditor', () => ({
  PostEditor: ({
    onUpdate,
  }: {
    onUpdate?: (json: Record<string, unknown>, plain: string) => void;
  }) => (
    <div data-testid="post-editor-stub">
      <button type="button" onClick={() => onUpdate?.({ type: 'doc' }, 'novo texto')}>
        Editar conteúdo
      </button>
    </div>
  ),
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
import { getWorkflowPostsWithProperties, clonePost } from '@/store';

const mockGetPosts = vi.mocked(getWorkflowPostsWithProperties);
const mockClonePost = vi.mocked(clonePost);

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
        initialPostId={undefined}
      />
    </QueryClientProvider>,
  );
}

function rowOf(titulo: string) {
  return screen
    .getByRole('checkbox', { name: `Selecionar ${titulo}` })
    .closest('.drawer-post-item') as HTMLElement;
}

describe('WorkflowDrawer: Duplicar post', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMembershipRole = 'owner';
    mockEntregasPerm = 'editar';
    mockGetPosts.mockResolvedValue([post(1, 'Post A'), post(2, 'Post B', 'agendado')]);
  });

  it('o item do kebab abre o diálogo "Duplicar post" para aquele post', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);
    await screen.findByRole('checkbox', { name: 'Selecionar Post B' });

    fireEvent.click(within(rowOf('Post B')).getByText('Duplicar post'));

    expect(await screen.findByRole('dialog', { name: 'Duplicar post' })).toBeInTheDocument();
    // Post agendado: o aviso de reagendar aparece no diálogo.
    expect(
      screen.getByText(/precisa agendar de novo|é preciso agendar de novo/),
    ).toBeInTheDocument();
  });

  it('sem permissão de editar entregas o item não existe', async () => {
    mockMembershipRole = 'agent';
    mockEntregasPerm = 'ver';
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);
    await screen.findByRole('checkbox', { name: 'Selecionar Post A' });

    expect(screen.queryByText('Duplicar post')).not.toBeInTheDocument();
  });

  it('com o conteúdo do post salvando, o item fica desabilitado só nesse post', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);
    await screen.findByRole('checkbox', { name: 'Selecionar Post A' });

    fireEvent.click(within(rowOf('Post A')).getByText('Post A'));
    fireEvent.click(
      await within(rowOf('Post A')).findByRole('button', { name: 'Editar conteúdo' }),
    );

    const itemA = within(rowOf('Post A')).getByRole('button', { name: /Duplicar post/ });
    expect(itemA).toBeDisabled();
    expect(within(rowOf('Post B')).getByRole('button', { name: /Duplicar post/ })).toBeEnabled();

    // Depois do debounce o save termina e o item volta.
    await waitFor(() => expect(itemA).toBeEnabled(), { timeout: 3000 });
  });

  it('ao confirmar: clona o post, recarrega a lista e toasta', async () => {
    mockClonePost.mockResolvedValue(99);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);
    await screen.findByRole('checkbox', { name: 'Selecionar Post A' });
    const callsBefore = mockGetPosts.mock.calls.length;

    fireEvent.click(within(rowOf('Post A')).getByText('Duplicar post'));
    await screen.findByRole('dialog', { name: 'Duplicar post' });
    fireEvent.click(screen.getByRole('button', { name: 'Duplicar' }));

    await waitFor(() => expect(mockClonePost).toHaveBeenCalledWith(1, false));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Post duplicado'));
    await waitFor(() => expect(mockGetPosts.mock.calls.length).toBeGreaterThan(callsBefore));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
