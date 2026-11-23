import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from 'i18next';
import ptComments from '../../../../../../../packages/i18n/locales/pt/analyticsComments.json';
import enComments from '../../../../../../../packages/i18n/locales/en/analyticsComments.json';

import type { PostAnalytics } from '../../../../services/analytics';
import type { RateDistributions } from '../../../../lib/ig-rates';
import { missingActionMetricTitle } from '../../../../lib/post-action-metrics';
import { PostMetricsView } from '../PostMetricsView';

i18n.addResourceBundle('pt', 'analyticsComments', ptComments, true, true);
i18n.addResourceBundle('en', 'analyticsComments', enComments, true, true);

const { commentsMounts } = vi.hoisted(() => ({ commentsMounts: { count: 0 } }));

vi.mock('../../comments/PostCommentsPanel', async () => {
  const { useEffect } = await import('react');
  return {
    PostCommentsPanel: ({ post }: { post: { id: string } }) => {
      useEffect(() => {
        commentsMounts.count += 1;
      }, []);
      return <div data-testid="comments-panel">comentários de {post.id}</div>;
    },
  };
});

function post(over: Partial<PostAnalytics> = {}): PostAnalytics {
  return {
    id: 'post-1',
    instagram_post_id: 'ig1',
    caption: 'Psoríase é uma doença do corpo inteiro.',
    media_type: 'CAROUSEL_ALBUM',
    permalink: 'https://instagram.com/p/1',
    posted_at: '2026-11-21T21:02:00Z',
    likes: 2515,
    comments: 23,
    reach: 74209,
    impressions: 121630,
    saved: 613,
    shares: 1208,
    views: 121630,
    reposts: null,
    rates: {
      share_rate: 1208 / 121630,
      like_rate: 2515 / 121630,
      save_rate: 613 / 121630,
      comment_rate: 23 / 121630,
    },
    unavailable_metrics: [],
    ig_score: 82,
    thumbnail_url: null,
    engagement_rate: 5.54,
    saves_rate: 0.83,
    tags: [],
    synced_at: null,
    profile_visits: 1284,
    follows: 24,
    bio_link_clicks: 136,
    follows_per_mil_reach: 0.32,
    ...over,
  };
}

function buckets(over: Partial<Record<string, number[]>> = {}) {
  return {
    share_rate: [],
    like_rate: [],
    save_rate: [],
    comment_rate: [],
    reach: [],
    ...over,
  } as RateDistributions['overall'];
}

type Props = Parameters<typeof PostMetricsView>[0];

function renderView(over: Partial<Props> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props: Props = {
    post: post(),
    clientId: 7,
    commentsEnabled: false,
    variant: 'dialog',
    ...over,
  };
  const wrap = (ui: ReactElement) => <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
  const utils = render(wrap(<PostMetricsView {...props} />));
  return {
    ...utils,
    rerenderView: (next: Partial<Props>) =>
      utils.rerender(wrap(<PostMetricsView {...props} {...next} />)),
  };
}

function openTab(name: string | RegExp) {
  fireEvent.click(screen.getByRole('tab', { name }));
}

beforeEach(() => {
  commentsMounts.count = 0;
});

