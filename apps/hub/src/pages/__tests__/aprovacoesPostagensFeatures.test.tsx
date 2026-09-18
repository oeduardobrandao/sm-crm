import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HubContext } from '../../HubContext';
import type { HubPostsResponse, HubPost, HubPostMedia } from '../../types';

vi.mock('../../api', () => ({
  fetchPosts: vi.fn(),
  fetchInstagramFeed: vi.fn(),
  submitApproval: vi.fn(),
}));

vi.mock('../../components/InstagramPostCard', () => ({
  InstagramPostCard: ({
    post,
    readOnly,
    isSelected,
    onToggleSelect,
  }: {
    post: { id: number; titulo: string };
    readOnly?: boolean;
    isSelected?: boolean;
    onToggleSelect?: (id: number) => void;
  }) => (
    <article
      data-testid="instagram-post-card"
      data-post-id={String(post.id)}
      data-readonly={readOnly ? 'true' : 'false'}
      data-selected={isSelected ? 'true' : 'false'}
    >
      <h4>{post.titulo}</h4>
      {onToggleSelect && (
        <button type="button" onClick={() => onToggleSelect(post.id)}>
          Select {post.id}
        </button>
      )}
    </article>
  ),
}));

vi.mock('../../components/StoryPostCard', () => ({
  StoryPostCard: ({
    post,
    readOnly,
  }: {
    post: { id: number; titulo: string };
    readOnly?: boolean;
  }) => (
    <article
      data-testid="story-post-card"
      data-post-id={String(post.id)}
      data-readonly={readOnly ? 'true' : 'false'}
    >
      <h4>{post.titulo}</h4>
    </article>
  ),
}));

vi.mock('../../components/TextPostCard', () => ({
  TextPostCard: ({
    post,
    readOnly,
  }: {
    post: { id: number; titulo: string };
    readOnly?: boolean;
  }) => (
    <article
      data-testid="text-post-card"
      data-post-id={String(post.id)}
      data-readonly={readOnly ? 'true' : 'false'}
    >
      <h4>{post.titulo}</h4>
    </article>
  ),
}));

vi.mock('../../components/FeedPreviewButton', () => ({
  FeedPreviewButton: ({
    selectedCount,
    onClick,
  }: {
    selectedCount: number;
    onClick: () => void;
  }) => (
    <button type="button" data-testid="feed-preview-btn" onClick={onClick}>
      Preview ({selectedCount})
    </button>
  ),
}));

vi.mock('../../components/InstagramGridPreview', () => ({
  InstagramGridPreview: ({
    selectedPosts,
    onClose,
  }: {
    selectedPosts: { id: number }[];
    onClose: () => void;
  }) => (
    <div data-testid="instagram-grid-preview">
      <span data-testid="grid-selected-count">{selectedPosts.length}</span>
      <button type="button" onClick={onClose}>
        Close grid
      </button>
    </div>
  ),
}));

import { fetchPosts, fetchInstagramFeed } from '../../api';
import { AprovacoesPage } from '../AprovacoesPage';

const mockedFetchPosts = vi.mocked(fetchPosts);
const mockedFetchInstagramFeed = vi.mocked(fetchInstagramFeed);

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
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

const MEDIA: HubPostMedia = {
  id: 100,
  post_id: 1,
  kind: 'image',
  mime_type: 'image/jpeg',
  url: 'https://cdn.mesaas.com/img.jpg',
  thumbnail_url: null,
  width: 1080,
  height: 1080,
  duration_seconds: null,
  is_cover: false,
  sort_order: 0,
};

function makePost(overrides: Partial<HubPost> = {}): HubPost {
  return {
    id: 1,
    titulo: 'Post padrão',
    tipo: 'feed',
    status: 'enviado_cliente',
    ordem: 1,
    conteudo_plain: 'Conteúdo',
    scheduled_at: '2026-04-20T10:00:00.000Z',
    ig_caption: null,
    instagram_permalink: null,
    published_at: null,
    publish_error: null,
    workflow_id: 1,
    workflow_titulo: 'Editorial',
    media: [{ ...MEDIA, post_id: overrides.id ?? 1 }],
    cover_media: null,
    ...overrides,
  };
}

