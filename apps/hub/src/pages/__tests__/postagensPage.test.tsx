import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { HubContext } from '../../HubContext';
import type { HubPost, HubPostMedia, HubPostsResponse } from '../../types';

vi.mock('../../api', () => ({
  fetchPosts: vi.fn(),
  fetchInstagramFeed: vi.fn(),
  submitApproval: vi.fn(),
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
import { PostagensPage } from '../PostagensPage';
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
            <Route path="/:workspace/hub/:token/postagens/:postId?" element={<PostagensPage />} />
          </Routes>
        </MemoryRouter>
      </HubContext.Provider>
    </QueryClientProvider>,
  );
  return { ...result, qc };
}

const BASE = '/mesaas/hub/token-publico/postagens';

describe('PostagensPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders one flattened chronological grid with fluxo and status chips', async () => {
    renderPage(
      BASE,
      response({
        posts: [
          post({
            id: 1,
            titulo: 'Segundo',
            scheduled_at: '2026-04-22T10:00:00.000Z',
            workflow_id: 2,
            workflow_titulo: 'Campanha',
          }),
          post({ id: 2, titulo: 'Primeiro', scheduled_at: '2026-04-20T10:00:00.000Z' }),
          post({
            id: 3,
            titulo: 'Avulso',
            scheduled_at: null,
            workflow_id: null,
            workflow_titulo: null,
          }),
          post({ id: 4, titulo: 'Rascunho', status: 'rascunho' }),
        ],
      }),
    );
    const tiles = await screen.findAllByRole('button', { name: /^Abrir / });
    expect(tiles.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Abrir Primeiro',
      'Abrir Segundo',
      'Abrir Avulso',
    ]);
    expect(screen.getByRole('group', { name: 'Filtrar por fluxo' })).toHaveTextContent('Editorial');
    expect(screen.getByRole('group', { name: 'Filtrar por fluxo' })).toHaveTextContent('Campanha');
    expect(screen.getByRole('group', { name: 'Filtrar por fluxo' })).toHaveTextContent('Avulsas');
    expect(screen.getByRole('group', { name: 'Filtrar por status' })).toBeInTheDocument();
  });

  it('filters by fluxo and status together', async () => {
    renderPage(
      BASE,
      response({
        posts: [
          post({ id: 1, titulo: 'A', workflow_id: 1 }),
          post({
            id: 2,
            titulo: 'B',
            workflow_id: 2,
            workflow_titulo: 'Campanha',
            status: 'aprovado_cliente',
          }),
          post({ id: 3, titulo: 'C', workflow_id: 2, workflow_titulo: 'Campanha' }),
        ],
      }),
    );
    await screen.findByRole('button', { name: 'Abrir A' });
    fireEvent.click(screen.getByRole('button', { name: /Campanha/ }));
    expect(screen.queryByRole('button', { name: 'Abrir A' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Aprovado \(/ }));
    expect(screen.getByRole('button', { name: 'Abrir B' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abrir C' })).not.toBeInTheDocument();
  });

  it('shows an empty-state message (chips still visible) when a filter combination yields zero posts', async () => {
    renderPage(
      BASE,
      response({
        posts: [
          post({
            id: 1,
            titulo: 'A',
            workflow_id: 1,
            workflow_titulo: 'Editorial',
            status: 'enviado_cliente',
          }),
          post({
            id: 2,
            titulo: 'B',
            workflow_id: 2,
            workflow_titulo: 'Campanha',
            status: 'aprovado_cliente',
          }),
        ],
      }),
    );
    await screen.findByRole('button', { name: 'Abrir A' });
    // Narrow to the "Campanha" fluxo (only post B, status aprovado_cliente)...
    fireEvent.click(screen.getByRole('button', { name: /Campanha/ }));
    // ...then to the "Aguardando aprovação" status, which has zero overlap with Campanha.
    fireEvent.click(screen.getByRole('button', { name: /Aguardando aprovação \(/ }));
    expect(
      await screen.findByText('Nenhuma postagem encontrada para este filtro.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Abrir /, hidden: true })).not.toBeInTheDocument();
    // The chips stay mounted and interactive so the user can change the filter back.
    expect(screen.getByRole('group', { name: 'Filtrar por fluxo' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Filtrar por status' })).toBeInTheDocument();
  });

  it('opens the dialog on tile click and updates the URL; close returns to the list', async () => {
    renderPage(
      BASE,
      response({ posts: [post({ id: 1, titulo: 'A' }), post({ id: 2, titulo: 'B' })] }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir A' }));
    expect(screen.getByTestId('location')).toHaveTextContent(`${BASE}/1`);
    expect(screen.getByRole('dialog', { name: 'A' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Próximo post' }));
    expect(screen.getByTestId('location')).toHaveTextContent(`${BASE}/2`);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar postagem' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('location')).toHaveTextContent(BASE);
  });

  it('deep link opens the dialog with Aprovar for a pending post', async () => {
    renderPage(
      `${BASE}/2`,
      response({ posts: [post({ id: 1, titulo: 'A' }), post({ id: 2, titulo: 'B' })] }),
    );
    expect(await screen.findByRole('dialog', { name: 'B' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Aprovar/ })).toBeInTheDocument();
  });

  it('deep link to an unknown or internal post shows notAvailable', async () => {
    renderPage(`${BASE}/99`, response({ posts: [post({ id: 1 })] }));
    expect(await screen.findByText('Esta postagem não está disponível.')).toBeInTheDocument();
  });

  it('a background refetch that moves the open post out of the active filter resets the filters', async () => {
    const pending = [post({ id: 1, titulo: 'A' }), post({ id: 2, titulo: 'B' })];
    const afterApproval = [
      post({ id: 1, titulo: 'A' }),
      post({ id: 2, titulo: 'B', status: 'aprovado_cliente' }),
    ];
    mockedFetchPosts
      .mockResolvedValueOnce(response({ posts: pending }))
      .mockResolvedValue(response({ posts: afterApproval }));
    const { qc } = renderPage(BASE);
    await screen.findByRole('button', { name: 'Abrir B' });
    fireEvent.click(screen.getByRole('button', { name: /Aguardando aprovação \(/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Abrir B' }));
    expect(screen.getByRole('dialog', { name: 'B' })).toBeInTheDocument();
    // The agency approves B elsewhere; the next refetch drops it out of the "Aguardando" filter.
    await act(() => qc.invalidateQueries({ queryKey: ['hub-posts', 'token-publico'] }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Todos \(/, hidden: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    expect(screen.getByRole('dialog', { name: 'B' })).toBeInTheDocument();
  });

  it('select mode toggles checkboxes and opens the feed preview', async () => {
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
        posts: [post({ id: 1, titulo: 'A' }), post({ id: 2, titulo: 'S', tipo: 'stories' })],
        instagramProfile: { username: 'clinica', profilePictureUrl: null },
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Selecionar' }));
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(1);
    fireEvent.click(boxes[0]);
    fireEvent.click(screen.getByRole('button', { name: /Visualizar no Feed \(1\)/ }));
    // fetchInstagramFeed resolves asynchronously (real useQuery, not a synchronous mock),
    // unlike the brief's literal synchronous assertion here.
    expect(await screen.findByTestId('grid-selected-count')).toHaveTextContent('1');
    fireEvent.click(screen.getByText('Close grid'));
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('hides Selecionar without an instagramProfile', async () => {
    renderPage(BASE, response({ posts: [post({ id: 1 })] }));
    await screen.findByRole('button', { name: /Abrir/ });
    expect(screen.queryByRole('button', { name: 'Selecionar' })).not.toBeInTheDocument();
  });

  it('keeps page state when the dialog opens (same route object, no remount)', async () => {
    renderPage(
      BASE,
      response({
        posts: [
          post({ id: 1, titulo: 'A' }),
          post({ id: 2, titulo: 'B', status: 'aprovado_cliente' }),
        ],
      }),
    );
    await screen.findByRole('button', { name: 'Abrir A' });
    fireEvent.click(screen.getByRole('button', { name: /Aprovado \(/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Abrir B' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fechar postagem' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Aprovado \(/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByRole('button', { name: 'Abrir A' })).not.toBeInTheDocument();
  });
});
