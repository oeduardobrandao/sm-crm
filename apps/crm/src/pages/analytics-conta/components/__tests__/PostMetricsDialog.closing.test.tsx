import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import i18n from 'i18next';
import ptComments from '../../../../../../../packages/i18n/locales/pt/analyticsComments.json';

import type { PostAnalytics } from '../../../../services/analytics';
import { PostMetricsDialog } from '../PostMetricsDialog';

i18n.addResourceBundle('pt', 'analyticsComments', ptComments, true, true);

// jsdom has no animations, so Radix unmounts the content the moment `open` turns false. This
// Dialog keeps its content mounted while closed, the way Radix does during the exit animation,
// and exposes the state the pop-up asked for.
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => (
    <div data-testid="dialog" data-state={open ? 'open' : 'closed'}>
      {children}
    </div>
  ),
  DialogContent: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock('../../comments/PostCommentsPanel', () => ({
  PostCommentsPanel: () => <div data-testid="comments-panel" />,
}));

function post(over: Partial<PostAnalytics> = {}): PostAnalytics {
  return {
    id: 'post-1',
    instagram_post_id: 'ig1',
    caption: 'Legenda que fica durante o fechamento.',
    media_type: 'IMAGE',
    permalink: 'https://www.instagram.com/p/abc/',
    posted_at: '2026-11-21T21:02:00Z',
    likes: 10,
    comments: 2,
    reach: 100,
    impressions: 120,
    saved: 3,
    shares: 1,
    views: 120,
    reposts: null,
    rates: { share_rate: null, like_rate: null, save_rate: null, comment_rate: null },
    unavailable_metrics: [],
    ig_score: null,
    thumbnail_url: null,
    engagement_rate: 5,
    saves_rate: 1,
    tags: [],
    synced_at: null,
    profile_visits: 5,
    follows: 1,
    bio_link_clicks: 2,
    follows_per_mil_reach: 0.1,
    ...over,
  } as PostAnalytics;
}

describe('PostMetricsDialog while closing', () => {
  it('keeps the last post on screen after post turns null, so the exit animation has a body', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrap = (ui: ReactElement) => <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
    const props = { onOpenChange: () => {}, clientId: 1, commentsEnabled: false };
    const { rerender } = render(wrap(<PostMetricsDialog post={post()} {...props} />));
    expect(screen.getByTestId('dialog')).toHaveAttribute('data-state', 'open');

    rerender(wrap(<PostMetricsDialog post={null} {...props} />));
    expect(screen.getByTestId('dialog')).toHaveAttribute('data-state', 'closed');
    expect(screen.getByText('Legenda que fica durante o fechamento.')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Visão geral' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir no Instagram' })).toHaveAttribute(
      'href',
      'https://www.instagram.com/p/abc/',
    );
  });
});
