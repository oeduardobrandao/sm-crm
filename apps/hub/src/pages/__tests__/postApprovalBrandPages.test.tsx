import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HubContext } from '../../HubContext';

vi.mock('../../api', () => ({
  fetchPosts: vi.fn(),
  fetchBrand: vi.fn(),
}));

vi.mock('../../components/PostCard', () => ({
  PostCard: ({
    post,
    token,
    approvals,
    propertyValues,
    workflowSelectOptions,
    defaultExpanded,
    onApprovalSubmitted,
  }: {
    post: { id: number; titulo: string };
    token: string;
    approvals: unknown[];
    propertyValues: unknown[];
    workflowSelectOptions: unknown[];
    defaultExpanded?: boolean;
    onApprovalSubmitted: () => void;
  }) => (
    <article
      data-testid="post-card"
      data-default-expanded={defaultExpanded ? 'true' : 'false'}
      data-post-id={String(post.id)}
    >
      <h4>{post.titulo}</h4>
      <p data-testid={`post-wire-${post.id}`}>
        {[
          token,
          approvals.length,
          propertyValues.length,
          workflowSelectOptions.length,
          defaultExpanded ? 'expanded' : 'collapsed',
        ].join('|')}
      </p>
      <button type="button" onClick={onApprovalSubmitted}>
        Refresh {post.id}
      </button>
    </article>
  ),
}));

import { fetchBrand, fetchPosts } from '../../api';
import { AprovacoesPage } from '../AprovacoesPage';
import { MarcaPage } from '../MarcaPage';
import { PostagensPage } from '../PostagensPage';

const mockedFetchPosts = vi.mocked(fetchPosts);
const mockedFetchBrand = vi.mocked(fetchBrand);

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
        retry: false,
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

