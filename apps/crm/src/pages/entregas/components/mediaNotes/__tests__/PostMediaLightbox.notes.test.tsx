import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PostMedia } from '@/store/posts';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock('@/utils/downloadMedia', () => ({ downloadMedia: vi.fn() }));

const player = vi.hoisted(() => ({ el: null as HTMLVideoElement | null }));
vi.mock('@mesaas/ui/VideoPlayer', () => ({
  VideoPlayer: ({ onVideoElement }: { onVideoElement?: (el: HTMLVideoElement | null) => void }) => {
    useEffect(() => {
      if (player.el) onVideoElement?.(player.el);
    }, [onVideoElement]);
    return <div data-testid="video-stub" />;
  },
}));

import { PostMediaLightbox } from '../../PostMediaLightbox';
import { makeNote } from './fixtures';

const image = {
  id: 5,
  post_id: 42,
  kind: 'image',
  original_filename: 'a.jpg',
  url: 'https://example.test/a.jpg',
  width: 1000,
  height: 500,
} as PostMedia;
const image2 = { ...image, id: 6, original_filename: 'b.jpg' } as PostMedia;
const video = {
  id: 9,
  post_id: 42,
  kind: 'video',
  original_filename: 'v.mp4',
  url: 'https://example.test/v.mp4',
  width: 400,
  height: 400,
} as PostMedia;

function mockBox(width: number, height: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
}

describe('PostMediaLightbox internal notes', () => {
  beforeEach(() => {
    mockBox(400, 400);
    player.el = null;
  });
  afterEach(() => vi.restoreAllMocks());

  it('internal note sends link id and coords (letterboxed rect)', async () => {
    const onCreateInternalNote = vi.fn().mockResolvedValue(undefined);
    render(
      <PostMediaLightbox
        media={[image, image2]}
        initialIndex={1}
        open
        onOpenChange={vi.fn()}
        notes={[]}
        onCreateInternalNote={onCreateInternalNote}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Nota interna' }));
    // Click in the letterbox (above the rendered 400x200 image): ignored.
    fireEvent.click(screen.getByTestId('crm-pin-layer'), { clientX: 200, clientY: 20 });
    expect(screen.queryByText('Nota interna no slide 2')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('crm-pin-layer'), { clientX: 100, clientY: 200 });

    expect(screen.getByText('Nota interna no slide 2')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Nota interna'), 'Revisar o logo');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar nota interna' }));

    await waitFor(() =>
      expect(onCreateInternalNote).toHaveBeenCalledWith({
        linkId: 6,
        x: 0.25,
        y: 0.5,
        body: 'Revisar o logo',
      }),
    );
  });

  it('can add an internal note without a spot', async () => {
    const onCreateInternalNote = vi.fn().mockResolvedValue(undefined);
    render(
      <PostMediaLightbox
        media={[image]}
        initialIndex={0}
        open
        onOpenChange={vi.fn()}
        notes={[]}
        onCreateInternalNote={onCreateInternalNote}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Nota interna' }));
    await userEvent.click(screen.getByRole('button', { name: 'Comentar o slide inteiro' }));
    await userEvent.type(screen.getByLabelText('Nota interna'), 'Sem ponto');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar nota interna' }));
    await waitFor(() =>
      expect(onCreateInternalNote).toHaveBeenCalledWith({ linkId: 5, body: 'Sem ponto' }),
    );
  });

  it('video: pauses and sends t_seconds from the player', async () => {
    const el = document.createElement('video');
    Object.defineProperty(el, 'currentTime', { value: 12.5, configurable: true });
    Object.defineProperty(el, 'videoWidth', { value: 400, configurable: true });
    Object.defineProperty(el, 'videoHeight', { value: 400, configurable: true });
    el.pause = vi.fn();
    player.el = el;
    const onCreateInternalNote = vi.fn().mockResolvedValue(undefined);
    render(
      <PostMediaLightbox
        media={[video]}
        initialIndex={0}
        open
        onOpenChange={vi.fn()}
        notes={[]}
        onCreateInternalNote={onCreateInternalNote}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Nota interna' }));
    expect(el.pause).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('crm-pin-layer'), { clientX: 200, clientY: 100 });
    expect(screen.getByText('Nota interna em 0:12')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Nota interna'), 'Cortar aqui');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar nota interna' }));
    await waitFor(() =>
      expect(onCreateInternalNote).toHaveBeenCalledWith({
        linkId: 9,
        tSeconds: 12.5,
        x: 0.5,
        y: 0.25,
        body: 'Cortar aqui',
      }),
    );
  });

  it('does not offer internal notes without the handler', () => {
    render(<PostMediaLightbox media={[image]} initialIndex={0} open onOpenChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Nota interna' })).not.toBeInTheDocument();
  });

  it('arrow keys in the composer do not change the slide', async () => {
    render(
      <PostMediaLightbox
        media={[image, image2]}
        initialIndex={0}
        open
        onOpenChange={vi.fn()}
        notes={[]}
        onCreateInternalNote={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Nota interna' }));
    await userEvent.click(screen.getByRole('button', { name: 'Comentar o slide inteiro' }));
    await userEvent.type(screen.getByLabelText('Nota interna'), 'ab{ArrowRight}{ArrowLeft}');
    expect(screen.getByText('Nota interna no slide 1')).toBeInTheDocument();
  });

  it('shows the pins of the current item with the Interno label', () => {
    render(
      <PostMediaLightbox
        media={[image]}
        initialIndex={0}
        open
        onOpenChange={vi.fn()}
        notes={[
          makeNote({ id: 1, x: 0.5, y: 0.5 }),
          makeNote({
            id: 2,
            x: 0.1,
            y: 0.1,
            visibility: 'internal',
            author_kind: 'team',
            created_at: '2026-10-22T11:00:00Z',
          }),
        ]}
      />,
    );
    expect(screen.getByLabelText(/^Ponto 1:/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Interno · ponto 2:/)).toBeInTheDocument();
  });
});