function makeResponse(overrides: Partial<HubPostsResponse> = {}): HubPostsResponse {
  return {
    posts: [],
    postApprovals: [],
    propertyValues: [],
    workflowSelectOptions: [],
    instagramProfile: null,
    ...overrides,
  };
}

const APROVACOES_PATH = '/mesaas/hub/token-publico/aprovacoes';
const APROVACOES_ROUTE = '/:workspace/hub/:token/aprovacoes';

describe('AprovacoesPage — post type categorization', () => {
  beforeEach(() => {
    mockedFetchPosts.mockReset();
    mockedFetchInstagramFeed.mockReset();
  });

  it('only shows posts with status enviado_cliente', async () => {
    mockedFetchPosts.mockResolvedValue(
      makeResponse({
        posts: [
          makePost({ id: 1, titulo: 'Pending', status: 'enviado_cliente' }),
          makePost({ id: 2, titulo: 'Approved', status: 'aprovado_cliente' }),
          makePost({ id: 3, titulo: 'Scheduled', status: 'agendado' }),
          makePost({ id: 4, titulo: 'Draft', status: 'rascunho' }),
        ],
      }),
    );

    renderHubPage(APROVACOES_PATH, APROVACOES_ROUTE, <AprovacoesPage />);

    expect(await screen.findByText('1 post aguardando sua aprovação.')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.queryByText('Approved')).not.toBeInTheDocument();
    expect(screen.queryByText('Scheduled')).not.toBeInTheDocument();
    expect(screen.queryByText('Draft')).not.toBeInTheDocument();
  });

  it('shows singular count text for exactly one pending post', async () => {
    mockedFetchPosts.mockResolvedValue(
      makeResponse({
        posts: [makePost({ id: 1, titulo: 'Single' })],
      }),
    );

    renderHubPage(APROVACOES_PATH, APROVACOES_ROUTE, <AprovacoesPage />);

    expect(await screen.findByText('1 post aguardando sua aprovação.')).toBeInTheDocument();
  });

  it('shows plural count text for multiple pending posts', async () => {
    mockedFetchPosts.mockResolvedValue(
      makeResponse({
        posts: [
          makePost({ id: 1, titulo: 'First' }),
          makePost({ id: 2, titulo: 'Second' }),
          makePost({ id: 3, titulo: 'Third' }),
        ],
      }),
    );

    renderHubPage(APROVACOES_PATH, APROVACOES_ROUTE, <AprovacoesPage />);

    expect(await screen.findByText('3 posts aguardando sua aprovação.')).toBeInTheDocument();
  });
});

