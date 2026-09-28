import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { kbVideoKey } from '../../lib/kb-video-status';

vi.mock('../../lib/api', () => ({
  getKbVideo: vi.fn(),
  upsertKbVideo: vi.fn(),
  deleteKbVideo: vi.fn(),
  listKbVideoSeries: vi.fn(),
  listKbArticles: vi.fn(),
  refreshKbVideo: vi.fn(),
}));
vi.mock('../../lib/stream-upload', async (orig) => ({
  ...(await orig<typeof import('../../lib/stream-upload')>()),
  uploadKbVideo: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import {
  getKbVideo,
  listKbArticles,
  listKbVideoSeries,
  refreshKbVideo,
  upsertKbVideo,
} from '../../lib/api';
import { uploadKbVideo } from '../../lib/stream-upload';
import KbVideoEditorPage from '../KbVideoEditorPage';

const video = {
  id: 7,
  series_id: 's1',
  title: 'Primeiro acesso',
  slug: 'primeiro-acesso',
  description: null,
  article_id: null,
  display_order: 10,
  status: 'draft',
  stream_uid: 'u1',
  stream_status: 'pending',
  stream_upload_expires_at: null,
  duration_seconds: null,
  hls_url: null,
  thumbnail_url: null,
  created_at: '',
  updated_at: '',
};

beforeEach(() => {
  vi.mocked(listKbVideoSeries).mockResolvedValue({
    series: [
      {
        id: 's1',
        title: 'Primeiros passos',
        slug: 'pp',
        description: null,
        display_order: 1,
        status: 'published',
        created_at: '',
        updated_at: '',
      },
    ],
  } as never);
  vi.mocked(listKbArticles).mockResolvedValue({ articles: [] } as never);
  vi.mocked(getKbVideo).mockResolvedValue({ video } as never);
  vi.mocked(upsertKbVideo).mockResolvedValue({ video } as never);
  vi.mocked(uploadKbVideo).mockResolvedValue(video as never);
  vi.mocked(refreshKbVideo).mockResolvedValue({ video } as never);
});

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/kb-videos/new" element={<KbVideoEditorPage />} />
          <Route path="/admin/kb-videos/:id/edit" element={<KbVideoEditorPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('KbVideoEditorPage', () => {
  it('treats a non-canonical id as not found instead of loading another video', async () => {
    renderAt('/admin/kb-videos/7abc/edit');
    expect(await screen.findByText('Vídeo não encontrado.')).toBeInTheDocument();
    expect(getKbVideo).not.toHaveBeenCalled();
  });

  it('cannot publish a video that is still processing', async () => {
    renderAt('/admin/kb-videos/7/edit');
    expect(await screen.findByDisplayValue('Primeiro acesso')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Publicado' })).toBeDisabled();
    expect(screen.getByText(/Só é possível publicar/)).toBeInTheDocument();
    expect(screen.getAllByText('Processando').length).toBeGreaterThan(0);
  });

  it('allows publishing once the video is ready', async () => {
    vi.mocked(getKbVideo).mockResolvedValue({
      video: {
        ...video,
        stream_status: 'ready',
        hls_url: 'https://h/u1.m3u8',
        duration_seconds: 65,
      },
    } as never);
    renderAt('/admin/kb-videos/7/edit');
    await screen.findByDisplayValue('Primeiro acesso');
    expect(screen.getByRole('option', { name: 'Publicado' })).not.toBeDisabled();
  });

  it('keeps Publicado enabled for an already-published video while a replacement file processes', async () => {
    const publishedVideo = { ...video, status: 'published', stream_status: 'pending' };
    vi.mocked(getKbVideo).mockResolvedValue({ video: publishedVideo } as never);
    vi.mocked(refreshKbVideo).mockResolvedValue({ video: publishedVideo } as never);
    renderAt('/admin/kb-videos/7/edit');
    await screen.findByDisplayValue('Primeiro acesso');
    expect(screen.getByRole('option', { name: 'Publicado' })).not.toBeDisabled();
    expect(screen.queryByText(/Só é possível publicar/)).toBeNull();
  });

  it('refreshes a pending video from Stream to settle stalled processing', async () => {
    renderAt('/admin/kb-videos/7/edit');
    await screen.findByDisplayValue('Primeiro acesso');
    await waitFor(() => expect(refreshKbVideo).toHaveBeenCalledWith(7));
  });

  it('keeps unsaved edits when a background refetch settles processing mid-edit', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/admin/kb-videos/7/edit']}>
          <Routes>
            <Route path="/admin/kb-videos/:id/edit" element={<KbVideoEditorPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const titleInput = await screen.findByDisplayValue('Primeiro acesso');
    fireEvent.change(titleInput, { target: { value: 'Editado pelo admin, não salvo' } });

    const readyVideo = {
      ...video,
      stream_status: 'ready',
      hls_url: 'https://h/u1.m3u8',
      duration_seconds: 65,
      title: 'Título atualizado no servidor',
    };
    vi.mocked(getKbVideo).mockResolvedValue({ video: readyVideo } as never);
    vi.mocked(refreshKbVideo).mockResolvedValue({ video: readyVideo } as never);

    await act(async () => {
      await qc.refetchQueries({ queryKey: kbVideoKey(7) });
    });

    await waitFor(() => expect(screen.getByText('Pronto')).toBeInTheDocument());
    expect(screen.getByDisplayValue('Editado pelo admin, não salvo')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Título atualizado no servidor')).toBeNull();
  });

  it('asks to save first on a new video (no file field yet)', async () => {
    renderAt('/admin/kb-videos/new');
    expect(await screen.findByText(/Salve o vídeo para enviar o arquivo/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Arquivo de vídeo')).toBeNull();
  });

  it('uploads a chosen file for an existing video', async () => {
    renderAt('/admin/kb-videos/7/edit');
    await screen.findByDisplayValue('Primeiro acesso');
    const input = screen.getByLabelText('Arquivo de vídeo');
    const file = new File(['x'], 'tutorial.mp4', { type: 'video/mp4' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(uploadKbVideo).toHaveBeenCalledWith(7, file, expect.any(Object)));
  });

  it('saves the metadata with the series and order', async () => {
    renderAt('/admin/kb-videos/7/edit');
    await screen.findByDisplayValue('Primeiro acesso');
    fireEvent.click(screen.getByRole('button', { name: /Salvar/ }));
    await waitFor(() =>
      expect(upsertKbVideo).toHaveBeenCalledWith(
        expect.objectContaining({
          video_id: 7,
          series_id: 's1',
          display_order: 10,
          status: 'draft',
        }),
      ),
    );
  });
});
