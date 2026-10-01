import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/store/kbViews', () => ({ recordKbView: vi.fn(() => Promise.resolve()) }));
vi.mock('@/store/kbVideos', () => ({
  getPublishedVideoSeries: vi.fn(),
  getMyVideoProgress: vi.fn(),
  saveVideoProgress: vi.fn(),
}));

import { getMyVideoProgress, getPublishedVideoSeries, saveVideoProgress } from '@/store/kbVideos';
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
  vi.mocked(saveVideoProgress).mockResolvedValue(undefined);
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

  // Regression guard for the URL-sync fix (item 9): the URL slug is kept in sync with the
  // playing video via navigate({replace:true}) as it advances, but that must not remount the
  // playlist block and drop the autoPlay the user (or "próximo vídeo") just asked for. A literal
  // `key={slug}` on the block would remount it here and this would fail with autoplay false.
  it('advancing to the next video keeps it playing (no remount-triggered autoplay loss)', async () => {
    const { container } = renderAt('primeiro-acesso');
    await screen.findByRole('heading', { name: 'Primeiro acesso' });

    const video = container.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 65 });
    Object.defineProperty(video, 'duration', { configurable: true, value: 65 });
    fireEvent.ended(video);
    fireEvent.click(await screen.findByRole('button', { name: 'Assistir agora' }));

    expect(await screen.findByRole('heading', { name: 'Relatório mensal' })).toBeInTheDocument();
    const nextVideo = container.querySelector('video') as HTMLVideoElement;
    expect(nextVideo.autoplay).toBe(true);
  });

  // Regression guard for the same fix: navigating here from OUTSIDE (a Link to a different
  // /ajuda/video/:slug) must show the newly requested video, not get stuck on whatever the
  // playlist block picked at its own mount.
  it('follows an external navigation to a different video slug', async () => {
    function Harness() {
      return (
        <Routes>
          <Route
            path="/ajuda/video/:slug"
            element={
              <>
                <Link to="/ajuda/video/relatorio-mensal">Ver relatório</Link>
                <VideoPage />
              </>
            }
          />
        </Routes>
      );
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/ajuda/video/primeiro-acesso']}>
          <Harness />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByRole('heading', { name: 'Primeiro acesso' });
    fireEvent.click(screen.getByRole('link', { name: 'Ver relatório' }));

    expect(await screen.findByRole('heading', { name: 'Relatório mensal' })).toBeInTheDocument();
  });
});
