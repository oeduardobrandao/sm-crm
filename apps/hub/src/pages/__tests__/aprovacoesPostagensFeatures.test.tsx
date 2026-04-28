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
      <button type="button" onClick={onClose}>Close grid</button>
    </div>
  ),
}));

import { fetchPosts, fetchInstagramFeed } from '../../api';
import { AprovacoesPage } from '../AprovacoesPage';
import { PostagensPage } from '../PostagensPage';

const mockedFetchPosts = vi.mocked(fetchPosts);
const mockedFetchInstagramFeed = vi.mocked(fetchInstagramFeed);

const hubValue = {
  bootstrap: {
    workspace: { name: 'Mesaas', logo_url: 'https://cdn.mesaas.com/logo.png', brand_color: '#0f766e' },
    cliente_nome: 'Clínica Aurora',
    is_active: true,
    cliente_id: 14,
  },
  token: 'token-publico',
  workspace: 'mesaas',
};

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderHubPage(pathname: string, routePath: string, page: ReactElement, queryClient = createQueryClient()) {
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
const POSTAGENS_PATH = '/mesaas/hub/token-publico/postagens';
const POSTAGENS_ROUTE = '/:workspace/hub/:token/postagens';

describe('AprovacoesPage — post type categorization', () => {
  beforeEach(() => {
    mockedFetchPosts.mockReset();
    mockedFetchInstagramFeed.mockReset();
  });

  it('renders media posts as InstagramPostCard and excludes stories from that section', async () => {
    mockedFetchPosts.mockResolvedValue(makeResponse({
      posts: [
        makePost({ id: 1, titulo: 'Feed post', tipo: 'feed' }),
        makePost({ id: 2, titulo: 'Reels post', tipo: 'reels' }),
        makePost({ id: 3, titulo: 'Story post', tipo: 'stories' }),
      ],
    }));

    renderHubPage(APROVACOES_PATH, APROVACOES_ROUTE, <AprovacoesPage />);

    const instagramCards = await screen.findAllByTestId('instagram-post-card');
    expect(instagramCards).toHaveLength(2);
    expect(instagramCards.map(c => c.dataset.postId)).toEqual(['1', '2']);

    const storyCards = screen.getAllByTestId('story-post-card');
    expect(storyCards).toHaveLength(1);
    expect(storyCards[0].dataset.postId).toBe('3');
  });

  it('renders posts without media as TextPostCard', async () => {
    mockedFetchPosts.mockResolvedValue(makeResponse({
      posts: [
        makePost({ id: 1, titulo: 'No media', media: [] }),
      ],
    }));

    renderHubPage(APROVACOES_PATH, APROVACOES_ROUTE, <AprovacoesPage />);

    expect(await screen.findByTestId('text-post-card')).toBeInTheDocument();
    expect(screen.queryByTestId('instagram-post-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('story-post-card')).not.toBeInTheDocument();
  });

  it('renders carrossel posts as InstagramPostCard (not stories)', async () => {
    mockedFetchPosts.mockResolvedValue(makeResponse({
      posts: [
        makePost({ id: 1, titulo: 'Carrossel post', tipo: 'carrossel' }),
      ],
    }));

    renderHubPage(APROVACOES_PATH, APROVACOES_ROUTE, <AprovacoesPage />);

    expect(await screen.findByTestId('instagram-post-card')).toBeInTheDocument();
    expect(screen.queryByTestId('story-post-card')).not.toBeInTheDocument();
  });

  it('shows the Stories section header only when media posts also exist', async () => {
    mockedFetchPosts.mockResolvedValue(makeResponse({
      posts: [
        makePost({ id: 1, titulo: 'Feed', tipo: 'feed' }),
        makePost({ id: 2, titulo: 'Story', tipo: 'stories' }),
      ],
    }));

    renderHubPage(APROVACOES_PATH, APROVACOES_ROUTE, <AprovacoesPage />);

    expect(await screen.findByText('Stories')).toBeInTheDocument();
  });

  it('hides the Stories section header when only stories exist (no media posts)', async () => {
    mockedFetchPosts.mockResolvedValue(makeResponse({
      posts: [
        makePost({ id: 2, titulo: 'Story only', tipo: 'stories' }),
      ],
    }));

    renderHubPage(APROVACOES_PATH, APROVACOES_ROUTE, <AprovacoesPage />);

    await screen.findByTestId('story-post-card');
    expect(screen.queryByText('Stories')).not.toBeInTheDocument();
  });

  it('shows "Posts sem mídia" header when stories or media posts also exist', async () => {
    mockedFetchPosts.mockResolvedValue(makeResponse({
      posts: [
        makePost({ id: 1, titulo: 'Story', tipo: 'stories' }),
        makePost({ id: 2, titulo: 'Text only', media: [] }),
      ],
    }));

    renderHubPage(APROVACOES_PATH, APROVACOES_ROUTE, <AprovacoesPage />);

    expect(await screen.findByText('Posts sem mídia')).toBeInTheDocument();
  });

  it('hides "Posts sem mídia" header when only text posts exist', async () => {
    mockedFetchPosts.mockResolvedValue(makeResponse({
      posts: [
        makePost({ id: 1, titulo: 'Text only', media: [] }),
      ],
    }));

    renderHubPage(APROVACOES_PATH, APROVACOES_ROUTE, <AprovacoesPage />);

    await screen.findByTestId('text-post-card');
    expect(screen.queryByText('Posts sem mídia')).not.toBeInTheDocument();
  });

  it('only shows posts with status enviado_cliente', async () => {
    mockedFetchPosts.mockResolvedValue(makeResponse({
      posts: [
        makePost({ id: 1, titulo: 'Pending', status: 'enviado_cliente' }),
        makePost({ id: 2, titulo: 'Approved', status: 'aprovado_cliente' }),
        makePost({ id: 3, titulo: 'Scheduled', status: 'agendado' }),
        makePost({ id: 4, titulo: 'Draft', status: 'rascunho' }),
      ],
    }));

    renderHubPage(APROVACOES_PATH, APROVACOES_ROUTE, <AprovacoesPage />);

    expect(await screen.findByText('1 post aguardando sua aprovação.')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.queryByText('Approved')).not.toBeInTheDocument();
    expect(screen.queryByText('Scheduled')).not.toBeInTheDocument();
    expect(screen.queryByText('Draft')).not.toBeInTheDocument();
  });

  it('shows singular count text for exactly one pending post', async () => {
    mockedFetchPosts.mockResolvedValue(makeResponse({
      posts: [makePost({ id: 1, titulo: 'Single' })],
    }));

    renderHubPage(APROVACOES_PATH, APROVACOES_ROUTE, <AprovacoesPage />);

    expect(await screen.findByText('1 post aguardando sua aprovação.')).toBeInTheDocument();
  });

  it('shows plural count text for multiple pending posts', async () => {
    mockedFetchPosts.mockResolvedValue(makeResponse({
      posts: [
        makePost({ id: 1, titulo: 'First' }),
        makePost({ id: 2, titulo: 'Second' }),
        makePost({ id: 3, titulo: 'Third' }),
      ],
    }));

    renderHubPage(APROVACOES_PATH, APROVACOES_ROUTE, <AprovacoesPage />);

    expect(await screen.findByText('3 posts aguardando sua aprovação.')).toBeInTheDocument();
  });
});

describe('AprovacoesPage — feed preview and selection', () => {
  beforeEach(() => {
    mockedFetchPosts.mockReset();
    mockedFetchInstagramFeed.mockReset();
  });

  it('hides FeedPreviewButton when no instagramProfile is present', async () => {
    mockedFetchPosts.mockResolvedValue(makeResponse({
      posts: [makePost({ id: 1 })],
      instagramProfile: null,
    }));

    renderHubPage(APROVACOES_PATH, APROVACOES_ROUTE, <AprovacoesPage />);

    await screen.findByTestId('instagram-post-card');
    expect(screen.queryByTestId('feed-preview-btn')).not.toBeInTheDocument();
  });

  it('shows FeedPreviewButton when instagramProfile is present', async () => {
    mockedFetchPosts.mockResolvedValue(makeResponse({
      posts: [makePost({ id: 1 })],
      instagramProfile: { username: 'clinica_aurora', profilePictureUrl: null },
    }));

    renderHubPage(APROVACOES_PATH, APROVACOES_ROUTE, <AprovacoesPage />);

    expect(await screen.findByTestId('feed-preview-btn')).toBeInTheDocument();
    expect(screen.getByText('Preview (0)')).toBeInTheDocument();
  });

  it('updates selected count when toggling post selection', async () => {
    mockedFetchPosts.mockResolvedValue(makeResponse({
      posts: [
        makePost({ id: 1, titulo: 'Post A' }),
        makePost({ id: 2, titulo: 'Post B' }),
      ],
      instagramProfile: { username: 'clinica_aurora', profilePictureUrl: null },
    }));

    renderHubPage(APROVACOES_PATH, APROVACOES_ROUTE, <AprovacoesPage />);

    await screen.findByTestId('feed-preview-btn');
    expect(screen.getByText('Preview (0)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Select 1' }));
    expect(screen.getByText('Preview (1)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Select 2' }));
    expect(screen.getByText('Preview (2)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Select 1' }));
    expect(screen.getByText('Preview (1)')).toBeInTheDocument();
  });

  it('opens the grid preview and passes selected posts to it', async () => {
    mockedFetchPosts.mockResolvedValue(makeResponse({
      posts: [
        makePost({ id: 1, titulo: 'Post A' }),
        makePost({ id: 2, titulo: 'Post B' }),
      ],
      instagramProfile: { username: 'clinica_aurora', profilePictureUrl: null },
    }));
    mockedFetchInstagramFeed.mockResolvedValue({
      profile: {
        username: 'clinica_aurora',
        profilePictureUrl: null,
        followerCount: 5000,
        followingCount: 300,
        mediaCount: 120,
      },
      recentPosts: [],
    });

    renderHubPage(APROVACOES_PATH, APROVACOES_ROUTE, <AprovacoesPage />);

    await screen.findByTestId('feed-preview-btn');

    fireEvent.click(screen.getByRole('button', { name: 'Select 1' }));
    fireEvent.click(screen.getByTestId('feed-preview-btn'));

    const gridPreview = await screen.findByTestId('instagram-grid-preview');
    expect(within(gridPreview).getByTestId('grid-selected-count')).toHaveTextContent('1');
  });

  it('closes the grid preview when onClose is called', async () => {
    mockedFetchPosts.mockResolvedValue(makeResponse({
      posts: [makePost({ id: 1 })],
      instagramProfile: { username: 'clinica_aurora', profilePictureUrl: null },
    }));
    mockedFetchInstagramFeed.mockResolvedValue({
      profile: {
        username: 'clinica_aurora',
        profilePictureUrl: null,
        followerCount: 5000,
        followingCount: 300,
        mediaCount: 120,
      },
      recentPosts: [],
    });

    renderHubPage(APROVACOES_PATH, APROVACOES_ROUTE, <AprovacoesPage />);

    await screen.findByTestId('feed-preview-btn');
    fireEvent.click(screen.getByTestId('feed-preview-btn'));

    const gridPreview = await screen.findByTestId('instagram-grid-preview');
    fireEvent.click(within(gridPreview).getByRole('button', { name: 'Close grid' }));

    await waitFor(() => {
      expect(screen.queryByTestId('instagram-grid-preview')).not.toBeInTheDocument();
    });
  });

  it('only includes withMedia posts (not stories) in grid preview selection', async () => {
    mockedFetchPosts.mockResolvedValue(makeResponse({
      posts: [
        makePost({ id: 1, titulo: 'Feed post', tipo: 'feed' }),
        makePost({ id: 2, titulo: 'Story post', tipo: 'stories' }),
      ],
      instagramProfile: { username: 'clinica_aurora', profilePictureUrl: null },
    }));
    mockedFetchInstagramFeed.mockResolvedValue({
      profile: {
        username: 'clinica_aurora',
        profilePictureUrl: null,
        followerCount: 5000,
        followingCount: 300,
        mediaCount: 120,
      },
      recentPosts: [],
    });

    renderHubPage(APROVACOES_PATH, APROVACOES_ROUTE, <AprovacoesPage />);

    await screen.findByTestId('feed-preview-btn');

    fireEvent.click(screen.getByRole('button', { name: 'Select 1' }));
    fireEvent.click(screen.getByTestId('feed-preview-btn'));

    const gridPreview = await screen.findByTestId('instagram-grid-preview');
    expect(within(gridPreview).getByTestId('grid-selected-count')).toHaveTextContent('1');
  });
});

