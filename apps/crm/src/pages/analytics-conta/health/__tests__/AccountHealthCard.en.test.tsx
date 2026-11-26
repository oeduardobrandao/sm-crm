import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { i18n } from '@mesaas/i18n';
import type { AccountHealth } from '@/services/analytics';
import { AccountHealthCard } from '../AccountHealthCard';

// A card with a follower band but not enough posts to compare: renders the empty state.
const EMPTY: AccountHealth = {
  followers: 9274,
  band: '5k_20k',
  metrics: { engagement_rate: null, posts_30d: null, reel_views: null, reels_share: null },
  bestPost: null,
  benchmarks: {},
};

describe('AccountHealthCard in English', () => {
  afterEach(async () => {
    await i18n.changeLanguage('pt');
  });

  it('renders its heading and empty state in English', async () => {
    await i18n.changeLanguage('en');
    render(<AccountHealthCard health={EMPTY} isLoading={false} onOpenPost={() => {}} />);
    const card = screen.getByRole('article', { name: 'Is your Instagram doing well?' });
    expect(
      within(card).getByRole('heading', { name: 'Is your Instagram doing well?' }),
    ).toBeInTheDocument();
    expect(within(card).getByText('Not enough data to compare yet')).toBeInTheDocument();
  });
});
