import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { mockPhone } from '../../__tests__/phone';

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
  deleteKbVideo,
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

let restorePhone: () => void;

beforeEach(() => {
  restorePhone = mockPhone();
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
  vi.mocked(deleteKbVideo).mockResolvedValue({ message: 'ok' } as never);
  vi.mocked(uploadKbVideo).mockResolvedValue(video as never);
  vi.mocked(refreshKbVideo).mockResolvedValue({ video } as never);
});

afterEach(() => restorePhone());

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/kb-videos/new" element={<KbVideoEditorPage />} />
          <Route path="/admin/kb-videos/:id/edit" element={<KbVideoEditorPage />} />
          <Route path="/admin/kb-videos" element={<p>Lista de vídeos</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('KbVideoEditorPage (phone)', () => {
  it('shows a pushed nav bar with the video loaded into grouped rows', async () => {
    renderAt('/admin/kb-videos/7/edit');
    expect(await screen.findByDisplayValue('Primeiro acesso')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Editar vídeo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Voltar para Vídeos' })).toBeInTheDocument();
    expect(screen.getByLabelText('Slug')).toHaveValue('primeiro-acesso');
    expect(screen.getAllByText('Processando').length).toBeGreaterThan(0);
    expect(screen.getByText(/Só é possível publicar/)).toBeInTheDocument();
  });

  it('wraps the title in a stacked textarea and hides the Ordem stepper', async () => {
    renderAt('/admin/kb-videos/7/edit');
    await screen.findByDisplayValue('Primeiro acesso');
    const title = screen.getByLabelText('Título');
    expect(title.tagName).toBe('TEXTAREA');
    fireEvent.change(title, { target: { value: 'Um título\ncom quebra' } });
    expect(title).toHaveValue('Um título com quebra');
    expect(screen.getByLabelText('Ordem')).toHaveClass('[appearance:textfield]');
  });

  it('saves the metadata from the nav bar', async () => {
    renderAt('/admin/kb-videos/7/edit');
    await screen.findByDisplayValue('Primeiro acesso');
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Novo título' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(upsertKbVideo).toHaveBeenCalledWith(
        expect.objectContaining({ video_id: 7, title: 'Novo título', series_id: 's1' }),
      ),
    );
  });

  it('uploads a chosen file', async () => {
    renderAt('/admin/kb-videos/7/edit');
    await screen.findByDisplayValue('Primeiro acesso');
    expect(screen.getByRole('button', { name: /Substituir arquivo/ })).toBeInTheDocument();
    const file = new File(['x'], 'tutorial.mp4', { type: 'video/mp4' });
    fireEvent.change(screen.getByLabelText('Arquivo de vídeo'), { target: { files: [file] } });
    await waitFor(() => expect(uploadKbVideo).toHaveBeenCalledWith(7, file, expect.any(Object)));
  });

  it('deletes only after the confirm', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    renderAt('/admin/kb-videos/7/edit');
    await screen.findByDisplayValue('Primeiro acesso');
    fireEvent.click(screen.getByRole('button', { name: 'Excluir vídeo' }));
    expect(deleteKbVideo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Excluir vídeo' }));
    await waitFor(() => expect(deleteKbVideo).toHaveBeenCalledWith(7));
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('asks to save first on a new video', async () => {
    renderAt('/admin/kb-videos/new');
    expect(await screen.findByText(/Salve o vídeo para enviar o arquivo/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Novo vídeo' })).toBeInTheDocument();
  });

  describe('publish gate on the Status picker', () => {
    async function openStatus() {
      await screen.findByDisplayValue('Primeiro acesso');
      fireEvent.click(screen.getByRole('button', { name: /^Status/ }));
      return screen.findByRole('button', { name: /Publicado/ });
    }

    it('disables "Publicado" while the video is not ready', async () => {
      renderAt('/admin/kb-videos/7/edit');
      expect(await openStatus()).toBeDisabled();
    });

    it('enables "Publicado" once the video is ready', async () => {
      vi.mocked(getKbVideo).mockResolvedValue({
        video: {
          ...video,
          stream_status: 'ready',
          hls_url: 'https://h/u1.m3u8',
          duration_seconds: 65,
        },
      } as never);
      renderAt('/admin/kb-videos/7/edit');
      expect(await openStatus()).toBeEnabled();
    });

    it('keeps "Publicado" enabled for an already-published video being replaced', async () => {
      const published = { ...video, status: 'published', stream_status: 'pending' };
      vi.mocked(getKbVideo).mockResolvedValue({ video: published } as never);
      vi.mocked(refreshKbVideo).mockResolvedValue({ video: published } as never);
      renderAt('/admin/kb-videos/7/edit');
      expect(await openStatus()).toBeEnabled();
    });
  });
});