describe('PostagensPage — post type categorization within groups', () => {
  beforeEach(() => {
    mockedFetchPosts.mockReset();
  });

  it('renders feed/reels/carrossel as InstagramPostCard and stories as StoryPostCard within a group', async () => {
    mockedFetchPosts.mockResolvedValue(makeResponse({
      posts: [
        makePost({ id: 1, titulo: 'Feed post', tipo: 'feed', workflow_id: 1, workflow_titulo: 'Content' }),
        makePost({ id: 2, titulo: 'Reels post', tipo: 'reels', workflow_id: 1, workflow_titulo: 'Content' }),
        makePost({ id: 3, titulo: 'Story post', tipo: 'stories', workflow_id: 1, workflow_titulo: 'Content' }),
        makePost({ id: 4, titulo: 'Text post', media: [], workflow_id: 1, workflow_titulo: 'Content' }),
      ],
    }));

    renderHubPage(POSTAGENS_PATH, POSTAGENS_ROUTE, <PostagensPage />);

    await screen.findByRole('heading', { name: 'Postagens' });

    expect(screen.getAllByTestId('instagram-post-card')).toHaveLength(2);
    expect(screen.getAllByTestId('story-post-card')).toHaveLength(1);
    expect(screen.getAllByTestId('text-post-card')).toHaveLength(1);
  });

  it('passes readOnly to all card types in PostagensPage', async () => {
    mockedFetchPosts.mockResolvedValue(makeResponse({
      posts: [
        makePost({ id: 1, tipo: 'feed', workflow_id: 1, workflow_titulo: 'Content' }),
        makePost({ id: 2, tipo: 'stories', workflow_id: 1, workflow_titulo: 'Content' }),
        makePost({ id: 3, media: [], workflow_id: 1, workflow_titulo: 'Content' }),
      ],
    }));

    renderHubPage(POSTAGENS_PATH, POSTAGENS_ROUTE, <PostagensPage />);

    await screen.findByRole('heading', { name: 'Postagens' });

    const instagramCard = screen.getByTestId('instagram-post-card');
    const storyCard = screen.getByTestId('story-post-card');
    const textCard = screen.getByTestId('text-post-card');

    expect(instagramCard.dataset.readonly).toBe('true');
    expect(storyCard.dataset.readonly).toBe('true');
    expect(textCard.dataset.readonly).toBe('true');
  });

  it('shows singular post count in group header', async () => {
    mockedFetchPosts.mockResolvedValue(makeResponse({
      posts: [
        makePost({ id: 1, workflow_id: 1, workflow_titulo: 'Solo Group' }),
      ],
    }));

    renderHubPage(POSTAGENS_PATH, POSTAGENS_ROUTE, <PostagensPage />);

    expect(await screen.findByText('1 post')).toBeInTheDocument();
  });

  it('shows plural post count in group header', async () => {
    mockedFetchPosts.mockResolvedValue(makeResponse({
      posts: [
        makePost({ id: 1, workflow_id: 1, workflow_titulo: 'Multi Group' }),
        makePost({ id: 2, workflow_id: 1, workflow_titulo: 'Multi Group' }),
        makePost({ id: 3, workflow_id: 1, workflow_titulo: 'Multi Group' }),
      ],
    }));

    renderHubPage(POSTAGENS_PATH, POSTAGENS_ROUTE, <PostagensPage />);

    expect(await screen.findByText('3 posts')).toBeInTheDocument();
  });
});

