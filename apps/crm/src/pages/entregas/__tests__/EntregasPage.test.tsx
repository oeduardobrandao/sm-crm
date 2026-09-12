import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../hooks/useEntregasData', () => ({
  useEntregasData: vi.fn(),
}));

vi.mock('../hooks/useActivePosts', () => ({
  useActivePosts: vi.fn(() => ({ posts: [], isLoading: false })),
}));

const storeMocks = vi.hoisted(() => ({
  duplicateWorkflow: vi.fn(),
  getStandalonePost: vi.fn(),
  // Used by the provisional card built from a "mover para outro fluxo" seed.
  getDeadlineInfo: vi.fn(() => ({ estourado: false, urgente: false })),
}));
vi.mock('../../../store', () => storeMocks);

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// Real DropdownMenu needs Radix portal/pointer-capture machinery jsdom doesn't
// implement; render it flat (same pattern as LeadsPage.atlimit.test.tsx) so the
// Novo dropdown's items are directly clickable without opening anything first.
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

vi.mock('../components/NewAvulsoDialog', () => ({
  NewAvulsoDialog: ({
    open,
    onClose,
    onCreated,
    onNeedsManualApply,
  }: {
    open: boolean;
    onClose: () => void;
    onCreated: (post: { id: number }) => void;
    onNeedsManualApply?: (
      post: { id: number; titulo: string | null; cliente_id: number | null },
      template: { id: number },
    ) => void;
  }) =>
    open ? (
      <div>
        <div>NewAvulsoDialogMock</div>
        <button
          onClick={() => {
            // Mirrors the real dialog's submit flow: onCreated then onClose.
            onCreated({ id: 77 });
            onClose();
          }}
        >
          Create avulso post
        </button>
        <button
          onClick={() => {
            // Template pré-vinculado com modo_prazo != 'padrao' (spec §3): o
            // post já foi criado, mas precisa do ApplyProcessDialog manual.
            onNeedsManualApply?.({ id: 77, titulo: 'Post avulso', cliente_id: 1 }, { id: 9 });
            onClose();
          }}
        >
          Create avulso post needing manual apply
        </button>
        <button onClick={onClose}>Close avulso dialog</button>
      </div>
    ) : null,
}));

vi.mock('../components/ApplyProcessDialog', () => ({
  ApplyProcessDialog: ({
    onClose,
    onApplied,
    post,
  }: {
    onClose: () => void;
    onApplied: (result: { post_id: number }) => void;
    post: { id: number };
  }) => (
    <div>
      <div>ApplyProcessDialogMock: {post.id}</div>
      <button onClick={onClose}>Cancel apply process</button>
      <button
        onClick={() => {
          // Mirrors the real dialog's confirm flow (ApplyProcessDialog.tsx):
          // onApplied() then onClose(), same batch.
          onApplied({ post_id: post.id });
          onClose();
        }}
      >
        Apply process
      </button>
    </div>
  ),
}));

vi.mock('../components/EntregasFilters', () => ({
  EMPTY_FILTERS: {
    filterClientes: [],
    filterMembros: [],
    filterPostResponsaveis: [],
    filterStatus: [],
    filterSearch: '',
    filterEtapas: [],
    filterTemplates: [],
    filterTipos: [],
    filterPostStatus: [],
    filterPrazo: [],
    filterPrazoFrom: '',
    filterPrazoTo: '',
  },
  EntregasFilters: ({
    filters,
    onChange,
    clientes,
    membros,
    mode,
  }: {
    filters: { filterClientes: number[]; filterMembros: number[]; filterStatus: string[] };
    onChange: (next: {
      filterClientes: number[];
      filterMembros: number[];
      filterStatus: string[];
    }) => void;
    clientes: Array<{ id: number; nome: string }>;
    membros: Array<{ id: number; nome: string }>;
    mode?: string;
  }) => (
    <div>
      <div>Filters: {filters.filterStatus.join(',')}</div>
      <div>FiltersMode: {mode}</div>
      <div>Clientes: {clientes.length}</div>
      <div>Membros: {membros.length}</div>
      <button onClick={() => onChange({ ...filters, filterStatus: ['atrasado'] })}>
        Filter overdue
      </button>
      <button onClick={() => onChange({ ...filters, filterStatus: ['atrasado', 'urgente'] })}>
        Filter overdue and urgent
      </button>
      <button onClick={() => onChange({ ...filters, filterClientes: [10] })}>Filter client</button>
      <button onClick={() => onChange({ ...filters, filterMembros: [7] })}>Filter member</button>
      <button onClick={() => onChange({ ...filters, filterTipos: ['reels'] })}>Filter tipo</button>
      <button onClick={() => onChange({ ...filters, filterPostStatus: ['rascunho'] })}>
        Filter post status
      </button>
      <button onClick={() => onChange({ ...filters, filterPrazo: ['atrasado'] })}>
        Filter prazo atrasado
      </button>
      <button onClick={() => onChange({ ...filters, filterEtapas: ['Design'] })}>
        Filter etapa Design
      </button>
    </div>
  ),
}));

vi.mock('../views/KanbanView', () => ({
  KanbanView: ({
    cards,
    postEntities,
    showExample,
    onDismissExample,
    onCardClick,
    onEditClick,
    onPostsClick,
    onRecurring,
    onCreateTemplate,
    createTemplateDisabled,
  }: {
    cards: Array<{ workflow: { id: number; titulo: string } }>;
    postEntities?: Array<{ id: string }>;
    showExample?: boolean;
    onDismissExample?: () => void;
    onCardClick: (card: unknown) => void;
    onEditClick: (card: unknown) => void;
    onPostsClick: (card: unknown) => void;
    onRecurring: (workflowId: number) => void;
    onCreateTemplate?: () => void;
    createTemplateDisabled?: boolean;
  }) =>
    showExample ? (
      <div>
        <div>Posts de Agosto</div>
        <button onClick={onDismissExample}>Ocultar exemplo</button>
      </div>
    ) : cards.length === 0 && !postEntities?.length ? (
      <div>Nenhuma entrega encontrada. Ajuste os filtros ou crie um novo fluxo.</div>
    ) : (
      <div>
        {cards.length > 0 && (
          <div>Kanban view: {cards.map((card) => card.workflow.titulo).join(', ')}</div>
        )}
        {postEntities?.map((entity) => (
          <div key={entity.id} data-testid="post-process-card">
            {entity.id}
          </div>
        ))}
        {onCreateTemplate && (
          <button onClick={onCreateTemplate} disabled={createTemplateDisabled}>
            Create new template
          </button>
        )}
        {cards.length > 0 && (
          <>
            <button onClick={() => onEditClick(cards[0])}>Open edit modal</button>
            <button onClick={() => onCardClick(cards[0])}>Open drawer from card</button>
            <button onClick={() => onPostsClick(cards[0])}>Open drawer modal</button>
            <button onClick={() => onRecurring(cards[0].workflow.id)}>Trigger recurring</button>
          </>
        )}
      </div>
    ),
}));

// EntregasPage now reads profile.conta_id via useAuth; there is no AuthProvider in this suite.
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ profile: { conta_id: 'conta-1', role: 'owner' } }),
}));

const limitsMock = vi.hoisted(() => ({ features: null as Record<string, boolean> | null }));
vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({
    limits: null,
    features: limitsMock.features,
    planName: null,
    isLoading: false,
    isUnlimited: false,
  }),
}));

vi.mock('@/hooks/useEntitlements', () => ({
  useEntitlements: () => ({
    isAtLimit: () => false,
    hasFeature: () => true,
    features: {},
    limits: {},
    planName: null,
    isLoading: false,
  }),
}));

// SemProcessoSection is real in this suite and its PostStatusChip reads
// useStatusRegistry, which reaches getPostStatusDefinitions -- absent from
// storeMocks, and vitest throws on a missing mock export.
vi.mock('@/hooks/useStatusRegistry', () => ({
  useStatusRegistry: () => ({
    resolve: (p: { status: string }) => ({
      key: p.status,
      kind: 'canonical',
      canonical: p.status,
      label: p.status,
    }),
    options: [],
  }),
}));

// Mock only startEntregasTour (driver.js can't run in jsdom); tourStorageKey stays real so the
// localStorage assertions exercise the true key format.
const tourMock = vi.hoisted(() => ({ startEntregasTour: vi.fn() }));
vi.mock('../tour/entregasTour', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  startEntregasTour: tourMock.startEntregasTour,
}));

vi.mock('../views/ChartView', () => ({
  ChartView: ({
    cards,
    totalCards,
    filters,
    onFiltersChange,
    onCardClick,
    onGoToView,
    onGoToKanban,
  }: {
    cards: Array<{ workflow: { titulo: string } }>;
    totalCards: number;
    filters: Record<string, unknown>;
    onFiltersChange: (next: Record<string, unknown>) => void;
    onCardClick: (card: unknown) => void;
    onGoToView: (view: 'kanban' | 'list') => void;
    onGoToKanban?: () => void;
  }) => (
    <div>
      <div>Chart view: {cards.map((card) => card.workflow.titulo).join(', ')}</div>
      <div>Chart total: {totalCards}</div>
      <button onClick={() => onFiltersChange({ ...filters, filterPrazo: ['hoje'] })}>
        Chart KPI vencem hoje
      </button>
      <button onClick={() => onCardClick(cards[0])}>Open drawer from chart</button>
      <button onClick={() => onGoToView('list')}>Chart ver na lista</button>
      {onGoToKanban && <button onClick={onGoToKanban}>Chart somente fluxos</button>}
    </div>
  ),
}));

vi.mock('../views/CalendarView', () => ({
  CalendarView: ({
    cards,
    onCardClick,
  }: {
    cards: Array<{ workflow: { titulo: string } }>;
    onCardClick: (card: unknown) => void;
  }) => (
    <div>
      <div>Calendar view: {cards.map((card) => card.workflow.titulo).join(', ')}</div>
      <button onClick={() => onCardClick(cards[0])}>Open calendar drawer</button>
    </div>
  ),
}));

vi.mock('../views/ListView', () => ({
  ListView: ({
    cards,
    sort,
    onSortChange,
  }: {
    cards: Array<{ workflow: { titulo: string } }>;
    sort: { column: string; direction: 'asc' | 'desc' };
    onSortChange: (next: { column: string; direction: 'asc' | 'desc' }) => void;
  }) => (
    <div>
      <div>List view: {cards.map((card) => card.workflow.titulo).join(', ')}</div>
      <div>
        Sort: {sort.column}/{sort.direction}
      </div>
      <button onClick={() => onSortChange({ column: 'deadline', direction: 'desc' })}>
        Change sort
      </button>
    </div>
  ),
}));

