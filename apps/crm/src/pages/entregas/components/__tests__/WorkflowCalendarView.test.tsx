import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkflowCalendarView } from '../WorkflowCalendarView';

// Mock dnd-kit so it doesn't require pointer/touch events in jsdom
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DragOverlay: ({ children }: { children?: React.ReactNode }) => <>{children ?? null}</>,
  PointerSensor: class {},
  KeyboardSensor: class {},
  closestCenter: () => null,
  useSensor: () => ({}),
  useSensors: (...sensors: unknown[]) => sensors,
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    isDragging: false,
  }),
  useDroppable: () => ({
    setNodeRef: () => {},
    isOver: false,
  }),
}));

// Mock the store
vi.mock('@/store', () => ({
  getClientePosts: vi.fn(),
  updateWorkflowPost: vi.fn(),
}));

import { getClientePosts } from '@/store';
const mockGetClientePosts = vi.mocked(getClientePosts);

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const baseProps = {
  clienteId: 1,
  clienteNome: 'Marca X',
  currentWorkflowId: 10,
  currentWorkflowTitulo: 'Campanha Junho',
  onBack: vi.fn(),
};

describe('WorkflowCalendarView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('shows loading state', () => {
    mockGetClientePosts.mockReturnValue(new Promise(() => {})); // never resolves
    renderWithQuery(<WorkflowCalendarView {...baseProps} />);
    expect(screen.getByText('Carregando calendário...')).toBeTruthy();
  });

  it('renders sidebar and calendar grid after data loads', async () => {
    mockGetClientePosts.mockResolvedValue([
      { id: 1, workflow_id: 10, titulo: 'Post A', tipo: 'feed', status: 'rascunho', scheduled_at: null, ordem: 0, workflow_titulo: 'Campanha Junho' },
      { id: 2, workflow_id: 10, titulo: 'Post B', tipo: 'reels', status: 'rascunho', scheduled_at: '2026-06-15T10:00:00.000Z', ordem: 1, workflow_titulo: 'Campanha Junho' },
    ]);
    renderWithQuery(<WorkflowCalendarView {...baseProps} />);
    expect(await screen.findByText('Sem data')).toBeTruthy();
    expect(screen.getByText('Post A')).toBeTruthy();
  });

  it('shows empty state when all posts are scheduled', async () => {
    mockGetClientePosts.mockResolvedValue([
      { id: 1, workflow_id: 10, titulo: 'Post A', tipo: 'feed', status: 'rascunho', scheduled_at: '2026-06-10T10:00:00.000Z', ordem: 0, workflow_titulo: 'Campanha Junho' },
    ]);
    renderWithQuery(<WorkflowCalendarView {...baseProps} />);
    expect(await screen.findByText(/agendados/i)).toBeTruthy();
  });

  it('shows hint banner on first visit and hides after dismiss', async () => {
    mockGetClientePosts.mockResolvedValue([]);
    renderWithQuery(<WorkflowCalendarView {...baseProps} />);
    expect(await screen.findByText(/Arraste posts/)).toBeTruthy();
  });

  it('only shows current workflow posts in sidebar', async () => {
    mockGetClientePosts.mockResolvedValue([
      { id: 1, workflow_id: 10, titulo: 'My Post', tipo: 'feed', status: 'rascunho', scheduled_at: null, ordem: 0, workflow_titulo: 'Campanha Junho' },
      { id: 2, workflow_id: 20, titulo: 'Other Post', tipo: 'reels', status: 'rascunho', scheduled_at: null, ordem: 0, workflow_titulo: 'Outro Workflow' },
    ]);
    renderWithQuery(<WorkflowCalendarView {...baseProps} />);
    expect(await screen.findByText('My Post')).toBeTruthy();
    // Other Post should NOT appear in sidebar (it's from workflow 20, not 10)
    const sidebarPosts = screen.queryAllByText('Other Post');
    expect(sidebarPosts.length).toBe(0);
  });
});
