import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderInstagramOverviewCard } from '../InstagramOverviewCard';

const css = readFileSync('apps/crm/style.css', 'utf8');
const overviewSource = readFileSync(
  'apps/crm/src/components/instagram/InstagramOverviewCard.ts',
  'utf8',
);

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
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps three account metrics in one equal row and the expiry label on one line', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T12:00:00Z'));
    const container = document.createElement('div');

    renderInstagramOverviewCard(container, 42, accountExpiringIn38Days, vi.fn());

    expect(container.querySelectorAll('.instagram-overview__account-kpis .kpi-card')).toHaveLength(
      3,
    );
    expect(container.querySelector('.instagram-overview__token-badge')).toHaveTextContent(
      /38.*restantes/i,
    );
    expect(css).toMatch(
      /\.instagram-overview__account-kpis\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s,
    );
    expect(css).toMatch(
      /\.instagram-overview__token-badge\s*\{[^}]*white-space:\s*nowrap[^}]*min-height:\s*36px/s,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*900px\)\s*\{[^}]*\.instagram-overview__account-kpis\s*>\s*:last-child:nth-child\(odd\)\s*\{[^}]*grid-column:\s*auto[^}]*max-width:\s*none[^}]*justify-self:\s*stretch/s,
    );
  });

  it('uses a narrow-phone grid that gives metadata and actions safe placement', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T12:00:00Z'));
    const container = document.createElement('div');

    renderInstagramOverviewCard(container, 42, accountExpiringIn38Days, vi.fn());

    expect(css).toMatch(
      /@media\s*\(max-width:\s*600px\)\s*\{[^}]*\.instagram-overview__profile\s*\{[^}]*display:\s*grid\s*!important[^}]*grid-template-columns:\s*80px\s+minmax\(0,\s*1fr\)/s,
    );
    expect(css).toMatch(
      /\.instagram-overview__metadata\s*\{[^}]*grid-column:\s*2[^}]*grid-row:\s*1[^}]*min-width:\s*0/s,
    );
    expect(css).toMatch(
      /\.instagram-overview__actions\s*\{[^}]*grid-column:\s*1\s*\/\s*-1[^}]*grid-row:\s*2[^}]*justify-self:\s*stretch/s,
    );
    expect(container.querySelector('.instagram-overview__metadata')).toBeTruthy();
    expect(container.querySelector('.instagram-overview__actions')).toBeTruthy();
    expect(container.querySelector('#btn-ig-sync')).toHaveAttribute(
      'aria-label',
      'Sincronizar Dados',
    );
    expect(container.querySelector('#btn-ig-disconnect')).toHaveAttribute(
      'aria-label',
      'Desconectar',
    );
    expect(
      container.querySelectorAll('.instagram-overview__profile i[aria-hidden="true"]'),
    ).toHaveLength(4);
    expect(container.querySelector('.instagram-overview__token-badge i')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    expect(
      container.querySelectorAll(
        '.kpi-grid:not(.instagram-overview__account-kpis) .kpi-label i[aria-hidden="true"]',
      ),
    ).toHaveLength(4);

    const expiredContainer = document.createElement('div');
    renderInstagramOverviewCard(
      expiredContainer,
      42,
      { ...accountExpiringIn38Days, authorization_status: 'expired' },
      vi.fn(),
    );
    expect(
      expiredContainer.querySelector('#btn-ig-reconnect')?.parentElement?.querySelector('i'),
    ).toHaveAttribute('aria-hidden', 'true');

    const revokedContainer = document.createElement('div');
    renderInstagramOverviewCard(
      revokedContainer,
      42,
      { ...accountExpiringIn38Days, authorization_status: 'revoked' },
      vi.fn(),
    );
    expect(revokedContainer.querySelector('.card > div:first-child i')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('marks every static and dynamically injected overview icon as decorative', () => {
    const iconTags = overviewSource.match(/<i\b[^>]*>/g) ?? [];

    expect(iconTags).not.toHaveLength(0);
    expect(iconTags.every((tag) => /aria-hidden="true"/.test(tag))).toBe(true);
  });
});
