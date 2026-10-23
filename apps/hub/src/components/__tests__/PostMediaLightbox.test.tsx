import { Profiler } from 'react';
import { flushSync } from 'react-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostMediaLightbox } from '../PostMediaLightbox';
import type { HubMediaNote, HubPostMedia } from '../../types';

// VideoPlayer (packages/ui/VideoPlayer) is the component under test here by
// proxy -- these tests only need to prove the lightbox wires hlsSrc/src/
// onFatalError correctly, so hls.js itself is never exercised. Stubbing
// canPlayType to 'probably' keeps every playback-bearing case on the
// synchronous native-HLS path, mirroring the pattern in
// packages/ui/VideoPlayer/__tests__/index.test.tsx.
function stubCanPlayType(returnValue: string) {
  HTMLMediaElement.prototype.canPlayType = vi.fn(() => returnValue) as unknown as (
    type: string,
  ) => CanPlayTypeResult;
}

function makeMedia(overrides: Partial<HubPostMedia> = {}): HubPostMedia {
  return {
    id: 1,
    post_id: 7,
    kind: 'image',
    mime_type: 'image/jpeg',
    url: 'https://cdn.example.com/image-1.jpg',
    thumbnail_url: null,
    width: 1080,
    height: 1350,
    duration_seconds: null,
    is_cover: false,
    sort_order: 0,
    ...overrides,
  };
}

