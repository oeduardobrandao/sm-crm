import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HubContext } from '../../HubContext';

vi.mock('../../api', () => ({
  fetchPosts: vi.fn(),
  fetchBrand: vi.fn(),
  fetchInstagramFeed: vi.fn(),
  submitApproval: vi.fn(),
}));

vi.mock('../../components/PostCard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../components/PostCard')>();
  return {
    ...actual,
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
  };
});

vi.mock('../../components/FeedPreviewButton', () => ({
  FeedPreviewButton: () => null,
}));

vi.mock('../../components/InstagramGridPreview', () => ({
  InstagramGridPreview: () => null,
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
    feature_mensagens: true,
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
    status:
      | 'rascunho'
      | 'revisao_interna'
      | 'enviado_cliente'
      | 'aprovado_cliente'
      | 'correcao_cliente'
      | 'agendado'
      | 'publicado';
    scheduled_at: string | null;
    ordem: number;
    workflow_id: number;
    workflow_titulo: string;
    workflow_created_at: string;
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
    workflow_created_at: '2026-04-01T00:00:00.000Z',
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
      expect(screen.getByRole('heading', { name: 'Aprovações' })).toBeInTheDocument();
    });

    it('renders the empty copy when there are no client approvals pending', async () => {
      mockedFetchPosts.mockResolvedValue({
        posts: [makePost({ id: 8, status: 'agendado' })],
        postApprovals: [],
        propertyValues: [],
        workflowSelectOptions: [],
        instagramProfile: null,
      } as never);

      renderHubPage(
        '/mesaas/hub/token-publico/aprovacoes',
        '/:workspace/hub/:token/aprovacoes',
        <AprovacoesPage />,
      );

      expect(
        await screen.findByText('Tudo em dia. Nenhum post aguardando aprovação.'),
      ).toBeInTheDocument();
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
      expect(screen.getByRole('heading', { name: 'Postagens' })).toBeInTheDocument();
    });

    it('renders the error message when the posts query fails', async () => {
      mockedFetchPosts.mockRejectedValue(new Error('Falha na API'));

      renderHubPage(
        '/mesaas/hub/token-publico/postagens',
        '/:workspace/hub/:token/postagens',
        <PostagensPage />,
      );

      expect(await screen.findByText('Erro ao carregar postagens.')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Postagens' })).toBeInTheDocument();
    });

    it('renders the empty state when no visible posts are available', async () => {
      mockedFetchPosts.mockResolvedValue({
        posts: [
          makePost({ id: 20, titulo: 'Rascunho oculto', status: 'rascunho' }),
          makePost({ id: 21, titulo: 'Produção interna', status: 'revisao_interna' }),
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
    });

    it('sorts visible posts chronologically into one flattened grid, with fluxo chips per workflow', async () => {
      mockedFetchPosts.mockResolvedValue({
        posts: [
          makePost({
            id: 30,
            titulo: 'Mais tarde',
            workflow_id: 2,
            workflow_titulo: 'Branding',
            workflow_created_at: '2026-04-10T00:00:00.000Z',
            scheduled_at: '2026-04-25T09:00:00.000Z',
            ordem: 2,
          }),
          makePost({
            id: 31,
            titulo: 'Sem data',
            workflow_id: 2,
            workflow_titulo: 'Branding',
            workflow_created_at: '2026-04-10T00:00:00.000Z',
            scheduled_at: null,
            ordem: 1,
          }),
          makePost({
            id: 32,
            titulo: 'Mais cedo',
            workflow_id: 2,
            workflow_titulo: 'Branding',
            workflow_created_at: '2026-04-10T00:00:00.000Z',
            scheduled_at: '2026-04-20T09:00:00.000Z',
            ordem: 3,
          }),
          makePost({
            id: 33,
            titulo: 'Aprovado hoje',
            workflow_id: 1,
            workflow_titulo: 'Atendimento',
            workflow_created_at: '2026-04-18T00:00:00.000Z',
            status: 'aprovado_cliente',
            scheduled_at: '2026-04-18T09:00:00.000Z',
          }),
          makePost({
            id: 34,
            titulo: 'Rascunho oculto',
            workflow_id: 1,
            workflow_titulo: 'Atendimento',
            workflow_created_at: '2026-04-18T00:00:00.000Z',
            status: 'rascunho',
          }),
        ],
        postApprovals: [],
        propertyValues: [],
        workflowSelectOptions: [],
        instagramProfile: null,
      } as never);

      renderHubPage(
        '/mesaas/hub/token-publico/postagens',
        '/:workspace/hub/:token/postagens',
        <PostagensPage />,
      );

      expect(
        await screen.findByRole('button', { name: 'Abrir Aprovado hoje' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Postagens' })).toBeInTheDocument();

      const tiles = screen.getAllByRole('button', { name: /^Abrir / });
      expect(tiles.map((b) => b.getAttribute('aria-label'))).toEqual([
        'Abrir Aprovado hoje',
        'Abrir Mais cedo',
        'Abrir Mais tarde',
        'Abrir Sem data',
      ]);

      const fluxoChips = screen.getByRole('group', { name: 'Filtrar por fluxo' });
      expect(fluxoChips).toHaveTextContent('Atendimento');
      expect(fluxoChips).toHaveTextContent('Branding');

      expect(screen.queryByText('Rascunho oculto')).not.toBeInTheDocument();
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
      expect(screen.getByRole('heading', { name: 'Marca' })).toBeInTheDocument();
    });

    it('renders the empty state when no brand content has been added yet', async () => {
      mockedFetchBrand.mockResolvedValue({ brand: null, files: [] } as never);

      renderHubPage(
        '/mesaas/hub/token-publico/marca',
        '/:workspace/hub/:token/marca',
        <MarcaPage />,
      );

      expect(
        await screen.findByText('Nenhum material de marca foi adicionado ainda.'),
      ).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Marca' })).toBeInTheDocument();
    });

    it('renders the brand assets, typography, and downloadable files', async () => {
      mockedFetchBrand.mockResolvedValue({
        brand: {
          id: 'brand-1',
          cliente_id: 14,
          feature_mensagens: true,
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
            feature_mensagens: true,
            name: 'Brandbook.pdf',
            file_url: 'https://cdn.mesaas.com/brand/brandbook.pdf',
            file_type: 'application/pdf',
            display_order: 1,
          },
          {
            id: 'file-2',
            cliente_id: 14,
            feature_mensagens: true,
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

      expect(await screen.findByRole('img', { name: 'Logo' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Marca' })).toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'Logo' })).toHaveAttribute(
        'src',
        'https://cdn.mesaas.com/brand/logo.png',
      );
      expect(screen.getByText('Cor primária')).toBeInTheDocument();
      expect(screen.getByText('#0f766e')).toBeInTheDocument();
      expect(screen.getByText('Cor secundária')).toBeInTheDocument();
      expect(screen.getByText('#f97316')).toBeInTheDocument();
      expect(screen.getByText('Fonte principal')).toBeInTheDocument();
      expect(screen.getByText('Fraunces')).toBeInTheDocument();
      expect(screen.getByText('Fonte secundária')).toBeInTheDocument();
      expect(screen.getByText('Manrope')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Brandbook\.pdf/i })).toHaveAttribute(
        'href',
        'https://cdn.mesaas.com/brand/brandbook.pdf',
      );
      expect(screen.getByRole('link', { name: /Logo\.zip/i })).toHaveAttribute(
        'href',
        'https://cdn.mesaas.com/brand/logo.zip',
      );
    });
  });
});
