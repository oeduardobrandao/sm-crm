import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../../../services/postMedia', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../services/postMedia')>();
  return {
    ...actual,
    listPostMedia: vi.fn(async () => []),
    uploadPostMedia: vi.fn(),
    deletePostMedia: vi.fn(),
    reorderPostMedia: vi.fn(),
    updateVideoThumbnail: vi.fn(),
    probeVideo: vi.fn(async () => ({ width: 1080, height: 1920, duration_seconds: 30 })),
  };
});

vi.mock('@mesaas/ui/video/frame', () => {
  const extractVideoFrame = vi.fn();
  return {
    extractVideoFrame,
    extractVideoFrameWithTime: vi.fn(async (...args: unknown[]) => ({
      file: await extractVideoFrame(...args),
      timeSeconds: 0.5,
    })),
    captureFrameFromElement: vi.fn(),
  };
});

vi.mock('../../../../utils/imageJpeg', () => ({
  encodeImageAsJpeg: vi.fn((f: File) => Promise.resolve(f)),
}));

vi.mock('../PostMediaLightbox', () => ({
  PostMediaLightbox: () => null,
}));

vi.mock('../ThumbnailPickerDialog', () => ({
  ThumbnailPickerDialog: () => null,
}));

vi.mock('../../../arquivos/components/FilePickerModal', () => ({
  FilePickerModal: () => null,
}));

vi.mock('../../../../services/fileService', () => ({
  linkFileToPost: vi.fn(),
  unlinkFileFromPost: vi.fn(),
}));

const { downloadMediaMock, zipFileSpy } = vi.hoisted(() => ({
  downloadMediaMock: vi.fn(async () => undefined),
  zipFileSpy: vi.fn(),
}));

vi.mock('@/utils/downloadMedia', () => ({ downloadMedia: downloadMediaMock }));

vi.mock('jszip', () => ({
  default: class MockJSZip {
    file = zipFileSpy;
    async generateAsync() {
      return new Blob(['zip']);
    }
  },
}));

import { deletePostMedia, listPostMedia, reorderPostMedia } from '../../../../services/postMedia';
import type { PostMedia } from '../../../../store';
import { PostMediaGallery } from '../PostMediaGallery';
import { makeNote } from '../mediaNotes/__tests__/fixtures';
import { installPointerEvent } from '@/components/mobile/__tests__/pointer';

beforeAll(installPointerEvent);

const item = (id: number, name: string, sort: number) =>
  ({
    id,
    post_id: 42,
    conta_id: 'ws-1',
    r2_key: `k/${id}`,
    thumbnail_r2_key: null,
    kind: 'image',
    mime_type: 'image/jpeg',
    size_bytes: 10,
    original_filename: name,
    width: 1080,
    height: 1350,
    duration_seconds: null,
    is_cover: sort === 0,
    sort_order: sort,
    uploaded_by: null,
    created_at: '2026-10-01T00:00:00Z',
    url: `https://cdn.test/${id}.jpg`,
    media_lost_at: null,
  }) as unknown as PostMedia;

function renderPhoneGallery() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PostMediaGallery postId={42} variant="phone" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const tile = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) });

