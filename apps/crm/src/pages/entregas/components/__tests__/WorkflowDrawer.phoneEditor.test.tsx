import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { PostEditorBodyProps } from '../PostEditorBody';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BoardCard } from '../../hooks/useEntregasData';
import { makeCan, fakeMembership } from '@/test/makeCan';

// Phone (C4): expanding a post opens the pushed editor screen instead of the inline
// editor. Same lean harness as WorkflowDrawer.duplicate.test.tsx, with PostEditorBody
// stubbed so only the drawer's wiring (which post, which chrome) is under test.

vi.mock('@/pages/entregas/components/postEditorPhone/useIsPhoneEditor', () => ({
  useIsPhoneEditor: () => true,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

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

vi.mock('@/pages/entregas/components/PostEditorBody', () => ({
  PostEditorBody: ({ post, layout, phone, isExpanded }: PostEditorBodyProps) =>
    isExpanded ? (
      <div data-testid="editor-body" data-layout={layout ?? 'desktop'} data-post={post.id}>
        <h1>{post.titulo}</h1>
        <p>{phone?.subtitle}</p>
        <button type="button" onClick={phone?.onBack}>
          Voltar
        </button>
        <ul aria-label="Mais ações do post">
          {phone?.menuActions.map((a) => (
            <li key={a.label}>
              <button type="button" disabled={a.disabled} onClick={a.onSelect}>
                {a.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    ) : null,
}));

import { WorkflowDrawer } from '../WorkflowDrawer';
import { getWorkflowPostsWithProperties } from '@/store';

const mockGetPosts = vi.mocked(getWorkflowPostsWithProperties);

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
      nome: 'Produção',
      prazo_dias: 3,
      tipo_prazo: 'uteis',
      status: 'ativo',
    },
    cliente: { id: 42, nome: 'Marca X', sigla: 'MX', cor: '#000', status: 'ativo' },
    membro: undefined,
    deadline: null,
    totalEtapas: 1,
    etapaIdx: 0,
    allEtapas: [],
  } as unknown as BoardCard;

  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <WorkflowDrawer
          card={card}
          membros={[]}
          onClose={vi.fn()}
          onRefresh={vi.fn()}
          initialPostId={initialPostId}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function rowOf(titulo: string) {
  return screen
    .getByRole('checkbox', { name: `Selecionar ${titulo}` })
    .closest('.drawer-post-item') as HTMLElement;
}

const editorScreen = () => screen.queryByRole('region', { name: 'Editor do post' });

describe('WorkflowDrawer on phones: the post editor is a pushed screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMembershipRole = 'owner';
    mockEntregasPerm = 'editar';
    mockGetPosts.mockResolvedValue([post(1, 'Post A'), post(2, 'Post B', 'agendado')]);
  });

  it('expanding a row opens the screen with the phone layout; the row stays collapsed', async () => {
    renderDrawer();
    await screen.findByRole('checkbox', { name: 'Selecionar Post A' });
    expect(editorScreen()).toBeNull();

    fireEvent.click(within(rowOf('Post A')).getByText('Post A'));

    const region = await screen.findByRole('region', { name: 'Editor do post' });
    const body = within(region).getByTestId('editor-body');
    expect(body).toHaveAttribute('data-layout', 'phone');
    expect(body).toHaveAttribute('data-post', '1');
    expect(within(region).getByText('Marca X · Campanha Julho')).toBeInTheDocument();
    // No inline editor inside the row.
    expect(within(rowOf('Post A')).queryByTestId('editor-body')).toBeNull();
  });

  it('a ?post= deep link (initialPostId) opens the screen directly', async () => {
    renderDrawer(2);
    const region = await screen.findByRole('region', { name: 'Editor do post' });
    expect(within(region).getByTestId('editor-body')).toHaveAttribute('data-post', '2');
  });

  it('Voltar closes the screen back to the list', async () => {
    renderDrawer(1);
    const region = await screen.findByRole('region', { name: 'Editor do post' });
    fireEvent.click(within(region).getByRole('button', { name: 'Voltar' }));
    await waitFor(() => expect(editorScreen()).toBeNull());
    expect(screen.getByRole('checkbox', { name: 'Selecionar Post A' })).toBeInTheDocument();
  });

  it('the "…" menu carries every row action, Excluir last', async () => {
    renderDrawer(1);
    const region = await screen.findByRole('region', { name: 'Editor do post' });
    const labels = within(within(region).getByRole('list', { name: 'Mais ações do post' }))
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(labels).toEqual([
      'Copiar link',
      'Duplicar',
      'Mover para outro fluxo',
      'Desmembrar do fluxo',
      'Excluir post',
    ]);
  });

  it('Duplicar opens the dialog over the editor', async () => {
    renderDrawer(1);
    const region = await screen.findByRole('region', { name: 'Editor do post' });
    fireEvent.click(within(region).getByRole('button', { name: 'Duplicar' }));
    expect(await screen.findByRole('dialog', { name: 'Duplicar post' })).toBeInTheDocument();
  });

  it('Mover closes the editor first, then opens the move dialog over the drawer', async () => {
    renderDrawer(1);
    const region = await screen.findByRole('region', { name: 'Editor do post' });
    fireEvent.click(within(region).getByRole('button', { name: 'Mover para outro fluxo' }));
    expect(
      await screen.findByRole('dialog', { name: 'Mover para outro fluxo' }),
    ).toBeInTheDocument();
    expect(editorScreen()).toBeNull();
  });
});
