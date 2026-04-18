import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HubContext } from '../../HubContext';

vi.mock('../../api', () => ({
  fetchIdeias: vi.fn(),
  createIdeia: vi.fn(),
  updateIdeia: vi.fn(),
  deleteIdeia: vi.fn(),
}));

import { createIdeia, deleteIdeia, fetchIdeias, updateIdeia } from '../../api';
import { IdeiasPage } from '../IdeiasPage';

const mockedFetchIdeias = vi.mocked(fetchIdeias);
const mockedCreateIdeia = vi.mocked(createIdeia);
const mockedUpdateIdeia = vi.mocked(updateIdeia);
const mockedDeleteIdeia = vi.mocked(deleteIdeia);

const hubValue = {
  bootstrap: {
    workspace: {
      name: 'Mesaas',
      logo_url: 'https://cdn.mesaas.com/logo.png',
      brand_color: '#0f766e',
    },
    cliente_nome: 'Clínica Aurora',
    is_active: true,
    cliente_id: 14,
  },
  token: 'token-publico',
  workspace: 'mesaas',
};

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retryDelay: 0,
      },
    },
  });
}

function renderHubPage(
  pathname: string,
  routePath: string,
  page: ReactElement,
  queryClient = createQueryClient(),
) {
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <HubContext.Provider value={hubValue}>
          <MemoryRouter initialEntries={[pathname]}>
            <Routes>
              <Route path={routePath} element={page} />
            </Routes>
          </MemoryRouter>
        </HubContext.Provider>
      </QueryClientProvider>,
    ),
  };
}

function makeIdeia(
  overrides: Partial<{
    id: string;
    titulo: string;
    descricao: string;
    links: string[];
    status: 'nova' | 'em_analise' | 'aprovada' | 'descartada';
    comentario_agencia: string | null;
    comentario_autor_id: number | null;
    comentario_at: string | null;
    comentario_autor: { nome: string } | null;
    created_at: string;
    updated_at: string;
    ideia_reactions: Array<{ id: string; membro_id: number; emoji: string; membros: { nome: string } }>;
  }> = {},
) {
  return {
    id: 'idea-1',
    titulo: 'Ideia padrão',
    descricao: 'Descrição padrão da ideia.',
    links: ['https://example.com'],
    status: 'nova' as const,
    comentario_agencia: null,
    comentario_autor_id: null,
    comentario_at: null,
    comentario_autor: null,
    created_at: '2026-04-18T10:00:00.000Z',
    updated_at: '2026-04-18T10:00:00.000Z',
    ideia_reactions: [],
    ...overrides,
  };
}

