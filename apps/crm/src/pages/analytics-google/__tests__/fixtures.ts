import i18n from 'i18next';
import pt from '../../../../../../packages/i18n/locales/pt/analyticsGoogle.json';
import en from '../../../../../../packages/i18n/locales/en/analyticsGoogle.json';
import type {
  GbpAttentionReview,
  GbpPortfolio,
  GbpPortfolioUnit,
} from '../../../services/gbpAnalytics';

/** The shared vitest setup does not list the `analyticsGoogle` namespace; register it here. */
export function registerGoogleI18n() {
  i18n.addResourceBundle('pt', 'analyticsGoogle', pt, true, true);
  i18n.addResourceBundle('en', 'analyticsGoogle', en, true, true);
}

const HOUR = 3_600_000;
export const hoursAgo = (h: number) => new Date(Date.now() - h * HOUR).toISOString();

export function unit(id: string, extra: Partial<GbpPortfolioUnit> = {}): GbpPortfolioUnit {
  const base: GbpPortfolioUnit = {
    id,
    clientId: 1,
    clientName: 'Clínica Alfa',
    especialidade: null,
    title: `Unidade ${id}`,
    status: 'active',
    mapsUri: `https://maps.google.com/?cid=${id}`,
    lastSyncedAt: hoursAgo(2),
    stale: false,
    profileViews: 100,
    prevProfileViews: 80,
    calls: 1,
    directions: 1,
    websiteClicks: 1,
    messages: 1,
    bookings: 0,
    actions: 4,
    avgRating: 4.5,
    reviewCount: 20,
    newReviews: 1,
  };
  return { ...base, ...extra };
}

export function review(i: number, extra: Partial<GbpAttentionReview> = {}): GbpAttentionReview {
  return {
    unitId: 'u1',
    clientId: 1,
    unitTitle: 'Unidade u1',
    mapsUri: 'https://maps.google.com/?cid=u1',
    reviewerName: `Pessoa ${i}`,
    starRating: 2,
    comment: `Comentário ${i}`,
    createTime: hoursAgo(i + 1),
    ...extra,
  };
}

export function portfolio(extra: Partial<GbpPortfolio> = {}): GbpPortfolio {
  const units = extra.units ?? [
    unit('u1', {
      clientId: 1,
      clientName: 'Clínica Alfa',
      title: 'Alfa Moema',
      profileViews: 1200,
      prevProfileViews: 1000,
      calls: 30,
      directions: 20,
      websiteClicks: 10,
      messages: 5,
      bookings: 0,
      actions: 65,
      avgRating: 4.8,
      reviewCount: 120,
      newReviews: 6,
    }),
    unit('u2', {
      clientId: 2,
      clientName: 'Odonto Beta',
      title: 'Beta Centro',
      profileViews: 800,
      prevProfileViews: 400,
      calls: 10,
      directions: 5,
      websiteClicks: 3,
      messages: 2,
      bookings: 0,
      actions: 20,
      avgRating: 4.2,
      reviewCount: 30,
      newReviews: 2,
    }),
  ];
  return {
    window: {
      start: '2026-09-28',
      end: '2026-10-27',
      prevStart: '2026-08-29',
      prevEnd: '2026-09-27',
    },
    dataThrough: '2026-10-27',
    kpis: {
      units: units.length,
      revokedUnits: units.filter((u) => u.status === 'revoked').length,
      profileViews: { value: 2000, prev: 1400 },
      actions: { value: 85, prev: 70 },
      avgRating: { value: 4.7, prev: 4.6 },
      newReviews: { value: 8, prev: 5 },
    },
    units,
    reviewsAttention: [review(0)],
    ...extra,
  };
}