describe('PostagensPage — collapse/expand groups', () => {
  beforeEach(() => {
    mockedFetchPosts.mockReset();
  });

  it('groups are expanded by default', async () => {
    mockedFetchPosts.mockResolvedValue(makeResponse({
      posts: [
        makePost({ id: 1, titulo: 'Visible', workflow_id: 1, workflow_titulo: 'Alpha' }),
      ],
    }));

    renderHubPage(POSTAGENS_PATH, POSTAGENS_ROUTE, <PostagensPage />);

    expect(await screen.findByText('Visible')).toBeInTheDocument();
  });

  it('hides posts when a group is collapsed', async () => {
    mockedFetchPosts.mockResolvedValue(makeResponse({
      posts: [
        makePost({ id: 1, titulo: 'Hidden post', workflow_id: 1, workflow_titulo: 'Group A' }),
      ],
    }));

    renderHubPage(POSTAGENS_PATH, POSTAGENS_ROUTE, <PostagensPage />);

    expect(await screen.findByText('Hidden post')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Group A/ }));

    expect(screen.queryByText('Hidden post')).not.toBeInTheDocument();
  });

  it('re-shows posts when a collapsed group is expanded', async () => {
    mockedFetchPosts.mockResolvedValue(makeResponse({
      posts: [
        makePost({ id: 1, titulo: 'Toggle post', workflow_id: 1, workflow_titulo: 'Toggle Group' }),
      ],
    }));

    renderHubPage(POSTAGENS_PATH, POSTAGENS_ROUTE, <PostagensPage />);

    await screen.findByText('Toggle post');

    fireEvent.click(screen.getByRole('button', { name: /Toggle Group/ }));
    expect(screen.queryByText('Toggle post')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Toggle Group/ }));
    expect(screen.getByText('Toggle post')).toBeInTheDocument();
  });

  it('collapsing one group does not affect another', async () => {
    mockedFetchPosts.mockResolvedValue(makeResponse({
      posts: [
        makePost({ id: 1, titulo: 'Post Alpha', workflow_id: 1, workflow_titulo: 'Alpha' }),
        makePost({ id: 2, titulo: 'Post Beta', workflow_id: 2, workflow_titulo: 'Beta' }),
      ],
    }));

    renderHubPage(POSTAGENS_PATH, POSTAGENS_ROUTE, <PostagensPage />);

    await screen.findByText('Post Alpha');
    await screen.findByText('Post Beta');

    fireEvent.click(screen.getByRole('button', { name: /Alpha/ }));

    expect(screen.queryByText('Post Alpha')).not.toBeInTheDocument();
    expect(screen.getByText('Post Beta')).toBeInTheDocument();
  });

  it('hides all card types (media, stories, text) when collapsed', async () => {
    mockedFetchPosts.mockResolvedValue(makeResponse({
      posts: [
        makePost({ id: 1, titulo: 'Feed', tipo: 'feed', workflow_id: 1, workflow_titulo: 'Full Group' }),
        makePost({ id: 2, titulo: 'Story', tipo: 'stories', workflow_id: 1, workflow_titulo: 'Full Group' }),
        makePost({ id: 3, titulo: 'Text', media: [], workflow_id: 1, workflow_titulo: 'Full Group' }),
      ],
    }));

    renderHubPage(POSTAGENS_PATH, POSTAGENS_ROUTE, <PostagensPage />);

    await screen.findByText('Feed');
    expect(screen.getByText('Story')).toBeInTheDocument();
    expect(screen.getByText('Text')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Full Group/ }));

    expect(screen.queryByTestId('instagram-post-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('story-post-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('text-post-card')).not.toBeInTheDocument();
  });

  it('keeps the group header visible even when collapsed', async () => {
    mockedFetchPosts.mockResolvedValue(makeResponse({
      posts: [
        makePost({ id: 1, workflow_id: 1, workflow_titulo: 'Persistent Header' }),
      ],
    }));

    renderHubPage(POSTAGENS_PATH, POSTAGENS_ROUTE, <PostagensPage />);

    await screen.findByRole('heading', { name: 'Persistent Header' });

    fireEvent.click(screen.getByRole('button', { name: /Persistent Header/ }));

    expect(screen.getByRole('heading', { name: 'Persistent Header' })).toBeInTheDocument();
    expect(screen.getByText('1 post')).toBeInTheDocument();
  });
});

