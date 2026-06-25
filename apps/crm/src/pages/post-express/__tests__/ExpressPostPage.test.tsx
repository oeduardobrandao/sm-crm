import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../store', () => ({
  getClientes: vi.fn(),
  addWorkflow: vi.fn(),
  addWorkflowEtapa: vi.fn(),
  addWorkflowPost: vi.fn(),
  updateWorkflowPost: vi.fn(),
  updateWorkflow: vi.fn(),
  removeWorkflow: vi.fn(),
}));

vi.mock('../../../services/instagram', () => ({
  publishInstagramPostNow: vi.fn(),
}));

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        data: [{ client_id: 1 }, { client_id: 2 }],
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        })),
      })),
    })),
  },
}));

vi.mock('../../entregas/components/PostMediaGallery', () => ({
  PostMediaGallery: ({ onChange }: { onChange?: (m: any[]) => void }) => (
    <div data-testid="media-gallery">
      <button
        onClick={() =>
          onChange?.([{ id: 1, kind: 'image', url: 'test.jpg', original_filename: 'test.jpg' }])
        }
      >
        Simulate Upload
      </button>
    </div>
  ),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import ExpressPostPage from '../ExpressPostPage';
import {
  getClientes,
  addWorkflow,
  addWorkflowEtapa,
  addWorkflowPost,
  updateWorkflowPost,
  updateWorkflow,
  removeWorkflow,
} from '../../../store';
import { publishInstagramPostNow } from '../../../services/instagram';

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

const mockClientes = [
  {
    id: 1,
    nome: 'Client A',
    sigla: 'CA',
    cor: '#000',
    plano: 'pro',
    email: 'a@a.com',
    telefone: '',
    status: 'ativo' as const,
    valor_mensal: 100,
  },
  {
    id: 2,
    nome: 'Client B',
    sigla: 'CB',
    cor: '#000',
    plano: 'pro',
    email: 'b@b.com',
    telefone: '',
    status: 'ativo' as const,
    valor_mensal: 200,
  },
];

describe('ExpressPostPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getClientes).mockResolvedValue(mockClientes);
    vi.mocked(addWorkflow).mockResolvedValue({
      id: 10,
      cliente_id: 1,
      titulo: 'Post Express',
      status: 'ativo',
      etapa_atual: 0,
      recorrente: false,
    });
    vi.mocked(addWorkflowEtapa).mockResolvedValue({
      id: 20,
      workflow_id: 10,
      ordem: 0,
      nome: 'Publicação',
      prazo_dias: 0,
      tipo_prazo: 'corridos',
      status: 'concluido',
    });
    vi.mocked(addWorkflowPost).mockResolvedValue({
      id: 30,
      workflow_id: 10,
      titulo: 'Post Express',
      conteudo: null,
      conteudo_plain: '',
      tipo: 'feed',
      ordem: 0,
      status: 'rascunho',
    });
    vi.mocked(removeWorkflow).mockResolvedValue(undefined);
  });

  it('renders page title and subtitle', async () => {
    renderWithProviders(<ExpressPostPage />);
    expect(screen.getByText('Post Express')).toBeTruthy();
    expect(screen.getByText('Publique rapidamente no Instagram')).toBeTruthy();
  });

  it('shows empty state when no clients have Instagram', async () => {
    const { supabase } = await import('../../../lib/supabase');
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        data: [],
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        })),
      }),
    } as any);
    renderWithProviders(<ExpressPostPage />);
    await waitFor(() => {
      expect(screen.getByText(/Nenhum cliente com Instagram conectado/)).toBeTruthy();
    });
  });

  it('publish button is disabled when no client is selected', async () => {
    renderWithProviders(<ExpressPostPage />);
    const publishBtn = screen.getByText('Publicar agora').closest('button')!;
    expect(publishBtn.hasAttribute('disabled')).toBe(true);
  });

  it('publish button stays disabled after selecting client without caption or media', async () => {
    renderWithProviders(<ExpressPostPage />);

    await waitFor(() => {
      expect(screen.getByText('Client A')).toBeTruthy();
    });

    fireEvent.change(screen.getByDisplayValue('Selecionar cliente...'), { target: { value: '1' } });

    await waitFor(() => {
      expect(addWorkflow).toHaveBeenCalled();
    });

    const publishBtn = screen.getByText('Publicar agora').closest('button')!;
    expect(publishBtn.hasAttribute('disabled')).toBe(true);
  });

  it('does not call removeWorkflow on unmount when no draft exists', async () => {
    const { unmount } = renderWithProviders(<ExpressPostPage />);
    unmount();
    expect(removeWorkflow).not.toHaveBeenCalled();
  });

  async function selectClientAndAwaitDraft() {
    await waitFor(() => expect(screen.getByText('Client A')).toBeTruthy());
    fireEvent.change(screen.getByDisplayValue('Selecionar cliente...'), { target: { value: '1' } });
    // Draft creation makes the media gallery (and its upload simulator) appear.
    await waitFor(() => expect(screen.getByText('Simulate Upload')).toBeTruthy());
  }

  it('Stories mode hides the caption field and enables publishing without a caption', async () => {
    renderWithProviders(<ExpressPostPage />);
    await selectClientAndAwaitDraft();

    // Caption field is present in the default "Publicação" mode.
    expect(screen.queryByPlaceholderText('Escreva a legenda do post aqui...')).toBeTruthy();

    // Switch the format toggle to Stories.
    fireEvent.click(screen.getByRole('button', { name: 'Stories' }));

    // Caption field disappears (stories carry no caption).
    expect(screen.queryByPlaceholderText('Escreva a legenda do post aqui...')).toBeNull();

    // Add a single media, no caption typed.
    fireEvent.click(screen.getByText('Simulate Upload'));

    // Publish is enabled despite the empty caption.
    const publishBtn = screen.getByText('Publicar Stories').closest('button')!;
    expect(publishBtn.hasAttribute('disabled')).toBe(false);
  });

  it('publishing a Story sends tipo "stories" with an empty caption', async () => {
    vi.mocked(updateWorkflowPost).mockResolvedValue({
      id: 30,
      workflow_id: 10,
      titulo: 'Post Express',
      conteudo: null,
      conteudo_plain: '',
      tipo: 'stories',
      ordem: 0,
      status: 'aprovado_cliente',
    });
    vi.mocked(updateWorkflow).mockResolvedValue({
      id: 10,
      cliente_id: 1,
      titulo: 'Post Express',
      status: 'concluido',
      etapa_atual: 0,
      recorrente: false,
    });
    vi.mocked(publishInstagramPostNow).mockResolvedValue({ status: 'postado' } as any);

    renderWithProviders(<ExpressPostPage />);
    await selectClientAndAwaitDraft();

    fireEvent.click(screen.getByRole('button', { name: 'Stories' }));
    fireEvent.click(screen.getByText('Simulate Upload'));

    // Open the confirm dialog and confirm.
    fireEvent.click(screen.getByText('Publicar Stories').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));

    await waitFor(() =>
      expect(updateWorkflowPost).toHaveBeenCalledWith(
        30,
        expect.objectContaining({ tipo: 'stories', ig_caption: '' }),
      ),
    );
    await waitFor(() => expect(publishInstagramPostNow).toHaveBeenCalledWith(30));
  });
});
