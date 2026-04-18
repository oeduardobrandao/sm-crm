import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { HubContext } from '../../HubContext';

vi.mock('../../api', () => ({
  fetchPosts: vi.fn(),
  fetchPages: vi.fn(),
  fetchPage: vi.fn(),
  fetchBriefing: vi.fn(),
  submitBriefingAnswer: vi.fn(),
}));

vi.mock('../../components/PostCalendar', () => ({
  PostCalendar: ({ posts }: { posts: Array<{ titulo: string }> }) => (
    <div>Post calendar: {posts.map((post) => post.titulo).join(', ')}</div>
  ),
}));

import {
  fetchBriefing,
  fetchPage,
  fetchPages,
  fetchPosts,
  submitBriefingAnswer,
} from '../../api';
import { HomePage } from '../HomePage';
import { PaginasPage } from '../PaginasPage';
import { PaginaPage } from '../PaginaPage';
import { BriefingPage } from '../BriefingPage';

const mockedFetchPosts = vi.mocked(fetchPosts);
const mockedFetchPages = vi.mocked(fetchPages);
const mockedFetchPage = vi.mocked(fetchPage);
const mockedFetchBriefing = vi.mocked(fetchBriefing);
const mockedSubmitBriefingAnswer = vi.mocked(submitBriefingAnswer);

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

function PathProbe() {
  const location = useLocation();
  return <div data-testid="current-path">{location.pathname}</div>;
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function renderHubPage(
  pathname: string,
  routePath: string,
  page: React.ReactElement,
  queryClient = createQueryClient(),
) {
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <HubContext.Provider value={hubValue}>
          <MemoryRouter initialEntries={[pathname]}>
            <Routes>
              <Route
                path={routePath}
                element={(
                  <>
                    {page}
                    <PathProbe />
                  </>
                )}
              />
            </Routes>
          </MemoryRouter>
        </HubContext.Provider>
      </QueryClientProvider>,
    ),
  };
}

function makePost(overrides: Partial<{
  id: number;
  titulo: string;
  status: 'rascunho' | 'enviado_cliente' | 'aprovado_cliente' | 'correcao_cliente' | 'agendado' | 'publicado';
}> = {}) {
  return {
    id: 1,
    titulo: 'Post padrão',
    tipo: 'feed' as const,
    status: 'enviado_cliente' as const,
    ordem: 1,
    conteudo_plain: 'Conteúdo',
    scheduled_at: '2026-04-20T10:00:00.000Z',
    workflow_id: 1,
    workflow_titulo: 'Editorial',
    media: [],
    cover_media: null,
    ...overrides,
  };
}

