import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/store/kb', () => ({ getPublishedArticles: vi.fn(), getArticleBySlug: vi.fn() }));
vi.mock('@/store/kbViews', () => ({ recordKbView: vi.fn(() => Promise.resolve()) }));
vi.mock('@/store/kbVideos', () => ({
  getPublishedVideoSeries: vi.fn(),
  getMyVideoProgress: vi.fn(),
  saveVideoProgress: vi.fn(),
}));
vi.mock('@/services/inlineImage', () => ({
  extractR2Keys: () => [],
  resolveInlineImageUrls: async () => ({}),
  injectSignedUrls: (c: unknown) => c,
}));
vi.mock('../videos/ArticleVideos', () => ({ ArticleVideos: () => null }));
vi.mock('@/components/layout/PhoneShellHeader', () => ({
  PhoneShellActions: () => <div data-testid="shell-actions" />,
}));

import { getArticleBySlug, getPublishedArticles } from '@/store/kb';
import { getMyVideoProgress, getPublishedVideoSeries } from '@/store/kbVideos';
import AjudaPage from '../AjudaPage';
import SecaoPage from '../SecaoPage';
import ArtigoPage from '../ArtigoPage';

function article(over: Record<string, unknown>) {
  return {
    id: 'a1',
    title: 'Como cadastrar seu primeiro cliente',
    slug: 'primeiro-cliente',
    excerpt: null,
    content: null,
    content_plain: 'texto curto',
    cover_image_url: null,
    category: 'primeiros-passos',
    tags: [],
    status: 'published',
    display_order: 1,
    author_id: null,
    created_at: '2026-10-02T12:00:00Z',
    updated_at: '2026-10-02T12:00:00Z',
    ...over,
  };
}

const ARTICLES = [
  article({}),
  article({ id: 'a2', title: 'Conecte o Instagram', slug: 'instagram' }),
  article({ id: 'a3', title: 'Convide a equipe', slug: 'equipe', category: 'equipe' }),
];

const SERIES = [
  {
    id: 's1',
    title: 'Primeiros passos',
    slug: 'pp',
    description: null,
    display_order: 1,
    videos: [1, 2, 3].map((n) => ({
      id: n,
      series_id: 's1',
      title: n === 2 ? 'Cadastre seu primeiro cliente' : `Vídeo ${n}`,
      slug: `video-${n}`,
      description: null,
      display_order: n,
      duration_seconds: 252,
      hls_url: `https://h/${n}.m3u8`,
      thumbnail_url: null,
      article: null,
    })),
  },
];

function Path() {
  const { pathname } = useLocation();
  return <span data-testid="path">{pathname}</span>;
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/ajuda" element={<AjudaPage />} />
          <Route path="/ajuda/secao/:category" element={<SecaoPage />} />
          <Route path="/ajuda/video/:slug" element={<div>player</div>} />
          <Route path="/ajuda/:slug" element={<ArtigoPage />} />
        </Routes>
        <Path />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPublishedArticles).mockResolvedValue(ARTICLES as never);
  vi.mocked(getPublishedVideoSeries).mockResolvedValue(SERIES as never);
  // The first video was watched: the row offers the second.
  vi.mocked(getMyVideoProgress).mockResolvedValue([
    { video_id: 1, position_seconds: 252, completed_at: '2026-10-01T00:00:00Z' },
  ] as never);
});

describe('Central de Ajuda on phones', () => {
  it('lists sections with counts and the next tutorial as a row', async () => {
    renderAt('/ajuda');
    expect(screen.getByRole('heading', { level: 1, name: 'Central de Ajuda' })).toBeInTheDocument();
    const secoes = await screen.findByRole('list', { name: 'Seções' });
    expect(within(secoes).getByRole('link', { name: /Primeiros Passos/i })).toHaveAttribute(
      'href',
      '/ajuda/secao/primeiros-passos',
    );
    expect(within(secoes).getByText('2 artigos')).toBeInTheDocument();
    expect(within(secoes).getByText('1 artigo')).toBeInTheDocument();

    const tutorial = await screen.findByRole('link', { name: /Tutoriais em vídeo/ });
    expect(tutorial).toHaveAttribute('href', '/ajuda/video/video-2');
    expect(within(tutorial).getByText('2 de 3')).toBeInTheDocument();
    expect(within(tutorial).getByText('4:12')).toBeInTheDocument();
  });

  it('searches videos and articles', async () => {
    renderAt('/ajuda');
    await screen.findByRole('list', { name: 'Seções' });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar vídeos e artigos' }), {
      target: { value: 'instagram' },
    });
    expect(await screen.findByRole('link', { name: /Conecte o Instagram/ })).toHaveAttribute(
      'href',
      '/ajuda/instagram',
    );
    expect(screen.queryByRole('list', { name: 'Seções' })).toBeNull();
  });

  it('opens the player screen for a ?video= deep link', async () => {
    renderAt('/ajuda?video=video-3');
    expect(await screen.findByText('player')).toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent('/ajuda/video/video-3');
  });

  it('shows a section as a list under a back button', async () => {
    renderAt('/ajuda/secao/primeiros-passos');
    expect(
      screen.getByRole('button', { name: 'Voltar para Central de Ajuda' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Primeiros Passos' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /Conecte o Instagram/ })).toHaveAttribute(
      'href',
      '/ajuda/instagram',
    );
    expect(screen.queryByRole('link', { name: /Convide a equipe/ })).toBeNull();
  });

  it('opens the article index in a sheet', async () => {
    vi.mocked(getArticleBySlug).mockResolvedValue(
      article({
        content: {
          type: 'doc',
          content: [
            { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Abra' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'Em Mais, toque.' }] },
            { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Salve' }] },
          ],
        },
      }) as never,
    );
    renderAt('/ajuda/primeiro-cliente');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Como cadastrar seu primeiro cliente' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Primeiros Passos' })).toHaveAttribute(
      'href',
      '/ajuda/secao/primeiros-passos',
    );
    // Related articles from the same section, as list rows.
    expect(await screen.findByRole('link', { name: /Conecte o Instagram/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Índice' }));
    const sheet = await screen.findByRole('dialog', { name: 'Neste artigo' });
    expect(within(sheet).getByRole('button', { name: 'Abra' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Salve' })).toBeInTheDocument();
  });
});