describe('PostMediaGallery, phone strip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listPostMedia).mockResolvedValue([item(1, 'a.jpg', 0), item(2, 'b.jpg', 1)]);
    vi.mocked(reorderPostMedia).mockResolvedValue(undefined as never);
    vi.mocked(deletePostMedia).mockResolvedValue(undefined as never);
  });

  it('shows the count, the cover badge and the add tile', async () => {
    renderPhoneGallery();
    await screen.findByRole('button', { name: /^a\.jpg \(capa\)/ });
    expect(screen.getByText(/^2 de /)).toBeInTheDocument();
    expect(screen.getByText('Capa')).toBeInTheDocument();
    expect(screen.getByText('Adicionar')).toBeInTheDocument();
  });

  it('the hold menu (here: right-click) offers the per-item actions; Definir como capa moves it first', async () => {
    renderPhoneGallery();
    await screen.findByRole('button', { name: /^b\.jpg/ });
    fireEvent.contextMenu(tile('b\\.jpg'));
    const menu = await screen.findByRole('dialog', { name: 'Ações de b.jpg' });
    const labels = within(menu)
      .getAllByRole('menuitem')
      .map((b) => b.textContent?.trim());
    expect(labels).toEqual([
      'Definir como capa',
      'Ajustar proporção',
      'Reordenar',
      'Baixar',
      'Remover',
    ]);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Definir como capa' }));
    await waitFor(() => expect(reorderPostMedia).toHaveBeenCalledWith(2, 0));
    expect(reorderPostMedia).toHaveBeenCalledWith(1, 1);
  });

  it('the cover itself has no "Definir como capa"; Remover deletes', async () => {
    renderPhoneGallery();
    await screen.findByRole('button', { name: /^a\.jpg/ });
    fireEvent.contextMenu(tile('a\\.jpg'));
    const menu = await screen.findByRole('dialog', { name: 'Ações de a.jpg' });
    expect(within(menu).queryByRole('menuitem', { name: 'Definir como capa' })).toBeNull();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Remover' }));
    await waitFor(() => expect(deletePostMedia).toHaveBeenCalledWith(1));
  });

  it('Reordenar switches to sortable tiles (no hold menu) until Concluir', async () => {
    renderPhoneGallery();
    await screen.findByRole('button', { name: /^b\.jpg/ });
    fireEvent.contextMenu(tile('b\\.jpg'));
    const menu = await screen.findByRole('dialog', { name: 'Ações de b.jpg' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Reordenar' }));
    const concluir = await screen.findByRole('button', { name: 'Concluir' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'b.jpg, posição 2' })).toBeInTheDocument();
    expect(screen.queryByText('Adicionar')).toBeNull();
    // No hold menu while reordering: holding is the drag.
    fireEvent.contextMenu(screen.getByRole('button', { name: 'b.jpg, posição 2' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => concluir.click());
    expect(await screen.findByText('Adicionar')).toBeInTheDocument();
  });
});

describe('PostMediaGallery, phone strip, open notes', () => {
  it('the tile button announces its open-note count', async () => {
    vi.mocked(listPostMedia).mockResolvedValue([item(1, 'a.jpg', 0), item(2, 'b.jpg', 1)]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <PostMediaGallery
            postId={42}
            variant="phone"
            notes={[
              makeNote({ id: 1, current_link_id: 2 }),
              makeNote({ id: 2, current_link_id: 2, visibility: 'internal', author_kind: 'team' }),
            ]}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(
      await screen.findByRole('button', { name: /^b\.jpg.*2 comentários em aberto/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^a\.jpg/ })).not.toHaveAccessibleName(/em aberto/);
  });
});

describe('PostMediaGallery, phone strip, oversized video', () => {
  it('the hold menu of a 4K video offers "Reduzir resolução" beside "Ajustar proporção"', async () => {
    vi.mocked(listPostMedia).mockResolvedValue([
      {
        ...item(9, 'uhd.mp4', 0),
        kind: 'video',
        mime_type: 'video/mp4',
        width: 2160,
        height: 3840,
        duration_seconds: 30,
      } as PostMedia,
    ]);
    renderPhoneGallery();
    await screen.findByRole('button', { name: /^uhd\.mp4/ });
    fireEvent.contextMenu(tile('uhd\\.mp4'));
    const menu = await screen.findByRole('dialog', { name: 'Ações de uhd.mp4' });
    const labels = within(menu)
      .getAllByRole('menuitem')
      .map((b) => b.textContent?.trim());
    expect(labels).toContain('Reduzir resolução');
    expect(labels).toContain('Ajustar proporção');
  });
});

describe('PostMediaGallery, phone strip, shape and video cover', () => {
  it('keeps the strip height and sizes each tile by its file shape', async () => {
    vi.mocked(listPostMedia).mockResolvedValue([item(1, 'a.jpg', 0)]);
    renderPhoneGallery();
    // 1080×1350 (4:5) at the 92px strip height.
    expect((await screen.findByRole('button', { name: /^a\.jpg/ })).style.width).toBe('74px');
  });

  it('shows the short cover state on a video and reads it in the tile name', async () => {
    vi.mocked(listPostMedia).mockResolvedValue([
      {
        ...item(9, 'reel.mp4', 0),
        kind: 'video',
        mime_type: 'video/mp4',
        width: 1080,
        height: 1920,
        duration_seconds: 20,
        thumbnail_url: 'https://cdn.test/9.jpg',
        thumbnail_source: 'frame',
        thumbnail_frame_ms: 12300,
      } as PostMedia,
    ]);
    renderPhoneGallery();
    const reel = await screen.findByRole('button', { name: /^reel\.mp4/ });
    expect(reel).toHaveAccessibleName(/, Capa 0:12\.3/);
    expect(reel).toHaveTextContent('0:12.3');
    expect(reel.querySelector('[data-custom-cover]')).not.toBeNull();
    expect(reel.style.width).toBe('52px');
  });
});
