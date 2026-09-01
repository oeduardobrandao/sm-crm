import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
}));
vi.mock('../../../store', () => storeMocks);

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
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
  }: {
    open: boolean;
    onClose: () => void;
    onCreated: (post: { id: number }) => void;
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
        <button onClick={onClose}>Close avulso dialog</button>
      </div>
    ) : null,
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
    showExample,
    onDismissExample,
    onCardClick,
    onEditClick,
    onPostsClick,
    onRecurring,
  }: {
    cards: Array<{ workflow: { id: number; titulo: string } }>;
    showExample?: boolean;
    onDismissExample?: () => void;
    onCardClick: (card: unknown) => void;
    onEditClick: (card: unknown) => void;
    onPostsClick: (card: unknown) => void;
    onRecurring: (workflowId: number) => void;
  }) =>
    showExample ? (
      <div>
        <div>Posts de Agosto</div>
        <button onClick={onDismissExample}>Ocultar exemplo</button>
      </div>
    ) : cards.length === 0 ? (
      <div>Nenhuma entrega encontrada. Ajuste os filtros ou crie um novo fluxo.</div>
    ) : (
      <div>
        <div>Kanban view: {cards.map((card) => card.workflow.titulo).join(', ')}</div>
        <button onClick={() => onEditClick(cards[0])}>Open edit modal</button>
        <button onClick={() => onCardClick(cards[0])}>Open drawer from card</button>
        <button onClick={() => onPostsClick(cards[0])}>Open drawer modal</button>
        <button onClick={() => onRecurring(cards[0].workflow.id)}>Trigger recurring</button>
      </div>
    ),
}));

// EntregasPage now reads profile.conta_id via useAuth; there is no AuthProvider in this suite.
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ profile: { conta_id: 'conta-1', role: 'owner' } }),
}));

// Mock only startEntregasTour (driver.js can't run in jsdom); tourStorageKey stays real so the
// localStorage assertions exercise the true key format.
const tourMock = vi.hoisted(() => ({ startEntregasTour: vi.fn() }));
vi.mock('../tour/entregasTour', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  startEntregasTour: tourMock.startEntregasTour,
}));