describe('PostagensPage — sorting within groups', () => {
  beforeEach(() => {
    mockedFetchPosts.mockReset();
  });

  it('sorts posts by scheduled_at within a group, nulls last, then by ordem', async () => {
    mockedFetchPosts.mockResolvedValue(makeResponse({
      posts: [
        makePost({ id: 1, titulo: 'No date A', workflow_id: 1, workflow_titulo: 'Group', scheduled_at: null, ordem: 2 }),
        makePost({ id: 2, titulo: 'No date B', workflow_id: 1, workflow_titulo: 'Group', scheduled_at: null, ordem: 1 }),
        makePost({ id: 3, titulo: 'Late', workflow_id: 1, workflow_titulo: 'Group', scheduled_at: '2026-05-01T10:00:00Z', ordem: 1 }),
        makePost({ id: 4, titulo: 'Early', workflow_id: 1, workflow_titulo: 'Group', scheduled_at: '2026-04-01T10:00:00Z', ordem: 1 }),
      ],
    }));

    renderHubPage(POSTAGENS_PATH, POSTAGENS_ROUTE, <PostagensPage />);

    await screen.findByRole('heading', { name: 'Group' });

    const headings = screen.getAllByRole('heading', { level: 4 });
    expect(headings.map(h => h.textContent)).toEqual(['Early', 'Late', 'No date B', 'No date A']);
  });

  it('uses ordem as tiebreaker when scheduled_at is the same', async () => {
    mockedFetchPosts.mockResolvedValue(makeResponse({
      posts: [
        makePost({ id: 1, titulo: 'Second', workflow_id: 1, workflow_titulo: 'Group', scheduled_at: '2026-04-20T10:00:00Z', ordem: 5 }),
        makePost({ id: 2, titulo: 'First', workflow_id: 1, workflow_titulo: 'Group', scheduled_at: '2026-04-20T10:00:00Z', ordem: 2 }),
      ],
    }));

    renderHubPage(POSTAGENS_PATH, POSTAGENS_ROUTE, <PostagensPage />);

    await screen.findByRole('heading', { name: 'Group' });

    const headings = screen.getAllByRole('heading', { level: 4 });
    expect(headings.map(h => h.textContent)).toEqual(['First', 'Second']);
  });
});

