import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/store/kb', () => ({ getPublishedArticles: vi.fn() }));
vi.mock('@/store/kbViews', () => ({ recordKbView: vi.fn(() => Promise.resolve()) }));
vi.mock('@/store/kbVideos', () => ({
  getPublishedVideoSeries: vi.fn(),
  getMyVideoProgress: vi.fn(),
  saveVideoProgress: vi.fn(),
}));

import { getPublishedArticles } from '@/store/kb';
import { getMyVideoProgress, getPublishedVideoSeries, saveVideoProgress } from '@/store/kbVideos';
import AjudaPage from '../AjudaPage';

const SERIES = [
  {
    id: 's1',
    title: 'Primeiros passos',
    slug: 'pp',
    description: null,
    display_order: 1,
    videos: [
      {
        id: 1,
        series_id: 's1',
        title: 'Primeiro acesso',
        slug: 'primeiro-acesso',
        description: null,
        display_order: 1,
        duration_seconds: 65,
        hls_url: 'https://h/1.m3u8',
        thumbnail_url: null,
        article: null,
      },
      {
        id: 2,
        series_id: 's1',
        title: 'Relatório mensal',
        slug: 'relatorio-mensal',
        description: null,
        display_order: 2,
        duration_seconds: 80,
        hls_url: 'https://h/2.m3u8',
        thumbnail_url: null,
        article: null,
      },
    ],
  },
];

beforeEach(() => {
  HTMLMediaElement.prototype.canPlayType = vi.fn(() => 'probably') as unknown as (
    t: string,
  ) => CanPlayTypeResult;
  vi.mocked(getPublishedArticles).mockResolvedValue([]);
  vi.mocked(getPublishedVideoSeries).mockResolvedValue(SERIES as never);
  vi.mocked(getMyVideoProgress).mockResolvedValue([]);
  vi.mocked(saveVideoProgress).mockResolvedValue();
});
afterEach(() => {
  delete (HTMLMediaElement.prototype as { canPlayType?: unknown }).canPlayType;
});

function renderPage(path = '/ajuda') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AjudaPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AjudaPage videos', () => {
  it('shows the playlist above the search', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Primeiro acesso' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Buscar vídeos e artigos...')).toBeInTheDocument();
  });

  it('opens on the video named in ?video=', async () => {
    renderPage('/ajuda?video=relatorio-mensal');
    expect(await screen.findByRole('heading', { name: 'Relatório mensal' })).toBeInTheDocument();
  });

  it('hides the block when no series has a visible video', async () => {
    vi.mocked(getPublishedVideoSeries).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('Nenhum artigo publicado ainda.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Tutoriais em vídeo' })).toBeNull();
  });

  it('search finds videos, linking to their page', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Primeiro acesso' });
    fireEvent.change(screen.getByPlaceholderText('Buscar vídeos e artigos...'), {
      target: { value: 'relatorio' },
    });
    expect(await screen.findByRole('link', { name: /Relatório mensal/ })).toHaveAttribute(
      'href',
      '/ajuda/video/relatorio-mensal',
    );
  });
});
