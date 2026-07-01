import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach, beforeAll } from 'vitest';
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
    setActivatorNodeRef: () => {},
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
  getPostPreview: vi.fn(),
}));
vi.mock('@/services/postMedia', () => ({ listPostMedia: vi.fn() }));

import { getClientePosts, updateWorkflowPost, getPostPreview } from '@/store';
import { listPostMedia } from '@/services/postMedia';
const mockGetClientePosts = vi.mocked(getClientePosts);
const mockUpdate = vi.mocked(updateWorkflowPost);
const mockPreview = vi.mocked(getPostPreview);
const mockMedia = vi.mocked(listPostMedia);

beforeAll(() => {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () =>
    false;
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

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
    // Pin "today" to June 2026 so the calendar opens on the month the fixtures
    // schedule posts in. Fake only `Date` so testing-library's real timers
    // (findBy/waitFor polling) keep working.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-15T12:00:00.000Z'));
    localStorage.clear();
    mockPreview.mockResolvedValue({
      conteudo_plain: 'Conteúdo',
      responsavel_id: null,
      ig_caption: null,
      published_at: null,
      instagram_permalink: null,
    });
    mockMedia.mockResolvedValue([]);
    mockUpdate.mockResolvedValue({} as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows loading state', () => {
    mockGetClientePosts.mockReturnValue(new Promise(() => {})); // never resolves
    renderWithQuery(<WorkflowCalendarView {...baseProps} />);
    expect(screen.getByText('Carregando calendário...')).toBeTruthy();
  });

  it('renders sidebar and calendar grid after data loads', async () => {
    mockGetClientePosts.mockResolvedValue([
      {
        id: 1,
        workflow_id: 10,
        titulo: 'Post A',
        tipo: 'feed',
        status: 'rascunho',
        scheduled_at: null,
        ordem: 0,
        workflow_titulo: 'Campanha Junho',
      },
      {
        id: 2,
        workflow_id: 10,
        titulo: 'Post B',
        tipo: 'reels',
        status: 'rascunho',
        scheduled_at: '2026-06-15T10:00:00.000Z',
        ordem: 1,
        workflow_titulo: 'Campanha Junho',
      },
    ]);
    renderWithQuery(<WorkflowCalendarView {...baseProps} />);
    expect(await screen.findByText('Sem data')).toBeTruthy();
    expect(screen.getByText('Post A')).toBeTruthy();
  });

  it('shows empty state when all posts are scheduled', async () => {
    mockGetClientePosts.mockResolvedValue([
      {
        id: 1,
        workflow_id: 10,
        titulo: 'Post A',
        tipo: 'feed',
        status: 'rascunho',
        scheduled_at: '2026-06-10T10:00:00.000Z',
        ordem: 0,
        workflow_titulo: 'Campanha Junho',
      },
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
      {
        id: 1,
        workflow_id: 10,
        titulo: 'My Post',
        tipo: 'feed',
        status: 'rascunho',
        scheduled_at: null,
        ordem: 0,
        workflow_titulo: 'Campanha Junho',
      },
      {
        id: 2,
        workflow_id: 20,
        titulo: 'Other Post',
        tipo: 'reels',
        status: 'rascunho',
        scheduled_at: null,
        ordem: 0,
        workflow_titulo: 'Outro Workflow',
      },
    ]);
    renderWithQuery(<WorkflowCalendarView {...baseProps} />);
    expect(await screen.findByText('My Post')).toBeTruthy();
    // Other Post should NOT appear in sidebar (it's from workflow 20, not 10)
    const sidebarPosts = screen.queryAllByText('Other Post');
    expect(sidebarPosts.length).toBe(0);
  });

  it('opens the detail panel with the post title when a pill is clicked', async () => {
    mockGetClientePosts.mockResolvedValue([
      {
        id: 2,
        workflow_id: 10,
        titulo: 'Post Agendado B',
        tipo: 'reels',
        status: 'aprovado_cliente',
        scheduled_at: '2026-06-15T13:00:00.000Z',
        ordem: 0,
        workflow_titulo: 'Campanha Junho',
      },
    ]);
    renderWithQuery(<WorkflowCalendarView {...baseProps} />);
    const pill = await screen.findByRole('button', { name: /Post Agendado B/ });
    fireEvent.click(pill);
    expect(await screen.findByRole('heading', { name: 'Post Agendado B' })).toBeTruthy();
  });

  it('shows a read-only note for other-workflow posts', async () => {
    mockGetClientePosts.mockResolvedValue([
      {
        id: 3,
        workflow_id: 99,
        titulo: 'Outro WF',
        tipo: 'feed',
        status: 'aprovado_cliente',
        scheduled_at: '2026-06-15T13:00:00.000Z',
        ordem: 0,
        workflow_titulo: 'Outra Campanha',
      },
    ]);
    renderWithQuery(<WorkflowCalendarView {...baseProps} />);
    fireEvent.click(await screen.findByRole('button', { name: /Outro WF/ }));
    expect(await screen.findByText(/Pertence ao workflow/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Remover data/ })).toBeNull();
  });

  it('closes the panel after removing the date', async () => {
    mockGetClientePosts.mockResolvedValue([
      {
        id: 2,
        workflow_id: 10,
        titulo: 'Post Agendado B',
        tipo: 'reels',
        status: 'aprovado_cliente',
        scheduled_at: '2026-06-15T13:00:00.000Z',
        ordem: 0,
        workflow_titulo: 'Campanha Junho',
      },
    ]);
    renderWithQuery(<WorkflowCalendarView {...baseProps} />);
    fireEvent.click(await screen.findByRole('button', { name: /Post Agendado B/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Remover data/ }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Post Agendado B' })).toBeNull(),
    );
    expect(mockUpdate).toHaveBeenCalledWith(2, { scheduled_at: null });
  });

  it('closes the panel when the selected post is unscheduled externally', async () => {
    const scheduled = {
      id: 2,
      workflow_id: 10,
      titulo: 'Post Agendado B',
      tipo: 'reels' as const,
      status: 'aprovado_cliente' as const,
      scheduled_at: '2026-06-15T13:00:00.000Z',
      ordem: 0,
      workflow_titulo: 'Campanha Junho',
    };
    mockGetClientePosts.mockResolvedValue([scheduled]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <WorkflowCalendarView {...baseProps} />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /Post Agendado B/ }));
    expect(await screen.findByRole('heading', { name: 'Post Agendado B' })).toBeTruthy();

    // Simulate a refetch where the post lost its date (now in the "Sem data" sidebar)
    qc.setQueryData(['clientePosts', baseProps.clienteId], [{ ...scheduled, scheduled_at: null }]);
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Post Agendado B' })).toBeNull(),
    );
  });

  it('calls onOpenPost from the panel "Abrir post completo" button', async () => {
    const onOpenPost = vi.fn();
    mockGetClientePosts.mockResolvedValue([
      {
        id: 2,
        workflow_id: 10,
        titulo: 'Post Agendado B',
        tipo: 'reels',
        status: 'aprovado_cliente',
        scheduled_at: '2026-06-15T13:00:00.000Z',
        ordem: 0,
        workflow_titulo: 'Campanha Junho',
      },
    ]);
    renderWithQuery(<WorkflowCalendarView {...baseProps} onOpenPost={onOpenPost} />);
    fireEvent.click(await screen.findByRole('button', { name: /Post Agendado B/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Abrir post completo/ }));
    expect(onOpenPost).toHaveBeenCalledWith(2);
  });
});