describe('IdeiasPage', () => {
  beforeEach(() => {
    mockedFetchIdeias.mockReset();
    mockedCreateIdeia.mockReset();
    mockedUpdateIdeia.mockReset();
    mockedDeleteIdeia.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the loading state while ideias are pending', () => {
    mockedFetchIdeias.mockImplementation(() => new Promise(() => {}));

    const { container } = renderHubPage(
      '/mesaas/hub/token-publico/ideias',
      '/:workspace/hub/:token/ideias',
      <IdeiasPage />,
    );

    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  it('does not retry 4xx failures and lets the user retry manually', async () => {
    mockedFetchIdeias
      .mockRejectedValueOnce(new Error('HTTP 400'))
      .mockResolvedValueOnce({
        ideias: [makeIdeia({ id: 'idea-4xx', titulo: 'Ideia recuperada' })],
      } as never);

    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    renderHubPage(
      '/mesaas/hub/token-publico/ideias',
      '/:workspace/hub/:token/ideias',
      <IdeiasPage />,
      queryClient,
    );

    expect(await screen.findByText('Erro ao carregar ideias')).toBeInTheDocument();
    expect(screen.getByText('HTTP 400')).toBeInTheDocument();
    expect(mockedFetchIdeias).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['hub-ideias', 'token-publico'] });
    });
    expect(await screen.findByText('Ideia recuperada')).toBeInTheDocument();
  });

  it('retries non-4xx failures before surfacing the error', async () => {
    mockedFetchIdeias.mockRejectedValue(new Error('HTTP 500'));

    renderHubPage(
      '/mesaas/hub/token-publico/ideias',
      '/:workspace/hub/:token/ideias',
      <IdeiasPage />,
    );

    expect(await screen.findByText('Erro ao carregar ideias')).toBeInTheDocument();
    await waitFor(() => {
      expect(mockedFetchIdeias).toHaveBeenCalledTimes(3);
    });
  });

  it('renders the empty state when there are no ideias yet', async () => {
    mockedFetchIdeias.mockResolvedValue({ ideias: [] } as never);

    renderHubPage(
      '/mesaas/hub/token-publico/ideias',
      '/:workspace/hub/:token/ideias',
      <IdeiasPage />,
    );

    expect(await screen.findByText('Nenhuma ideia ainda')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adicionar ideia' })).toBeInTheDocument();
  });

  it('validates the modal before creating and trims payload fields on save', async () => {
    mockedFetchIdeias.mockResolvedValue({ ideias: [] } as never);
    mockedCreateIdeia.mockResolvedValue({
      ideia: makeIdeia({ id: 'idea-created', titulo: 'Campanha junho' }),
    } as never);

    renderHubPage(
      '/mesaas/hub/token-publico/ideias',
      '/:workspace/hub/:token/ideias',
      <IdeiasPage />,
    );

    await screen.findByText('Nenhuma ideia ainda');

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar ideia' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar ideia' }));

    expect(screen.getByText('Título obrigatório')).toBeInTheDocument();
    expect(screen.getByText('Descrição obrigatória')).toBeInTheDocument();
    expect(mockedCreateIdeia).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('Ex: Reel mostrando os bastidores...'), {
      target: { value: '  Campanha junho  ' },
    });
    fireEvent.change(screen.getByPlaceholderText('Descreva sua ideia com detalhes...'), {
      target: { value: '  Sequência de posts com depoimentos reais.  ' },
    });
    fireEvent.change(screen.getByPlaceholderText('https://...'), {
      target: { value: '  https://www.notion.so/campanha-junho  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar ideia' }));

    await waitFor(() => {
      expect(mockedCreateIdeia).toHaveBeenCalledWith('token-publico', {
        titulo: 'Campanha junho',
        descricao: 'Sequência de posts com depoimentos reais.',
        links: ['https://www.notion.so/campanha-junho'],
      });
    });
  });

  it('allows editing a mutable ideia and keeps immutable ideias read-only', async () => {
    mockedFetchIdeias.mockResolvedValue({
      ideias: [
        makeIdeia({
          id: 'idea-mutable',
          titulo: 'Ideia mutável',
          descricao: 'Pode ser editada.',
          links: ['https://example.com/valid'],
        }),
        makeIdeia({
          id: 'idea-locked',
          titulo: 'Ideia travada',
          status: 'em_analise',
          comentario_agencia: 'Vamos revisar depois.',
          ideia_reactions: [{ id: 'r1', membro_id: 10, emoji: '🔥', membros: { nome: 'Ana' } }],
          links: ['javascript:alert(1)', 'nota'],
        }),
      ],
    } as never);

    renderHubPage(
      '/mesaas/hub/token-publico/ideias',
      '/:workspace/hub/:token/ideias',
      <IdeiasPage />,
    );

    const mutableHeading = await screen.findByRole('heading', { name: 'Ideia mutável' });
    const mutableCard = mutableHeading.closest('.hub-card');
    expect(mutableCard).not.toBeNull();
    expect(within(mutableCard as HTMLElement).getAllByRole('button')).toHaveLength(2);

    const immutableHeading = screen.getByRole('heading', { name: 'Ideia travada' });
    const immutableCard = immutableHeading.closest('.hub-card');
    expect(immutableCard).not.toBeNull();
    expect(within(immutableCard as HTMLElement).queryAllByRole('button')).toHaveLength(0);

    const links = within(immutableCard as HTMLElement).getAllByRole('link');
    expect(links[0]).toHaveAttribute('href', '#');
    expect(links[1]).toHaveAttribute('href', '#');
    expect(links[0]).toHaveAttribute('target', '_blank');
    expect(links[0]).toHaveAttribute('rel', expect.stringContaining('noopener'));

    fireEvent.click(within(mutableCard as HTMLElement).getAllByRole('button')[0]);

    expect(await screen.findByRole('heading', { name: 'Editar ideia' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Ideia mutável')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Pode ser editada.')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('Ideia mutável'), {
      target: { value: 'Ideia mutável ajustada' },
    });
    fireEvent.change(screen.getByDisplayValue('Pode ser editada.'), {
      target: { value: 'Descrição atualizada.' },
    });
    fireEvent.change(screen.getByDisplayValue('https://example.com/valid'), {
      target: { value: 'https://example.com/valid-editada' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    await waitFor(() => {
      expect(mockedUpdateIdeia).toHaveBeenCalledWith('token-publico', 'idea-mutable', {
        titulo: 'Ideia mutável ajustada',
        descricao: 'Descrição atualizada.',
        links: ['https://example.com/valid-editada'],
      });
    });
  });

  it('deletes a mutable ideia and refreshes the list after invalidation', async () => {
    mockedFetchIdeias
      .mockResolvedValueOnce({
        ideias: [
          makeIdeia({ id: 'idea-delete', titulo: 'Apagar depois' }),
          makeIdeia({
            id: 'idea-keep',
            titulo: 'Continuar',
            status: 'aprovada',
            comentario_agencia: 'Já aprovada.',
          }),
        ],
      } as never)
      .mockResolvedValueOnce({
        ideias: [
          makeIdeia({
            id: 'idea-keep',
            titulo: 'Continuar',
            status: 'aprovada',
            comentario_agencia: 'Já aprovada.',
          }),
        ],
      } as never);
    mockedDeleteIdeia.mockResolvedValue({ ok: true } as never);

    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    renderHubPage(
      '/mesaas/hub/token-publico/ideias',
      '/:workspace/hub/:token/ideias',
      <IdeiasPage />,
      queryClient,
    );

    const deletingHeading = await screen.findByRole('heading', { name: 'Apagar depois' });
    const deletingCard = deletingHeading.closest('.hub-card') as HTMLElement;

    fireEvent.click(within(deletingCard).getAllByRole('button')[1]);

    await waitFor(() => {
      expect(mockedDeleteIdeia).toHaveBeenCalledWith('token-publico', 'idea-delete');
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['hub-ideias', 'token-publico'] });
    });
    expect(await screen.findByText('Continuar')).toBeInTheDocument();
    expect(screen.queryByText('Apagar depois')).not.toBeInTheDocument();
  });
});
