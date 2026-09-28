import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/store/kbVideos', () => ({
  getPublishedVideoSeries: vi.fn(),
  getMyVideoProgress: vi.fn(),
  saveVideoProgress: vi.fn(),
}));

import { getMyVideoProgress, getPublishedVideoSeries } from '@/store/kbVideos';
import VideoPage from '../VideoPage';

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
  vi.mocked(getPublishedVideoSeries).mockResolvedValue(SERIES as never);
  vi.mocked(getMyVideoProgress).mockResolvedValue([]);
});
afterEach(() => {
  delete (HTMLMediaElement.prototype as { canPlayType?: unknown }).canPlayType;
});

function renderAt(slug: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/ajuda/video/${slug}`]}>
        <Routes>
          <Route path="/ajuda/video/:slug" element={<VideoPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('VideoPage', () => {
  it('plays the video from the URL and restores the tab title on unmount', async () => {
    document.title = 'Dashboard | Mesaas';
    const { unmount } = renderAt('relatorio-mensal');
    expect(await screen.findByRole('heading', { name: 'Relatório mensal' })).toBeInTheDocument();
    expect(document.title).toBe('Relatório mensal | Mesaas');
    expect(screen.getByRole('link', { name: /Central de Ajuda/ })).toHaveAttribute(
      'href',
      '/ajuda',
    );
    unmount();
    expect(document.title).toBe('Dashboard | Mesaas');
  });

  it('shows "Vídeo não encontrado" for an unknown slug', async () => {
    renderAt('nao-existe');
    expect(await screen.findByText('Vídeo não encontrado.')).toBeInTheDocument();
  });
});
