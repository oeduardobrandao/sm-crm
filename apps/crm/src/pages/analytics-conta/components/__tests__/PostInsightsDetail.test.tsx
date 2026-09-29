import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { PostAnalytics } from '../../../../services/analytics';
import { PostInsightsDetail } from '../PostInsightsDetail';

function post(over: Partial<PostAnalytics> = {}): PostAnalytics {
  return {
    id: 1,
    instagram_post_id: 'ig1',
    caption: 'Dá preguiça. Dá medo.',
    media_type: 'CAROUSEL_ALBUM',
    permalink: 'https://instagram.com/p/1',
    posted_at: '2026-09-23T12:00:00Z',
    likes: 4512,
    comments: 17,
    reach: 37600,
    impressions: 66656,
    saved: 630,
    shares: 1502,
    views: 66656,
    rates: { share_rate: null, like_rate: null, save_rate: null, comment_rate: null },
    unavailable_metrics: [],
    ig_score: null,
    thumbnail_url: null,
    engagement_rate: 18.4,
    saves_rate: 1.7,
    tags: [],
    profile_visits: 328,
    follows: 75,
    bio_link_clicks: 1,
    follows_per_mil_reach: 1.99,
    ...over,
  };
}

describe('PostInsightsDetail', () => {
  it('renders both groups with the values', () => {
    render(<PostInsightsDetail post={post()} />);
    expect(screen.getByText('Interações')).toBeInTheDocument();
    expect(screen.getByText('Ações após a visualização')).toBeInTheDocument();
    // Instagram Login doesn't serve reposts, so the row isn't shown at all.
    expect(screen.queryByText('Reposts')).not.toBeInTheDocument();
    expect(screen.getByText('Visitas ao perfil').nextSibling).toHaveTextContent('328');
    expect(screen.getByText('Novos seguidores').nextSibling).toHaveTextContent('75');
    expect(screen.getByText('Toques no link da bio').nextSibling).toHaveTextContent(/^1$/);
    expect(screen.getByText('Curtidas').nextSibling).toHaveTextContent('4.512');
    expect(screen.getByText('1 novo seguidor a cada 501 contas alcançadas')).toBeInTheDocument();
  });

  it('renders "—" with a metric-specific tooltip for missing values, and no conversion line', () => {
    render(
      <PostInsightsDetail
        post={post({
          follows: null,
          profile_visits: null,
          bio_link_clicks: null,
          follows_per_mil_reach: null,
          unavailable_metrics: ['follows', 'profile_visits'],
        })}
      />,
    );
    const follows = screen.getByText('Novos seguidores').nextSibling as HTMLElement;
    expect(follows).toHaveTextContent('—');
    expect(follows).toHaveAttribute(
      'title',
      'O Instagram não retornou este dado na última sincronização',
    );
    const bio = screen.getByText('Toques no link da bio').nextSibling as HTMLElement;
    expect(bio).toHaveAttribute('title', 'Sem dado para este post');
    expect(screen.queryByText(/novo seguidor a cada/)).not.toBeInTheDocument();
  });

  it('treats undefined (pre-migration rows) like null', () => {
    const p = post();
    delete (p as Partial<PostAnalytics>).profile_visits;
    render(<PostInsightsDetail post={p} />);
    expect(screen.getByText('Visitas ao perfil').nextSibling).toHaveTextContent('—');
  });

  it('explains that Reels never get the action metrics', () => {
    render(
      <PostInsightsDetail
        post={post({
          media_type: 'VIDEO',
          follows: null,
          profile_visits: null,
          bio_link_clicks: null,
          follows_per_mil_reach: null,
          unavailable_metrics: ['follows', 'profile_visits', 'bio_link_clicks'],
        })}
      />,
    );
    for (const label of ['Visitas ao perfil', 'Novos seguidores', 'Toques no link da bio']) {
      expect(screen.getByText(label).nextSibling).toHaveAttribute(
        'title',
        'O Instagram não fornece este dado para Reels',
      );
    }
  });
});