describe('AprovacoesPage — feed preview and selection', () => {
  const FEED = {
    profile: {
      username: 'clinica_aurora',
      profilePictureUrl: null,
      followerCount: 5000,
      followingCount: 300,
      mediaCount: 120,
    },
    recentPosts: [],
  };

  beforeEach(() => {
    mockedFetchPosts.mockReset();
    mockedFetchInstagramFeed.mockReset();
  });

  it('hides Selecionar and FeedPreviewButton when no instagramProfile is present', async () => {
    mockedFetchPosts.mockResolvedValue(
      makeResponse({
        posts: [makePost({ id: 1 })],
        instagramProfile: null,
      }),
    );

    renderHubPage(APROVACOES_PATH, APROVACOES_ROUTE, <AprovacoesPage />);

    await screen.findByRole('button', { name: /^Abrir / });
    expect(screen.queryByRole('button', { name: 'Selecionar' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('feed-preview-btn')).not.toBeInTheDocument();
  });

  it('offers FeedPreviewButton only in select mode when instagramProfile is present', async () => {
    mockedFetchPosts.mockResolvedValue(
      makeResponse({
        posts: [makePost({ id: 1 })],
        instagramProfile: { username: 'clinica_aurora', profilePictureUrl: null },
      }),
    );

    renderHubPage(APROVACOES_PATH, APROVACOES_ROUTE, <AprovacoesPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Selecionar' }));
    expect(await screen.findByTestId('feed-preview-btn')).toBeInTheDocument();
    expect(screen.getByText('Preview (0)')).toBeInTheDocument();
  });

  it('updates selected count when toggling post selection', async () => {
    mockedFetchPosts.mockResolvedValue(
      makeResponse({
        posts: [makePost({ id: 1, titulo: 'Post A' }), makePost({ id: 2, titulo: 'Post B' })],
        instagramProfile: { username: 'clinica_aurora', profilePictureUrl: null },
      }),
    );

    renderHubPage(APROVACOES_PATH, APROVACOES_ROUTE, <AprovacoesPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Selecionar' }));
    expect(screen.getByText('Preview (0)')).toBeInTheDocument();

    const [first, second] = screen.getAllByRole('checkbox');
    fireEvent.click(first);
    expect(screen.getByText('Preview (1)')).toBeInTheDocument();

    fireEvent.click(second);
    expect(screen.getByText('Preview (2)')).toBeInTheDocument();

    fireEvent.click(first);
    expect(screen.getByText('Preview (1)')).toBeInTheDocument();
  });

  it('opens the grid preview and passes selected posts to it', async () => {
    mockedFetchPosts.mockResolvedValue(
      makeResponse({
        posts: [makePost({ id: 1, titulo: 'Post A' }), makePost({ id: 2, titulo: 'Post B' })],
        instagramProfile: { username: 'clinica_aurora', profilePictureUrl: null },
      }),
    );
    mockedFetchInstagramFeed.mockResolvedValue(FEED);

    renderHubPage(APROVACOES_PATH, APROVACOES_ROUTE, <AprovacoesPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Selecionar' }));
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByTestId('feed-preview-btn'));

    const gridPreview = await screen.findByTestId('instagram-grid-preview');
    expect(within(gridPreview).getByTestId('grid-selected-count')).toHaveTextContent('1');
  });

  it('closes the grid preview when onClose is called', async () => {
    mockedFetchPosts.mockResolvedValue(
      makeResponse({
        posts: [makePost({ id: 1 })],
        instagramProfile: { username: 'clinica_aurora', profilePictureUrl: null },
      }),
    );
    mockedFetchInstagramFeed.mockResolvedValue(FEED);

    renderHubPage(APROVACOES_PATH, APROVACOES_ROUTE, <AprovacoesPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Selecionar' }));
    fireEvent.click(screen.getByTestId('feed-preview-btn'));

    const gridPreview = await screen.findByTestId('instagram-grid-preview');
    fireEvent.click(within(gridPreview).getByRole('button', { name: 'Close grid' }));

    await waitFor(() => {
      expect(screen.queryByTestId('instagram-grid-preview')).not.toBeInTheDocument();
    });
  });

  it('only offers media posts (not stories) for grid preview selection', async () => {
    mockedFetchPosts.mockResolvedValue(
      makeResponse({
        posts: [
          makePost({ id: 1, titulo: 'Feed post', tipo: 'feed' }),
          makePost({ id: 2, titulo: 'Story post', tipo: 'stories' }),
        ],
        instagramProfile: { username: 'clinica_aurora', profilePictureUrl: null },
      }),
    );
    mockedFetchInstagramFeed.mockResolvedValue(FEED);

    renderHubPage(APROVACOES_PATH, APROVACOES_ROUTE, <AprovacoesPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Selecionar' }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByTestId('feed-preview-btn'));

    const gridPreview = await screen.findByTestId('instagram-grid-preview');
    expect(within(gridPreview).getByTestId('grid-selected-count')).toHaveTextContent('1');
  });
});

describe('AprovacoesPage — status filter chips', () => {
  beforeEach(() => {
    mockedFetchPosts.mockReset();
    mockedFetchInstagramFeed.mockReset();
  });

  it('does not render the filter chips on AprovacoesPage', async () => {
    mockedFetchPosts.mockResolvedValue(
      makeResponse({ posts: [makePost({ id: 1, titulo: 'Pendente A' })] }),
    );
    renderHubPage(APROVACOES_PATH, APROVACOES_ROUTE, <AprovacoesPage />);
    await screen.findByText('Pendente A');
    expect(screen.queryByRole('group', { name: 'Filtrar por status' })).not.toBeInTheDocument();
  });
});
