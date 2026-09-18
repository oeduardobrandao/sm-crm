import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { HubContext } from '../../HubContext';
import type { HubPost, HubPostMedia, HubPostsResponse } from '../../types';

const { submitApprovalMock } = vi.hoisted(() => ({ submitApprovalMock: vi.fn() }));

vi.mock('../../api', () => ({
  fetchPosts: vi.fn(),
  fetchInstagramFeed: vi.fn(),
  submitApproval: submitApprovalMock,
  submitEditSuggestion: vi.fn(),
  fetchPostHistory: vi.fn().mockResolvedValue({ events: [], approvals: [] }),
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
    workspace: { name: 'Mesaas', logo_url: '', brand_color: '#0f766e' },
    cliente_nome: 'C',
    is_active: true,
    cliente_id: 14,
  },
  token: 'token-publico',
  workspace: 'mesaas',
} as never;

const MEDIA: HubPostMedia = {
  id: 100,
  post_id: 1,
  kind: 'image',
  mime_type: 'image/jpeg',
  url: 'https://cdn/img.jpg',
  thumbnail_url: null,
  width: 1080,
  height: 1350,
  duration_seconds: null,
  is_cover: false,
  sort_order: 0,
};

function post(over: Partial<HubPost> = {}): HubPost {
  return {
    id: 1,
    titulo: 'Post padrão',
    tipo: 'feed',
    status: 'enviado_cliente',
    ordem: 1,
    conteudo: null,
    conteudo_plain: 'Conteúdo',
    scheduled_at: '2026-04-20T10:00:00.000Z',
    ig_caption: null,
    instagram_permalink: null,
    published_at: null,
    publish_error: null,
    workflow_id: 1,
    workflow_titulo: 'Editorial',
    workflow_created_at: null,
    media: [{ ...MEDIA, post_id: over.id ?? 1 }],
    cover_media: null,
    pending_suggestion: null,
    suggestion_rejected_at: null,
    ...over,
  };
}

function response(over: Partial<HubPostsResponse> = {}): HubPostsResponse {
  return {
    posts: [],
    postApprovals: [],
    propertyValues: [],
    workflowSelectOptions: [],
    instagramProfile: null,
    ...over,
  };
}

function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="location">{loc.pathname}</span>;
}

function renderPage(path: string, resp?: HubPostsResponse) {
  if (resp) mockedFetchPosts.mockResolvedValue(resp);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={qc}>
      <HubContext.Provider value={hubValue}>
        <MemoryRouter initialEntries={[path]}>
          <LocationProbe />
          <Routes>
            <Route path="/:workspace/hub/:token/aprovacoes/:postId?" element={<AprovacoesPage />} />
          </Routes>
        </MemoryRouter>
      </HubContext.Provider>
    </QueryClientProvider>,
  );
  return { ...result, qc };
}

const BASE = '/mesaas/hub/token-publico/aprovacoes';