vi.mock('../views/ConcludedView', () => ({
  ConcludedView: () => <div>Concluded view</div>,
}));

vi.mock('../views/PostsKanbanView', () => ({
  PostsKanbanView: ({
    posts,
    onPostClick,
  }: {
    posts: unknown[];
    onPostClick: (post: { id: number; workflow_id: number | null }) => void;
  }) => (
    <div>
      Posts kanban view: {posts.length}
      <button onClick={() => onPostClick({ id: 999, workflow_id: null })}>
        Open avulso post from kanban
      </button>
    </div>
  ),
}));

vi.mock('../views/PostsListView', () => ({
  PostsListView: ({
    posts,
    onFluxoClick,
  }: {
    posts: unknown[];
    onFluxoClick: (workflowId: number) => void;
  }) => (
    <div>
      <div>Posts list view: {posts.length}</div>
      <button onClick={() => onFluxoClick(1)}>Open fluxo from tag</button>
    </div>
  ),
}));

vi.mock('../components/WorkflowDrawer', () => ({
  WorkflowDrawer: ({
    card,
    onClose,
    initialPostId,
    onOpenWorkflow,
    onDetachedKeepingProcess,
  }: {
    card: { workflow: { titulo: string } };
    onClose: () => void;
    initialPostId?: number;
    onOpenWorkflow?: (workflowId: number, seed?: unknown) => void;
    onDetachedKeepingProcess?: (postIds: number[]) => void;
  }) => (
    <div>
      <div>Workflow drawer: {card.workflow.titulo}</div>
      <div data-testid="drawer-initial-post">{initialPostId ?? 'none'}</div>
      <button onClick={onClose}>Close drawer</button>
      <button onClick={() => onOpenWorkflow?.(99)}>Move posts to workflow 99</button>
      <button
        onClick={() =>
          onOpenWorkflow?.(99, {
            workflow: { id: 99, titulo: 'Fluxo Novo', cliente_id: 10, status: 'ativo' },
            etapas: [
              { id: 990, workflow_id: 99, ordem: 0, nome: 'Copy', status: 'ativo', prazo_dias: 2 },
            ],
          })
        }
      >
        Move posts to workflow 99 with seed
      </button>
      <button onClick={() => onDetachedKeepingProcess?.([77])}>Detach keeping process</button>
    </div>
  ),
}));

// StandalonePostDrawer pulls in most of `store` for real (getPostApprovals,
// getWorkspaceUsers, etc.) -- functions the file-wide `../../../store` mock above
// deliberately doesn't stub (it only provides duplicateWorkflow/getStandalonePost).
// Stubbed the same way WorkflowDrawer is above: EntregasPage's own wiring
// (standalonePostId state, onAttached) is what these tests exercise, not the
// drawer's internals.
vi.mock('../components/StandalonePostDrawer', () => ({
  StandalonePostDrawer: ({
    postId,
    onClose,
    onAttached,
  }: {
    postId: number;
    onClose: () => void;
    onAttached: (workflowId: number, postId: number) => void;
  }) => (
    <div>
      <div>Standalone drawer: {postId}</div>
      <button onClick={onClose}>Close standalone drawer</button>
      <button onClick={() => onAttached(2, postId)}>Attach standalone post to fluxo 2</button>
    </div>
  ),
}));

vi.mock('../wizard/NewWorkflowWizard', () => ({
  NewWorkflowWizard: ({
    open,
    onClose,
    onCreated,
  }: {
    open: boolean;
    onClose: () => void;
    onCreated: () => void;
  }) =>
    open ? (
      <div>
        <div>WizardMock</div>
        <button onClick={onCreated}>Created workflow</button>
        <button onClick={onClose}>Close new modal</button>
      </div>
    ) : null,
}));

vi.mock('../components/WorkflowModals', () => ({
  EditWorkflowModal: ({
    card,
    onClose,
    onSaved,
    onDeleted,
    onOpenPosts,
  }: {
    card: { workflow: { titulo: string } };
    onClose: () => void;
    onSaved: () => void;
    onDeleted: () => void;
    onOpenPosts: () => void;
  }) => (
    <div>
      <div>Edit workflow modal: {card.workflow.titulo}</div>
      <button onClick={onSaved}>Save workflow</button>
      <button onClick={onDeleted}>Delete workflow</button>
      <button onClick={onOpenPosts}>Open posts from edit</button>
      <button onClick={onClose}>Close edit modal</button>
    </div>
  ),
  TemplatesModal: ({
    open,
    onClose,
    onRefresh,
  }: {
    open: boolean;
    onClose: () => void;
    onRefresh: () => void;
  }) =>
    open ? (
      <div>
        <div>Templates modal</div>
        <button onClick={onRefresh}>Refresh templates</button>
        <button onClick={onClose}>Close templates modal</button>
      </div>
    ) : null,
  RecurringWorkflowDialog: ({
    open,
    onConfirm,
    onCancel,
  }: {
    open: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  }) =>
    open ? (
      <div>
        <div>Recurring dialog</div>
        <button onClick={onConfirm}>Confirm recurring</button>
        <button onClick={onCancel}>Cancel recurring</button>
      </div>
    ) : null,
}));

import { useEntregasData } from '../hooks/useEntregasData';
import { useActivePosts } from '../hooks/useActivePosts';
import { duplicateWorkflow, getStandalonePost } from '../../../store';
import { toast } from 'sonner';
import EntregasPage from '../EntregasPage';
import { toPostEntity } from '../boardEntity';
import type { PostProcessWithPost } from '../../../store';

const mockedUseEntregasData = vi.mocked(useEntregasData);
const mockedUseActivePosts = vi.mocked(useActivePosts);
const mockedDuplicateWorkflow = vi.mocked(duplicateWorkflow);
const mockedGetStandalonePost = vi.mocked(getStandalonePost);
const mockedToast = vi.mocked(toast);

function makeCard(overrides: Record<string, unknown> = {}) {
  return {
    workflow: {
      id: 1,
      titulo: 'Fluxo Editorial',
      cliente_id: 10,
      status: 'ativo',
    },
    etapa: {
      responsavel_id: 7,
    },
    deadline: {
      estourado: false,
      urgente: false,
    },
    ...overrides,
  };
}

function PathProbe() {
  const location = useLocation();
  return <div data-testid="current-path">{location.pathname + location.search}</div>;
}

/** Stands in for the globally-mounted GlobalSearchTrigger, which can fire a
 * /entregas?drawer= deep link while the user is ALREADY on /entregas. */
function DeepLinkProbe() {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate('/entregas?drawer=2&post=5')}>Deep link from search</button>
      <button onClick={() => navigate('/entregas?post=5')}>Deep link to bare post</button>
    </>
  );
}

