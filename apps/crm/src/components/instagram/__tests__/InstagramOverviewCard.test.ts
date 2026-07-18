import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { renderInstagramOverviewCard } from '../InstagramOverviewCard';

const css = readFileSync('apps/crm/style.css', 'utf8');

const accountExpiringIn38Days = {
  username: 'mesaasteste',
  profile_picture_url: null,
  authorization_status: 'active',
  token_expires_at: '2026-08-25T12:00:00Z',
  updated_at: '2026-07-18T12:00:00Z',
  follower_count: 1200,
  following_count: 300,
  media_count: 45,
};

describe('renderInstagramOverviewCard', () => {
  it('keeps three account metrics in one equal row and the expiry label on one line', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T12:00:00Z'));
    const container = document.createElement('div');

    renderInstagramOverviewCard(container, 42, accountExpiringIn38Days, vi.fn());

    expect(container.querySelectorAll('.instagram-overview__account-kpis .kpi-card')).toHaveLength(3);
    expect(container.querySelector('.instagram-overview__token-badge')).toHaveTextContent(
      /38.*restantes/i,
    );
    expect(css).toMatch(
      /\.instagram-overview__account-kpis\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s,
    );
    expect(css).toMatch(
      /\.instagram-overview__token-badge\s*\{[^}]*white-space:\s*nowrap[^}]*min-height:\s*36px/s,
    );
  });
});
