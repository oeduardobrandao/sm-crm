import { afterEach, describe, expect, it, vi } from 'vitest';

// Widget builds raw HTML strings by hand (imperative pattern, like the Instagram
// widgets it's cloned from) — escapeHTML/sanitizeUrl on every interpolation is the
// repo's hard security rule (CLAUDE.md). This asserts both hold for a malicious
// title and unsafe javascript: schemes on share_url/cover_image_url.

const { getTikTokPostsMock } = vi.hoisted(() => ({ getTikTokPostsMock: vi.fn() }));

vi.mock('../../../services/tiktok', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/tiktok')>();
  return {
    ...actual,
    getTikTokPosts: (...args: unknown[]) => getTikTokPostsMock(...args),
  };
});

import { renderTikTokPostsTable } from '../TikTokPostsTable';

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('renderTikTokPostsTable — security: escapeHTML + sanitizeUrl', () => {
  it('escapes a malicious title and drops javascript: share_url/thumbnail schemes', async () => {
    getTikTokPostsMock.mockResolvedValue({
      total: 1,
      posts: [
        {
          id: 'p1',
          tiktok_account_id: 'a1',
          tiktok_video_id: 'v1',
          title: '<img src=x onerror=alert(1)>',
          video_description: null,
          duration: 65,
          height: null,
          width: null,
          share_url: 'javascript:alert(1)',
          embed_link: null,
          cover_image_url: 'javascript:alert(2)',
          posted_at: '2026-07-01T00:00:00Z',
          views: 1000,
          likes: 10,
          comments: 2,
          shares: 1,
          synced_at: null,
          created_at: '2026-07-01T00:00:00Z',
        },
      ],
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    await renderTikTokPostsTable(container, 5);

    expect(getTikTokPostsMock).toHaveBeenCalledWith(5, 1);

    // Title is escaped, not injected as raw HTML.
    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).not.toContain('<img src=x onerror=alert(1)>');
    expect(container.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;');

    // sanitizeUrl neutralizes javascript: to '#' — the widget hides the affordance
    // entirely rather than ever emitting a javascript: URL into the DOM.
    expect(container.innerHTML).not.toContain('javascript:');
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });
});
