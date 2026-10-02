import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/store/kbViews', () => ({ recordKbView: vi.fn(() => Promise.resolve()) }));
vi.mock('@/store/kbVideos', () => ({
  getPublishedVideoSeries: vi.fn(),
  getMyVideoProgress: vi.fn(),
  saveVideoProgress: vi.fn(),
}));

import { recordKbView } from '@/store/kbViews';
import { getMyVideoProgress, getPublishedVideoSeries } from '@/store/kbVideos';
import type { KbVideo, KbVideoSeries } from '@/store/kbVideos';
import { ArticleVideos } from '../ArticleVideos';

function v(id: number, title: string, articleSlug: string | null): KbVideo {
  return {
    id,
    series_id: 's2',
    title,
    slug: `video-${id}`,
    description: null,
    display_order: id,
    duration_seconds: 109,
    hls_url: `https://h/${id}.m3u8`,
    thumbnail_url: null,
    article: articleSlug ? { slug: articleSlug, title: 'Artigo' } : null,
  };
}

const SERIES: KbVideoSeries[] = [
  {
    id: 's2',
    title: 'Indo Além',
    slug: 'indo-alem',
    description: null,
    display_order: 2,
    videos: [v(4, 'Métricas do Instagram', null), v(5, 'Relatórios', 'relatorios')],
  },
];

beforeEach(() => {
  HTMLMediaElement.prototype.canPlayType = vi.fn(() => 'probably') as unknown as (
    t: string,
  ) => CanPlayTypeResult;
  vi.mocked(getPublishedVideoSeries).mockResolvedValue(SERIES);
  vi.mocked(getMyVideoProgress).mockResolvedValue([]);
});
afterEach(() => {
  delete (HTMLMediaElement.prototype as { canPlayType?: unknown }).canPlayType;
  vi.clearAllMocks();
});

function renderFor(slug: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ArticleVideos articleSlug={slug} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ArticleVideos', () => {
  it('plays the video linked to the article, pointing to its series', async () => {
    const { container } = renderFor('relatorios');
    expect(await screen.findByText('Relatórios')).toBeInTheDocument();
    expect(screen.queryByText('Métricas do Instagram')).toBeNull();
    expect(screen.getByText('· 1:49')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ver a série Indo Além/ })).toHaveAttribute(
      'href',
      '/ajuda/video/video-5',
    );

    const el = container.querySelector('video') as HTMLVideoElement;
    expect(el).not.toBeNull();
    expect(el.autoplay).toBe(false);
    fireEvent.play(el);
    fireEvent.play(el);
    expect(recordKbView).toHaveBeenCalledTimes(1);
  });

  it('renders nothing for an article without a linked video', async () => {
    const { container } = renderFor('outro-artigo');
    await vi.waitFor(() => expect(getMyVideoProgress).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });
});
