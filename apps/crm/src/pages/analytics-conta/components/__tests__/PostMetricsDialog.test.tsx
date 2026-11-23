import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import i18n from 'i18next';
import ptComments from '../../../../../../../packages/i18n/locales/pt/analyticsComments.json';
import enComments from '../../../../../../../packages/i18n/locales/en/analyticsComments.json';

import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import type { PostAnalytics } from '../../../../services/analytics';
import { PostMetricsDialog } from '../PostMetricsDialog';

i18n.addResourceBundle('pt', 'analyticsComments', ptComments, true, true);
i18n.addResourceBundle('en', 'analyticsComments', enComments, true, true);

vi.mock('../../comments/PostCommentsPanel', () => ({
  PostCommentsPanel: () => <div data-testid="comments-panel" />,
}));

function post(over: Partial<PostAnalytics> = {}): PostAnalytics {
  return {
    id: 'post-1',
    instagram_post_id: 'ig1',
    caption: 'Legenda do post de teste.',
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
    rates: { share_rate: 0.01, like_rate: 0.08, save_rate: 0.02, comment_rate: 0.01 },
    unavailable_metrics: [],
    ig_score: 50,
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

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const closeButtons = () =>
  screen
    .getAllByRole('button', { name: /fechar/i })
    .filter((b) => !b.classList.contains('sr-only'));

describe('PostMetricsDialog', () => {
  it('renders the title, the view and the Instagram link with the sanitized permalink', () => {
    wrap(
      <PostMetricsDialog
        post={post()}
        onOpenChange={() => {}}
        clientId={1}
        commentsEnabled={false}
      />,
    );
    expect(screen.getByText('Métricas do post')).toBeTruthy();
    expect(screen.getByText('Visão geral')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Abrir no Instagram' });
    expect(link.getAttribute('href')).toBe('https://www.instagram.com/p/abc/');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('hides the Instagram link for an unsafe or empty permalink', () => {
    for (const permalink of ['javascript:alert(1)', '', null]) {
      const { unmount } = wrap(
        <PostMetricsDialog
          post={post({ permalink })}
          onOpenChange={() => {}}
          clientId={1}
          commentsEnabled={false}
        />,
      );
      expect(screen.queryByRole('link', { name: 'Abrir no Instagram' })).toBeNull();
      unmount();
    }
  });

  it('returns focus to returnFocusTo on close', async () => {
    function Host() {
      const ref = useRef<HTMLButtonElement>(null);
      const [open, setOpen] = useState(true);
      return (
        <>
          <button ref={ref}>opener</button>
          <PostMetricsDialog
            post={open ? post() : null}
            onOpenChange={(o) => setOpen(o)}
            clientId={1}
            commentsEnabled={false}
            returnFocusTo={ref}
          />
        </>
      );
    }
    wrap(<Host />);
    const opener = screen.getByText('opener');
    fireEvent.click(closeButtons()[0]);
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('stays open above an open Sheet and closing it keeps the Sheet open', async () => {
    function Host() {
      const [dlg, setDlg] = useState(true);
      return (
        <Sheet open onOpenChange={() => {}}>
          <SheetContent
            onInteractOutside={(e) => {
              if (dlg) e.preventDefault();
            }}
          >
            <SheetTitle>Detalhe do post</SheetTitle>
            <div data-testid="sheet-body">sheet</div>
            <PostMetricsDialog
              post={dlg ? post() : null}
              onOpenChange={(o) => setDlg(o)}
              clientId={1}
              commentsEnabled={false}
            />
          </SheetContent>
        </Sheet>
      );
    }
    wrap(<Host />);
    expect(screen.getByText('Métricas do post')).toBeTruthy();
    fireEvent.click(closeButtons()[0]);
    await waitFor(() => expect(screen.queryByText('Métricas do post')).toBeNull());
    expect(screen.getByTestId('sheet-body')).toBeTruthy();
  });
});
