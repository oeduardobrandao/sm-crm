import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/api', () => ({
  listKbVideoSeries: vi.fn(),
  listKbVideos: vi.fn(),
  getKbViewStats: vi.fn(),
  refreshKbVideo: vi.fn(),
  reorderKbVideos: vi.fn(),
  upsertKbVideo: vi.fn(),
  upsertKbVideoSeries: vi.fn(),
  deleteKbVideoSeries: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import {
  getKbViewStats,
  listKbVideos,
  listKbVideoSeries,
  refreshKbVideo,
  reorderKbVideos,
  upsertKbVideo,
} from '../../lib/api';
import { toast } from 'sonner';
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
  vi.mocked(getKbViewStats).mockResolvedValue({
    articles: {},
    videos: {
      '1': { views_30d: 5, users_30d: 4, views_total: 9, users_total: 7, completed: 3 },
    },
  });
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
  it('shows view counts and completions per video', async () => {
    renderPage();
    expect(await screen.findByText('5 visualizações · 4 pessoas')).toBeInTheDocument();
    expect(screen.getByText('Total: 9 · 7 pessoas · 3 concluíram')).toBeInTheDocument();
    expect(screen.getByText('Sem visualizações')).toBeInTheDocument(); // video 2
  });

  it('still lists videos when the stats call fails', async () => {
    vi.mocked(getKbViewStats).mockRejectedValue(new Error('down'));
    renderPage();
    expect(
      (await screen.findAllByRole('link', { name: 'Primeiro acesso' })).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/· \d+ pessoas?$/)).not.toBeInTheDocument();
  });

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

  it('bulk-publishes the selected videos one by one and reports refusals', async () => {
    vi.mocked(upsertKbVideo).mockReset();
    vi.mocked(upsertKbVideo)
      .mockResolvedValueOnce({ video: videos[0] } as never)
      .mockRejectedValueOnce(new Error('only a ready video can be published'));
    renderPage();
    await screen.findAllByRole('link', { name: 'Primeiro acesso' });
    expect(screen.queryByRole('toolbar', { name: 'Ações em massa' })).toBeNull();

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Selecionar todos os vídeos de Primeiros passos' }),
    );
    expect(screen.getByText('2 selecionados')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Publicar/ }));

    await waitFor(() => expect(upsertKbVideo).toHaveBeenCalledTimes(2));
    expect(upsertKbVideo).toHaveBeenCalledWith({ video_id: 1, status: 'published' });
    expect(upsertKbVideo).toHaveBeenCalledWith({ video_id: 2, status: 'published' });
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        '1 item publicado. 1 falhou. Só vídeos com o arquivo pronto podem ser publicados.',
      ),
    );
    expect(screen.queryByRole('toolbar', { name: 'Ações em massa' })).toBeNull();
  });

  it('bulk-unpublishes a single selected video', async () => {
    vi.mocked(upsertKbVideo).mockReset();
    vi.mocked(upsertKbVideo).mockResolvedValue({ video: videos[0] } as never);
    renderPage();
    await screen.findAllByRole('link', { name: 'Primeiro acesso' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar Primeiro acesso' }));
    expect(screen.getByText('1 selecionado')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Despublicar/ }));
    await waitFor(() =>
      expect(upsertKbVideo).toHaveBeenCalledWith({ video_id: 1, status: 'draft' }),
    );
    expect(upsertKbVideo).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('1 item despublicado.'));
  });

  it('does not auto-refresh a pending upload that is still fresh', async () => {
    renderPage();
    await screen.findAllByRole('link', { name: 'Equipe' });
    expect(refreshKbVideo).not.toHaveBeenCalled();
  });

  it('keeps retrying a stale pending upload once a minute while Stream is still processing', async () => {
    vi.mocked(refreshKbVideo).mockClear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const stale = { ...videos[1], updated_at: new Date(Date.now() - 10 * 60_000).toISOString() };
      vi.mocked(listKbVideos).mockResolvedValue({ videos: [videos[0], stale] } as never);
      vi.mocked(refreshKbVideo).mockResolvedValue({ video: stale } as never);
      renderPage();
      await waitFor(() => expect(refreshKbVideo).toHaveBeenCalledTimes(1));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(refreshKbVideo).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(40_000);
      });
      await waitFor(() => expect(refreshKbVideo).toHaveBeenCalledTimes(2));
      expect(refreshKbVideo).toHaveBeenLastCalledWith(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows an empty state when there are no series yet', async () => {
    vi.mocked(listKbVideoSeries).mockResolvedValue({ series: [] } as never);
    vi.mocked(listKbVideos).mockResolvedValue({ videos: [] } as never);
    renderPage();
    expect(await screen.findByText('Nenhuma série ainda')).toBeInTheDocument();
  });
});