describe('PostagensPage — status filtering', () => {
  beforeEach(() => {
    mockedFetchPosts.mockReset();
  });

  it('shows all visible statuses: enviado_cliente, aprovado_cliente, correcao_cliente, agendado, postado, falha_publicacao', async () => {
    mockedFetchPosts.mockResolvedValue(makeResponse({
      posts: [
        makePost({ id: 1, titulo: 'Enviado', status: 'enviado_cliente', workflow_id: 1, workflow_titulo: 'W' }),
        makePost({ id: 2, titulo: 'Aprovado', status: 'aprovado_cliente', workflow_id: 1, workflow_titulo: 'W' }),
        makePost({ id: 3, titulo: 'Correção', status: 'correcao_cliente', workflow_id: 1, workflow_titulo: 'W' }),
        makePost({ id: 4, titulo: 'Agendado', status: 'agendado', workflow_id: 1, workflow_titulo: 'W' }),
        makePost({ id: 5, titulo: 'Postado', status: 'postado', workflow_id: 1, workflow_titulo: 'W' }),
        makePost({ id: 6, titulo: 'Falha', status: 'falha_publicacao', workflow_id: 1, workflow_titulo: 'W' }),
      ],
    }));

    renderHubPage(POSTAGENS_PATH, POSTAGENS_ROUTE, <PostagensPage />);

    expect(await screen.findByText('6 posts')).toBeInTheDocument();
    expect(screen.getByText('Enviado')).toBeInTheDocument();
    expect(screen.getByText('Aprovado')).toBeInTheDocument();
    expect(screen.getByText('Correção')).toBeInTheDocument();
    expect(screen.getByText('Agendado')).toBeInTheDocument();
    expect(screen.getByText('Postado')).toBeInTheDocument();
    expect(screen.getByText('Falha')).toBeInTheDocument();
  });

  it('filters out rascunho and em_producao statuses', async () => {
    mockedFetchPosts.mockResolvedValue(makeResponse({
      posts: [
        makePost({ id: 1, titulo: 'Rascunho', status: 'rascunho', workflow_id: 1, workflow_titulo: 'W' }),
        makePost({ id: 2, titulo: 'Produção', status: 'em_producao', workflow_id: 1, workflow_titulo: 'W' }),
        makePost({ id: 3, titulo: 'Visible', status: 'enviado_cliente', workflow_id: 1, workflow_titulo: 'W' }),
      ],
    }));

    renderHubPage(POSTAGENS_PATH, POSTAGENS_ROUTE, <PostagensPage />);

    expect(await screen.findByText('1 post')).toBeInTheDocument();
    expect(screen.getByText('Visible')).toBeInTheDocument();
    expect(screen.queryByText('Rascunho')).not.toBeInTheDocument();
    expect(screen.queryByText('Produção')).not.toBeInTheDocument();
  });
});