describe('PostMetricsView', () => {
  it('shows the icon row with pt-BR numbers and hides Reposts when null', () => {
    renderView();
    const row = screen.getByRole('list', { name: 'Interações' });
    expect(within(row).getByText('2.515')).toBeInTheDocument();
    expect(within(row).getByText('Curtidas')).toBeInTheDocument();
    expect(within(row).getByText('1.208')).toBeInTheDocument();
    expect(within(row).getByText('Envios')).toBeInTheDocument();
    expect(within(row).getByText('Salvos')).toBeInTheDocument();
    expect(within(row).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.queryByText('Reposts')).not.toBeInTheDocument();
  });

  it('shows Reposts when the post has a number', () => {
    renderView({ post: post({ reposts: 41 }) });
    const row = screen.getByRole('list', { name: 'Interações' });
    expect(within(row).getByText('Reposts')).toBeInTheDocument();
    expect(within(row).getByText('41')).toBeInTheDocument();
    expect(within(row).getAllByRole('listitem')).toHaveLength(5);
  });

  it('Resumo for a carousel shows views, reach, profile visits and new followers', () => {
    renderView();
    expect(screen.getByText('Carrossel')).toBeInTheDocument();
    const resumo = screen.getByRole('region', { name: 'Resumo' });
    expect(within(resumo).getByText('Visualizações').nextSibling).toHaveTextContent('121.630');
    expect(within(resumo).getByText('Contas alcançadas').nextSibling).toHaveTextContent('74.209');
    expect(within(resumo).getByText('Visitas ao perfil').nextSibling).toHaveTextContent('1.284');
    expect(within(resumo).getByText('Novos seguidores').nextSibling).toHaveTextContent(/^24$/);
    expect(within(resumo).getByText('5,54%')).toBeInTheDocument();
    expect(within(resumo).getByText('82 de 100')).toBeInTheDocument();
    expect(screen.queryByText('Seguidores por mil alcançados')).not.toBeInTheDocument();
  });

  it('paints the engagement rate green only from 3%', () => {
    const { unmount } = renderView({ post: post({ engagement_rate: 3 }) });
    expect(screen.getByText('3,00%')).toHaveClass('post-metrics__ratio-value--good');
    unmount();
    renderView({ post: post({ engagement_rate: 2.99 }) });
    expect(screen.getByText('2,99%')).not.toHaveClass('post-metrics__ratio-value--good');
  });

  it('Resumo for a Reel shows "—" with the Reels reason for follows and profile visits', () => {
    renderView({
      post: post({
        media_type: 'VIDEO',
        follows: null,
        profile_visits: null,
        bio_link_clicks: null,
        follows_per_mil_reach: null,
        ig_score: null,
      }),
    });
    const reason = missingActionMetricTitle('follows', [], 'VIDEO');
    expect(reason).toBe('O Instagram não fornece este dado para Reels');
    expect(screen.getByText('Reel')).toBeInTheDocument();
    const resumo = screen.getByRole('region', { name: 'Resumo' });
    expect(within(resumo).getByText('Visitas ao perfil').nextSibling).toHaveTextContent('—');
    expect(within(resumo).getByText('Novos seguidores').nextSibling).toHaveTextContent('—');
    expect(within(resumo).getAllByText(reason)).toHaveLength(2);
    expect(within(resumo).queryByText('0')).not.toBeInTheDocument();
    expect(within(resumo).queryByText('IG Score')).not.toBeInTheDocument();
  });

  it('shows the publication time in São Paulo', () => {
    renderView();
    expect(screen.getByText('Publicado em 21 de nov. às 18:02')).toBeInTheDocument();
  });

  it('Engajamento lists actions, interactions and the reach-per-follower line', () => {
    renderView({ post: post({ reposts: 41 }) });
    openTab('Engajamento');
    expect(screen.queryByRole('region', { name: 'Resumo' })).not.toBeInTheDocument();

    const actions = screen.getByRole('region', { name: 'Ações após a visualização' });
    expect(within(actions).getByText('Visitas ao perfil').nextSibling).toHaveTextContent('1.284');
    expect(within(actions).getByText('Novos seguidores').nextSibling).toHaveTextContent(/^24$/);
    expect(within(actions).getByText('Toques no link da bio').nextSibling).toHaveTextContent('136');
    expect(
      within(actions).getByText('1 novo seguidor a cada 3.092 contas alcançadas'),
    ).toBeInTheDocument();

    const inter = screen.getByRole('region', { name: 'Interações' });
    expect(within(inter).getByText('Curtidas').nextSibling).toHaveTextContent('2.515');
    expect(within(inter).getByText('Comentários').nextSibling).toHaveTextContent(/^23$/);
    expect(within(inter).getByText('Reposts').nextSibling).toHaveTextContent(/^41$/);
    expect(within(inter).getByText('Compartilhamentos').nextSibling).toHaveTextContent('1.208');
    expect(within(inter).getByText('Salvamentos').nextSibling).toHaveTextContent('613');

    expect(
      screen.getByText(
        'O Instagram não informa curtidas por foto do carrossel, de onde vieram as visualizações nem o público do post.',
      ),
    ).toBeInTheDocument();
  });

  it('Engajamento shows "—" with a reason for missing actions and no conversion line', () => {
    renderView({
      post: post({ follows: null, bio_link_clicks: null, unavailable_metrics: ['follows'] }),
    });
    openTab('Engajamento');
    const actions = screen.getByRole('region', { name: 'Ações após a visualização' });
    const follows = within(actions).getByText('Novos seguidores').nextSibling as HTMLElement;
    expect(follows).toHaveTextContent('—');
    expect(follows).toHaveAttribute(
      'title',
      'O Instagram não retornou este dado na última sincronização',
    );
    expect(within(actions).queryByText(/novo seguidor a cada/)).not.toBeInTheDocument();
  });

  it('treats undefined action metrics (pre-migration rows) like null, never 0', () => {
    const p = post();
    delete (p as Partial<PostAnalytics>).profile_visits;
    renderView({ post: p });
    const resumo = screen.getByRole('region', { name: 'Resumo' });
    expect(within(resumo).getByText('Visitas ao perfil').nextSibling).toHaveTextContent('—');
    openTab('Engajamento');
    const actions = screen.getByRole('region', { name: 'Ações após a visualização' });
    expect(within(actions).getByText('Visitas ao perfil').nextSibling).toHaveTextContent('—');
  });

  it('Engajamento gives every action row of a Reel the Reels reason', () => {
    renderView({
      post: post({
        media_type: 'VIDEO',
        follows: null,
        profile_visits: null,
        bio_link_clicks: null,
        follows_per_mil_reach: null,
        unavailable_metrics: ['follows', 'profile_visits', 'bio_link_clicks'],
      }),
    });
    openTab('Engajamento');
    const actions = screen.getByRole('region', { name: 'Ações após a visualização' });
    for (const label of ['Visitas ao perfil', 'Novos seguidores', 'Toques no link da bio']) {
      expect(within(actions).getByText(label).nextSibling).toHaveAttribute(
        'title',
        'O Instagram não fornece este dado para Reels',
      );
    }
  });

  it('hides the rate block without dists and omits the median tick below MIN_SAMPLE', () => {
    const { unmount } = renderView();
    openTab('Engajamento');
    expect(screen.queryByRole('region', { name: 'Por visualização' })).not.toBeInTheDocument();
    unmount();

    // share_rate has 5 samples (tick), like_rate only 3 (no tick); the format bucket is empty,
    // so selectRateSamples falls back to the overall sample.
    const dists: RateDistributions = {
      overall: buckets({
        share_rate: [0.002, 0.004, 0.005, 0.006, 0.008],
        like_rate: [0.01, 0.02, 0.03],
        save_rate: [0.001, 0.002, 0.003, 0.004, 0.005],
        comment_rate: [0.0001, 0.0002, 0.0003, 0.0004, 0.0005],
      }),
      byFormat: {},
    };
    const second = renderView({
      dists,
      post: post({ rates: { ...post().rates, save_rate: null } }),
    });
    openTab('Engajamento');
    const block = screen.getByRole('region', { name: 'Por visualização' });
    // save_rate is null, so its row is hidden.
    expect(within(block).queryByText('Salvamentos')).not.toBeInTheDocument();
    const shareRow = within(block).getByText('Compartilhamentos').closest('.post-metrics__rate');
    const likeRow = within(block).getByText('Curtidas').closest('.post-metrics__rate');
    expect(shareRow?.querySelector('.post-metrics__rate-tick')).not.toBeNull();
    expect(likeRow?.querySelector('.post-metrics__rate-tick')).toBeNull();
    // 1208 / 121630 = 0,99%
    expect(within(shareRow as HTMLElement).getByText('0,99%')).toBeInTheDocument();
    expect(within(likeRow as HTMLElement).getByText('2,07%')).toBeInTheDocument();
    for (const fill of second.container.querySelectorAll<HTMLElement>('.post-metrics__rate-fill')) {
      expect(fill.style.width).toMatch(/^\d+(\.\d+)?%$/);
    }
  });

  it("scales bars without a median against the post's own largest rate", () => {
    // Every bucket is below MIN_SAMPLE, so no row has a median.
    const dists: RateDistributions = { overall: buckets(), byFormat: {} };
    renderView({ dists });
    openTab('Engajamento');
    const block = screen.getByRole('region', { name: 'Por visualização' });
    const fill = (label: string) =>
      (
        within(block).getByText(label).closest('.post-metrics__rate') as HTMLElement
      ).querySelector<HTMLElement>('.post-metrics__rate-fill')!.style.width;
    // like_rate (2515) is the largest, so it fills the track; the others follow in proportion.
    expect(fill('Curtidas')).toBe('100%');
    expect(parseFloat(fill('Compartilhamentos'))).toBeCloseTo((1208 / 2515) * 100, 5);
    expect(parseFloat(fill('Comentários'))).toBeCloseTo((23 / 2515) * 100, 5);
    expect(fill('Compartilhamentos')).not.toBe(fill('Curtidas'));
  });

  it('a count Instagram did not return reads "—" with the reason, never 0', () => {
    renderView({
      post: post({
        views: 0,
        impressions: 0,
        reach: 0,
        likes: 0,
        saved: 0,
        engagement_rate: 0,
        rates: { share_rate: null, like_rate: null, save_rate: null, comment_rate: null },
        unavailable_metrics: ['impressions', 'reach', 'likes', 'saved'],
      }),
    });
    const reason = 'O Instagram não retornou este dado na última sincronização';
    const resumo = screen.getByRole('region', { name: 'Resumo' });
    for (const label of ['Visualizações', 'Contas alcançadas']) {
      const card = within(resumo).getByText(label).parentElement as HTMLElement;
      expect(card).toHaveClass('post-metrics__card--missing');
      expect(within(card).getByText('—')).toBeInTheDocument();
      expect(within(card).getByText(reason)).toBeInTheDocument();
    }
    const engagement = within(resumo).getByText('Engajamento').parentElement as HTMLElement;
    expect(within(engagement).getByText('—')).toBeInTheDocument();
    expect(within(engagement).getByText(reason)).toBeInTheDocument();
    expect(within(resumo).queryByText('0,00%')).not.toBeInTheDocument();

    const row = screen.getByRole('list', { name: 'Interações' });
    const stat = (label: string) => within(row).getByText(label).closest('li') as HTMLElement;
    expect(stat('Curtidas').querySelector('strong')).toHaveTextContent('—');
    expect(stat('Curtidas').querySelector('strong')).toHaveAttribute('title', reason);
    expect(stat('Salvos').querySelector('strong')).toHaveTextContent('—');
    // Returned counts keep their number.
    expect(stat('Comentários').querySelector('strong')).toHaveTextContent('23');
    expect(stat('Envios').querySelector('strong')).toHaveTextContent('1.208');
    expect(within(row).queryByText('0')).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'Curtidas e Salvos: o Instagram não retornou estes dados na última sincronização.',
      ),
    ).toBeInTheDocument();

    openTab('Engajamento');
    const interacoes = screen.getByRole('region', { name: 'Interações' });
    expect(within(interacoes).getByText('Curtidas').nextSibling).toHaveTextContent('—');
    expect(within(interacoes).getByText('Salvamentos').nextSibling).toHaveTextContent('—');
    expect(within(interacoes).getByText('Comentários').nextSibling).toHaveTextContent('23');
  });

  it('a real 0 Instagram did return still reads 0', () => {
    renderView({
      post: post({
        views: 0,
        impressions: 0,
        reach: 0,
        likes: 0,
        saved: 0,
        engagement_rate: 0,
        unavailable_metrics: [],
      }),
    });
    const resumo = screen.getByRole('region', { name: 'Resumo' });
    expect(within(resumo).getByText('Visualizações').nextSibling).toHaveTextContent(/^0$/);
    expect(within(resumo).getByText('Contas alcançadas').nextSibling).toHaveTextContent(/^0$/);
    expect(within(resumo).getByText('0,00%')).toBeInTheDocument();
    expect(within(resumo).queryByText('—')).not.toBeInTheDocument();
    const row = screen.getByRole('list', { name: 'Interações' });
    const stat = (label: string) => within(row).getByText(label).closest('li') as HTMLElement;
    expect(stat('Curtidas').querySelector('strong')).toHaveTextContent(/^0$/);
    expect(stat('Salvos').querySelector('strong')).toHaveTextContent(/^0$/);
  });

  it('a value kept from an earlier sync still shows when this sync skipped it', () => {
    renderView({ post: post({ unavailable_metrics: ['reach', 'likes'] }) });
    const resumo = screen.getByRole('region', { name: 'Resumo' });
    expect(within(resumo).getByText('Contas alcançadas').nextSibling).toHaveTextContent('74.209');
    expect(within(resumo).getByText('5,54%')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Interações' })).toHaveTextContent('2.515');
  });

  it('mounts the comments panel only after its tab is opened, and only with the flag', () => {
    const { unmount } = renderView({ commentsEnabled: false });
    expect(screen.queryByRole('tab', { name: /Comentários/ })).not.toBeInTheDocument();
    expect(commentsMounts.count).toBe(0);
    unmount();

    renderView({ commentsEnabled: true });
    expect(commentsMounts.count).toBe(0);
    expect(screen.queryByTestId('comments-panel')).not.toBeInTheDocument();
    openTab('Comentários · 23');
    expect(screen.getByTestId('comments-panel')).toBeInTheDocument();
    expect(commentsMounts.count).toBe(1);
    expect(screen.getByRole('tabpanel')).toContainElement(screen.getByTestId('comments-panel'));
  });

  it('returns to Visão geral when the post changes', () => {
    const { rerenderView } = renderView({ commentsEnabled: true });
    openTab('Engajamento');
    expect(screen.getByRole('tab', { name: 'Engajamento' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    rerenderView({ post: post({ id: 'post-2', instagram_post_id: 'ig2' }) });
    expect(screen.getByRole('tab', { name: 'Visão geral' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('region', { name: 'Resumo' })).toBeInTheDocument();
  });

  it('renders overviewFooter at the end of Visão geral only', () => {
    renderView({ overviewFooter: <div data-testid="tags-group">Tags</div> });
    const panel = screen.getByRole('tabpanel');
    const footer = within(panel).getByTestId('tags-group');
    expect(panel.lastElementChild).toContainElement(footer);
    openTab('Engajamento');
    expect(screen.queryByTestId('tags-group')).not.toBeInTheDocument();
  });

  it('sheet variant renders a SegmentedControl tablist', () => {
    renderView({ variant: 'sheet', commentsEnabled: true });
    const tablist = screen.getByRole('tablist', { name: 'Detalhes do post' });
    expect(tablist).toHaveClass('phone-segmented');
    expect(within(tablist).getAllByRole('tab')).toHaveLength(3);
    openTab('Engajamento');
    expect(screen.getByRole('region', { name: 'Ações após a visualização' })).toBeInTheDocument();
  });

  it('dialog variant renders underline tabs wired to the panel', () => {
    renderView({ commentsEnabled: true });
    const tablist = screen.getByRole('tablist', { name: 'Detalhes do post' });
    expect(tablist).not.toHaveClass('phone-segmented');
    const selected = within(tablist).getByRole('tab', { name: 'Visão geral' });
    expect(selected).toHaveAttribute('aria-selected', 'true');
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', selected.id);
    expect(selected).toHaveAttribute('aria-controls', panel.id);
  });

  it('shows the footer with the sync age, and a "Ver mais" button only when the caption overflows', () => {
    renderView({ post: post({ synced_at: new Date(Date.now() - 2 * 3600_000).toISOString() }) });
    expect(
      screen.getByText('Dados da API oficial do Instagram. Podem levar até 48 h para fechar.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Atualizado há 2 h')).toBeInTheDocument();
    // jsdom has no layout, so the clamp never overflows here.
    expect(screen.queryByRole('button', { name: 'Ver mais' })).not.toBeInTheDocument();
  });

  it('"Ver mais" is a button that expands a caption that overflows the clamp', () => {
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(120);
    const client = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(60);
    try {
      renderView();
      const more = screen.getByRole('button', { name: 'Ver mais' });
      expect(more).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(more);
      expect(screen.getByRole('button', { name: 'Ver menos' })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    } finally {
      scroll.mockRestore();
      client.mockRestore();
    }
  });
});
