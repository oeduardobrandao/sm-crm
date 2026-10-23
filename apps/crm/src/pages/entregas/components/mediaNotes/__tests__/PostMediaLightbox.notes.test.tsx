import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
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
    expect(screen.getByLabelText(/^Interno 1:/)).toBeInTheDocument();
  });

  const internalNote = (over = {}) =>
    makeNote({
      id: 20,
      visibility: 'internal',
      author_kind: 'team',
      body: 'Revisar o logo',
      ...over,
    });

  it('lists every internal note on the item, whole-slide ones included, with resolve and reopen', async () => {
    const onNoteStatus = vi.fn().mockResolvedValue(undefined);
    render(
      <PostMediaLightbox
        media={[image]}
        initialIndex={0}
        open
        onOpenChange={vi.fn()}
        onNoteStatus={onNoteStatus}
        notes={[
          internalNote({ id: 20, x: null, y: null, body: 'Nota do slide inteiro' }),
          internalNote({
            id: 21,
            x: 0.4,
            y: 0.4,
            status: 'resolved',
            body: 'Nota resolvida',
            created_at: '2026-10-22T11:00:00Z',
          }),
          internalNote({ id: 22, current_link_id: 6, body: 'Outro slide' }),
          makeNote({ id: 23, body: 'Nota do cliente' }),
        ]}
      />,
    );
    const list = screen.getByRole('region', { name: 'Notas internas (2)' });
    expect(list).toHaveTextContent('Nota do slide inteiro');
    expect(list).toHaveTextContent('Nota resolvida');
    expect(list).not.toHaveTextContent('Outro slide');
    expect(list).not.toHaveTextContent('Nota do cliente');

    await userEvent.click(within(list).getByRole('button', { name: 'Marcar como resolvido' }));
    expect(onNoteStatus).toHaveBeenCalledWith([20], 'resolved');
    await userEvent.click(within(list).getByRole('button', { name: 'Reabrir' }));
    expect(onNoteStatus).toHaveBeenCalledWith([21], 'open');
  });

  it('has no list when the item has no internal notes', () => {
    render(
      <PostMediaLightbox
        media={[image]}
        initialIndex={0}
        open
        onOpenChange={vi.fn()}
        notes={[makeNote({ id: 23 })]}
      />,
    );
    expect(screen.queryByRole('region', { name: /Notas internas/ })).not.toBeInTheDocument();
  });

  async function openComposer(onOpenChange = vi.fn()) {
    render(
      <PostMediaLightbox
        media={[image, image2]}
        initialIndex={0}
        open
        onOpenChange={onOpenChange}
        notes={[]}
        onCreateInternalNote={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Nota interna' }));
    await userEvent.click(screen.getByRole('button', { name: 'Comentar o slide inteiro' }));
    return onOpenChange;
  }

  it('Escape does not discard a note being typed', async () => {
    const onOpenChange = await openComposer();
    await userEvent.type(screen.getByLabelText('Nota interna'), 'Rascunho');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Nota interna')).toHaveValue('Rascunho');
  });

  it('Escape still closes when the composer is empty', async () => {
    const onOpenChange = await openComposer();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('previous and next are ignored while text is present; Cancelar then frees them', async () => {
    await openComposer();
    await userEvent.type(screen.getByLabelText('Nota interna'), 'Rascunho');
    await userEvent.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(screen.getByText('Nota interna no slide 1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    expect(screen.queryByText('Nota interna no slide 1')).not.toBeInTheDocument();
  });

  it('a failing save keeps the draft and shows a pt-BR toast, not the raw error', async () => {
    const onCreateInternalNote = vi
      .fn()
      .mockRejectedValue(new Error('new row violates row-level security policy for table'));
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
    await userEvent.type(screen.getByLabelText('Nota interna'), 'Texto');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar nota interna' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Não foi possível salvar a nota. Tente novamente.'),
    );
    expect(screen.getByLabelText('Nota interna')).toHaveValue('Texto');
  });
});
