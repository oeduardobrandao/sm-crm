import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/store/clients', () => ({ getClientes: vi.fn() }));
vi.mock('@/store/posts', () => ({ getClientePosts: vi.fn() }));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const createFromScratch = vi.fn();
vi.mock('../hooks/useEstudioEntryFlow', () => ({
  useEstudioEntryFlow: () => ({ createFromScratch, creating: false }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { getClientes, type Cliente } from '@/store/clients';
import { getClientePosts } from '@/store/posts';
import { toast } from 'sonner';
import PostPicker from '../components/PostPicker';

const mockedGetClientes = vi.mocked(getClientes);
const mockedGetClientePosts = vi.mocked(getClientePosts);
const mockedToastError = vi.mocked(toast.error);

function renderPicker() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PostPicker />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Waits for the client list to actually finish loading (the `<option>` must exist in the DOM
 * before `fireEvent.change` can select it — firing against a value with no matching `<option>`
 * yet is a silent no-op in jsdom). */
async function selectClient() {
  await screen.findByText('Ana Studio');
  fireEvent.change(screen.getByDisplayValue(/selecione um cliente/i), { target: { value: '1' } });
}

describe('PostPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetClientes.mockResolvedValue([{ id: 1, nome: 'Ana Studio' } as Cliente]);
    mockedGetClientePosts.mockResolvedValue([]);
  });

  it('lists clients and disables "Criar novo" until one is selected', async () => {
    renderPicker();
    expect(await screen.findByText('Ana Studio')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /criar novo design/i })).toBeDisabled();
  });

  it('shows only editable posts for the selected client, labeled with their workflow', async () => {
    mockedGetClientePosts.mockResolvedValue([
      {
        id: 10,
        workflow_id: 1,
        titulo: 'Post A',
        tipo: 'feed',
        status: 'rascunho',
        scheduled_at: null,
        ordem: 0,
        workflow_titulo: 'Fluxo Julho',
      },
      {
        id: 11,
        workflow_id: 1,
        titulo: 'Post postado',
        tipo: 'feed',
        status: 'postado',
        scheduled_at: null,
        ordem: 1,
        workflow_titulo: 'Fluxo Julho',
      },
    ]);
    renderPicker();

    await selectClient();

    expect(await screen.findByText('Post A')).toBeInTheDocument();
    expect(screen.getByText('Fluxo Julho')).toBeInTheDocument();
    expect(screen.queryByText('Post postado')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /criar novo design/i })).toBeEnabled();
  });

  it('navigates to the editor when an existing post is clicked', async () => {
    mockedGetClientePosts.mockResolvedValue([
      {
        id: 10,
        workflow_id: 1,
        titulo: 'Post A',
        tipo: 'feed',
        status: 'rascunho',
        scheduled_at: null,
        ordem: 0,
        workflow_titulo: 'Fluxo Julho',
      },
    ]);
    renderPicker();
    await selectClient();
    fireEvent.click(await screen.findByText('Post A'));
    expect(mockNavigate).toHaveBeenCalledWith('/estudio/10');
  });

  it('createFromScratch failures surface a toast and do not navigate', async () => {
    createFromScratch.mockRejectedValue(new Error('boom'));
    renderPicker();
    await selectClient();
    fireEvent.click(await screen.findByRole('button', { name: /criar novo design/i }));
    await waitFor(() => expect(mockedToastError).toHaveBeenCalled());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('creating a new design navigates to the editor with the returned postId', async () => {
    createFromScratch.mockResolvedValue({ workflowId: 5, postId: 99 });
    renderPicker();
    await selectClient();
    fireEvent.click(await screen.findByRole('button', { name: /criar novo design/i }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/estudio/99'));
  });
});
