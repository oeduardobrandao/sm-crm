import i18n from 'i18next';
import pt from '../../../../../../packages/i18n/locales/pt/analyticsYoutube.json';
import en from '../../../../../../packages/i18n/locales/en/analyticsYoutube.json';
import type { YtPortfolioChannel } from '../../../services/youtubeAnalytics';

/** The shared vitest setup does not list the `analyticsYoutube` namespace; register it here. */
export function registerYouTubeI18n() {
  i18n.addResourceBundle('pt', 'analyticsYoutube', pt, true, true);
  i18n.addResourceBundle('en', 'analyticsYoutube', en, true, true);
}

const HOUR = 3_600_000;
export const hoursAgo = (h: number) => new Date(Date.now() - h * HOUR).toISOString();

export function channel(
  clientId: number,
  clientName: string,
  extra: Partial<YtPortfolioChannel> = {},
): YtPortfolioChannel {
  return {
    clientId,
    clientName,
    title: `${clientName} TV`,
    handle: `@${clientName.toLowerCase().replace(/\s/g, '')}`,
    avatarUrl: null,
    subscriberCount: 1000,
    authorizationStatus: 'active',
    lastSyncedAt: hoursAgo(1),
    window: {
      start: '2026-10-03',
      end: '2026-10-30',
      prevStart: '2026-09-05',
      prevEnd: '2026-10-02',
    },
    metrics: {
      netSubscribers: 10,
      views: 1000,
      watchMinutes: 600,
      avgViewDurationS: 42,
      shortsShare: 0.5,
    },
    ...extra,
  };
}

/** A revoked channel after its purge: no window, every metric null. */
export function revoked(
  clientId: number,
  clientName: string,
  extra: Partial<YtPortfolioChannel> = {},
) {
  return channel(clientId, clientName, {
    authorizationStatus: 'revoked',
    window: null,
    metrics: {
      netSubscribers: null,
      views: null,
      watchMinutes: null,
      avgViewDurationS: null,
      shortsShare: null,
    },
    ...extra,
  });
}

export function channels(): YtPortfolioChannel[] {
  return [
    channel(1, 'Ana Lima', {
      title: 'Dra. Ana Lima',
      subscriberCount: 48310,
      metrics: {
        netSubscribers: 1204,
        views: 212480,
        watchMinutes: 414720,
        avgViewDurationS: 42,
        shortsShare: 0.71,
      },
    }),
    channel(2, 'Odonto Sorriso', {
      title: 'Odonto Sorriso Oficial',
      subscriberCount: 21077,
      metrics: {
        netSubscribers: -36,
        views: 98140,
        watchMinutes: 204300,
        avgViewDurationS: 358,
        shortsShare: null,
      },
    }),
    revoked(3, 'Studio Bella', { title: 'Studio Bella', subscriberCount: 5880 }),
  ];
}