describe('hub content pages', () => {
  beforeEach(() => {
    mockedFetchPosts.mockReset();
    mockedFetchPages.mockReset();
    mockedFetchPage.mockReset();
    mockedFetchBriefing.mockReset();
    mockedSubmitBriefingAnswer.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the home dashboard cards, pending approvals, and filtered calendar posts', async () => {
    mockedFetchPosts.mockResolvedValue({
      posts: [
        makePost({ id: 1, titulo: 'Post pendente', status: 'enviado_cliente' }),
        makePost({ id: 2, titulo: 'Post agendado', status: 'agendado' }),
        makePost({ id: 3, titulo: 'Rascunho interno', status: 'rascunho' }),
      ],
    } as never);

    renderHubPage('/mesaas/hub/token-publico', '/:workspace/hub/:token/*', <HomePage />);

    expect(await screen.findByText(/Olá,/)).toBeInTheDocument();
    expect(await screen.findByText('Post calendar: Post pendente, Post agendado')).toBeInTheDocument();
    expect(screen.getByText('1', { selector: 'span' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Aprovações/ }));

    await waitFor(() => {
      expect(screen.getByTestId('current-path')).toHaveTextContent('/mesaas/hub/token-publico/aprovacoes');
    });
  });

  it('renders the empty pages state when no materials exist yet', async () => {
    mockedFetchPages.mockResolvedValue({ pages: [] });

    renderHubPage('/mesaas/hub/token-publico/paginas', '/:workspace/hub/:token/paginas', <PaginasPage />);

    expect(await screen.findByText('Nenhuma página foi criada ainda.')).toBeInTheDocument();
  });

  it('renders page links with the workspace-scoped URLs', async () => {
    mockedFetchPages.mockResolvedValue({
      pages: [
        { id: '42', title: 'Guia da Marca', display_order: 1, created_at: '2026-04-18T10:00:00.000Z' },
      ],
    });

    renderHubPage('/mesaas/hub/token-publico/paginas', '/:workspace/hub/:token/paginas', <PaginasPage />);

    const link = await screen.findByRole('link', { name: 'Guia da Marca' });
    expect(link).toHaveAttribute('href', '/mesaas/hub/token-publico/paginas/42');
  });

  it('renders a not-found state when a page payload is missing', async () => {
    mockedFetchPage.mockResolvedValue({ page: null } as never);

    renderHubPage('/mesaas/hub/token-publico/paginas/42', '/:workspace/hub/:token/paginas/:pageId', <PaginaPage />);

    expect(await screen.findByText('Página não encontrada.')).toBeInTheDocument();
  });

  it('renders rich page content blocks and the back link', async () => {
    mockedFetchPage.mockResolvedValue({
      page: {
        id: '42',
        title: 'Plano Editorial',
        display_order: 1,
        created_at: '2026-04-18T10:00:00.000Z',
        content: [
          { type: 'heading', level: 2, content: 'Estratégia' },
          { type: 'paragraph', content: 'Texto base da estratégia.' },
          { type: 'link', content: 'Abrir site', href: 'https://mesaas.com' },
          { type: 'markdown', content: '**Mensagem-chave**' },
          { type: 'image', content: 'https://cdn.mesaas.com/guia.png' },
        ],
      },
    } as never);

    renderHubPage('/mesaas/hub/token-publico/paginas/42', '/:workspace/hub/:token/paginas/:pageId', <PaginaPage />);

    expect(await screen.findByText('Plano Editorial')).toBeInTheDocument();
    expect(screen.getByText('Estratégia')).toBeInTheDocument();
    expect(screen.getByText('Texto base da estratégia.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir site' })).toHaveAttribute('href', 'https://mesaas.com');
    expect(screen.getByText('Mensagem-chave')).toBeInTheDocument();
    expect(document.querySelector('img[src="https://cdn.mesaas.com/guia.png"]')).not.toBeNull();
    expect(screen.getByRole('link', { name: /Voltar/ })).toHaveAttribute('href', '/mesaas/hub/token-publico/paginas');
  });

  it('renders the empty briefing state when no questions are available', async () => {
    mockedFetchBriefing.mockResolvedValue({ questions: [] });

    renderHubPage('/mesaas/hub/token-publico/briefing', '/:workspace/hub/:token/briefing', <BriefingPage />);

    expect(await screen.findByText('Nenhuma pergunta disponível ainda.')).toBeInTheDocument();
  });

  it('switches briefing sections and autosaves answers through the API', async () => {
    mockedFetchBriefing.mockResolvedValue({
      questions: [
        {
          id: 'q1',
          question: 'Qual a personalidade da marca?',
          answer: 'Acolhedora',
          section: 'Marca',
          display_order: 1,
        },
        {
          id: 'q2',
          question: 'Qual o principal objetivo?',
          answer: null,
          section: 'Geral',
          display_order: 2,
        },
      ],
    });
    mockedSubmitBriefingAnswer.mockResolvedValue({ ok: true } as never);

    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    renderHubPage(
      '/mesaas/hub/token-publico/briefing',
      '/:workspace/hub/:token/briefing',
      <BriefingPage />,
      queryClient,
    );

    expect(await screen.findByText('Qual a personalidade da marca?')).toBeInTheDocument();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Geral' }));
    expect(screen.getByText('Qual o principal objetivo?')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Digite sua resposta…'), {
      target: { value: 'Gerar mais leads qualificados' },
    });

    expect(screen.getByText('Salvando…')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(mockedSubmitBriefingAnswer).toHaveBeenCalledWith(
      'token-publico',
      'q2',
      'Gerar mais leads qualificados',
    );
    expect(screen.getByText('✓ Salvo')).toBeInTheDocument();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['hub-briefing', 'token-publico'] });
  });
});