function makePost(
  overrides: Partial<{
    id: number;
    titulo: string;
    status: 'rascunho' | 'em_producao' | 'enviado_cliente' | 'aprovado_cliente' | 'correcao_cliente' | 'agendado' | 'publicado';
    scheduled_at: string | null;
    ordem: number;
    workflow_id: number;
    workflow_titulo: string;
  }> = {},
) {
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

describe('hub approval, posts, and brand pages', () => {
  beforeEach(() => {
    mockedFetchPosts.mockReset();
    mockedFetchBrand.mockReset();
  });

  describe('AprovacoesPage', () => {
    it('shows the loading spinner while pending approvals are loading', () => {
      mockedFetchPosts.mockImplementation(() => new Promise(() => {}));

      const { container } = renderHubPage(
        '/mesaas/hub/token-publico/aprovacoes',
        '/:workspace/hub/:token/aprovacoes',
        <AprovacoesPage />,
      );

      expect(container.querySelector('.animate-spin')).not.toBeNull();
    });

    it('renders the empty copy when there are no client approvals pending', async () => {
      mockedFetchPosts.mockResolvedValue({
        posts: [makePost({ id: 8, status: 'agendado' })],
        postApprovals: [],
        propertyValues: [],
        workflowSelectOptions: [],
      } as never);

      renderHubPage(
        '/mesaas/hub/token-publico/aprovacoes',
        '/:workspace/hub/:token/aprovacoes',
        <AprovacoesPage />,
      );

      expect(await screen.findByText('Tudo em dia. Nenhum post aguardando aprovação.')).toBeInTheDocument();
      expect(screen.queryByTestId('post-card')).not.toBeInTheDocument();
    });

    it('sorts pending posts and invalidates the posts query after an approval callback', async () => {
      mockedFetchPosts.mockResolvedValue({
        posts: [
          makePost({
            id: 11,
            titulo: 'Post mais tarde',
            scheduled_at: '2026-04-25T09:00:00.000Z',
          }),
          makePost({
            id: 12,
            titulo: 'Post mais cedo',
            scheduled_at: '2026-04-19T09:00:00.000Z',
          }),
          makePost({
            id: 13,
            titulo: 'Post já agendado',
            status: 'agendado',
          }),
        ],
        postApprovals: [{ id: 1, post_id: 12, action: 'mensagem', comentario: 'Olhar CTA', is_workspace_user: false, created_at: '2026-04-18T10:00:00.000Z' }],
        propertyValues: [{ post_id: 12, value: 'Instagram', template_property_definitions: { name: 'Canal', type: 'text', config: {}, portal_visible: true, display_order: 1 } }],
        workflowSelectOptions: [{ workflow_id: 1, property_definition_id: 99, option_id: 'feed', label: 'Feed', color: '#0f766e' }],
      } as never);

      const queryClient = createQueryClient();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      renderHubPage(
        '/mesaas/hub/token-publico/aprovacoes',
        '/:workspace/hub/:token/aprovacoes',
        <AprovacoesPage />,
        queryClient,
      );

      expect(await screen.findByText('2 posts aguardando sua aprovação.')).toBeInTheDocument();
      expect(screen.getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent)).toEqual([
        'Post mais cedo',
        'Post mais tarde',
      ]);
      expect(screen.queryByText('Post já agendado')).not.toBeInTheDocument();
      expect(screen.getByTestId('post-wire-12')).toHaveTextContent('token-publico|1|1|1|collapsed');

      fireEvent.click(screen.getByRole('button', { name: 'Refresh 12' }));

      await waitFor(() => {
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['hub-posts', 'token-publico'] });
      });
    });
  });

  describe('PostagensPage', () => {
    it('shows the loading spinner while post groups are loading', () => {
      mockedFetchPosts.mockImplementation(() => new Promise(() => {}));

      const { container } = renderHubPage(
        '/mesaas/hub/token-publico/postagens',
        '/:workspace/hub/:token/postagens',
        <PostagensPage />,
      );

      expect(container.querySelector('.animate-spin')).not.toBeNull();
    });

    it('renders the error message when the posts query fails', async () => {
      mockedFetchPosts.mockRejectedValue(new Error('Falha na API'));

      renderHubPage(
        '/mesaas/hub/token-publico/postagens',
        '/:workspace/hub/:token/postagens',
        <PostagensPage />,
      );

      expect(await screen.findByText('Erro ao carregar postagens.')).toBeInTheDocument();
    });

    it('renders the empty state when no visible posts are available', async () => {
      mockedFetchPosts.mockResolvedValue({
        posts: [
          makePost({ id: 20, titulo: 'Rascunho oculto', status: 'rascunho' }),
          makePost({ id: 21, titulo: 'Produção interna', status: 'em_producao' }),
        ],
        postApprovals: [],
        propertyValues: [],
        workflowSelectOptions: [],
      } as never);

      renderHubPage(
        '/mesaas/hub/token-publico/postagens',
        '/:workspace/hub/:token/postagens',
        <PostagensPage />,
      );

      expect(await screen.findByText('Nenhuma postagem disponível ainda.')).toBeInTheDocument();
      expect(screen.queryByTestId('post-card')).not.toBeInTheDocument();
    });

    it('groups and sorts visible posts, wires defaultExpanded from the query string, and invalidates on refresh', async () => {
      mockedFetchPosts.mockResolvedValue({
        posts: [
          makePost({
            id: 30,
            titulo: 'Mais tarde',
            workflow_id: 2,
            workflow_titulo: 'Branding',
            scheduled_at: '2026-04-25T09:00:00.000Z',
            ordem: 2,
          }),
          makePost({
            id: 31,
            titulo: 'Sem data',
            workflow_id: 2,
            workflow_titulo: 'Branding',
            scheduled_at: null,
            ordem: 1,
          }),
          makePost({
            id: 32,
            titulo: 'Mais cedo',
            workflow_id: 2,
            workflow_titulo: 'Branding',
            scheduled_at: '2026-04-20T09:00:00.000Z',
            ordem: 3,
          }),
          makePost({
            id: 33,
            titulo: 'Aprovado hoje',
            workflow_id: 1,
            workflow_titulo: 'Atendimento',
            status: 'aprovado_cliente',
            scheduled_at: '2026-04-18T09:00:00.000Z',
          }),
          makePost({
            id: 34,
            titulo: 'Rascunho oculto',
            workflow_id: 1,
            workflow_titulo: 'Atendimento',
            status: 'rascunho',
          }),
        ],
        postApprovals: [{ id: 2, post_id: 30, action: 'mensagem', comentario: 'Ver legenda', is_workspace_user: false, created_at: '2026-04-18T12:00:00.000Z' }],
        propertyValues: [{ post_id: 30, value: 'Urgente', template_property_definitions: { name: 'Prioridade', type: 'text', config: {}, portal_visible: true, display_order: 1 } }],
        workflowSelectOptions: [{ workflow_id: 2, property_definition_id: 5, option_id: 'ig', label: 'Instagram', color: '#ff8a00' }],
      } as never);

      const queryClient = createQueryClient();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      renderHubPage(
        '/mesaas/hub/token-publico/postagens?post=30',
        '/:workspace/hub/:token/postagens',
        <PostagensPage />,
        queryClient,
      );

      expect(await screen.findByRole('heading', { name: 'Postagens' })).toBeInTheDocument();

      const groupHeadings = screen.getAllByRole('heading', { level: 3 });
      expect(groupHeadings.map((heading) => heading.textContent)).toEqual(['Atendimento', 'Branding']);

      const atendimentoSection = groupHeadings[0].closest('section');
      const brandingSection = groupHeadings[1].closest('section');

      expect(atendimentoSection).not.toBeNull();
      expect(brandingSection).not.toBeNull();
      expect(within(atendimentoSection as HTMLElement).getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent)).toEqual([
        'Aprovado hoje',
      ]);
      expect(within(brandingSection as HTMLElement).getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent)).toEqual([
        'Mais cedo',
        'Mais tarde',
        'Sem data',
      ]);

      expect(screen.queryByText('Rascunho oculto')).not.toBeInTheDocument();
      expect(screen.getByTestId('post-wire-30')).toHaveTextContent('token-publico|1|1|1|expanded');
      expect(screen.getByTestId('post-wire-32')).toHaveTextContent('token-publico|1|1|1|collapsed');

      fireEvent.click(screen.getByRole('button', { name: 'Refresh 30' }));

      await waitFor(() => {
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['hub-posts', 'token-publico'] });
      });
    });
  });

  describe('MarcaPage', () => {
    it('shows the loading spinner while brand materials are loading', () => {
      mockedFetchBrand.mockImplementation(() => new Promise(() => {}));

      const { container } = renderHubPage(
        '/mesaas/hub/token-publico/marca',
        '/:workspace/hub/:token/marca',
        <MarcaPage />,
      );

      expect(container.querySelector('.animate-spin')).not.toBeNull();
    });

    it('renders the empty state when no brand content has been added yet', async () => {
      mockedFetchBrand.mockResolvedValue({ brand: null, files: [] } as never);

      renderHubPage(
        '/mesaas/hub/token-publico/marca',
        '/:workspace/hub/:token/marca',
        <MarcaPage />,
      );

      expect(await screen.findByText('Nenhum material de marca foi adicionado ainda.')).toBeInTheDocument();
    });

    it('renders the brand assets, typography, and downloadable files', async () => {
      mockedFetchBrand.mockResolvedValue({
        brand: {
          id: 'brand-1',
          cliente_id: 14,
          logo_url: 'https://cdn.mesaas.com/brand/logo.png',
          primary_color: '#0f766e',
          secondary_color: '#f97316',
          font_primary: 'Fraunces',
          font_secondary: 'Manrope',
        },
        files: [
          {
            id: 'file-1',
            cliente_id: 14,
            name: 'Brandbook.pdf',
            file_url: 'https://cdn.mesaas.com/brand/brandbook.pdf',
            file_type: 'application/pdf',
            display_order: 1,
          },
          {
            id: 'file-2',
            cliente_id: 14,
            name: 'Logo.zip',
            file_url: 'https://cdn.mesaas.com/brand/logo.zip',
            file_type: 'application/zip',
            display_order: 2,
          },
        ],
      } as never);

      renderHubPage(
        '/mesaas/hub/token-publico/marca',
        '/:workspace/hub/:token/marca',
        <MarcaPage />,
      );

      expect(await screen.findByRole('heading', { name: 'Marca' })).toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'Logo' })).toHaveAttribute('src', 'https://cdn.mesaas.com/brand/logo.png');
      expect(screen.getByText('Cor primária')).toBeInTheDocument();
      expect(screen.getByText('#0f766e')).toBeInTheDocument();
      expect(screen.getByText('Cor secundária')).toBeInTheDocument();
      expect(screen.getByText('#f97316')).toBeInTheDocument();
      expect(screen.getByText('Fonte principal')).toBeInTheDocument();
      expect(screen.getByText('Fraunces')).toBeInTheDocument();
      expect(screen.getByText('Fonte secundária')).toBeInTheDocument();
      expect(screen.getByText('Manrope')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Brandbook\.pdf/i })).toHaveAttribute('href', 'https://cdn.mesaas.com/brand/brandbook.pdf');
      expect(screen.getByRole('link', { name: /Logo\.zip/i })).toHaveAttribute('href', 'https://cdn.mesaas.com/brand/logo.zip');
    });
  });
});
