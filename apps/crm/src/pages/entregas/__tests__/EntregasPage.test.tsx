import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../hooks/useEntregasData', () => ({
  useEntregasData: vi.fn(),
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
  EntregasFilters: ({
    filters,
    onChange,
    clientes,
    membros,
  }: {
    filters: { filterCliente: number | null; filterMembro: number | null; filterStatus: string };
    onChange: (next: { filterCliente: number | null; filterMembro: number | null; filterStatus: string }) => void;
    clientes: Array<{ id: number; nome: string }>;
    membros: Array<{ id: number; nome: string }>;
  }) => (
    <div>
      <div>Filters: {filters.filterStatus}</div>
      <div>Clientes: {clientes.length}</div>
      <div>Membros: {membros.length}</div>
      <button onClick={() => onChange({ ...filters, filterStatus: 'atrasado' })}>Filter overdue</button>
      <button onClick={() => onChange({ ...filters, filterCliente: 10 })}>Filter client</button>
      <button onClick={() => onChange({ ...filters, filterMembro: 7 })}>Filter member</button>
    </div>
  ),
}));

vi.mock('../views/KanbanView', () => ({
  KanbanView: ({
    cards,
    onCardClick,
    onPostsClick,
    onRecurring,
  }: {
    cards: Array<{ workflow: { id: number; titulo: string } }>;
    onCardClick: (card: unknown) => void;
    onPostsClick: (card: unknown) => void;
    onRecurring: (workflowId: number) => void;
  }) => (
    <div>
      <div>Kanban view: {cards.map((card) => card.workflow.titulo).join(', ')}</div>
      <button onClick={() => onCardClick(cards[0])}>Open edit modal</button>
      <button onClick={() => onPostsClick(cards[0])}>Open drawer modal</button>
      <button onClick={() => onRecurring(cards[0].workflow.id)}>Trigger recurring</button>
    </div>
  ),
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
      <button onClick={() => onCardClick(cards[0])}>Open calendar edit</button>
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
      <div>Sort: {sort.column}/{sort.direction}</div>
      <button onClick={() => onSortChange({ column: 'deadline', direction: 'desc' })}>Change sort</button>
    </div>
  ),
}));

vi.mock('../views/ConcludedView', () => ({
  ConcludedView: () => <div>Concluded view</div>,
}));

vi.mock('../components/WorkflowDrawer', () => ({
  WorkflowDrawer: ({
    card,
    onClose,
  }: {
    card: { workflow: { titulo: string } };
    onClose: () => void;
  }) => (
    <div>
      <div>Workflow drawer: {card.workflow.titulo}</div>
      <button onClick={onClose}>Close drawer</button>
    </div>
  ),
}));

vi.mock('../components/WorkflowModals', () => ({
  NewWorkflowModal: ({
    open,
    onClose,
    onCreated,
  }: {
    open: boolean;
    onClose: () => void;
    onCreated: () => void;
  }) => open ? (
    <div>
      <div>New workflow modal</div>
      <button onClick={onCreated}>Created workflow</button>
      <button onClick={onClose}>Close new modal</button>
    </div>
  ) : null,
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
  }) => open ? (
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
  }) => open ? (
    <div>
      <div>Recurring dialog</div>
      <button onClick={onConfirm}>Confirm recurring</button>
      <button onClick={onCancel}>Cancel recurring</button>
    </div>
  ) : null,
}));

import { useEntregasData } from '../hooks/useEntregasData';
import { duplicateWorkflow } from '../../../store';
import { toast } from 'sonner';
import EntregasPage from '../EntregasPage';

const mockedUseEntregasData = vi.mocked(useEntregasData);
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

function renderPage(initialEntry = '/entregas') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/entregas"
          element={(
            <>
              <EntregasPage />
              <PathProbe />
            </>
          )}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('EntregasPage', () => {
  beforeEach(() => {
    mockedDuplicateWorkflow.mockReset();
    mockedToast.success.mockReset();
    mockedToast.error.mockReset();
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

    expect(screen.getByText('Entregas')).toBeInTheDocument();
    expect(screen.getByText(/fluxos ativos: 2/i)).toBeInTheDocument();
    expect(screen.getByText(/1 atrasado/i)).toBeInTheDocument();
    expect(screen.getByText(/1 urgente/i)).toBeInTheDocument();
    expect(screen.getByText('Kanban view: Fluxo Editorial, Fluxo Atrasado')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Filter overdue'));
    expect(screen.getByText('Kanban view: Fluxo Atrasado')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Templates'));
    expect(screen.getByText('Templates modal')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Refresh templates'));
    expect(refresh).toHaveBeenCalled();

    fireEvent.click(screen.getByText('Novo Fluxo'));
    expect(screen.getByText('New workflow modal')).toBeInTheDocument();
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
});
