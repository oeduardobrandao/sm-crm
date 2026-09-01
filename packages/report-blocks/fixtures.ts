// Fixture de snapshot para testes e para o drawer do editor (PR 2).
import type { ReportDocSnapshot } from './types';

export function makeSnapshotFixture(over: Partial<ReportDocSnapshot> = {}): ReportDocSnapshot {
  return {
    version: 1,
    period: {
      month: '2026-07',
      label: 'Julho de 2026',
      start: '2026-07-01T00:00:00.000Z',
      endExclusive: '2026-08-01T00:00:00.000Z',
      effectiveEnd: '2026-07-31T00:00:00.000Z',
    },
    account: { handle: 'dra.exemplo', specialty: 'Dermatologia · São Paulo' },
    branding: {
      workspace_name: 'DK Marketing',
      logo_url: null,
      splash_url: null,
      accent_color: '#7c3aed',
    },
    kpis: {
      followers_gained: { value: 132, unit: 'count', prev: 98 },
      followers_total: { value: 12450, unit: 'count', prev: 12318 },
      reach: { value: 45200, unit: 'count', prev: 39800 },
      views: { value: 88400, unit: 'count', prev: 74100 },
      engagement_rate: { value: 4.7, unit: 'pct', prev: 4.1 },
      saves: { value: 310, unit: 'count', prev: 265 },
      posts_count: { value: 14, unit: 'count', prev: 12 },
      profile_views: { value: 2210, unit: 'count', prev: 1980 },
      website_clicks: { value: 87, unit: 'count', prev: 90 },
    },
    follower_trend: [
      { date: '2026-07-01', count: 12320 },
      { date: '2026-07-10', count: 12360 },
      { date: '2026-07-20', count: 12410 },
      { date: '2026-07-31', count: 12450 },
    ],
    content_breakdown: {
      reels: { count: 6, avg_reach: 5200, avg_engagement: 0.05, avg_views: 9100 },
      carousels: { count: 5, avg_reach: 2900, avg_engagement: 0.062, avg_views: 4300 },
      images: { count: 3, avg_reach: 1400, avg_engagement: 0.064, avg_views: 2050 },
    },
    top_posts: [
      {
        type: 'reel',
        views: 18400,
        reach: 9800,
        likes: 540,
        comments: 44,
        saves: 88,
        shares: 12,
        caption_preview: 'Mitos sobre protetor solar',
        date: '2026-07-12T14:00:00Z',
        permalink: 'https://instagram.com/p/a',
        thumbnail_url: null,
      },
      {
        type: 'carousel',
        views: 9700,
        reach: 6200,
        likes: 380,
        comments: 21,
        saves: 65,
        shares: 9,
        caption_preview: '5 sinais de alerta na pele',
        date: '2026-07-05T14:00:00Z',
        permalink: 'https://instagram.com/p/b',
        thumbnail_url: null,
      },
    ],
    audience: {
      gender_split: { female: 78, male: 22 },
      top_cities: [
        { name: 'São Paulo', pct: 42 },
        { name: 'Campinas', pct: 11 },
      ],
      top_age_ranges: [
        { range: '25-34', pct: 38 },
        { range: '35-44', pct: 31 },
      ],
      top_countries: [{ name: 'Brasil', pct: 96 }],
    },
    best_times: [
      { day: 'Seg', hour: 12, avg_engagement: 210 },
      { day: 'Qua', hour: 19, avg_engagement: 260 },
    ],
    tags_performance: [{ tag: 'Educativo', avg_engagement: 4.2, avg_reach: 5100, count: 6 }],
    ...over,
  };
}
