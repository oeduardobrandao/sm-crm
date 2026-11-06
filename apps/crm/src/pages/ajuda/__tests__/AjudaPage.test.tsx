import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/store/kb', () => ({ getPublishedArticles: vi.fn() }));
// Desktop markup: the phone branch (PhonePageHeader) has its own suite.
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));
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

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderPage(path = '/ajuda') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AjudaPage />
        <LocationProbe />
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

  it('leaves a plain /ajuda alone until a video is picked', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Primeiro acesso' });
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/ajuda$/);
  });

  it('writes ?video= when a video is picked in the rail, keeping ?q=', async () => {
    renderPage('/ajuda?q=fatura');
    await screen.findByRole('heading', { name: 'Primeiro acesso' });
    fireEvent.click(screen.getByRole('button', { name: /Relatório mensal/ }));
    expect(await screen.findByRole('heading', { name: 'Relatório mensal' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/ajuda?q=fatura&video=relatorio-mensal',
    );
  });

  it('writes ?video= when another series is picked', async () => {
    const outra = {
      id: 's2',
      title: 'Agenda',
      slug: 'agenda',
      description: null,
      display_order: 2,
      videos: [
        {
          ...SERIES[0].videos[0],
          id: 3,
          series_id: 's2',
          title: 'Conhecendo a Agenda',
          slug: 'agenda-conhecendo',
        },
      ],
    };
    vi.mocked(getPublishedVideoSeries).mockResolvedValue([...SERIES, outra] as never);
    renderPage('/ajuda?video=relatorio-mensal');
    await screen.findByRole('heading', { name: 'Relatório mensal' });
    fireEvent.click(screen.getByRole('tab', { name: /Agenda/ }));
    expect(await screen.findByRole('heading', { name: 'Conhecendo a Agenda' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/ajuda?video=agenda-conhecendo');
  });
});
