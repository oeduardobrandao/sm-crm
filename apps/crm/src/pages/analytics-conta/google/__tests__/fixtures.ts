import i18n from 'i18next';
import pt from '../../../../../../../packages/i18n/locales/pt/analyticsGoogle.json';
import en from '../../../../../../../packages/i18n/locales/en/analyticsGoogle.json';
import type {
  GbpDailyPoint,
  GbpKeywords,
  GbpKpiEntry,
  GbpKpiId,
  GbpOverview,
  GbpRatingDistribution,
  GbpReview,
  GbpSurfaceRow,
  GbpUnitRow,
} from '../../../../services/gbpAnalytics';

/** The shared vitest setup does not list the `analyticsGoogle` namespace; register it here. */
export function registerGoogleI18n() {
  i18n.addResourceBundle('pt', 'analyticsGoogle', pt, true, true);
  i18n.addResourceBundle('en', 'analyticsGoogle', en, true, true);
}

export const MOEMA = '11111111-1111-4111-8111-111111111111';
export const PINHEIROS = '22222222-2222-4222-8222-222222222222';

const entry = (value: number | null, prev: number | null): GbpKpiEntry => ({ value, prev });

export function overview(
  kpis: Partial<Record<GbpKpiId, GbpKpiEntry>> = {},
  dataThrough: string | null = '2026-10-27',
): GbpOverview {
  return {
    dataThrough,
    window: {
      start: '2026-09-28',
      end: '2026-10-27',
      prevStart: '2026-08-29',
      prevEnd: '2026-09-27',
    },
    kpis: {
      profile_views: entry(24800, 22342),
      calls: entry(386, 360),
      directions: entry(1204, 1047),
      website_clicks: entry(642, 662),
      messages: entry(158, 130),
      bookings: entry(41, 41),
      avg_rating: entry(4.7, 4.6),
      new_reviews: entry(23, 18),
      ...kpis,
    },
  };
}

export function unit(id: string, title: string, extra: Partial<GbpUnitRow> = {}): GbpUnitRow {
  return {
    id,
    title,
    status: 'active',
    profileViews: 16204,
    calls: 251,
    directions: 812,
    websiteClicks: 430,
    messages: 96,
    bookings: 20,
    avgRating: 4.8,
    totalReviewCount: 312,
    ...extra,
  };
}

export const twoUnits = (): GbpUnitRow[] => [
  unit(MOEMA, 'Moema'),
  unit(PINHEIROS, 'Pinheiros', { profileViews: 8611, avgRating: 4.6, totalReviewCount: 128 }),
];

export function daily(): GbpDailyPoint[] {
  return ['2026-10-25', '2026-10-26', '2026-10-27'].map((date, i) => ({
    date,
    profileViews: 800 + i,
    calls: 12,
    directions: 40,
    websiteClicks: 21,
    messages: 5,
    bookings: 1,
  }));
}

export function surfaces(): GbpSurfaceRow[] {
  return [
    { surface: 'mobile_search', value: 10920, pct: 44 },
    { surface: 'mobile_maps', value: 8430, pct: 34 },
    { surface: 'desktop_search', value: 3720, pct: 15 },
    { surface: 'desktop_maps', value: 1730, pct: 7 },
  ];
}

export function keywords(): GbpKeywords {
  return {
    month: '2026-09',
    months: ['2026-08', '2026-09'],
    keywords: [
      { keyword: 'dentista moema', value: 1240, threshold: null },
      { keyword: 'clínica odontológica', value: 860, threshold: null },
      { keyword: 'lente de contato dental preço', value: null, threshold: 15 },
    ],
  };
}

export function review(name: string, extra: Partial<GbpReview> = {}): GbpReview {
  return {
    reviewer: name,
    rating: 5,
    comment: `Comentário de ${name}`,
    unitTitle: 'Moema',
    unitMapsUri: 'https://maps.google.com/?cid=123',
    createTime: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    hasReply: true,
    ...extra,
  };
}

export function distribution(extra: Partial<GbpRatingDistribution> = {}): GbpRatingDistribution {
  return {
    counts: { '1': 9, '2': 6, '3': 14, '4': 49, '5': 362 },
    storedTotal: 440,
    total: 440,
    partial: false,
    ...extra,
  };
}
