import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/api', () => ({
  listKbVideoSeries: vi.fn(),
  listKbVideos: vi.fn(),
  refreshKbVideo: vi.fn(),
  reorderKbVideos: vi.fn(),
  upsertKbVideoSeries: vi.fn(),
  deleteKbVideoSeries: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { listKbVideos, listKbVideoSeries, refreshKbVideo, reorderKbVideos } from '../../lib/api';
import KbVideosPage from '../KbVideosPage';

const series = [
  {
    id: 's1',
    title: 'Primeiros passos',
    slug: 'primeiros-passos',
    description: null,
    display_order: 1,
    status: 'published',
    created_at: '',
    updated_at: '',
  },
];
const base = {
  series_id: 's1',
  description: null,
  article_id: null,
  status: 'draft',
  stream_upload_expires_at: null,
  hls_url: null,
  thumbnail_url: null,
  created_at: '',
  updated_at: new Date().toISOString(),
};
const videos = [
  {
    ...base,
    id: 1,
    title: 'Primeiro acesso',
    slug: 'primeiro-acesso',
    display_order: 10,
    stream_uid: 'u1',
    stream_status: 'ready',
    duration_seconds: 65,
    status: 'published',
  },
  {
    ...base,
    id: 2,
    title: 'Equipe',
    slug: 'equipe',
    display_order: 20,
    stream_uid: 'u2',
    stream_status: 'pending',
    duration_seconds: null,
  },
];

beforeEach(() => {
  vi.mocked(listKbVideoSeries).mockResolvedValue({ series } as never);
  vi.mocked(listKbVideos).mockResolvedValue({ videos } as never);
  vi.mocked(refreshKbVideo).mockResolvedValue({ video: videos[1] } as never);
  vi.mocked(reorderKbVideos).mockResolvedValue({ message: 'ok' } as never);
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <KbVideosPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('KbVideosPage', () => {
  it('groups videos under their series with links to the editor', async () => {
    renderPage();
    expect(await screen.findByText('Primeiros passos')).toBeInTheDocument();
    const links = await screen.findAllByRole('link', { name: 'Primeiro acesso' });
    for (const l of links) expect(l).toHaveAttribute('href', '/admin/kb-videos/1/edit');
    expect(screen.getAllByText('Pronto').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Processando').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1:05').length).toBeGreaterThan(0);
  });

  it('"Novo vídeo" links to the new-video route', async () => {
    renderPage();
    expect(await screen.findByRole('link', { name: /Novo vídeo/ })).toHaveAttribute(
      'href',
      '/admin/kb-videos/new',
    );
  });

  it('moving a video down renumbers the series', async () => {
    renderPage();
    await screen.findAllByRole('link', { name: 'Primeiro acesso' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Mover Primeiro acesso para baixo' })[0]);
    await waitFor(() =>
      expect(reorderKbVideos).toHaveBeenCalledWith([
        { id: 2, display_order: 10 },
        { id: 1, display_order: 20 },
      ]),
    );
  });

  it('does not auto-refresh a pending upload that is still fresh', async () => {
    renderPage();
    await screen.findAllByRole('link', { name: 'Equipe' });
    expect(refreshKbVideo).not.toHaveBeenCalled();
  });

  it('shows an empty state when there are no series yet', async () => {
    vi.mocked(listKbVideoSeries).mockResolvedValue({ series: [] } as never);
    vi.mocked(listKbVideos).mockResolvedValue({ videos: [] } as never);
    renderPage();
    expect(await screen.findByText('Nenhuma série ainda')).toBeInTheDocument();
  });
});
