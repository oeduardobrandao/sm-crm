import { afterEach, describe, expect, it } from 'vitest';
import { renderTikTokOverviewCard } from '../TikTokOverviewCard';
import type { TikTokAccount } from '../../../services/tiktok';

afterEach(() => {
  document.body.innerHTML = '';
});

function baseAccount(overrides: Partial<TikTokAccount> = {}): TikTokAccount {
  return {
    id: 'acc-1',
    client_id: 5,
    tiktok_open_id: 'open-1',
    username: '<script>alert(1)</script>',
    display_name: null,
    avatar_url: 'javascript:alert(1)',
    profile_deep_link: null,
    follower_count: 1234,
    following_count: 10,
    likes_count: 1234567,
    video_count: 42,
    access_token_expires_at: null,
    refresh_token_expires_at: null,
    last_synced_at: '2026-07-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    authorization_status: 'active',
    scopes: null,
    auto_sync_enabled: true,
    ...overrides,
  };
}

describe('renderTikTokOverviewCard — security: escapeHTML + sanitizeUrl', () => {
  it('escapes the username and neutralizes an unsafe avatar_url', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    renderTikTokOverviewCard(container, 5, baseAccount(), () => {});

    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).not.toContain('<script>alert(1)</script>');
    expect(container.innerHTML).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');

    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('#'); // sanitizeUrl neutralizes javascript:
  });

  it('formats KPI numbers with pt-BR locale grouping (likes_count bigint-as-number)', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderTikTokOverviewCard(container, 5, baseAccount(), () => {});
    expect(container.textContent).toContain('1.234.567');
  });

  it('shows a reconnect banner + button when the refresh token expires within 30 days', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const soon = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    renderTikTokOverviewCard(
      container,
      5,
      baseAccount({ username: 'realuser', refresh_token_expires_at: soon }),
      () => {},
    );
    expect(container.querySelector('#btn-tt-reconnect')).not.toBeNull();
    expect(container.textContent).toContain('Reconecte a conta TikTok em breve');
  });

  it('shows the revoked banner + reconnect action when authorization_status is revoked', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderTikTokOverviewCard(
      container,
      5,
      baseAccount({ username: 'realuser', authorization_status: 'revoked' }),
      () => {},
    );
    expect(container.querySelector('#btn-tt-reconnect')).not.toBeNull();
  });
});
