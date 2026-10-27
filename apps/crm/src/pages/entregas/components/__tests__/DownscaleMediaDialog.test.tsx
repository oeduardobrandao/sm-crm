import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostMedia } from '@/store';

const m = vi.hoisted(() => ({
  fetchMediaFile: vi.fn(),
  downscaleVideo: vi.fn(),
  replacePostMedia: vi.fn(),
  encodeImageAsJpeg: vi.fn(),
  extractVideoFrame: vi.fn(),
  fetchWithRetry: vi.fn(),
  captureEvent: vi.fn(),
  trackUnsavedWork: vi.fn((p: Promise<unknown>) => p),
  toast: { success: vi.fn(), error: vi.fn() },
  confirmClose: [] as unknown[],
}));

vi.mock('sonner', () => ({ toast: m.toast }));
vi.mock('@/lib/analytics', () => ({ captureEvent: m.captureEvent }));
vi.mock('@mesaas/app-lifecycle', () => ({ trackUnsavedWork: m.trackUnsavedWork }));
vi.mock('@/services/mediaAdjustment', () => ({ replacePostMedia: m.replacePostMedia }));
vi.mock('@/utils/imageJpeg', () => ({ encodeImageAsJpeg: m.encodeImageAsJpeg }));
vi.mock('@/utils/fetchWithRetry', () => ({ fetchWithRetry: m.fetchWithRetry }));
vi.mock('@mesaas/ui/video/frame', () => ({ extractVideoFrame: m.extractVideoFrame }));
vi.mock('../../media-editor/fetchMediaFile', () => ({ fetchMediaFile: m.fetchMediaFile }));
vi.mock('../../media-editor/downscaleVideo', () => ({ downscaleVideo: m.downscaleVideo }));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({
    confirmClose,
    children,
  }: {
    confirmClose?: boolean;
    children: React.ReactNode;
  }) => {
    m.confirmClose.push(confirmClose);
    return <div data-confirm-close={String(!!confirmClose)}>{children}</div>;
  },
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

import { DownscaleMediaDialog } from '../DownscaleMediaDialog';

const media = {
  id: 7,
  kind: 'video',
  mime_type: 'video/mp4',
  size_bytes: 200 * 1024 * 1024,
  original_filename: 'clip.mp4',
  width: 2160,
  height: 3840,
  duration_seconds: 30,
  url: 'https://x/clip.mp4',
  thumbnail_url: 'https://x/thumb.jpg',
} as unknown as PostMedia;

const source = new File(['a'], 'clip.mp4', { type: 'video/mp4' });
const output = new File(['b'], 'clip (1080p).mp4', { type: 'video/mp4' });
const jpeg = new File(['j'], 'cover.jpg', { type: 'image/jpeg' });
const frame = new File(['f'], 'frame.jpg', { type: 'image/jpeg' });

function setup() {
  const onOpenChange = vi.fn();
  const onDone = vi.fn();
  render(
    <DownscaleMediaDialog
      media={media}
      forStories={false}
      onOpenChange={onOpenChange}
      onDone={onDone}
    />,
  );
  return { onOpenChange, onDone };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.confirmClose.length = 0;
  m.fetchMediaFile.mockResolvedValue(source);
  m.downscaleVideo.mockResolvedValue({
    file: output,
    engine: 'webcodecs',
    hdr: false,
    width: 1080,
    height: 1920,
  });
  m.replacePostMedia.mockResolvedValue(undefined);
  m.fetchWithRetry.mockResolvedValue({ ok: true, blob: async () => new Blob(['t']) });
  m.encodeImageAsJpeg.mockResolvedValue(jpeg);
  m.extractVideoFrame.mockResolvedValue(frame);
});

