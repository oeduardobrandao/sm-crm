import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostMediaPane } from '../PostMediaPane';
import type { HubMediaNote, HubPost, HubPostMedia } from '../../../types';

function m(id: number, over: Partial<HubPostMedia> = {}): HubPostMedia {
  return {
    id,
    post_id: 1,
    kind: 'image',
    mime_type: 'image/jpeg',
    url: `https://cdn/${id}.jpg`,
    thumbnail_url: null,
    width: 1080,
    height: 1350,
    duration_seconds: null,
    is_cover: false,
    sort_order: id,
    ...over,
  };
}

function post(over: Partial<HubPost> = {}): HubPost {
  return {
    id: 1,
    titulo: 'P',
    tipo: 'carrossel',
    status: 'enviado_cliente',
    ordem: 1,
    conteudo: null,
    conteudo_plain: '',
    scheduled_at: null,
    ig_caption: null,
    instagram_permalink: null,
    published_at: null,
    publish_error: null,
    workflow_id: null,
    workflow_titulo: null,
    workflow_created_at: null,
    media: [m(1), m(2), m(3)],
    cover_media: null,
    pending_suggestion: null,
    suggestion_rejected_at: null,
    ...over,
  };
}

describe('PostMediaPane', () => {
  it('renders every slide and advances with the on-media arrow', () => {
    render(<PostMediaPane post={post()} onOpenLightbox={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: /Abrir mídia/ })).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Slide anterior' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Próximo slide' }));
    expect(screen.getByRole('button', { name: 'Slide anterior' })).toBeInTheDocument();
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });

  it('opens the lightbox at the clicked slide', () => {
    const onOpenLightbox = vi.fn();
    render(<PostMediaPane post={post()} onOpenLightbox={onOpenLightbox} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir mídia 2' }));
    expect(onOpenLightbox).toHaveBeenCalledWith(1);
  });

  it('renders story frames with tap zones', () => {
    render(
      <PostMediaPane
        post={post({ tipo: 'stories', media: [m(1), m(2)] })}
        onOpenLightbox={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
  });

  it('story: a right tap advances, and on the last frame opens the lightbox instead of no-op', () => {
    const onOpenLightbox = vi.fn();
    render(
      <PostMediaPane
        post={post({ tipo: 'stories', media: [m(1), m(2)] })}
        onOpenLightbox={onOpenLightbox}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(onOpenLightbox).not.toHaveBeenCalled();
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(onOpenLightbox).toHaveBeenCalledTimes(1);
    expect(onOpenLightbox).toHaveBeenCalledWith(1);
  });

  it('shows MediaUnavailable for a lost file', () => {
    render(
      <PostMediaPane
        post={post({ media: [m(1, { media_lost_at: '2026-08-01T00:00:00Z' })] })}
        onOpenLightbox={vi.fn()}
      />,
    );
    expect(screen.getByText('Mídia indisponível')).toBeInTheDocument();
  });

  // jsdom has no IntersectionObserver, so VideoPrewarm warms immediately and
  // the hidden <video> carries the src the pane handed it.
  describe('video prewarm', () => {
    const video = (id: number) =>
      m(id, {
        kind: 'video',
        mime_type: 'video/quicktime',
        url: `https://cdn.example.com/${id}.mov`,
        thumbnail_url: `https://cdn.example.com/${id}-thumb.jpg`,
      });

    it('prewarms the post video so the lightbox opens without stutter', () => {
      const { container } = render(
        <PostMediaPane
          post={post({ tipo: 'reels', media: [video(5)] })}
          onOpenLightbox={vi.fn()}
        />,
      );
      expect(container.querySelector('video')).toHaveAttribute(
        'src',
        'https://cdn.example.com/5.mov',
      );
    });

    it('prewarms the story video in the story layout', () => {
      const { container } = render(
        <PostMediaPane
          post={post({ tipo: 'stories', media: [video(6)] })}
          onOpenLightbox={vi.fn()}
        />,
      );
      expect(container.querySelector('video')).toHaveAttribute(
        'src',
        'https://cdn.example.com/6.mov',
      );
    });

    it('does not prewarm anything for an image-only post', () => {
      const { container } = render(<PostMediaPane post={post()} onOpenLightbox={vi.fn()} />);
      expect(container.querySelector('video')).toBeNull();
    });

    it('does not prewarm anything for an image-only story', () => {
      const { container } = render(
        <PostMediaPane
          post={post({ tipo: 'stories', media: [m(1), m(2)] })}
          onOpenLightbox={vi.fn()}
        />,
      );
      expect(container.querySelector('video')).toBeNull();
    });
  });

  describe('media notes', () => {
    const HINT = 'Toque na imagem para marcar um ponto';

    function note(over: Partial<HubMediaNote> = {}): HubMediaNote {
      return {
        id: 1,
        post_id: 1,
        media_kind: 'image',
        link_id: 1,
        slide_index: 0,
        is_previous_version: false,
        t_seconds: null,
        x: 0.5,
        y: 0.5,
        author: 'client',
        author_name: null,
        body: 'Trocar a cor',
        status: 'open',
        resolved_at: null,
        created_at: '2026-10-23T00:00:00Z',
        replies: [],
        ...over,
      };
    }

    // jsdom has no PointerEvent: a MouseEvent named like one carries clientX/clientY.
    const pointer = (el: Element, type: string, x: number, y: number) =>
      fireEvent(el, new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));

    beforeEach(() => {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        right: 400,
        bottom: 400,
        width: 400,
        height: 400,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
    });
    afterEach(() => vi.restoreAllMocks());

    it('placing disables lightbox on tap and places a pin', () => {
      const onOpenLightbox = vi.fn();
      const onPlace = vi.fn();
      render(
        <PostMediaPane post={post()} onOpenLightbox={onOpenLightbox} placing onPlace={onPlace} />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Abrir mídia 1' }));
      expect(onOpenLightbox).not.toHaveBeenCalled();
      const capture = screen.getByRole('button', { name: HINT });
      pointer(capture, 'pointerdown', 200, 200);
      pointer(capture, 'pointerup', 200, 200);
      expect(onPlace).toHaveBeenCalledWith(1, { x: 0.5, y: 0.5 });
    });

    it('swipe in placing mode changes slide without placing', () => {
      const onPlace = vi.fn();
      const { container } = render(
        <PostMediaPane post={post()} onOpenLightbox={vi.fn()} placing onPlace={onPlace} />,
      );
      const capture = screen.getByRole('button', { name: HINT });
      pointer(capture, 'pointerdown', 300, 200);
      pointer(capture, 'pointermove', 240, 200);
      // Once the swipe is decided the pane captures the pointer, so the release lands on the
      // viewport (jsdom has no pointer capture) and the unmounted capture button never sees it.
      pointer(container.firstElementChild!, 'pointerup', 240, 200);
      expect(screen.getByText('2 / 3')).toBeInTheDocument();
      expect(onPlace).not.toHaveBeenCalled();
    });

    it('story tap zones are disabled while placing', () => {
      render(
        <PostMediaPane
          post={post({ tipo: 'stories', media: [m(1), m(2)] })}
          onOpenLightbox={vi.fn()}
          placing
        />,
      );
      expect(screen.getByRole('button', { name: 'Próximo' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
      expect(screen.getByRole('button', { name: HINT })).toBeInTheDocument();
    });

    it('a story frame accepts a pin while placing', () => {
      const onPlace = vi.fn();
      render(
        <PostMediaPane
          post={post({ tipo: 'stories', media: [m(1), m(2)] })}
          onOpenLightbox={vi.fn()}
          placing
          onPlace={onPlace}
        />,
      );
      const capture = screen.getByRole('button', { name: HINT });
      pointer(capture, 'pointerdown', 200, 200);
      pointer(capture, 'pointerup', 200, 200);
      expect(onPlace).toHaveBeenCalledWith(1, { x: 0.5, y: 0.5 });
    });

    it('video slides never enter placing mode', () => {
      render(
        <PostMediaPane
          post={post({
            tipo: 'reels',
            media: [m(1, { kind: 'video', thumbnail_url: 'https://cdn/t.jpg' })],
          })}
          onOpenLightbox={vi.fn()}
          placing
        />,
      );
      expect(screen.queryByRole('button', { name: HINT })).toBeNull();
    });

    it('slide badge shows open count', () => {
      render(
        <PostMediaPane
          post={post()}
          onOpenLightbox={vi.fn()}
          notes={[
            note({ id: 1, link_id: 1 }),
            note({ id: 2, link_id: 1 }),
            note({ id: 3, link_id: 1, status: 'resolved' }),
            note({ id: 4, link_id: 2 }),
          ]}
        />,
      );
      expect(screen.getByTestId('slide-open-badge')).toHaveTextContent('2 em aberto');
      fireEvent.click(screen.getByRole('button', { name: 'Próximo slide' }));
      expect(screen.getByTestId('slide-open-badge')).toHaveTextContent('1 em aberto');
      fireEvent.click(screen.getByRole('button', { name: 'Próximo slide' }));
      expect(screen.queryByTestId('slide-open-badge')).toBeNull();
    });

    it('shows only the current slide pins, with no capture button outside placing', () => {
      render(
        <PostMediaPane
          post={post()}
          onOpenLightbox={vi.fn()}
          notes={[
            note({ id: 1, link_id: 1, body: 'No um' }),
            note({ id: 2, link_id: 2, body: 'No dois' }),
          ]}
        />,
      );
      expect(screen.getByRole('img', { name: 'No um' })).toBeInTheDocument();
      expect(screen.queryByRole('img', { name: 'No dois' })).toBeNull();
      expect(screen.queryByRole('button', { name: HINT })).toBeNull();
    });

    it('reports the current slide and honours jumpTo', () => {
      const currentIndexChange = vi.fn();
      const { rerender } = render(
        <PostMediaPane
          post={post()}
          onOpenLightbox={vi.fn()}
          currentIndexChange={currentIndexChange}
        />,
      );
      expect(currentIndexChange).toHaveBeenLastCalledWith(0);
      rerender(
        <PostMediaPane
          post={post()}
          onOpenLightbox={vi.fn()}
          currentIndexChange={currentIndexChange}
          jumpTo={{ linkId: 3, seq: 1 }}
        />,
      );
      expect(screen.getByText('3 / 3')).toBeInTheDocument();
      expect(currentIndexChange).toHaveBeenLastCalledWith(2);
    });
  });
});
