import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { mockPhone } from '../../__tests__/phone';

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

let restorePhone: () => void;

beforeEach(() => {
  restorePhone = mockPhone();
  vi.mocked(listKbVideoSeries).mockResolvedValue({ series } as never);
  vi.mocked(listKbVideos).mockResolvedValue({ videos } as never);
  vi.mocked(refreshKbVideo).mockResolvedValue({ video: videos[1] } as never);
  vi.mocked(reorderKbVideos).mockResolvedValue({ message: 'ok' } as never);
  vi.mocked(upsertKbVideo).mockReset();
  vi.mocked(getKbViewStats).mockResolvedValue({
    articles: {},
    videos: {
      '1': { views_30d: 5, users_30d: 4, views_total: 9, users_total: 7, completed: 3 },
    },
  });
});

afterEach(() => restorePhone());

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Where />
        <KbVideosPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('KbVideosPage (phone)', () => {
  it('shows the large title and one grouped list of video rows per series', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Vídeos' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: /Primeiros passos/ })).toBeInTheDocument();

    const first = await screen.findByRole('link', { name: /Primeiro acesso/ });
    expect(first).toHaveAttribute('href', '/admin/kb-videos/1/edit');
    expect(within(first).getByText('Publicado')).toBeInTheDocument();
    expect(within(first).getByText('Pronto')).toBeInTheDocument();
    expect(within(first).getByText('1:05')).toBeInTheDocument();
    expect(first).toHaveAccessibleName(/Duração 1:05/);
    const second = screen.getByRole('link', { name: /Equipe/ });
    expect(second).toHaveAttribute('href', '/admin/kb-videos/2/edit');
    expect(within(second).getByText('Processando')).toBeInTheDocument();
  });

  it('the plus button offers a new series, which opens the series sheet', async () => {
    renderPage();
    await screen.findByRole('link', { name: /Primeiro acesso/ });
    fireEvent.click(screen.getByRole('button', { name: 'Novo vídeo ou nova série' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Nova série' }));
    expect(await screen.findByRole('dialog', { name: 'Nova série' })).toBeInTheDocument();
    expect(screen.getByLabelText('Título')).toBeInTheDocument();
  });

  it('the plus button also offers a new video, which opens the new-video route', async () => {
    renderPage();
    await screen.findByRole('link', { name: /Primeiro acesso/ });
    fireEvent.click(screen.getByRole('button', { name: 'Novo vídeo ou nova série' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Novo vídeo' }));
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('/admin/kb-videos/new'),
    );
  });

  it('"Editar série" opens the series sheet with the series loaded', async () => {
    renderPage();
    await screen.findByRole('link', { name: /Primeiro acesso/ });
    fireEvent.click(screen.getByRole('button', { name: 'Editar série' }));
    expect(await screen.findByRole('dialog', { name: 'Editar série' })).toBeInTheDocument();
    expect(screen.getByLabelText('Título')).toHaveValue('Primeiros passos');
  });

  it('Selecionar turns the rows into a selection list and publishes the picked video', async () => {
    vi.mocked(upsertKbVideo).mockResolvedValue({ video: videos[0] } as never);
    renderPage();
    await screen.findByRole('link', { name: /Primeiro acesso/ });
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar vídeos' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar Equipe' }));
    expect(screen.getByText('1 selecionado')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Publicar/ }));
    await waitFor(() =>
      expect(upsertKbVideo).toHaveBeenCalledWith({ video_id: 2, status: 'published' }),
    );
  });

  it('reorders through the swipe actions of a row', async () => {
    renderPage();
    await screen.findByRole('link', { name: /Primeiro acesso/ });
    fireEvent.click(screen.getByRole('button', { name: /Descer/ }));
    await waitFor(() =>
      expect(reorderKbVideos).toHaveBeenCalledWith([
        { id: 2, display_order: 10 },
        { id: 1, display_order: 20 },
      ]),
    );
  });
});