describe('DownscaleMediaDialog', () => {
  it('downloads, converts, replaces and reports done', async () => {
    const order: string[] = [];
    m.fetchMediaFile.mockImplementation(async () => (order.push('download'), source));
    m.downscaleVideo.mockImplementation(async () => {
      order.push('convert');
      return { file: output, engine: 'webcodecs', hdr: false, width: 1080, height: 1920 };
    });
    m.replacePostMedia.mockImplementation(async () => void order.push('save'));
    const { onDone } = setup();
    expect(screen.getByText('Baixando…')).toBeInTheDocument();
    expect(screen.getByText('Convertendo…')).toBeInTheDocument();
    expect(screen.getByText('Salvando…')).toBeInTheDocument();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(order).toEqual(['download', 'convert', 'save']);
    expect(m.replacePostMedia).toHaveBeenCalledWith(
      media,
      output,
      jpeg,
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(m.toast.success).toHaveBeenCalledWith('Vídeo reduzido para 1080×1920.');
    expect(m.trackUnsavedWork).toHaveBeenCalled();
    expect(m.captureEvent).toHaveBeenCalledWith(
      'video_downscaled',
      expect.objectContaining({ source: 'warning', outcome: 'ok' }),
    );
  });

  it('falls back to a frame of the output when the thumbnail fetch fails', async () => {
    m.fetchWithRetry.mockRejectedValue(new Error('x'));
    const { onDone } = setup();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(m.extractVideoFrame).toHaveBeenCalledWith(output);
    expect(m.replacePostMedia.mock.calls[0]![2]).toBe(frame);
  });

  it('cancel during convert aborts and never saves; cancel hidden while saving', async () => {
    let signal!: AbortSignal;
    m.downscaleVideo.mockImplementation(
      (_f: File, _p: unknown, o: { signal: AbortSignal }) =>
        new Promise((_, rej) => {
          signal = o.signal;
          o.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
        }),
    );
    const { onOpenChange } = setup();
    const cancel = await screen.findByRole('button', { name: 'Cancelar' });
    expect(document.querySelector('[data-confirm-close="true"]')).toBeTruthy();
    fireEvent.click(cancel);
    await waitFor(() => expect(signal.aborted).toBe(true));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(m.replacePostMedia).not.toHaveBeenCalled();
    expect(m.captureEvent).toHaveBeenCalledWith(
      'video_downscaled',
      expect.objectContaining({ outcome: 'cancelled' }),
    );
  });

  it('hides Cancel during the save stage', async () => {
    m.replacePostMedia.mockImplementation(() => new Promise(() => {}));
    setup();
    await waitFor(() => expect(m.replacePostMedia).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
    expect(document.querySelector('[data-confirm-close="true"]')).toBeTruthy();
  });

  it('shows replaceOrphan when the replace fails', async () => {
    m.replacePostMedia.mockRejectedValue(new Error('boom'));
    setup();
    await waitFor(() =>
      expect(m.toast.error).toHaveBeenCalledWith(
        'Não foi possível substituir a mídia. A versão reduzida ficou em Arquivos.',
      ),
    );
    expect(m.captureEvent).toHaveBeenCalledWith(
      'video_downscaled',
      expect.objectContaining({ outcome: 'error' }),
    );
  });

  it('shows convertFailedNoFallback when conversion fails and does not save', async () => {
    m.downscaleVideo.mockRejectedValue(new Error('nope'));
    setup();
    await waitFor(() =>
      expect(m.toast.error).toHaveBeenCalledWith('clip.mp4: não foi possível reduzir o vídeo.'),
    );
    expect(m.replacePostMedia).not.toHaveBeenCalled();
  });

  it('reports unsupported when the engine is unavailable', async () => {
    const err = new Error('x');
    err.name = 'EngineUnavailable';
    m.downscaleVideo.mockRejectedValue(err);
    setup();
    await waitFor(() =>
      expect(m.captureEvent).toHaveBeenCalledWith(
        'video_downscaled',
        expect.objectContaining({ outcome: 'unsupported' }),
      ),
    );
    await act(async () => {});
  });

  it('does not restart when media is replaced by a new object of the same id mid-convert', async () => {
    let signal!: AbortSignal;
    let finish!: (v: unknown) => void;
    m.downscaleVideo.mockImplementation(
      (_f: File, _p: unknown, o: { signal: AbortSignal }) =>
        new Promise((res) => {
          signal = o.signal;
          finish = res;
        }),
    );
    const props = { forStories: false, onOpenChange: vi.fn(), onDone: vi.fn() };
    const { rerender } = render(<DownscaleMediaDialog media={media} {...props} />);
    await waitFor(() => expect(m.downscaleVideo).toHaveBeenCalled());
    rerender(<DownscaleMediaDialog media={{ ...media, url: 'https://x/new.mp4' }} {...props} />);
    await act(async () => {});
    expect(m.downscaleVideo).toHaveBeenCalledTimes(1);
    expect(m.fetchMediaFile).toHaveBeenCalledTimes(1);
    expect(signal.aborted).toBe(false);
    finish({ file: output, engine: 'webcodecs', hdr: false, width: 1080, height: 1920 });
    await waitFor(() => expect(props.onDone).toHaveBeenCalled());
  });
});