describe('PostMediaLightbox', () => {
  afterEach(() => {
    delete (HTMLMediaElement.prototype as { canPlayType?: unknown }).canPlayType;
  });

  it('navigates with buttons and keyboard, updates the counter, and supports all close controls', () => {
    const onClose = vi.fn();
    const media = [
      makeMedia({ id: 1, url: 'https://cdn.example.com/image-1.jpg' }),
      makeMedia({ id: 2, url: 'https://cdn.example.com/image-2.jpg' }),
      makeMedia({ id: 3, url: 'https://cdn.example.com/image-3.jpg' }),
    ];

    render(<PostMediaLightbox media={media} initialIndex={1} onClose={onClose} />);

    expect(document.body.querySelector('img')).toHaveAttribute(
      'src',
      'https://cdn.example.com/image-2.jpg',
    );
    expect(screen.getByText('2 / 3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));

    expect(document.body.querySelector('img')).toHaveAttribute(
      'src',
      'https://cdn.example.com/image-3.jpg',
    );
    expect(screen.getByText('3 / 3')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'ArrowRight' });

    expect(document.body.querySelector('img')).toHaveAttribute(
      'src',
      'https://cdn.example.com/image-1.jpg',
    );
    expect(screen.getByText('1 / 3')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'ArrowLeft' });

    expect(document.body.querySelector('img')).toHaveAttribute(
      'src',
      'https://cdn.example.com/image-3.jpg',
    );
    expect(screen.getByText('3 / 3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('changes media on horizontal swipes and ignores vertical-dominant gestures', () => {
    const media = [
      makeMedia({ id: 1, url: 'https://cdn.example.com/image-1.jpg' }),
      makeMedia({ id: 2, url: 'https://cdn.example.com/image-2.jpg' }),
    ];

    render(<PostMediaLightbox media={media} initialIndex={0} onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog');

    expect(document.body.querySelector('img')).toHaveAttribute(
      'src',
      'https://cdn.example.com/image-1.jpg',
    );

    fireEvent.touchStart(dialog, {
      touches: [{ clientX: 220, clientY: 120 }],
    });
    fireEvent.touchEnd(dialog, {
      changedTouches: [{ clientX: 120, clientY: 110 }],
    });

    expect(document.body.querySelector('img')).toHaveAttribute(
      'src',
      'https://cdn.example.com/image-2.jpg',
    );

    fireEvent.touchStart(dialog, {
      touches: [{ clientX: 220, clientY: 120 }],
    });
    fireEvent.touchEnd(dialog, {
      changedTouches: [{ clientX: 140, clientY: 260 }],
    });

    expect(document.body.querySelector('img')).toHaveAttribute(
      'src',
      'https://cdn.example.com/image-2.jpg',
    );

    fireEvent.touchStart(dialog, {
      touches: [{ clientX: 120, clientY: 120 }],
    });
    fireEvent.touchEnd(dialog, {
      changedTouches: [{ clientX: 210, clientY: 130 }],
    });

    expect(document.body.querySelector('img')).toHaveAttribute(
      'src',
      'https://cdn.example.com/image-1.jpg',
    );
  });

  it('eagerly buffers the open video so playback starts without stutter', () => {
    render(
      <PostMediaLightbox
        media={[
          makeMedia({
            id: 9,
            kind: 'video',
            mime_type: 'video/quicktime',
            url: 'https://cdn.example.com/video.mov',
            thumbnail_url: 'https://cdn.example.com/video-thumb.jpg',
          }),
        ]}
        initialIndex={0}
        onClose={vi.fn()}
      />,
    );

    expect(document.body.querySelector('video')).toHaveAttribute('preload', 'auto');
  });

  it('calls the stale URL callback when image and video media fail to load', () => {
    const onStaleUrl = vi.fn();
    const onClose = vi.fn();

    const { rerender } = render(
      <PostMediaLightbox
        media={[makeMedia({ id: 1, url: 'https://cdn.example.com/image-1.jpg' })]}
        initialIndex={0}
        onClose={onClose}
        onStaleUrl={onStaleUrl}
      />,
    );

    const image = document.body.querySelector('img');

    if (!image) {
      throw new Error('Image media was not rendered');
    }

    fireEvent.error(image);

    rerender(
      <PostMediaLightbox
        media={[
          makeMedia({
            id: 2,
            kind: 'video',
            mime_type: 'video/mp4',
            url: 'https://cdn.example.com/video.mp4',
            thumbnail_url: 'https://cdn.example.com/video-thumb.jpg',
          }),
        ]}
        initialIndex={0}
        onClose={onClose}
        onStaleUrl={onStaleUrl}
      />,
    );

    const video = document.body.querySelector('video');

    if (!video) {
      throw new Error('Video media was not rendered');
    }

    fireEvent.error(video);

    expect(onStaleUrl).toHaveBeenCalledTimes(2);
  });

  it('plays the HLS manifest through VideoPlayer when media has a playback field', () => {
    stubCanPlayType('probably');

    render(
      <PostMediaLightbox
        media={[
          makeMedia({
            id: 4,
            kind: 'video',
            mime_type: 'video/mp4',
            url: 'https://cdn.example.com/video.mp4',
            thumbnail_url: 'https://cdn.example.com/video-thumb.jpg',
            playback: {
              hls: 'https://videodelivery.example.com/abc123/manifest/video.m3u8',
              expires_at: '2026-08-13T12:00:00Z',
            },
          }),
        ]}
        initialIndex={0}
        onClose={vi.fn()}
      />,
    );

    const video = document.body.querySelector('video');
    expect(video).toHaveAttribute(
      'src',
      'https://videodelivery.example.com/abc123/manifest/video.m3u8',
    );
  });

  it('renders the plain progressive src, unchanged, when media has no playback field', () => {
    render(
      <PostMediaLightbox
        media={[
          makeMedia({
            id: 5,
            kind: 'video',
            mime_type: 'video/mp4',
            url: 'https://cdn.example.com/video.mp4',
            thumbnail_url: 'https://cdn.example.com/video-thumb.jpg',
          }),
        ]}
        initialIndex={0}
        onClose={vi.fn()}
      />,
    );

    const video = document.body.querySelector('video');
    expect(video).toHaveAttribute('src', 'https://cdn.example.com/video.mp4');
  });

  it('routes only the fallback-mode fatal error to onStaleUrl, not the initial HLS error', () => {
    stubCanPlayType('probably');
    const onStaleUrl = vi.fn();

    render(
      <PostMediaLightbox
        media={[
          makeMedia({
            id: 6,
            kind: 'video',
            mime_type: 'video/mp4',
            url: 'https://cdn.example.com/video.mp4',
            thumbnail_url: 'https://cdn.example.com/video-thumb.jpg',
            playback: {
              hls: 'https://videodelivery.example.com/abc123/manifest/video.m3u8',
              expires_at: '2026-08-13T12:00:00Z',
            },
          }),
        ]}
        initialIndex={0}
        onClose={vi.fn()}
        onStaleUrl={onStaleUrl}
      />,
    );

    const hlsVideo = document.body.querySelector('video');
    expect(hlsVideo).toHaveAttribute(
      'src',
      'https://videodelivery.example.com/abc123/manifest/video.m3u8',
    );

    // First error is on the native-HLS source: VideoPlayer still has the
    // progressive fallback left to try, so it swaps sources silently.
    fireEvent.error(hlsVideo as HTMLVideoElement);

    const fallbackVideo = document.body.querySelector('video');
    expect(fallbackVideo).toHaveAttribute('src', 'https://cdn.example.com/video.mp4');
    expect(onStaleUrl).not.toHaveBeenCalled();

    // Second error is on the fallback itself: nothing left to try, so this
    // is the one that should trigger the parent's refetch.
    fireEvent.error(fallbackVideo as HTMLVideoElement);

    expect(onStaleUrl).toHaveBeenCalledTimes(1);
  });

  it('shows the unavailable placeholder instead of a broken image for a permanently lost item', () => {
    const media = [makeMedia({ id: 1, media_lost_at: '2026-08-14T03:00:00.000Z', url: null })];
    render(<PostMediaLightbox media={media} initialIndex={0} onClose={vi.fn()} />);
    expect(screen.getByText('Mídia indisponível')).toBeInTheDocument();
    expect(document.body.querySelector('img')).not.toBeInTheDocument();
  });
});

describe('PostMediaLightbox media notes', () => {
  const HINT = 'Toque na imagem para marcar um ponto';
  const PH = 'O que você quer mudar aqui?';

  function video(over: Partial<HubPostMedia> = {}) {
    return makeMedia({
      id: 5,
      kind: 'video',
      mime_type: 'video/mp4',
      url: 'https://cdn.example.com/v.mp4',
      width: 1000,
      height: 1000,
      ...over,
    });
  }

  function note(over: Partial<HubMediaNote> = {}): HubMediaNote {
    return {
      id: 1,
      post_id: 7,
      media_kind: 'video',
      link_id: 5,
      slide_index: 0,
      is_previous_version: false,
      t_seconds: 25,
      x: null,
      y: null,
      author: 'client',
      author_name: null,
      body: 'Cena',
      status: 'open',
      resolved_at: null,
      created_at: '2026-10-23T00:00:00Z',
      replies: [],
      ...over,
    };
  }

  /** jsdom's media element has no playback: give the mounted <video> a clock. */
  function clock() {
    const el = document.querySelector('video')!;
    let ct = 0;
    Object.defineProperty(el, 'currentTime', {
      configurable: true,
      get: () => ct,
      set: (v: number) => {
        ct = v;
      },
    });
    Object.defineProperty(el, 'duration', { configurable: true, get: () => 100 });
    fireEvent(el, new Event('loadedmetadata'));
    return {
      el,
      setTime(v: number) {
        ct = v;
        fireEvent(el, new Event('timeupdate'));
      },
      get time() {
        return ct;
      },
    };
  }

  const pointer = (el: Element, type: string, x: number, y: number) =>
    fireEvent(el, new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));

  beforeEach(() => {
    stubCanPlayType('');
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
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
  afterEach(() => {
    vi.restoreAllMocks();
    delete (HTMLMediaElement.prototype as { canPlayType?: unknown }).canPlayType;
  });

  function renderVideo(props: Partial<React.ComponentProps<typeof PostMediaLightbox>> = {}) {
    const onCreateNote = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const onOverlayChange = vi.fn();
    render(
      <PostMediaLightbox
        media={[video()]}
        initialIndex={0}
        onClose={onClose}
        notes={[]}
        canWrite
        onCreateNote={onCreateNote}
        onOverlayChange={onOverlayChange}
        {...props}
      />,
    );
    return { onCreateNote, onClose, onOverlayChange };
  }

  it('Comentar em pauses and passes current time', async () => {
    const { onCreateNote } = renderVideo();
    const c = clock();
    c.setTime(42);
    fireEvent.click(screen.getByRole('button', { name: 'Comentar em 0:42' }));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    fireEvent.change(await screen.findByPlaceholderText(PH), {
      target: { value: 'Mais contraste' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar comentário' }));
    await waitFor(() =>
      expect(onCreateNote).toHaveBeenCalledWith({
        link_id: 5,
        t_seconds: 42,
        body: 'Mais contraste',
      }),
    );
  });

  it('tapping the frame pauses, places a pending pin and comments on the moment and spot', async () => {
    const { onCreateNote } = renderVideo();
    const c = clock();
    c.setTime(42);
    const capture = screen.getByRole('button', { name: HINT });
    pointer(capture, 'pointerdown', 200, 100);
    pointer(capture, 'pointerup', 200, 100);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(screen.getByTestId('media-pin-pending')).toBeInTheDocument();
    expect(
      await screen.findByRole('textbox', { name: 'Comentário em 0:42, no ponto marcado' }),
    ).toBeInTheDocument();
    fireEvent.change(await screen.findByPlaceholderText(PH), { target: { value: 'Aqui' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar comentário' }));
    await waitFor(() =>
      expect(onCreateNote).toHaveBeenCalledWith({
        link_id: 5,
        t_seconds: 42,
        x: 0.5,
        y: 0.25,
        body: 'Aqui',
      }),
    );
  });

  it('marker click seeks', () => {
    renderVideo({ notes: [note({ t_seconds: 25 })] });
    const c = clock();
    fireEvent.click(screen.getByRole('button', { name: 'Comentário em 0:25' }));
    expect(c.time).toBe(25);
  });

  it('markers have a tap target of at least 24px and sit at t / duration', () => {
    renderVideo({ notes: [note({ t_seconds: 25 })] });
    clock();
    const marker = screen.getByRole('button', { name: 'Comentário em 0:25' });
    expect(marker.className).toContain('h-6');
    expect(marker.style.left).toBe('25%');
  });

  it('spot pin hidden away from its moment', () => {
    renderVideo({ notes: [note({ t_seconds: 42, x: 0.5, y: 0.5, body: 'Na cena' })] });
    const c = clock();
    c.setTime(10);
    expect(screen.queryByRole('img', { name: 'Na cena' })).toBeNull();
    c.setTime(42);
    expect(screen.getByRole('img', { name: 'Na cena' })).toBeInTheDocument();
  });

  it('no comment controls when canWrite false', () => {
    renderVideo({ canWrite: false, notes: [note()] });
    clock();
    expect(screen.queryByRole('button', { name: /^Comentar em/ })).toBeNull();
    expect(screen.queryByRole('button', { name: HINT })).toBeNull();
    // Reading the existing notes is still allowed.
    expect(screen.getByRole('button', { name: 'Comentário em 0:25' })).toBeInTheDocument();
  });

  it('without notes prop renders no note UI', () => {
    render(<PostMediaLightbox media={[video()]} initialIndex={0} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Comentar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Comentário em/ })).toBeNull();
    expect(screen.queryByRole('button', { name: HINT })).toBeNull();
    expect(document.querySelector('[data-testid="media-pin-layer"]')).toBeNull();
  });

  it('initialSeek seeks after loadedmetadata', () => {
    renderVideo({ initialSeek: 30 });
    const el = document.querySelector('video')!;
    let ct = 0;
    Object.defineProperty(el, 'currentTime', {
      configurable: true,
      get: () => ct,
      set: (v: number) => {
        ct = v;
      },
    });
    expect(ct).toBe(0);
    fireEvent(el, new Event('loadedmetadata'));
    expect(ct).toBe(30);
  });

  it('Escape closes only the composer, and a click inside it does not close the lightbox', async () => {
    const { onClose, onOverlayChange } = renderVideo();
    clock();
    fireEvent.click(screen.getByRole('button', { name: /^Comentar em/ }));
    const field = await screen.findByPlaceholderText(PH);
    expect(onOverlayChange).toHaveBeenCalledWith(true);
    fireEvent.click(field);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByPlaceholderText(PH)).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('an image item renders its pins read-only', () => {
    render(
      <PostMediaLightbox
        media={[makeMedia({ id: 3 })]}
        initialIndex={0}
        onClose={vi.fn()}
        notes={[note({ link_id: 3, media_kind: 'image', t_seconds: null, x: 0.5, y: 0.5 })]}
        canWrite
        onCreateNote={vi.fn()}
      />,
    );
    expect(screen.getByRole('img', { name: 'Cena' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: HINT })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Comentar em/ })).toBeNull();
  });

  describe('fix round 1', () => {
    const SECOND = () =>
      video({ id: 6, url: 'https://cdn.example.com/v2.mp4', thumbnail_url: null });

    function renderTwo(props: Partial<React.ComponentProps<typeof PostMediaLightbox>> = {}) {
      const onCreateNote = vi.fn().mockResolvedValue(undefined);
      const onClose = vi.fn();
      render(
        <PostMediaLightbox
          media={[video(), SECOND()]}
          initialIndex={0}
          onClose={onClose}
          notes={[]}
          canWrite
          onCreateNote={onCreateNote}
          {...props}
        />,
      );
      return { onCreateNote, onClose };
    }

    it('arrow keys typed in the composer do not switch the item, and the note keeps its link and moment', async () => {
      const { onCreateNote } = renderTwo();
      const c = clock();
      c.setTime(42);
      fireEvent.click(screen.getByRole('button', { name: 'Comentar em 0:42' }));
      const field = await screen.findByPlaceholderText(PH);
      fireEvent.keyDown(field, { key: 'ArrowRight' });
      fireEvent.change(field, { target: { value: 'Na primeira' } });
      fireEvent.click(screen.getByRole('button', { name: 'Enviar comentário' }));
      await waitFor(() =>
        expect(onCreateNote).toHaveBeenCalledWith({
          link_id: 5,
          t_seconds: 42,
          body: 'Na primeira',
        }),
      );
    });

    it('the note keeps the link it was started on even if the item changes before sending', async () => {
      const { onCreateNote } = renderTwo();
      const c = clock();
      c.setTime(42);
      fireEvent.click(screen.getByRole('button', { name: 'Comentar em 0:42' }));
      const field = await screen.findByPlaceholderText(PH);
      // A programmatic move (not a key the guard can see) still must not retarget the note.
      fireEvent.click(screen.getByRole('button', { name: 'Próxima', hidden: true }));
      fireEvent.change(field, { target: { value: 'x' } });
      fireEvent.click(screen.getByRole('button', { name: 'Enviar comentário' }));
      await waitFor(() =>
        expect(onCreateNote).toHaveBeenCalledWith({ link_id: 5, t_seconds: 42, body: 'x' }),
      );
    });

    it('arrow keys still switch the item when nothing is open', () => {
      renderTwo();
      expect(screen.getByText('1 / 2')).toBeInTheDocument();
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      expect(screen.getByText('2 / 2')).toBeInTheDocument();
    });

    it('one Escape closes only the composer even when its close is flushed before the lightbox listener runs', async () => {
      const { onClose } = renderTwo();
      clock();
      fireEvent.click(screen.getByRole('button', { name: /^Comentar em/ }));
      await screen.findByPlaceholderText(PH);
      // Radix (registered when the composer mounted) takes Escape in the capture phase and
      // closes the composer; a real browser flushes that state before the next listener.
      const flush = () => flushSync(() => undefined);
      document.addEventListener('keydown', flush, true);
      fireEvent.keyDown(document, { key: 'Escape' });
      document.removeEventListener('keydown', flush, true);
      await waitFor(() => expect(screen.queryByPlaceholderText(PH)).toBeNull());
      expect(onClose).not.toHaveBeenCalled();
    });

    it('one Escape stays a single close when the flush hands the lightbox a new onClose', async () => {
      const onClose = vi.fn();
      const newOnClose = vi.fn();
      const props = {
        media: [video(), SECOND()],
        initialIndex: 0,
        notes: [] as HubMediaNote[],
        canWrite: true,
        onCreateNote: vi.fn().mockResolvedValue(undefined),
      };
      const { rerender } = render(<PostMediaLightbox {...props} onClose={onClose} />);
      clock();
      fireEvent.click(screen.getByRole('button', { name: /^Comentar em/ }));
      await screen.findByPlaceholderText(PH);
      // What PostDetailDialog does when the composer's overlay report re-renders it: a new
      // inline onClose lands between the capture and the bubble phase of the same key.
      const swap = () =>
        flushSync(() => {
          rerender(<PostMediaLightbox {...props} onClose={newOnClose} />);
        });
      document.addEventListener('keydown', swap, true);
      fireEvent.keyDown(document, { key: 'Escape' });
      document.removeEventListener('keydown', swap, true);
      await waitFor(() => expect(screen.queryByPlaceholderText(PH)).toBeNull());
      expect(onClose).not.toHaveBeenCalled();
      expect(newOnClose).not.toHaveBeenCalled();
    });

    it('Escape still closes the lightbox when the outer dialog also preventDefaults it', () => {
      const { onClose } = renderTwo();
      const outer = (e: Event) => e.preventDefault();
      document.addEventListener('keydown', outer, true);
      fireEvent.keyDown(document, { key: 'Escape' });
      document.removeEventListener('keydown', outer, true);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not re-render on timeupdate without notes, but does with notes', () => {
      const commits = vi.fn();
      const { unmount } = render(
        <Profiler id="plain" onRender={commits}>
          <PostMediaLightbox media={[video()]} initialIndex={0} onClose={vi.fn()} />
        </Profiler>,
      );
      const plain = document.querySelector('video')!;
      let tick = 0;
      Object.defineProperty(plain, 'currentTime', { configurable: true, get: () => ++tick });
      const before = commits.mock.calls.length;
      fireEvent(plain, new Event('timeupdate'));
      fireEvent(plain, new Event('timeupdate'));
      expect(commits.mock.calls.length).toBe(before);
      unmount();

      const withNotes = vi.fn();
      render(
        <Profiler id="notes" onRender={withNotes}>
          <PostMediaLightbox media={[video()]} initialIndex={0} onClose={vi.fn()} notes={[]} />
        </Profiler>,
      );
      const el = document.querySelector('video')!;
      Object.defineProperty(el, 'currentTime', { configurable: true, value: 3 });
      const mid = withNotes.mock.calls.length;
      fireEvent(el, new Event('timeupdate'));
      expect(withNotes.mock.calls.length).toBeGreaterThan(mid);
    });

    it('resets the clock when the item changes', () => {
      renderTwo({ notes: [note({ t_seconds: 25 })] });
      const c = clock();
      c.setTime(42);
      expect(screen.getByRole('button', { name: 'Comentar em 0:42' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Comentário em 0:25' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
      expect(screen.getByRole('button', { name: 'Comentar em 0:00' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Comentário em 0:25' })).toBeNull();
    });

    it('the button label and the composer title come from the same moment', async () => {
      renderTwo();
      const c = clock();
      c.setTime(42);
      fireEvent.click(screen.getByRole('button', { name: 'Comentar em 0:42' }));
      expect(
        await screen.findByRole('textbox', { name: 'Comentário em 0:42' }),
      ).toBeInTheDocument();
    });

    it('initialSeek is dropped when the user swipes away before loadedmetadata', () => {
      renderTwo({ initialSeek: 30 });
      // Away to the second item, then back, before the first video ever reported metadata.
      fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
      fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
      const again = document.querySelector('video')!;
      let ct = 0;
      Object.defineProperty(again, 'currentTime', {
        configurable: true,
        get: () => ct,
        set: (v: number) => {
          ct = v;
        },
      });
      fireEvent(again, new Event('loadedmetadata'));
      expect(ct).toBe(0);
    });

    it('the stored moment and the composer title read the live clock, not the throttled label', async () => {
      const { onCreateNote } = renderTwo();
      const c = clock();
      c.setTime(42);
      // The clock moved on without a timeupdate yet: the button still says 0:42.
      Object.defineProperty(c.el, 'currentTime', {
        configurable: true,
        get: () => 43.4,
        set: () => {},
      });
      fireEvent.click(screen.getByRole('button', { name: 'Comentar em 0:42' }));
      const field = await screen.findByRole('textbox', { name: 'Comentário em 0:43' });
      fireEvent.change(field, { target: { value: 'ao vivo' } });
      fireEvent.click(screen.getByRole('button', { name: 'Enviar comentário' }));
      await waitFor(() =>
        expect(onCreateNote).toHaveBeenCalledWith({ link_id: 5, t_seconds: 43.4, body: 'ao vivo' }),
      );
    });

    it('initialSeek does not re-apply after swiping away and back', () => {
      renderTwo({ initialSeek: 30 });
      const first = document.querySelector('video')!;
      let ct = 0;
      Object.defineProperty(first, 'currentTime', {
        configurable: true,
        get: () => ct,
        set: (v: number) => {
          ct = v;
        },
      });
      fireEvent(first, new Event('loadedmetadata'));
      expect(ct).toBe(30);
      fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
      fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
      const again = document.querySelector('video')!;
      let ct2 = 0;
      Object.defineProperty(again, 'currentTime', {
        configurable: true,
        get: () => ct2,
        set: (v: number) => {
          ct2 = v;
        },
      });
      fireEvent(again, new Event('loadedmetadata'));
      expect(ct2).toBe(0);
    });
  });
});