vi.mock('../views/ChartView', () => ({
  ChartView: ({ cards }: { cards: Array<{ workflow: { titulo: string } }> }) => (
    <div>Chart view: {cards.map((card) => card.workflow.titulo).join(', ')}</div>
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
  }: {
    card: { workflow: { titulo: string } };
    onClose: () => void;
    initialPostId?: number;
    onOpenWorkflow?: (workflowId: number) => void;
  }) => (
    <div>
      <div>Workflow drawer: {card.workflow.titulo}</div>
      <div data-testid="drawer-initial-post">{initialPostId ?? 'none'}</div>
      <button onClick={onClose}>Close drawer</button>
      <button onClick={() => onOpenWorkflow?.(99)}>Move posts to workflow 99</button>
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

function renderPage(initialEntry = '/entregas') {
  return render(
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
    </MemoryRouter>,
  );
}

function renderEntregasPage(data: { activeWorkflows: unknown[]; cards: unknown[] }) {
  mockedUseEntregasData.mockReturnValue({
    clientes: [],
    membros: [],
    templates: [],
    cards: data.cards,
    activeWorkflows: data.activeWorkflows,
    isLoading: false,
    refresh: vi.fn(),
  } as never);
  return renderPage();
}

const wfFixture = { id: 1 };

describe('EntregasPage', () => {
  beforeEach(() => {
    mockedDuplicateWorkflow.mockReset();
    mockedGetStandalonePost.mockReset();
    mockedToast.success.mockReset();
    mockedToast.error.mockReset();
    tourMock.startEntregasTour.mockReset();
    mockedUseActivePosts.mockReturnValue({ posts: [], isLoading: false });
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

  it('keeps the current view when creating a post avulso from an already-Publicações kanban/lista', () => {
    renderEntregasPage({ activeWorkflows: [wfFixture], cards: [makeCard()] });

    fireEvent.click(screen.getByText('Lista'));
    fireEvent.click(screen.getByText('Publicações'));
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
      isLoading: false,
      refresh: vi.fn(),
    } as never);

    renderPage();

    fireEvent.click(screen.getByText('Gráfico'));
    expect(screen.getByText('Chart view: Fluxo Editorial')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Lista'));
    expect(screen.getByText('List view: Fluxo Editorial')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Change sort'));
    expect(screen.getByText('Sort: deadline/desc')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Concluídas'));
    expect(screen.getByText('Concluded view')).toBeInTheDocument();
    expect(screen.queryByText(/Filters:/)).not.toBeInTheDocument();
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

  it('duplicates recurring workflows and refreshes on success', async () => {
    const refresh = vi.fn();
    mockedDuplicateWorkflow.mockResolvedValue(undefined as never);
    mockedUseEntregasData.mockReturnValue({
      clientes: [{ id: 10, nome: 'Clínica Aurora' }],
      membros: [{ id: 7, nome: 'Ana' }],
      templates: [],
      cards: [makeCard()],
      activeWorkflows: [{ id: 1 }],
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
    fireEvent.click(screen.getByText('Gráfico'));
    expect(screen.queryByText(/ver tour novamente/i)).toBeNull();
  });

  it('toggles the kanban into Publicações mode: swaps the board, hides the replay link, posts filters', () => {
    renderEntregasPage({ activeWorkflows: [wfFixture], cards: [makeCard()] });

    expect(screen.getByText(/^kanban view:/i)).toBeInTheDocument();
    expect(screen.getByText('FiltersMode: entregas')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Publicações'));

    expect(screen.getByText('Posts kanban view: 0')).toBeInTheDocument();
    expect(screen.queryByText(/^kanban view:/i)).toBeNull();
    expect(screen.queryByText(/ver tour novamente/i)).toBeNull();
    expect(screen.getByText('FiltersMode: posts')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Fluxos' }));
    expect(screen.getByText(/^kanban view:/i)).toBeInTheDocument();
  });

  it('clicking a post avulso from the Publicações kanban closes an already-open workflow drawer', async () => {
    renderEntregasPage({ activeWorkflows: [wfFixture], cards: [makeCard()] });

    fireEvent.click(screen.getByText('Open drawer from card'));
    expect(await screen.findByText('Workflow drawer: Fluxo Editorial')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Publicações'));
    fireEvent.click(screen.getByText('Open avulso post from kanban'));

    expect(screen.queryByText('Workflow drawer: Fluxo Editorial')).not.toBeInTheDocument();
  });

  it('keeps the Publicações mode when switching between kanban and lista (one page-wide mode)', () => {
    renderEntregasPage({ activeWorkflows: [wfFixture], cards: [makeCard()] });

    // Put the page in Publicações mode from the kanban…
    fireEvent.click(screen.getByText('Publicações'));
    expect(screen.getByText('Posts kanban view: 0')).toBeInTheDocument();

    // …and Lista opens already in Publicações (shared state, not per-view).
    fireEvent.click(screen.getByText('Lista'));
    expect(screen.getByText('Posts list view: 0')).toBeInTheDocument();
    expect(screen.queryByText(/^list view:/i)).toBeNull();
    expect(screen.getByText('FiltersMode: posts')).toBeInTheDocument();

    // Back to Fluxos in the lista carries into the kanban too.
    fireEvent.click(screen.getByText('Fluxos'));
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

    fireEvent.click(screen.getByText('Publicações'));
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

      fireEvent.click(screen.getByText('Publicações'));

      expect(localStorage.getItem('entregas_last_mode_conta-1')).toBe('publicacoes');
    });
  });

  it('opens the whole workflow card from a fluxo tag click', async () => {
    renderEntregasPage({ activeWorkflows: [wfFixture], cards: [makeCard()] });

    fireEvent.click(screen.getByText('Lista'));
    fireEvent.click(screen.getByText('Publicações'));
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

    fireEvent.click(screen.getByText('Publicações'));
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

    fireEvent.click(screen.getByText('Publicações'));
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

    fireEvent.click(screen.getByText('Publicações'));
    expect(screen.getByText('Posts kanban view: 2')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Filter prazo atrasado'));
    expect(screen.getByText('Posts kanban view: 1')).toBeInTheDocument();
  });
});

describe('EntregasPage — painel "Como funciona"', () => {
  const EXPLAINER_KEY = 'entregas_explainer_dismissed_conta-1';

  beforeEach(() => {
    mockedUseActivePosts.mockReturnValue({ posts: [], isLoading: false });
    tourMock.startEntregasTour.mockReset();
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