describe('AprovacoesPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows only pending posts, sorted by scheduled_at, with the count description', async () => {
    renderPage(
      BASE,
      response({
        posts: [
          post({ id: 1, titulo: 'Tarde', scheduled_at: '2026-04-22T10:00:00.000Z' }),
          post({ id: 2, titulo: 'Cedo', scheduled_at: '2026-04-20T10:00:00.000Z' }),
          post({ id: 3, titulo: 'Aprovado', status: 'aprovado_cliente' }),
        ],
      }),
    );
    const tiles = await screen.findAllByRole('button', { name: /^Abrir / });
    expect(tiles.map((b) => b.getAttribute('aria-label'))).toEqual(['Abrir Cedo', 'Abrir Tarde']);
    expect(screen.getByText('2 posts aguardando sua aprovação.')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Filtrar por status' })).not.toBeInTheDocument();
  });

  it('shows the empty description when nothing is pending', async () => {
    renderPage(BASE, response({ posts: [post({ id: 3, status: 'postado' })] }));
    expect(
      await screen.findByText('Tudo em dia. Nenhum post aguardando aprovação.'),
    ).toBeInTheDocument();
  });

  it('shows a load error instead of the empty state or the dialog when the fetch fails', async () => {
    mockedFetchPosts.mockRejectedValue(new Error('boom'));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <HubContext.Provider value={hubValue}>
          <MemoryRouter initialEntries={[`${BASE}/1`]}>
            <Routes>
              <Route
                path="/:workspace/hub/:token/aprovacoes/:postId?"
                element={<AprovacoesPage />}
              />
            </Routes>
          </MemoryRouter>
        </HubContext.Provider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Erro ao carregar aprovações.')).toBeInTheDocument();
    expect(
      screen.queryByText('Tudo em dia. Nenhum post aguardando aprovação.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Abrir / })).not.toBeInTheDocument();
  });

  it('opens the dialog at aprovacoes/:postId and approving advances to the next pending post', async () => {
    submitApprovalMock.mockResolvedValue({ ok: true });
    const both = [post({ id: 1, titulo: 'A' }), post({ id: 2, titulo: 'B' })];
    const onlyB = [post({ id: 2, titulo: 'B' })];
    // After the approval the agency-side list no longer contains A.
    mockedFetchPosts
      .mockResolvedValueOnce(response({ posts: both }))
      .mockResolvedValue(response({ posts: onlyB }));
    const { qc } = renderPage(BASE);
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir A' }));
    expect(screen.getByTestId('location')).toHaveTextContent(`${BASE}/1`);
    fireEvent.click(screen.getByRole('button', { name: /Aprovar/ }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`${BASE}/2`));
    expect(screen.getByRole('dialog', { name: 'B' })).toBeInTheDocument();
    // The approval refreshes the posts query so the approved post leaves the pending list.
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['hub-posts', 'token-publico'] }),
    );
    // The refetch shrinks `pending` underneath the open dialog: A is gone from the grid,
    // the dialog survives on B, and nothing flips to the error state.
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Abrir A', hidden: true }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Abrir B', hidden: true })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'B' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(`${BASE}/2`);
    expect(screen.queryByText('Erro ao carregar aprovações.')).not.toBeInTheDocument();
  });

  it('keeps cached posts and the open dialog when a background refetch fails', async () => {
    const { qc } = renderPage(
      `${BASE}/1`,
      response({ posts: [post({ id: 1, titulo: 'A' }), post({ id: 2, titulo: 'B' })] }),
    );
    expect(await screen.findByRole('dialog', { name: 'A' })).toBeInTheDocument();
    mockedFetchPosts.mockRejectedValue(new Error('flaky'));
    await act(() => qc.invalidateQueries({ queryKey: ['hub-posts', 'token-publico'] }));
    expect(qc.getQueryState(['hub-posts', 'token-publico'])?.status).toBe('error');
    // react-query batches observer notifications on a timer; let the error render flush.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(screen.queryByText('Erro ao carregar aprovações.')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'A' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir A', hidden: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir B', hidden: true })).toBeInTheDocument();
  });

  it('select mode only offers media tiles and feeds the preview', async () => {
    mockedFetchInstagramFeed.mockResolvedValue({
      profile: {
        username: 'clinica',
        profilePictureUrl: null,
        followerCount: 0,
        followingCount: 0,
        mediaCount: 0,
      },
      recentPosts: [],
    });
    renderPage(
      BASE,
      response({
        posts: [
          post({ id: 1, titulo: 'A' }),
          post({ id: 2, titulo: 'S', tipo: 'stories' }),
          post({ id: 3, titulo: 'T', media: [] }),
        ],
        instagramProfile: { username: 'clinica', profilePictureUrl: null },
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Selecionar' }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Visualizar no Feed \(1\)/ }));
    // fetchInstagramFeed resolves asynchronously through a real useQuery.
    expect(await screen.findByTestId('grid-selected-count')).toHaveTextContent('1');
  });

  it('leaves select mode when a refetch empties the pending list', async () => {
    mockedFetchPosts
      .mockResolvedValueOnce(
        response({
          posts: [post({ id: 1, titulo: 'A' }), post({ id: 2, titulo: 'B' })],
          instagramProfile: { username: 'clinica', profilePictureUrl: null },
        }),
      )
      .mockResolvedValue(
        response({
          posts: [post({ id: 1, titulo: 'A', status: 'aprovado_cliente' })],
          instagramProfile: { username: 'clinica', profilePictureUrl: null },
        }),
      );
    const { qc } = renderPage(BASE);
    fireEvent.click(await screen.findByRole('button', { name: 'Selecionar' }));
    const hint = 'Selecione posts para visualizar como ficarão no feed do Instagram.';
    expect(screen.getByText(hint)).toBeInTheDocument();
    await act(() => qc.invalidateQueries({ queryKey: ['hub-posts', 'token-publico'] }));
    expect(
      await screen.findByText('Tudo em dia. Nenhum post aguardando aprovação.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
  });
});