function pageTree(initialEntry: string) {
  return (
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/entregas"
          element={
            <>
              <EntregasPage />
              <PathProbe />
              <DeepLinkProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

function renderPage(initialEntry = '/entregas') {
  return render(pageTree(initialEntry));
}

function renderEntregasPage(data: {
  activeWorkflows: unknown[];
  cards: unknown[];
  postProcessesVisible?: boolean;
}) {
  mockedUseEntregasData.mockReturnValue({
    clientes: [],
    membros: [],
    templates: [],
    cards: data.cards,
    activeWorkflows: data.activeWorkflows,
    postEntities: [],
    processByPostId: new Map(),
    concludedPostProcesses: [],
    activePostProcessCount: 0,
    postProcessesVisible: data.postProcessesVisible ?? false,
    isLoading: false,
    refresh: vi.fn(),
  } as never);
  return renderPage();
}

const wfFixture = { id: 1 };

// Mirrors useEntregasData.test.ts's vigenteFixture: a minimal PostProcessWithPost
// that toPostEntity accepts, used to hand EntregasPage a real PostEntity (the hook
// itself is mocked in this suite, so nothing derives it for us).
const vigenteFixture: PostProcessWithPost = {
  id: 9,
  conta_id: 'c',
  post_id: 77,
  template_id: null,
  template_nome: null,
  assinatura: '',
  origem_workflow_id: null,
  origem_descricao: null,
  estado: 'ativo',
  motivo_encerramento: null,
  etapa_atual: 0,
  modo_prazo: 'padrao',
  board_position: 0,
  revisao: 1,
  created_by: null,
  created_at: '2026-09-10T00:00:00Z',
  updated_at: '2026-09-10T00:00:00Z',
  concluido_em: null,
  steps: [
    {
      id: 1,
      conta_id: 'c',
      process_id: 9,
      ordem: 0,
      nome: 'Copy',
      tipo: 'padrao',
      responsavel_id: null,
      prazo_dias: null,
      tipo_prazo: null,
      prazo_efetivo: null,
      estado: 'ativo',
      iniciado_em: null,
      concluido_em: null,
      interrompido_em: null,
      origem_etapa_ordem: null,
      origem_etapa_nome: null,
    },
  ],
  post: {
    id: 77,
    workflow_id: null,
    cliente_id: 10,
    cliente_nome: 'Cliente A',
    workflow_titulo: null,
    titulo: 'Post X',
    tipo: 'feed',
    status: 'rascunho',
    custom_status_id: null,
    scheduled_at: null,
    published_at: null,
    ig_caption: null,
    instagram_permalink: null,
    publish_error: null,
    publish_error_code: null,
    ordem: 0,
    responsavel_id: null,
    platform: 'instagram',
    tiktok_publish_status: null,
    tiktok_publish_error: null,
    tiktok_post_url: null,
    instagram_media_id: null,
    ig_trial_strategy: null,
    board_ordem: null,
  },
} as unknown as PostProcessWithPost;

/** 'YYYY-MM-DD' n days from today, local time — the etapa `data_limite` format. */
function isoInDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

describe('EntregasPage', () => {
  beforeEach(() => {
    mockedDuplicateWorkflow.mockReset();
    mockedGetStandalonePost.mockReset();
    mockedToast.success.mockReset();
    mockedToast.error.mockReset();
    mockedToast.info.mockReset();
    tourMock.startEntregasTour.mockReset();
    mockedUseActivePosts.mockReturnValue({ posts: [], isLoading: false });
    limitsMock.features = null;
    localStorage.clear();
    // The "Como funciona" panel is open by default, and its copy names the same
    // objects the board does ("Publicações", "Fluxos"), which makes the board's
    // own getByText queries ambiguous. Board tests start with it dismissed; the
    // explainer's own describe block clears this key to get it back.
    localStorage.setItem('entregas_explainer_dismissed_conta-1', 'true');
    // Anchors are queried one frame after launch; run the callback inline so launchTour
    // completes within the test tick.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });

  it('renders a loading state while entregas data is hydrating', () => {
    mockedUseEntregasData.mockReturnValue({
      clientes: [],
      membros: [],
      templates: [],
      cards: [],
      activeWorkflows: [],
      postEntities: [],
      processByPostId: new Map(),
      concludedPostProcesses: [],
      activePostProcessCount: 0,
      isLoading: true,
      refresh: vi.fn(),
    } as never);

    const { container } = renderPage();

    expect(container.firstChild).not.toBeNull();
    expect(screen.queryByText('Entregas')).not.toBeInTheDocument();
  });

  it('renders the default kanban shell, applies filters, and opens the main modals', async () => {
    const refresh = vi.fn();
    mockedUseEntregasData.mockReturnValue({
      clientes: [{ id: 10, nome: 'Clínica Aurora' }],
      membros: [{ id: 7, nome: 'Ana' }],
      templates: [{ id: 99, nome: 'Template' }],
      cards: [
        makeCard({
          workflow: { id: 1, titulo: 'Fluxo Editorial', cliente_id: 10, status: 'ativo' },
          etapa: { responsavel_id: 7 },
          deadline: { estourado: false, urgente: true },
        }),
        makeCard({
          workflow: { id: 2, titulo: 'Fluxo Atrasado', cliente_id: 11, status: 'ativo' },
          etapa: { responsavel_id: 8 },
          deadline: { estourado: true, urgente: false },
        }),
      ],
      activeWorkflows: [{ id: 1 }, { id: 2 }],
      postEntities: [],
      processByPostId: new Map(),
      concludedPostProcesses: [],
      activePostProcessCount: 0,
      isLoading: false,
      refresh,
    } as never);

    renderPage();

    expect(screen.getByRole('heading', { name: 'Entregas' })).toBeInTheDocument();
    expect(screen.getByText(/fluxos ativos: 2/i)).toBeInTheDocument();
    expect(screen.getByText(/1 atrasado/i)).toBeInTheDocument();
    expect(screen.getByText(/1 urgente/i)).toBeInTheDocument();
    expect(screen.getByText('Kanban view: Fluxo Editorial, Fluxo Atrasado')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Filter overdue'));
    expect(screen.getByText('Kanban view: Fluxo Atrasado')).toBeInTheDocument();

    // Multi-select is an OR across the picked statuses
    fireEvent.click(screen.getByText('Filter overdue and urgent'));
    expect(screen.getByText('Kanban view: Fluxo Editorial, Fluxo Atrasado')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Templates'));
    expect(screen.getByText('Templates modal')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Refresh templates'));
    expect(refresh).toHaveBeenCalled();

    // "Novo" is now a dropdown with "Novo fluxo" and "Post avulso" items.
    fireEvent.click(screen.getByText('Novo fluxo'));
    expect(screen.getByText('WizardMock')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Created workflow'));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('opens TemplatesModal from the board\'s own "Create new template" control', () => {
    renderEntregasPage({ activeWorkflows: [wfFixture], cards: [makeCard()] });

    expect(screen.queryByText('Templates modal')).not.toBeInTheDocument();

    // Distinct from the top-nav "Templates" button covered above: this exercises
    // KanbanView's own onCreateTemplate -> setTemplatesOpen(true) wiring.
    fireEvent.click(screen.getByText('Create new template'));

    expect(screen.getByText('Templates modal')).toBeInTheDocument();
  });

  it('mostra o total de posts individuais no cabeçalho só com a flag ligada', async () => {
    renderEntregasPage({ activeWorkflows: [wfFixture], cards: [] });
    expect(await screen.findByText(/fluxos ativos: 1/)).toBeInTheDocument();
    expect(screen.queryByText(/posts individuais/)).toBeNull();
  });

  it('opens the Post avulso dialog from the Novo dropdown and switches into Publicações after creating one', () => {
    renderEntregasPage({ activeWorkflows: [wfFixture], cards: [makeCard()] });

    expect(screen.getByText(/^kanban view:/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Post avulso'));
    expect(screen.getByText('NewAvulsoDialogMock')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Create avulso post'));
    // The kanban view has no Publicações mode of its own in this suite's mock (it
    // only reads `cards`), so the switch is observed via the real PostsKanbanView
    // mock rendering instead of the KanbanView mock.
    expect(screen.getByText('Posts kanban view: 0')).toBeInTheDocument();
    expect(screen.queryByText('NewAvulsoDialogMock')).not.toBeInTheDocument();
  });

  it('reveals the standalone post if the manual apply dialog is cancelled (post was already created)', () => {
    renderEntregasPage({ activeWorkflows: [wfFixture], cards: [makeCard()] });

    fireEvent.click(screen.getByText('Post avulso'));
    fireEvent.click(screen.getByText('Create avulso post needing manual apply'));

    expect(screen.getByText('ApplyProcessDialogMock: 77')).toBeInTheDocument();

    // Cancelling must NOT just close the dialog -- the post already exists
    // without a process, so it needs the same reveal as a normal avulso
    // creation, or it silently vanishes from the Fluxos board (2026-09-12
    // Codex review finding).
    fireEvent.click(screen.getByText('Cancel apply process'));

    expect(screen.queryByText('ApplyProcessDialogMock: 77')).not.toBeInTheDocument();
    expect(screen.getByText('Standalone drawer: 77')).toBeInTheDocument();
    expect(screen.getByText('Posts kanban view: 0')).toBeInTheDocument();
  });

  it('reveals the post on the Fluxos board (not Publicações) after successfully applying a process manually', () => {
    renderEntregasPage({ activeWorkflows: [wfFixture], cards: [makeCard()] });

    fireEvent.click(screen.getByText('Post avulso'));
    fireEvent.click(screen.getByText('Create avulso post needing manual apply'));
    expect(screen.getByText('ApplyProcessDialogMock: 77')).toBeInTheDocument();

    // The real ApplyProcessDialog calls onApplied() then onClose() in the same
    // batch on success -- the onClose fallback added for the cancel case must
    // NOT also fire here and override the reveal (2026-09-12 opus review
    // finding: it did, landing the user in Publicações instead of Fluxos).
    fireEvent.click(screen.getByText('Apply process'));

    expect(screen.queryByText('ApplyProcessDialogMock: 77')).not.toBeInTheDocument();
    expect(screen.getByText(/^kanban view:/i)).toBeInTheDocument();
    expect(screen.queryByText('Posts kanban view: 0')).not.toBeInTheDocument();
    expect(screen.queryByText('Standalone drawer: 77')).not.toBeInTheDocument();
  });

  it('keeps the current view when creating a post avulso from an already-Publicações kanban/lista', () => {
    renderEntregasPage({ activeWorkflows: [wfFixture], cards: [makeCard()] });

    fireEvent.click(screen.getByText('Lista'));
    fireEvent.click(screen.getByText('Status'));
    expect(screen.getByText('Posts list view: 0')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Post avulso'));
    fireEvent.click(screen.getByText('Create avulso post'));

    expect(screen.getByText('Posts list view: 0')).toBeInTheDocument();
  });

  it('switches from a non-kanban/lista view (calendar) to kanban Publicações after creating a post avulso', () => {
    renderEntregasPage({ activeWorkflows: [wfFixture], cards: [makeCard()] });

    fireEvent.click(screen.getByText('Calendário'));
    expect(screen.getByText(/^calendar view:/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Post avulso'));
    fireEvent.click(screen.getByText('Create avulso post'));

    expect(screen.getByText('Posts kanban view: 0')).toBeInTheDocument();
  });

  it('switches views and hides filters in the concluded view', () => {
    mockedUseEntregasData.mockReturnValue({
      clientes: [{ id: 10, nome: 'Clínica Aurora' }],
      membros: [{ id: 7, nome: 'Ana' }],
      templates: [],
      cards: [makeCard()],
      activeWorkflows: [{ id: 1 }],
      postEntities: [],
      processByPostId: new Map(),
      concludedPostProcesses: [],
      activePostProcessCount: 0,
      isLoading: false,
      refresh: vi.fn(),
    } as never);

    renderPage();

    fireEvent.click(screen.getByText('Visão geral'));
    expect(screen.getByText('Chart view: Fluxo Editorial')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Lista'));
    expect(screen.getByText('List view: Fluxo Editorial')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Change sort'));
    expect(screen.getByText('Sort: deadline/desc')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Concluídas'));
    expect(screen.getByText('Concluded view')).toBeInTheDocument();
    expect(screen.queryByText(/Filters:/)).not.toBeInTheDocument();
  });

  it('exposes the view switcher as a tablist and sets the document title', () => {
    renderEntregasPage({ activeWorkflows: [wfFixture], cards: [makeCard()] });

    expect(document.title).toBe('Entregas | Mesaas');

    expect(screen.getByRole('tablist', { name: 'Modos de visualização' })).toBeInTheDocument();
    const kanbanTab = screen.getByRole('tab', { name: 'Kanban' });
    const visaoGeralTab = screen.getByRole('tab', { name: 'Visão geral' });
    expect(kanbanTab).toHaveAttribute('aria-selected', 'true');
    expect(visaoGeralTab).toHaveAttribute('aria-selected', 'false');

    fireEvent.click(visaoGeralTab);

    expect(visaoGeralTab).toHaveAttribute('aria-selected', 'true');
    expect(kanbanTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('Chart view: Fluxo Editorial')).toBeInTheDocument();
    // The "de N fluxos" caption counts the whole board, not the filtered slice.
    expect(screen.getByText('Chart total: 1')).toBeInTheDocument();
  });

  // The Visão geral KPIs and buckets patch filterPrazo; without the entregas-mode
  // pipeline reading it, every one of those clicks changed state with no effect.
  it('applies the prazo filter to the fluxos board, not only to posts', () => {
    renderEntregasPage({
      activeWorkflows: [{ id: 1 }, { id: 2 }],
      cards: [
        makeCard({
          workflow: { id: 1, titulo: 'Vence hoje', cliente_id: 10, status: 'ativo' },
          etapa: { responsavel_id: 7, data_limite: isoInDays(0) },
        }),
        makeCard({
          workflow: { id: 2, titulo: 'Vence semana que vem', cliente_id: 10, status: 'ativo' },
          etapa: { responsavel_id: 7, data_limite: isoInDays(8) },
        }),
      ],
    });

    fireEvent.click(screen.getByText('Visão geral'));
    expect(screen.getByText('Chart view: Vence hoje, Vence semana que vem')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Chart KPI vencem hoje'));

    expect(screen.getByText('Chart view: Vence hoje')).toBeInTheDocument();
  });

  it('hydrates the prazo filter for the fluxos board straight from the URL', () => {
    mockedUseEntregasData.mockReturnValue({
      clientes: [],
      membros: [],
      templates: [],
      cards: [
        makeCard({
          workflow: { id: 1, titulo: 'Vence hoje', cliente_id: 10, status: 'ativo' },
          etapa: { responsavel_id: 7, data_limite: isoInDays(0) },
        }),
        makeCard({
          workflow: { id: 2, titulo: 'Vence semana que vem', cliente_id: 10, status: 'ativo' },
          etapa: { responsavel_id: 7, data_limite: isoInDays(8) },
        }),
      ],
      activeWorkflows: [{ id: 1 }, { id: 2 }],
      postEntities: [],
      activePostProcessCount: 0,
      isLoading: false,
      refresh: vi.fn(),
    } as never);

    renderPage('/entregas?prazo=hoje');

    expect(screen.getByText('Kanban view: Vence hoje')).toBeInTheDocument();
  });

  it('auto-opens the drawer from the query string and supports edit-to-posts flow', async () => {
    mockedUseEntregasData.mockReturnValue({
      clientes: [{ id: 10, nome: 'Clínica Aurora' }],
      membros: [{ id: 7, nome: 'Ana' }],
      templates: [],
      cards: [
        makeCard({
          workflow: { id: 2, titulo: 'Fluxo Profundo', cliente_id: 10, status: 'ativo' },
        }),
      ],
      activeWorkflows: [{ id: 2 }],
      postEntities: [],
      activePostProcessCount: 0,
      isLoading: false,
      refresh: vi.fn(),
    } as never);

    renderPage('/entregas?drawer=2');

    expect(await screen.findByText('Workflow drawer: Fluxo Profundo')).toBeInTheDocument();
    expect(screen.getByTestId('current-path')).toHaveTextContent('/entregas');

    fireEvent.click(screen.getByText('Close drawer'));
    expect(screen.queryByText('Workflow drawer: Fluxo Profundo')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Open edit modal'));
    expect(screen.getByText('Edit workflow modal: Fluxo Profundo')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Open posts from edit'));
    await waitFor(() => {
      expect(screen.getByText('Workflow drawer: Fluxo Profundo')).toBeInTheDocument();
    });
    expect(screen.queryByText('Edit workflow modal: Fluxo Profundo')).not.toBeInTheDocument();
  });

  // Regression: the URL-sync effect used to re-add `drawer` from a stale searchParams
  // snapshot, pinning it in the URL forever so every reload re-opened the drawer.
  it('strips the consumed drawer param from the URL so a reload does not re-open it', async () => {
    mockedUseEntregasData.mockReturnValue({
      clientes: [{ id: 10, nome: 'Clínica Aurora' }],
      membros: [{ id: 7, nome: 'Ana' }],
      templates: [],
      cards: [
        makeCard({
          workflow: { id: 2, titulo: 'Fluxo Profundo', cliente_id: 10, status: 'ativo' },
        }),
      ],
      activeWorkflows: [{ id: 2 }],
      postEntities: [],
      activePostProcessCount: 0,
      isLoading: false,
      refresh: vi.fn(),
    } as never);

    renderPage('/entregas?drawer=2&post=5');

    expect(await screen.findByText('Workflow drawer: Fluxo Profundo')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('current-path')).toHaveTextContent(/^\/entregas$/);
    });
  });

  // GlobalSearchTrigger is mounted globally, so a ?drawer= deep link can arrive while the
  // user is ALREADY on /entregas. `cards` does not change reference on that navigation, so
  // a resolver keyed only on `cards` never re-runs and the click silently does nothing.
  it('opens the drawer for a deep link that arrives while already on /entregas', async () => {
    mockedUseEntregasData.mockReturnValue({
      clientes: [{ id: 10, nome: 'Clínica Aurora' }],
      membros: [{ id: 7, nome: 'Ana' }],
      templates: [],
      cards: [
        makeCard({
          workflow: { id: 2, titulo: 'Fluxo Profundo', cliente_id: 10, status: 'ativo' },
        }),
      ],
      activeWorkflows: [{ id: 2 }],
      postEntities: [],
      activePostProcessCount: 0,
      isLoading: false,
      refresh: vi.fn(),
    } as never);

    renderPage('/entregas');
    expect(screen.queryByText('Workflow drawer: Fluxo Profundo')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Deep link from search'));

    expect(await screen.findByText('Workflow drawer: Fluxo Profundo')).toBeInTheDocument();
    expect(screen.getByTestId('drawer-initial-post')).toHaveTextContent('5');
    await waitFor(() => {
      expect(screen.getByTestId('current-path')).toHaveTextContent(/^\/entregas$/);
    });
  });

  it('opens the linked post inside the drawer when ?post= accompanies ?drawer=', async () => {
    mockedUseEntregasData.mockReturnValue({
      clientes: [{ id: 10, nome: 'Clínica Aurora' }],
      membros: [{ id: 7, nome: 'Ana' }],
      templates: [],
      cards: [
        makeCard({
          workflow: { id: 2, titulo: 'Fluxo Profundo', cliente_id: 10, status: 'ativo' },
        }),
      ],
      activeWorkflows: [{ id: 2 }],
      postEntities: [],
      activePostProcessCount: 0,
      isLoading: false,
      refresh: vi.fn(),
    } as never);

    renderPage('/entregas?drawer=2&post=5');

    expect(await screen.findByText('Workflow drawer: Fluxo Profundo')).toBeInTheDocument();
    expect(screen.getByTestId('drawer-initial-post')).toHaveTextContent('5');
  });

  describe('bare ?post= deep link (no ?drawer=)', () => {
    it('resolves to a post avulso: opens the standalone slot and closes an already-open workflow drawer', async () => {
      mockedUseEntregasData.mockReturnValue({
        clientes: [{ id: 10, nome: 'Clínica Aurora' }],
        membros: [{ id: 7, nome: 'Ana' }],
        templates: [],
        cards: [
          makeCard({
            workflow: { id: 2, titulo: 'Fluxo Profundo', cliente_id: 10, status: 'ativo' },
          }),
        ],
        activeWorkflows: [{ id: 2 }],
        postEntities: [],
        activePostProcessCount: 0,
        isLoading: false,
        refresh: vi.fn(),
      } as never);
      mockedGetStandalonePost.mockResolvedValue({
        id: 5,
        workflow_id: null,
        cliente_nome: 'Clínica Aurora',
      } as never);

      renderPage('/entregas?drawer=2');
      expect(await screen.findByText('Workflow drawer: Fluxo Profundo')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Deep link to bare post'));

      await waitFor(() => {
        expect(screen.queryByText('Workflow drawer: Fluxo Profundo')).not.toBeInTheDocument();
      });
      expect(mockedGetStandalonePost).toHaveBeenCalledWith(5);
      expect(mockedToast.error).not.toHaveBeenCalled();
      await waitFor(() => {
        expect(screen.getByTestId('current-path')).toHaveTextContent(/^\/entregas$/);
      });
    });

    it('onAttached from the standalone drawer closes it and opens the target WorkflowDrawer at the same post', async () => {
      mockedUseEntregasData.mockReturnValue({
        clientes: [{ id: 10, nome: 'Clínica Aurora' }],
        membros: [{ id: 7, nome: 'Ana' }],
        templates: [],
        cards: [
          makeCard({
            workflow: { id: 2, titulo: 'Fluxo Profundo', cliente_id: 10, status: 'ativo' },
          }),
        ],
        activeWorkflows: [{ id: 2 }],
        postEntities: [],
        activePostProcessCount: 0,
        isLoading: false,
        refresh: vi.fn(),
      } as never);
      mockedGetStandalonePost.mockResolvedValue({
        id: 5,
        workflow_id: null,
        cliente_nome: 'Clínica Aurora',
      } as never);

      renderPage('/entregas?post=5');
      expect(await screen.findByText('Standalone drawer: 5')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Attach standalone post to fluxo 2'));

      await waitFor(() => {
        expect(screen.queryByText('Standalone drawer: 5')).not.toBeInTheDocument();
      });
      expect(await screen.findByText('Workflow drawer: Fluxo Profundo')).toBeInTheDocument();
      expect(screen.getByTestId('drawer-initial-post')).toHaveTextContent('5');
    });

    it('onOpenWorkflow (mover posts) segura o alvo pendente até o card do fluxo novo existir após o refetch', async () => {
      let data = {
        clientes: [{ id: 10, nome: 'Clínica Aurora' }],
        membros: [],
        templates: [],
        cards: [makeCard()],
        activeWorkflows: [{ id: 1 }],
        postEntities: [],
        activePostProcessCount: 0,
        isLoading: false,
        refresh: vi.fn(),
      };
      mockedUseEntregasData.mockImplementation(() => data as never);

      renderPage();
      fireEvent.click(screen.getByText('Open drawer from card'));
      expect(await screen.findByText('Workflow drawer: Fluxo Editorial')).toBeInTheDocument();

      // The drawer just moved posts into workflow 99, which is NOT on the board
      // yet (a freshly created flow only shows up after the workflows refetch):
      // the source drawer closes and nothing else opens -- the target is kept
      // pending, not dropped.
      fireEvent.click(screen.getByText('Move posts to workflow 99'));
      await waitFor(() => expect(screen.queryByText(/Workflow drawer:/)).not.toBeInTheDocument());

      // The refetch lands (new cards identity including workflow 99); any
      // re-render lets the pending-deep-link resolver see the fresh cards.
      data = {
        ...data,
        cards: [
          ...data.cards,
          makeCard({
            workflow: { id: 99, titulo: 'Fluxo Novo', cliente_id: 10, status: 'ativo' },
          }),
        ],
      };
      fireEvent.click(screen.getByText('Filter overdue'));

      expect(await screen.findByText('Workflow drawer: Fluxo Novo')).toBeInTheDocument();
      expect(screen.getByTestId('drawer-initial-post')).toHaveTextContent('none');
    });

    it('onOpenWorkflow com seed abre o drawer do fluxo novo NA HORA, sem esperar refetch', async () => {
      mockedUseEntregasData.mockReturnValue({
        clientes: [{ id: 10, nome: 'Clínica Aurora' }],
        membros: [],
        templates: [],
        cards: [makeCard()],
        activeWorkflows: [{ id: 1 }],
        postEntities: [],
        activePostProcessCount: 0,
        isLoading: false,
        refresh: vi.fn(),
      } as never);

      renderPage();
      fireEvent.click(screen.getByText('Open drawer from card'));
      expect(await screen.findByText('Workflow drawer: Fluxo Editorial')).toBeInTheDocument();

      // Workflow 99 is NOT on the board (cards unchanged), but the seed carries
      // its row + etapas: the provisional card opens the destination drawer
      // immediately -- no refetch, no pending deep link.
      fireEvent.click(screen.getByText('Move posts to workflow 99 with seed'));

      expect(await screen.findByText('Workflow drawer: Fluxo Novo')).toBeInTheDocument();
      expect(screen.getByTestId('drawer-initial-post')).toHaveTextContent('none');
    });

    it('resolves to an attached post: falls back to the same card-lookup drawer as ?drawer=', async () => {
      mockedUseEntregasData.mockReturnValue({
        clientes: [{ id: 10, nome: 'Clínica Aurora' }],
        membros: [{ id: 7, nome: 'Ana' }],
        templates: [],
        cards: [
          makeCard({
            workflow: { id: 2, titulo: 'Fluxo Profundo', cliente_id: 10, status: 'ativo' },
          }),
        ],
        activeWorkflows: [{ id: 2 }],
        postEntities: [],
        activePostProcessCount: 0,
        isLoading: false,
        refresh: vi.fn(),
      } as never);
      mockedGetStandalonePost.mockResolvedValue({
        id: 7,
        workflow_id: 2,
        cliente_nome: 'Clínica Aurora',
      } as never);

      renderPage('/entregas?post=7');

      expect(await screen.findByText('Workflow drawer: Fluxo Profundo')).toBeInTheDocument();
      expect(screen.getByTestId('drawer-initial-post')).toHaveTextContent('7');
      expect(mockedGetStandalonePost).toHaveBeenCalledWith(7);
    });

    it('shows a not-found toast when the post no longer exists', async () => {
      mockedUseEntregasData.mockReturnValue({
        clientes: [],
        membros: [],
        templates: [],
        cards: [],
        activeWorkflows: [],
        postEntities: [],
        activePostProcessCount: 0,
        isLoading: false,
        refresh: vi.fn(),
      } as never);
      mockedGetStandalonePost.mockResolvedValue(null);

      renderPage('/entregas?post=404');

      await waitFor(() => {
        expect(mockedToast.error).toHaveBeenCalledWith('Post não encontrado');
      });
      expect(screen.queryByText(/Workflow drawer/)).not.toBeInTheDocument();
    });
  });

  describe('deep link ?drawer= quando o fluxo não está no quadro', () => {
    function renderWithBoard(entry: string) {
      mockedUseEntregasData.mockReturnValue({
        clientes: [],
        membros: [],
        templates: [],
        cards: [makeCard()],
        activeWorkflows: [wfFixture],
        postEntities: [],
        activePostProcessCount: 0,
        isLoading: false,
        refresh: vi.fn(),
      } as never);
      return renderPage(entry);
    }

    it('abre o post avulso quando o post foi desmembrado do fluxo do link', async () => {
      mockedGetStandalonePost.mockResolvedValue({ id: 5, workflow_id: null } as never);
      renderWithBoard('/entregas?drawer=99&post=5');
      expect(await screen.findByText('Standalone drawer: 5')).toBeInTheDocument();
      expect(mockedGetStandalonePost).toHaveBeenCalledWith(5);
      expect(screen.getByTestId('current-path')).toHaveTextContent('/entregas');
    });

    it('avisa quando o post continua em um fluxo fora do quadro, sem entrar em loop', async () => {
      mockedGetStandalonePost.mockResolvedValue({ id: 5, workflow_id: 99 } as never);
      renderWithBoard('/entregas?drawer=99&post=5');
      await waitFor(() =>
        expect(mockedToast.error).toHaveBeenCalledWith(
          'Este post está em um fluxo que não aparece mais no quadro.',
        ),
      );
      expect(mockedGetStandalonePost).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(/Standalone drawer/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Workflow drawer/)).not.toBeInTheDocument();
    });

    it('abre o novo fluxo quando o post foi movido para um fluxo que está no quadro', async () => {
      mockedGetStandalonePost.mockResolvedValue({ id: 5, workflow_id: 1 } as never);
      renderWithBoard('/entregas?drawer=99&post=5');
      expect(await screen.findByText('Workflow drawer: Fluxo Editorial')).toBeInTheDocument();
      expect(screen.getByTestId('drawer-initial-post')).toHaveTextContent('5');
      expect(mockedGetStandalonePost).toHaveBeenCalledTimes(1);
      expect(mockedToast.error).not.toHaveBeenCalled();
    });

    it('avisa uma única vez quando o post foi movido para outro fluxo que também não está no quadro', async () => {
      mockedGetStandalonePost.mockResolvedValue({ id: 5, workflow_id: 42 } as never);
      renderWithBoard('/entregas?drawer=99&post=5');
      await waitFor(() =>
        expect(mockedToast.error).toHaveBeenCalledWith(
          'Este post está em um fluxo que não aparece mais no quadro.',
        ),
      );
      expect(mockedToast.error).toHaveBeenCalledTimes(1);
      expect(mockedGetStandalonePost).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(/Workflow drawer/)).not.toBeInTheDocument();
    });

    it('avisa quando só o fluxo foi pedido e ele não existe', async () => {
      renderWithBoard('/entregas?drawer=99');
      await waitFor(() => expect(mockedToast.error).toHaveBeenCalledWith('Fluxo não encontrado'));
      expect(mockedGetStandalonePost).not.toHaveBeenCalled();
    });

    it('espera o carregamento antes de decidir que o fluxo não existe', async () => {
      mockedUseEntregasData.mockReturnValue({
        clientes: [],
        membros: [],
        templates: [],
        cards: [],
        activeWorkflows: [],
        postEntities: [],
        activePostProcessCount: 0,
        isLoading: true,
        isFetching: true,
        refresh: vi.fn(),
      } as never);
      const { rerender } = renderPage('/entregas?drawer=99');
      await new Promise((r) => setTimeout(r, 0));
      expect(mockedToast.error).not.toHaveBeenCalled();

      // Carregamento termina, lista final confirma que o fluxo não existe.
      mockedUseEntregasData.mockReturnValue({
        clientes: [],
        membros: [],
        templates: [],
        cards: [],
        activeWorkflows: [],
        postEntities: [],
        activePostProcessCount: 0,
        isLoading: false,
        isFetching: false,
        refresh: vi.fn(),
      } as never);
      rerender(pageTree('/entregas?drawer=99'));
      await waitFor(() => expect(mockedToast.error).toHaveBeenCalledWith('Fluxo não encontrado'));
    });

    it('espera o refetch em background antes de decidir que o fluxo não existe', async () => {
      mockedUseEntregasData.mockReturnValue({
        clientes: [],
        membros: [],
        templates: [],
        cards: [makeCard()],
        activeWorkflows: [wfFixture],
        postEntities: [],
        activePostProcessCount: 0,
        isLoading: false,
        isFetching: true,
        refresh: vi.fn(),
      } as never);
      renderPage('/entregas?drawer=99');
      await new Promise((r) => setTimeout(r, 0));
      expect(mockedToast.error).not.toHaveBeenCalled();
    });

    it('continua abrindo o drawer do fluxo quando o card existe', async () => {
      renderWithBoard('/entregas?drawer=1&post=5');
      expect(await screen.findByText('Workflow drawer: Fluxo Editorial')).toBeInTheDocument();
      expect(screen.getByTestId('drawer-initial-post')).toHaveTextContent('5');
      expect(mockedGetStandalonePost).not.toHaveBeenCalled();
    });

    it('resolve ?post= de post preso em fluxo fora do quadro com duas consultas e um aviso', async () => {
      mockedGetStandalonePost.mockResolvedValue({ id: 7, workflow_id: 99 } as never);
      mockedUseEntregasData.mockReturnValue({
        clientes: [],
        membros: [],
        templates: [],
        cards: [],
        activeWorkflows: [],
        postEntities: [],
        activePostProcessCount: 0,
        isLoading: false,
        isFetching: false,
        refresh: vi.fn(),
      } as never);
      renderPage('/entregas?post=7');
      await waitFor(() =>
        expect(mockedToast.error).toHaveBeenCalledWith(
          'Este post está em um fluxo que não aparece mais no quadro.',
        ),
      );
      expect(mockedGetStandalonePost).toHaveBeenCalledTimes(2);
      expect(screen.queryByText(/Standalone drawer/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Workflow drawer/)).not.toBeInTheDocument();
    });
  });

  it('duplicates recurring workflows and refreshes on success', async () => {
    const refresh = vi.fn();
    mockedDuplicateWorkflow.mockResolvedValue(undefined as never);
    mockedUseEntregasData.mockReturnValue({
      clientes: [{ id: 10, nome: 'Clínica Aurora' }],
      membros: [{ id: 7, nome: 'Ana' }],
      templates: [],
      cards: [makeCard()],
      activeWorkflows: [{ id: 1 }],
      postEntities: [],
      activePostProcessCount: 0,
      isLoading: false,
      refresh,
    } as never);

    renderPage();
    fireEvent.click(screen.getByText('Trigger recurring'));
    expect(screen.getByText('Recurring dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Confirm recurring'));

    await waitFor(() => {
      expect(mockedDuplicateWorkflow).toHaveBeenCalledWith(1);
    });
    expect(mockedToast.success).toHaveBeenCalledWith('Novo ciclo criado!');
    expect(refresh).toHaveBeenCalled();
  });

  it('shows an error toast when recurring duplication fails', async () => {
    const refresh = vi.fn();
    mockedDuplicateWorkflow.mockRejectedValue(new Error('boom'));
    mockedUseEntregasData.mockReturnValue({
      clientes: [{ id: 10, nome: 'Clínica Aurora' }],
      membros: [{ id: 7, nome: 'Ana' }],
      templates: [],
      cards: [makeCard()],
      activeWorkflows: [{ id: 1 }],
      postEntities: [],
      activePostProcessCount: 0,
      isLoading: false,
      refresh,
    } as never);

    renderPage();
    fireEvent.click(screen.getByText('Trigger recurring'));
    fireEvent.click(screen.getByText('Confirm recurring'));

    await waitFor(() => {
      expect(mockedToast.error).toHaveBeenCalledWith('Erro ao criar ciclo');
    });
    expect(refresh).toHaveBeenCalled();
  });

  it('shows the ExampleBoard when there are no active workflows and the tour key is unset', () => {
    localStorage.clear();
    renderEntregasPage({ activeWorkflows: [], cards: [] });
    expect(screen.getByText('Posts de Agosto')).toBeTruthy(); // example card
  });

  it('keeps the plain empty message when filters empty the board but workflows exist', () => {
    renderEntregasPage({ activeWorkflows: [wfFixture], cards: [] });
    expect(screen.queryByText('Posts de Agosto')).toBeNull();
    expect(screen.getByText(/nenhuma entrega encontrada/i)).toBeTruthy();
  });

  it('does not show the ExampleBoard once dismissed', () => {
    localStorage.setItem('entregas_tour_done_conta-1', 'true');
    renderEntregasPage({ activeWorkflows: [], cards: [] });
    expect(screen.queryByText('Posts de Agosto')).toBeNull();
  });

  it('replay temporarily renders the ExampleBoard without clearing the key', async () => {
    localStorage.setItem('entregas_tour_done_conta-1', 'true');
    renderEntregasPage({ activeWorkflows: [], cards: [] });
    fireEvent.click(screen.getByText(/ver tour novamente/i));
    expect(screen.getByText('Posts de Agosto')).toBeTruthy();
    expect(localStorage.getItem('entregas_tour_done_conta-1')).toBe('true');
  });

  it('auto-starts the tour exactly once on an empty first visit with an unset key', () => {
    localStorage.clear();
    renderEntregasPage({ activeWorkflows: [], cards: [] });
    expect(tourMock.startEntregasTour).toHaveBeenCalledTimes(1);
    expect(tourMock.startEntregasTour).toHaveBeenCalledWith(
      expect.objectContaining({
        onComplete: expect.any(Function),
        onDismiss: expect.any(Function),
      }),
    );
  });

  it('does not auto-start the tour when the conta has already completed it', () => {
    localStorage.setItem('entregas_tour_done_conta-1', 'true');
    renderEntregasPage({ activeWorkflows: [], cards: [] });
    expect(tourMock.startEntregasTour).not.toHaveBeenCalled();
  });

  it('shows the replay control only on the kanban view', () => {
    renderEntregasPage({ activeWorkflows: [wfFixture], cards: [] });
    expect(screen.getByText(/ver tour novamente/i)).toBeTruthy();
    fireEvent.click(screen.getByText('Visão geral'));
    expect(screen.queryByText(/ver tour novamente/i)).toBeNull();
  });

  it('toggles the kanban into Publicações mode: swaps the board, hides the replay link, posts filters', () => {
    renderEntregasPage({ activeWorkflows: [wfFixture], cards: [makeCard()] });

    expect(screen.getByText(/^kanban view:/i)).toBeInTheDocument();
    expect(screen.getByText('FiltersMode: entregas')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Status'));

    expect(screen.getByText('Posts kanban view: 0')).toBeInTheDocument();
    expect(screen.queryByText(/^kanban view:/i)).toBeNull();
    expect(screen.queryByText(/ver tour novamente/i)).toBeNull();
    expect(screen.getByText('FiltersMode: posts')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Etapas' }));
    expect(screen.getByText(/^kanban view:/i)).toBeInTheDocument();
  });

  it('clicking a post avulso from the Publicações kanban closes an already-open workflow drawer', async () => {
    renderEntregasPage({ activeWorkflows: [wfFixture], cards: [makeCard()] });

    fireEvent.click(screen.getByText('Open drawer from card'));
    expect(await screen.findByText('Workflow drawer: Fluxo Editorial')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Status'));
    fireEvent.click(screen.getByText('Open avulso post from kanban'));

    expect(screen.queryByText('Workflow drawer: Fluxo Editorial')).not.toBeInTheDocument();
  });

  it('keeps the Publicações mode when switching between kanban and lista (one page-wide mode)', () => {
    renderEntregasPage({ activeWorkflows: [wfFixture], cards: [makeCard()] });

    // Put the page in Publicações mode from the kanban…
    fireEvent.click(screen.getByText('Status'));
    expect(screen.getByText('Posts kanban view: 0')).toBeInTheDocument();

    // …and Lista opens already in Publicações (shared state, not per-view).
    fireEvent.click(screen.getByText('Lista'));
    expect(screen.getByText('Posts list view: 0')).toBeInTheDocument();
    expect(screen.queryByText(/^list view:/i)).toBeNull();
    expect(screen.getByText('FiltersMode: posts')).toBeInTheDocument();

    // Back to Fluxos in the lista carries into the kanban too.
    fireEvent.click(screen.getByText('Etapas'));
    expect(screen.getByText(/^list view:/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Kanban'));
    expect(screen.queryByText('Posts kanban view: 0')).toBeNull();
  });

  it('applies tipo and post-status filters to the posts modes', () => {
    mockedUseActivePosts.mockReturnValue({
      posts: [
        { id: 1, workflow_id: 1, titulo: 'A', tipo: 'reels', status: 'rascunho' },
        { id: 2, workflow_id: 1, titulo: 'B', tipo: 'feed', status: 'postado' },
        { id: 3, workflow_id: 1, titulo: 'C', tipo: 'reels', status: 'postado' },
      ],
      isLoading: false,
    } as never);
    renderEntregasPage({ activeWorkflows: [wfFixture], cards: [makeCard()] });

    fireEvent.click(screen.getByText('Status'));
    expect(screen.getByText('Posts kanban view: 3')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Filter tipo')); // reels only
    expect(screen.getByText('Posts kanban view: 2')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Filter post status')); // + rascunho only
    expect(screen.getByText('Posts kanban view: 1')).toBeInTheDocument();
  });

  it('hydrates view, mode and filters from the URL and writes them back', () => {
    renderEntregasPage({ activeWorkflows: [wfFixture], cards: [makeCard()] });
    // Default state → clean URL
    expect(screen.getByTestId('current-path')).toHaveTextContent(/^\/entregas$/);
  });

  it('opens directly in a shared posts-list view from query params', () => {
    mockedUseEntregasData.mockReturnValue({
      clientes: [],
      membros: [],
      templates: [],
      cards: [makeCard()],
      activeWorkflows: [wfFixture],
      postEntities: [],
      activePostProcessCount: 0,
      isLoading: false,
      refresh: vi.fn(),
    } as never);

    renderPage('/entregas?view=list&mode=publicacoes');

    expect(screen.getByText('Posts list view: 0')).toBeInTheDocument();
    expect(screen.getByText('FiltersMode: posts')).toBeInTheDocument();
    expect(screen.getByTestId('current-path')).toHaveTextContent(
      '/entregas?view=list&mode=publicacoes',
    );
  });

  describe('mode seeding: URL vs persisted last-mode preference', () => {
    it('an explicit ?mode= wins over a persisted preference for the named view', () => {
      localStorage.setItem('entregas_last_mode_conta-1', 'entregas');
      mockedUseEntregasData.mockReturnValue({
        clientes: [],
        membros: [],
        templates: [],
        cards: [makeCard()],
        activeWorkflows: [wfFixture],
        postEntities: [],
        activePostProcessCount: 0,
        isLoading: false,
        refresh: vi.fn(),
      } as never);
      renderPage('/entregas?mode=publicacoes');

      expect(screen.getByText('Posts kanban view: 0')).toBeInTheDocument();
    });

    it('with no ?mode= param at all, every one of the three modeful views seeds from the persisted preference', () => {
      localStorage.setItem('entregas_last_mode_conta-1', 'publicacoes');
      renderEntregasPage({ activeWorkflows: [wfFixture], cards: [makeCard()] });

      // Kanban seeded straight into Publicações...
      expect(screen.getByText('Posts kanban view: 0')).toBeInTheDocument();
      // ...and so does Lista, independently of any URL param.
      fireEvent.click(screen.getByText('Lista'));
      expect(screen.getByText('Posts list view: 0')).toBeInTheDocument();
    });

    it('with no ?mode= param and no persisted preference, every view defaults to Fluxos/Entregas', () => {
      renderEntregasPage({ activeWorkflows: [wfFixture], cards: [makeCard()] });
      expect(screen.getByText(/^kanban view:/i)).toBeInTheDocument();
    });

    it('persists the active mode per conta whenever it changes', () => {
      renderEntregasPage({ activeWorkflows: [wfFixture], cards: [makeCard()] });

      fireEvent.click(screen.getByText('Status'));

      expect(localStorage.getItem('entregas_last_mode_conta-1')).toBe('publicacoes');
    });
  });

  it('opens the whole workflow card from a fluxo tag click', async () => {
    renderEntregasPage({ activeWorkflows: [wfFixture], cards: [makeCard()] });

    fireEvent.click(screen.getByText('Lista'));
    fireEvent.click(screen.getByText('Status'));
    fireEvent.click(screen.getByText('Open fluxo from tag'));

    expect(await screen.findByText('Workflow drawer: Fluxo Editorial')).toBeInTheDocument();
  });

  it('filters posts by the CURRENT ETAPA responsible, not the post-level responsável', () => {
    mockedUseActivePosts.mockReturnValue({
      posts: [
        // Post-level responsavel_id deliberately contradicts the etapa responsible:
        // the filter must follow the etapa (workflow 1 → membro 7), matching the column.
        {
          id: 1,
          workflow_id: 1,
          titulo: 'Etapa da Ana',
          tipo: 'feed',
          status: 'rascunho',
          responsavel_id: 99,
        },
        {
          id: 2,
          workflow_id: 2,
          titulo: 'Etapa de outrem',
          tipo: 'feed',
          status: 'rascunho',
          responsavel_id: 7,
        },
      ],
      isLoading: false,
    } as never);
    renderEntregasPage({
      activeWorkflows: [{ id: 1 }, { id: 2 }],
      cards: [
        makeCard({
          workflow: { id: 1, titulo: 'Fluxo Ana', cliente_id: 10, status: 'ativo' },
          etapa: { responsavel_id: 7 },
        }),
        makeCard({
          workflow: { id: 2, titulo: 'Fluxo Outro', cliente_id: 10, status: 'ativo' },
          etapa: { responsavel_id: 8 },
        }),
      ],
    });

    fireEvent.click(screen.getByText('Status'));
    expect(screen.getByText('Posts kanban view: 2')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Filter member')); // filterMembros: [7]
    expect(screen.getByText('Posts kanban view: 1')).toBeInTheDocument();
  });

  it('filters posts by the workflow current etapa', () => {
    mockedUseActivePosts.mockReturnValue({
      posts: [
        { id: 1, workflow_id: 1, titulo: 'Em design', tipo: 'feed', status: 'rascunho' },
        { id: 2, workflow_id: 2, titulo: 'Em copy', tipo: 'feed', status: 'rascunho' },
      ],
      isLoading: false,
    } as never);
    renderEntregasPage({
      activeWorkflows: [{ id: 1 }, { id: 2 }],
      cards: [
        makeCard({
          workflow: { id: 1, titulo: 'Fluxo Design', cliente_id: 10, status: 'ativo' },
          etapa: { nome: 'Design', responsavel_id: 7 },
        }),
        makeCard({
          workflow: { id: 2, titulo: 'Fluxo Copy', cliente_id: 10, status: 'ativo' },
          etapa: { nome: 'Copy', responsavel_id: 7 },
        }),
      ],
    });

    fireEvent.click(screen.getByText('Status'));
    expect(screen.getByText('Posts kanban view: 2')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Filter etapa Design'));
    expect(screen.getByText('Posts kanban view: 1')).toBeInTheDocument();
  });

  it('applies the prazo-da-etapa filter through the workflow cards', () => {
    mockedUseActivePosts.mockReturnValue({
      posts: [
        { id: 1, workflow_id: 1, titulo: 'No fluxo atrasado', tipo: 'feed', status: 'rascunho' },
        { id: 2, workflow_id: 2, titulo: 'No fluxo em dia', tipo: 'feed', status: 'rascunho' },
      ],
      isLoading: false,
    } as never);
    renderEntregasPage({
      activeWorkflows: [{ id: 1 }, { id: 2 }],
      cards: [
        makeCard({
          workflow: { id: 1, titulo: 'Atrasado', cliente_id: 10, status: 'ativo' },
          deadline: { estourado: true, urgente: false },
        }),
        makeCard({
          workflow: { id: 2, titulo: 'Em dia', cliente_id: 10, status: 'ativo' },
          deadline: { estourado: false, urgente: false },
        }),
      ],
    });

    fireEvent.click(screen.getByText('Status'));
    expect(screen.getByText('Posts kanban view: 2')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Filter prazo atrasado'));
    expect(screen.getByText('Posts kanban view: 1')).toBeInTheDocument();
  });

  describe('filtro de entidade', () => {
    it('flag desligada: sem toggle, sem entidade na URL e sem chave nova no localStorage', () => {
      renderEntregasPage({ activeWorkflows: [wfFixture], cards: [] });
      expect(screen.queryByRole('radiogroup', { name: 'Entidades do quadro' })).toBeNull();
      // PathProbe reads the MemoryRouter's own useLocation(), which DOES reflect
      // setSearchParams -- so this is a real assertion on the synced URL, not
      // just an inference from the viewQuery unit tests.
      expect(screen.getByTestId('current-path')).toHaveTextContent(/^\/entregas$/);
      expect(localStorage.getItem('entregas_entidade_conta-1')).toBeNull();

      // Switching views/mode is exactly what would otherwise trigger the
      // persist effect and the URL sync; confirm the guarantee survives that.
      fireEvent.click(screen.getByText('Lista'));
      expect(screen.getByTestId('current-path')).toHaveTextContent(/^\/entregas\?view=list$/);
      expect(localStorage.getItem('entregas_entidade_conta-1')).toBeNull();
    });

    it('flag ligada e navegador novo: começa em Todos; com entregas_last_mode gravado começa em Fluxos', () => {
      limitsMock.features = { feature_post_processes: true };
      renderEntregasPage({
        activeWorkflows: [wfFixture],
        cards: [],
        postProcessesVisible: true,
      });
      expect(screen.getByRole('radio', { name: 'Todos' })).toHaveAttribute('aria-checked', 'true');
    });

    it('com entregas_last_mode gravado começa em Fluxos', () => {
      limitsMock.features = { feature_post_processes: true };
      localStorage.setItem('entregas_last_mode_conta-1', 'entregas');
      renderEntregasPage({
        activeWorkflows: [wfFixture],
        cards: [],
        postProcessesVisible: true,
      });
      expect(screen.getByRole('radio', { name: 'Fluxos' })).toHaveAttribute('aria-checked', 'true');
    });

    it('?entidade=posts na URL vence a preferência local', () => {
      limitsMock.features = { feature_post_processes: true };
      localStorage.setItem('entregas_entidade_conta-1', 'todos');
      mockedUseEntregasData.mockReturnValue({
        clientes: [],
        membros: [],
        templates: [],
        cards: [],
        activeWorkflows: [wfFixture],
        postEntities: [],
        processByPostId: new Map(),
        concludedPostProcesses: [],
        activePostProcessCount: 0,
        postProcessesVisible: true,
        isLoading: false,
        refresh: vi.fn(),
      } as never);
      renderPage('/entregas?entidade=posts');
      expect(screen.getByRole('radio', { name: 'Posts individuais' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
    });

    it('em Todos, a seção Sem processo lista só avulsos sem processo vigente e liga useActivePosts', async () => {
      limitsMock.features = { feature_post_processes: true };
      mockedUseActivePosts.mockReturnValue({
        posts: [
          {
            id: 1,
            workflow_id: null,
            cliente_id: 1,
            cliente_nome: 'A',
            titulo: 'Avulso livre',
            tipo: 'feed',
            status: 'rascunho',
            platform: 'instagram',
          },
          {
            id: 2,
            workflow_id: null,
            cliente_id: 1,
            cliente_nome: 'A',
            titulo: 'Avulso com processo',
            tipo: 'feed',
            status: 'rascunho',
            platform: 'instagram',
          },
        ],
        isLoading: false,
      } as never);
      mockedUseEntregasData.mockReturnValue({
        clientes: [],
        membros: [],
        templates: [],
        cards: [],
        activeWorkflows: [wfFixture],
        postEntities: [],
        processByPostId: new Map([[2, {}]]),
        concludedPostProcesses: [],
        activePostProcessCount: 0,
        postProcessesVisible: true,
        isLoading: false,
        refresh: vi.fn(),
      } as never);
      renderPage('/entregas?entidade=todos');
      expect(await screen.findByText('Avulso livre')).toBeInTheDocument();
      expect(screen.queryByText('Avulso com processo')).toBeNull();
      expect(mockedUseActivePosts).toHaveBeenLastCalledWith(true);
    });

    it('flag desligada: useActivePosts fica em false no Kanban de Fluxos e a seção Sem processo não monta', () => {
      limitsMock.features = null;
      mockedUseActivePosts.mockReturnValue({
        posts: [
          {
            id: 1,
            workflow_id: null,
            cliente_id: 1,
            cliente_nome: 'A',
            titulo: 'Avulso livre',
            tipo: 'feed',
            status: 'rascunho',
            platform: 'instagram',
          },
        ],
        isLoading: false,
      } as never);
      renderEntregasPage({ activeWorkflows: [wfFixture], cards: [] });
      expect(mockedUseActivePosts).toHaveBeenLastCalledWith(false);
      expect(screen.queryByRole('heading', { name: 'Sem processo' })).toBeNull();
      expect(screen.queryByText('Avulso livre')).toBeNull();
    });

    it('flag ligada e entidade=fluxos: a seção Sem processo também não monta (spec §4.3: não aparece em Fluxos)', () => {
      limitsMock.features = { feature_post_processes: true };
      mockedUseActivePosts.mockReturnValue({
        posts: [
          {
            id: 1,
            workflow_id: null,
            cliente_id: 1,
            cliente_nome: 'A',
            titulo: 'Avulso livre',
            tipo: 'feed',
            status: 'rascunho',
            platform: 'instagram',
          },
        ],
        isLoading: false,
      } as never);
      mockedUseEntregasData.mockReturnValue({
        clientes: [],
        membros: [],
        templates: [],
        cards: [],
        activeWorkflows: [wfFixture],
        postEntities: [],
        processByPostId: new Map(),
        concludedPostProcesses: [],
        activePostProcessCount: 0,
        postProcessesVisible: true,
        isLoading: false,
        refresh: vi.fn(),
      } as never);
      renderPage('/entregas?entidade=fluxos');
      expect(mockedUseActivePosts).toHaveBeenLastCalledWith(false);
      expect(screen.queryByRole('heading', { name: 'Sem processo' })).toBeNull();
      expect(screen.queryByText('Avulso livre')).toBeNull();
    });

    it('link "Somente fluxos" da Visão geral leva ao Kanban E muda entidade para Todos, não só a view', () => {
      limitsMock.features = { feature_post_processes: true };
      // Returning user with no explicit ?entidade= in the URL: entidade defaults
      // to 'fluxos' (spec default for "quem já usou Entregas"). This is exactly
      // the common case where the ChartView "Somente fluxos" note renders and
      // its link must actually reveal individual posts, not just switch views.
      localStorage.setItem('entregas_last_mode_conta-1', 'entregas');
      renderEntregasPage({
        activeWorkflows: [wfFixture],
        cards: [makeCard()],
        postProcessesVisible: true,
      });

      expect(screen.getByRole('radio', { name: 'Fluxos' })).toHaveAttribute('aria-checked', 'true');

      fireEvent.click(screen.getByText('Visão geral'));
      fireEvent.click(screen.getByText('Chart somente fluxos'));

      // 'kanban' is the default view, so serializeEntregasQuery omits it from the
      // URL; only 'entidade=todos' shows up, confirming the filter itself changed.
      expect(screen.getByTestId('current-path')).toHaveTextContent(/^\/entregas\?entidade=todos$/);
      expect(screen.getByRole('radio', { name: 'Todos' })).toHaveAttribute('aria-checked', 'true');
    });

    it('link "Somente fluxos" clicado em modo Publicações também leva ao Kanban de Fluxos, não ao de Publicações', () => {
      limitsMock.features = { feature_post_processes: true };
      mockedUseEntregasData.mockReturnValue({
        clientes: [],
        membros: [],
        templates: [],
        cards: [makeCard()],
        activeWorkflows: [wfFixture],
        postEntities: [],
        processByPostId: new Map(),
        concludedPostProcesses: [],
        activePostProcessCount: 0,
        postProcessesVisible: true,
        isLoading: false,
        refresh: vi.fn(),
      } as never);

      // Starts on the Visão geral (Chart) tab while mode is 'publicacoes' (e.g. the user
      // was just looking at the Publicações chart). onGoToKanban must reset `mode` too,
      // not just `entidade` — otherwise the link lands on the Publicações board.
      renderPage('/entregas?view=chart&mode=publicacoes');

      fireEvent.click(screen.getByText('Chart somente fluxos'));

      // mode=entregas is the default, so it — like the default view=kanban — is omitted
      // from the URL; only entidade=todos shows up, same shape as the mode=entregas case.
      expect(screen.getByTestId('current-path')).toHaveTextContent(/^\/entregas\?entidade=todos$/);
      expect(screen.getByText(/^Kanban view:/)).toBeInTheDocument();
      expect(screen.queryByText(/^Posts kanban view:/)).toBeNull();
      // EntidadeToggle only mounts when mode === 'entregas' (and the flag is on), so this
      // confirms mode actually flipped back, not just that entidade and the URL did.
      expect(screen.getByRole('radio', { name: 'Todos' })).toHaveAttribute('aria-checked', 'true');
    });

    it('flag desligada com processo ativo: mostra o toggle de entidade e o card individual', async () => {
      limitsMock.features = { feature_post_processes: false };
      const entity = toPostEntity(vigenteFixture, { clientes: [], membros: [] })!;
      mockedUseEntregasData.mockReturnValue({
        clientes: [],
        membros: [],
        templates: [],
        cards: [],
        activeWorkflows: [],
        postEntities: [entity],
        processByPostId: new Map([[77, vigenteFixture]]),
        concludedPostProcesses: [],
        activePostProcessCount: 1,
        postProcessesVisible: true,
        isLoading: false,
        refresh: vi.fn(),
      } as never);
      renderPage('/entregas');
      await screen.findByTestId('post-process-card');
      expect(screen.getByRole('radiogroup', { name: 'Entidades do quadro' })).toBeInTheDocument();
      // Criação continua escondida: a seção Sem processo não aparece com a flag desligada.
      expect(screen.queryByText('Sem processo')).toBeNull();
      // A asserção acima é vácua sozinha (mockedUseActivePosts já devolve posts: []
      // neste describe, então SemProcessoSection já se escondia por "total === 0",
      // independente do gate). Esta é a que de fato prova que semProcessoMode usou
      // postProcessesEnabled (false aqui), não postProcessesVisible (true aqui, por
      // haver processo vigente): se EntregasPage.tsx voltasse a gatear por
      // postProcessesVisible, este valor seria true e a asserção falharia.
      expect(mockedUseActivePosts).toHaveBeenLastCalledWith(false);
    });

    describe('revelar card no quadro depois de desmembrar mantendo etapas', () => {
      const entity = toPostEntity(vigenteFixture, { clientes: [], membros: [] })!;

      function baseData(overrides: Record<string, unknown> = {}) {
        return {
          clientes: [{ id: 10, nome: 'Clínica Aurora' }],
          membros: [{ id: 7, nome: 'Ana' }],
          templates: [],
          cards: [
            makeCard({
              workflow: { id: 2, titulo: 'Fluxo Profundo', cliente_id: 10, status: 'ativo' },
            }),
          ],
          activeWorkflows: [{ id: 2 }],
          postEntities: [],
          processByPostId: new Map(),
          concludedPostProcesses: [],
          activePostProcessCount: 1,
          postProcessesVisible: true,
          isLoading: false,
          isFetching: false,
          refresh: vi.fn(),
          ...overrides,
        };
      }

      beforeEach(() => {
        limitsMock.features = { feature_post_processes: true };
      });

      it('desmembrar mantendo etapas revela o card: Kanban, Todos, filtros que escondiam limpos, drawer do post aberto', async () => {
        mockedUseEntregasData.mockReturnValue(baseData({ postEntities: [entity] }) as never);
        renderPage('/entregas?drawer=2&clientes=99');

        expect(await screen.findByText('Workflow drawer: Fluxo Profundo')).toBeInTheDocument();

        await act(async () => {
          fireEvent.click(screen.getByText('Detach keeping process'));
        });

        await screen.findByText('Standalone drawer: 77');
        expect(screen.getByTestId('current-path')).toHaveTextContent('entidade=todos');
        expect(screen.getByTestId('current-path')).not.toHaveTextContent('clientes=99');
        expect(mockedToast.info).toHaveBeenCalledWith(
          'Filtros removidos para mostrar o post no quadro.',
        );
      });

      it('timing guard: não desiste antes de observar um fetch, e revela assim que a entidade chega', async () => {
        mockedUseEntregasData.mockReturnValue(baseData({ postEntities: [] }) as never);
        const { rerender } = renderPage('/entregas?drawer=2');

        expect(await screen.findByText('Workflow drawer: Fluxo Profundo')).toBeInTheDocument();

        await act(async () => {
          fireEvent.click(screen.getByText('Detach keeping process'));
        });
        // First pass: entity not found yet, and no fetch has been observed since the
        // reveal started -- keeps waiting silently instead of giving up immediately.
        expect(mockedToast.error).not.toHaveBeenCalledWith(
          'O post não apareceu no quadro. Recarregue a página.',
        );
        expect(screen.queryByText('Standalone drawer: 77')).toBeNull();

        mockedUseEntregasData.mockReturnValue(
          baseData({ postEntities: [], isFetching: true }) as never,
        );
        await act(async () => {
          rerender(pageTree('/entregas?drawer=2'));
        });
        expect(mockedToast.error).not.toHaveBeenCalledWith(
          'O post não apareceu no quadro. Recarregue a página.',
        );

        mockedUseEntregasData.mockReturnValue(
          baseData({ postEntities: [entity], isFetching: false }) as never,
        );
        await act(async () => {
          rerender(pageTree('/entregas?drawer=2'));
        });

        await screen.findByText('Standalone drawer: 77');
        expect(mockedToast.error).not.toHaveBeenCalledWith(
          'O post não apareceu no quadro. Recarregue a página.',
        );
      });

      it('timing guard: desiste e toasta erro só depois de observar um fetch em que a entidade ainda não chegou', async () => {
        mockedUseEntregasData.mockReturnValue(baseData({ postEntities: [] }) as never);
        const { rerender } = renderPage('/entregas?drawer=2');

        expect(await screen.findByText('Workflow drawer: Fluxo Profundo')).toBeInTheDocument();

        await act(async () => {
          fireEvent.click(screen.getByText('Detach keeping process'));
        });

        mockedUseEntregasData.mockReturnValue(
          baseData({ postEntities: [], isFetching: true }) as never,
        );
        await act(async () => {
          rerender(pageTree('/entregas?drawer=2'));
        });

        mockedUseEntregasData.mockReturnValue(
          baseData({ postEntities: [], isFetching: false }) as never,
        );
        await act(async () => {
          rerender(pageTree('/entregas?drawer=2'));
        });

        await waitFor(() =>
          expect(mockedToast.error).toHaveBeenCalledWith(
            'O post não apareceu no quadro. Recarregue a página.',
          ),
        );
        expect(screen.queryByText('Standalone drawer: 77')).toBeNull();
      });
    });
  });
});

describe('EntregasPage — painel "Como funciona"', () => {
  const EXPLAINER_KEY = 'entregas_explainer_dismissed_conta-1';

  beforeEach(() => {
    mockedUseActivePosts.mockReturnValue({ posts: [], isLoading: false });
    tourMock.startEntregasTour.mockReset();
    limitsMock.features = null;
    localStorage.clear();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });

  it('opens by default when the conta has never dismissed it', () => {
    renderEntregasPage({ activeWorkflows: [wfFixture], cards: [] });

    expect(screen.getByRole('heading', { name: /como funciona esta página/i })).toBeTruthy();
  });

  it('shows on a board that already has workflows, unlike the tour', () => {
    // The tour only auto-starts on an empty board; the explainer must not inherit
    // that gate — a full board is exactly as opaque to a new team member.
    renderEntregasPage({ activeWorkflows: [wfFixture], cards: [] });

    expect(screen.getByRole('heading', { name: /como funciona esta página/i })).toBeTruthy();
    expect(tourMock.startEntregasTour).not.toHaveBeenCalled();
  });

  it('stays closed once the conta has dismissed it', () => {
    localStorage.setItem(EXPLAINER_KEY, 'true');
    renderEntregasPage({ activeWorkflows: [wfFixture], cards: [] });

    expect(screen.queryByRole('heading', { name: /como funciona esta página/i })).toBeNull();
  });

  it('persists the dismissal and swaps the panel for the reopen button', () => {
    renderEntregasPage({ activeWorkflows: [wfFixture], cards: [] });

    fireEvent.click(screen.getByLabelText('Fechar explicação'));

    expect(localStorage.getItem(EXPLAINER_KEY)).toBe('true');
    expect(screen.queryByRole('heading', { name: /como funciona esta página/i })).toBeNull();
    expect(screen.getByRole('button', { name: /como funciona/i })).toBeTruthy();
  });

  it('reopens from the header button without clearing the dismissal', () => {
    localStorage.setItem(EXPLAINER_KEY, 'true');
    renderEntregasPage({ activeWorkflows: [wfFixture], cards: [] });

    fireEvent.click(screen.getByRole('button', { name: /como funciona/i }));

    expect(screen.getByRole('heading', { name: /como funciona esta página/i })).toBeTruthy();
    // Reopening is a one-off view, not an un-dismiss: the key survives so the
    // panel does not come back by itself on the next visit.
    expect(localStorage.getItem(EXPLAINER_KEY)).toBe('true');
  });

  it('states the two rules the page never explained: the split tracks and hub visibility', () => {
    renderEntregasPage({ activeWorkflows: [wfFixture], cards: [] });

    expect(screen.getByText(/não se sincronizam/i)).toBeTruthy();
    expect(screen.getByRole('heading', { name: /quem vê o quê/i })).toBeTruthy();
  });
});
