import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KbVideo, KbVideoSeries } from '@/store/kbVideos';
import { VideoPlaylistBlock } from '../VideoPlaylistBlock';
import { toProgressMap } from '../playlist';

function v(id: number, title: string, extra: Partial<KbVideo> = {}): KbVideo {
  return {
    id,
    series_id: 's1',
    title,
    slug: `video-${id}`,
    description: null,
    display_order: id,
    duration_seconds: 100,
    hls_url: `https://h/${id}.m3u8`,
    thumbnail_url: null,
    article: null,
    ...extra,
  };
}

const series: KbVideoSeries[] = [
  {
    id: 's1',
    title: 'Primeiros passos',
    slug: 'pp',
    description: null,
    display_order: 1,
    videos: [
      v(1, 'Primeiro acesso'),
      v(2, 'Convidando a equipe', { article: { slug: 'convidar-equipe', title: 'Convidar' } }),
      v(3, 'Primeiro cliente'),
    ],
  },
];
const done = (id: number) => ({
  video_id: id,
  position_seconds: 100,
  completed_at: '2026-09-28T10:00:00Z',
});

beforeEach(() => {
  HTMLMediaElement.prototype.canPlayType = vi.fn(() => 'probably') as unknown as (
    t: string,
  ) => CanPlayTypeResult;
});
afterEach(() => {
  delete (HTMLMediaElement.prototype as { canPlayType?: unknown }).canPlayType;
});

function renderBlock(props: Partial<Parameters<typeof VideoPlaylistBlock>[0]> = {}) {
  const onSaveProgress = vi.fn();
  const utils = render(
    <MemoryRouter>
      <VideoPlaylistBlock
        series={series}
        progress={toProgressMap([done(1)])}
        onSaveProgress={onSaveProgress}
        {...props}
      />
    </MemoryRouter>,
  );
  return { ...utils, onSaveProgress };
}

function videoEl(container: HTMLElement) {
  return container.querySelector('video') as HTMLVideoElement;
}

function setMedia(el: HTMLVideoElement, currentTime: number, duration = 100) {
  Object.defineProperty(el, 'currentTime', {
    configurable: true,
    writable: true,
    value: currentTime,
  });
  Object.defineProperty(el, 'duration', { configurable: true, value: duration });
}

describe('VideoPlaylistBlock', () => {
  it('opens on the first unwatched video and shows series progress', () => {
    renderBlock();
    expect(screen.getByRole('heading', { name: 'Convidando a equipe' })).toBeInTheDocument();
    expect(screen.getByText('1 de 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Convidando a equipe/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByRole('link', { name: /Ler artigo/ })).toHaveAttribute(
      'href',
      '/ajuda/convidar-equipe',
    );
  });

  it('follows requestedSlug when it changes after mount, without remounting the block', () => {
    const { rerender } = renderBlock({ requestedSlug: 'video-1' });
    expect(screen.getByRole('heading', { name: 'Primeiro acesso' })).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <VideoPlaylistBlock
          series={series}
          progress={toProgressMap([done(1)])}
          onSaveProgress={vi.fn()}
          requestedSlug="video-3"
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Primeiro cliente' })).toBeInTheDocument();
  });

  it('does not fight a just-made internal selection once the URL catches up to it', () => {
    const onSaveProgress = vi.fn();
    const { rerender } = renderBlock({ requestedSlug: 'video-2', onSaveProgress });
    fireEvent.click(screen.getByRole('button', { name: /Primeiro cliente/ }));
    expect(screen.getByRole('heading', { name: 'Primeiro cliente' })).toBeInTheDocument();

    // Simulate the URL having caught up (navigate({replace:true}) already landed) to the video
    // just selected: requestedSlug now equals it, so the sync effect must no-op.
    rerender(
      <MemoryRouter>
        <VideoPlaylistBlock
          series={series}
          progress={toProgressMap([done(1)])}
          onSaveProgress={onSaveProgress}
          requestedSlug="video-3"
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Primeiro cliente' })).toBeInTheDocument();
  });

  it('switches video from the rail', () => {
    renderBlock();
    fireEvent.click(screen.getByRole('button', { name: /Primeiro cliente/ }));
    expect(screen.getByRole('heading', { name: 'Primeiro cliente' })).toBeInTheDocument();
  });

  it('marks a video complete once at 90%', () => {
    const { container, onSaveProgress } = renderBlock();
    const el = videoEl(container);
    setMedia(el, 91);
    fireEvent.timeUpdate(el);
    setMedia(el, 95);
    fireEvent.timeUpdate(el);
    expect(onSaveProgress.mock.calls.filter((c) => c[2] === true)).toEqual([[2, 91, true]]);
  });

  it('resumes from the saved position', () => {
    const { container } = renderBlock({
      progress: toProgressMap([done(1), { video_id: 2, position_seconds: 42, completed_at: null }]),
    });
    const el = videoEl(container);
    setMedia(el, 0);
    fireEvent.loadedMetadata(el);
    expect(el.currentTime).toBe(42);
  });

  it('offers the next video when one ends', () => {
    const { container } = renderBlock();
    const el = videoEl(container);
    setMedia(el, 100);
    fireEvent.ended(el);
    expect(screen.getByText('Próximo: Primeiro cliente')).toBeInTheDocument();
  });

  it('collapses when everything was watched and expands on "Rever"', () => {
    renderBlock({ collapsible: true, progress: toProgressMap([done(1), done(2), done(3)]) });
    expect(screen.queryByRole('heading', { name: 'Primeiro acesso' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Rever' }));
    expect(screen.getByRole('heading', { name: 'Primeiro acesso' })).toBeInTheDocument();
  });

  it('shows a retry state when the video cannot load', () => {
    const { container } = renderBlock();
    fireEvent.error(videoEl(container)); // native-hls → fallback
    fireEvent.error(videoEl(container)); // fallback fails → fatal
    expect(screen.getByText('Não foi possível carregar este vídeo.')).toBeInTheDocument();
    const retryButton = screen.getByRole('button', { name: 'Tentar novamente' });
    // The outline variant only sets bg-background, no text colour, so on this dark overlay it
    // inherits text-white and becomes invisible in light mode (white text on a white button).
    expect(retryButton).toHaveClass('text-foreground');
    fireEvent.click(retryButton);
    expect(videoEl(container)).not.toBeNull();
  });

  it('offers to watch again once the last video in the series ends, with a readable button', () => {
    const { container } = renderBlock({
      progress: toProgressMap([done(1), done(2)]),
    });
    fireEvent.click(screen.getByRole('button', { name: /Primeiro cliente/ }));
    const el = videoEl(container);
    setMedia(el, 100);
    fireEvent.ended(el);
    expect(screen.getByText('Série concluída')).toBeInTheDocument();
    const watchAgainButton = screen.getByRole('button', { name: 'Assistir de novo' });
    // Same outline-variant contrast bug as "Tentar novamente": must not inherit the overlay's
    // text-white in light mode.
    expect(watchAgainButton).toHaveClass('text-foreground');
  });
});
