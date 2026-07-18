import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderInstagramPostsTable } from '../InstagramPostsTable';
import { getInstagramPosts } from '../../../services/instagram';

vi.mock('../../../services/instagram', () => ({ getInstagramPosts: vi.fn() }));

const posts = Array.from({ length: 6 }, (_, index) => ({
  id: String(index + 1),
  posted_at: '2026-07-13T12:00:00Z',
  media_type: 'CAROUSEL_ALBUM',
  caption: index === 0 ? '<img src=x onerror=alert(1)>' : `Legenda ${index + 1}`,
  thumbnail_url: '',
  permalink: 'https://instagram.com/p/safe',
  likes: 75,
  comments: 6,
  reach: 321,
  impressions: 941,
}));

describe('renderInstagramPostsTable', () => {
  beforeEach(() => vi.resetAllMocks());

  it('renders scoped post cards with escaped captions', async () => {
    vi.mocked(getInstagramPosts).mockResolvedValue({ posts, total: 6 } as never);
    const container = document.createElement('div');

    await renderInstagramPostsTable(container, 42);

    expect(container.querySelector('.ig-posts-section')).not.toBeNull();
    expect(container.querySelectorAll('.ig-post-card')).toHaveLength(6);
    expect(container.querySelector('img[onerror="alert(1)"]')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('keeps rows after the fifth collapsed until Ver mais is activated', async () => {
    vi.mocked(getInstagramPosts).mockResolvedValue({ posts, total: 6 } as never);
    const container = document.createElement('div');

    await renderInstagramPostsTable(container, 42);

    const sixth = container.querySelectorAll<HTMLElement>('.ig-post-card')[5];
    expect(sixth.style.display).toBe('none');
    container.querySelector<HTMLButtonElement>('#btn-ig-expand')!.click();
    expect(sixth.style.display).toBe('');
  });
});
