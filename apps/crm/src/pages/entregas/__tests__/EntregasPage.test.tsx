import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../hooks/useEntregasData', () => ({
  useEntregasData: vi.fn(),
}));

vi.mock('../hooks/useActivePosts', () => ({
  useActivePosts: vi.fn(() => ({ posts: [], isLoading: false })),
}));

vi.mock('../../../store', () => ({
  duplicateWorkflow: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
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
  PostsKanbanView: ({ posts }: { posts: unknown[] }) => (
    <div>Posts kanban view: {posts.length}</div>
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
  }: {
    card: { workflow: { titulo: string } };
    onClose: () => void;
    initialPostId?: number;
  }) => (
    <div>
      <div>Workflow drawer: {card.workflow.titulo}</div>
      <div data-testid="drawer-initial-post">{initialPostId ?? 'none'}</div>
      <button onClick={onClose}>Close drawer</button>
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
import { duplicateWorkflow } from '../../../store';
import { toast } from 'sonner';
import EntregasPage from '../EntregasPage';

const mockedUseEntregasData = vi.mocked(useEntregasData);
const mockedUseActivePosts = vi.mocked(useActivePosts);
const mockedDuplicateWorkflow = vi.mocked(duplicateWorkflow);
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
    <button onClick={() => navigate('/entregas?drawer=2&post=5')}>Deep link from search</button>
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
    mockedToast.success.mockReset();
    mockedToast.error.mockReset();
    tourMock.startEntregasTour.mockReset();
    mockedUseActivePosts.mockReturnValue({ posts: [], isLoading: false });
    localStorage.clear();
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

    fireEvent.click(screen.getByText('Novo Fluxo'));
    expect(screen.getByText('WizardMock')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Created workflow'));
    expect(refresh).toHaveBeenCalledTimes(2);
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

    fireEvent.click(screen.getByRole('button', { name: 'Entregas' }));
    expect(screen.getByText(/^kanban view:/i)).toBeInTheDocument();
  });

  it('toggles the lista into Publicações mode independently of the kanban mode', () => {
    renderEntregasPage({ activeWorkflows: [wfFixture], cards: [makeCard()] });

    // Put the kanban in Publicações mode…
    fireEvent.click(screen.getByText('Publicações'));
    expect(screen.getByText('Posts kanban view: 0')).toBeInTheDocument();

    // …then Lista still opens in Entregas mode (independent state).
    fireEvent.click(screen.getByText('Lista'));
    expect(screen.getByText(/^list view:/i)).toBeInTheDocument();
    expect(screen.getByText('FiltersMode: entregas')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Publicações'));
    expect(screen.getByText('Posts list view: 0')).toBeInTheDocument();
    expect(screen.queryByText(/^list view:/i)).toBeNull();
    expect(screen.getByText('FiltersMode: posts')).toBeInTheDocument();

    // Kanban kept its own mode.
    fireEvent.click(screen.getByText('Kanban'));
    expect(screen.getByText('Posts kanban view: 0')).toBeInTheDocument();
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
