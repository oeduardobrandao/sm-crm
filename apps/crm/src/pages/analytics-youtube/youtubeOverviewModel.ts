// Filter, sort and cell formatting for `/analytics/youtube`. Every row is one channel over its
// own window: the page never adds rows up, so nothing here computes a number across channels
// except counts.
import { formatDistanceToNowStrict } from 'date-fns';
import { enUS, ptBR } from 'date-fns/locale';
import type { YtPortfolioChannel } from '../../services/youtubeAnalytics';
import {
  MISSING,
  formatCount,
  formatDuration,
  formatSigned,
} from '../analytics-conta/youtube/youtubeTabFormat';

export type YtChannelSortCol =
  | 'subscriberCount'
  | 'netSubscribers'
  | 'views'
  | 'watchHours'
  | 'shortsShare'
  | 'avgViewDurationS'
  | 'lastSyncedAt'
  | 'title';

export type YtStatusFilter = 'all' | 'revoked';

export interface YtChannelFilter {
  query: string;
  /** A client id as a string, or 'all'. */
  clientId: string;
  status: YtStatusFilter;
}

/** Lower case without accents, so "clinica" finds "Clínica". */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The name a channel shows: its title, else its handle. */
export const channelName = (c: YtPortfolioChannel): string | null => c.title ?? c.handle;

/** Search (title, handle or client name), client and status, in that order. */
export function filterChannels(
  channels: YtPortfolioChannel[],
  { query, clientId, status }: YtChannelFilter,
): YtPortfolioChannel[] {
  const q = fold(query.trim());
  return channels.filter((c) => {
    if (clientId !== 'all' && String(c.clientId) !== clientId) return false;
    if (status === 'revoked' && c.authorizationStatus !== 'revoked') return false;
    if (!q) return true;
    return [c.title, c.handle, c.clientName].some((s) => s && fold(s).includes(q));
  });
}

/** Channel counts per status: Mesaas link records, not YouTube metrics. */
export function statusCounts(channels: YtPortfolioChannel[]): Record<YtStatusFilter, number> {
  return {
    all: channels.length,
    revoked: channels.filter((c) => c.authorizationStatus === 'revoked').length,
  };
}

/**
 * The value a metric cell shows. A revoked channel's history is purged on revocation, so its
 * window metrics read as missing even if the server answered before the purge ran: the cell
 * and the sort agree.
 */
export function metricOf(c: YtPortfolioChannel, col: YtMetricCol): number | null {
  if (col === 'subscriberCount') return c.subscriberCount;
  if (c.authorizationStatus === 'revoked') return null;
  if (col === 'watchHours') {
    return c.metrics.watchMinutes === null ? null : c.metrics.watchMinutes / 60;
  }
  return c.metrics[col];
}

function sortValue(c: YtPortfolioChannel, col: YtChannelSortCol): number | string | null {
  if (col === 'title') return channelName(c);
  if (col === 'lastSyncedAt') {
    const t = c.lastSyncedAt ? Date.parse(c.lastSyncedAt) : NaN;
    return Number.isNaN(t) ? null : t;
  }
  return metricOf(c, col);
}

export type YtMetricCol = Exclude<YtChannelSortCol, 'title' | 'lastSyncedAt'>;

/** The numeric columns, in table order. */
export const METRIC_COLS: readonly YtMetricCol[] = [
  'subscriberCount',
  'netSubscribers',
  'views',
  'watchHours',
  'shortsShare',
  'avgViewDurationS',
];

/** Every column the table and the phone sort sheet offer. */
export const SORT_COLS: readonly YtChannelSortCol[] = ['title', ...METRIC_COLS, 'lastSyncedAt'];

/** Shorts share 0..1 as a whole percent, the Shorts split card's rounding. */
export const shortsPct = (share: number): number => Math.round(share * 100);

/** One metric cell as text; a missing value reads as the dash, never 0. */
export function formatMetric(c: YtPortfolioChannel, col: YtMetricCol): string {
  const v = metricOf(c, col);
  if (v === null) return MISSING;
  switch (col) {
    case 'netSubscribers':
      return formatSigned(v);
    case 'watchHours':
      return formatCount(Math.round(v));
    case 'shortsShare':
      return `${shortsPct(v)}%`;
    case 'avgViewDurationS':
      return formatDuration(v);
    default:
      return formatCount(v);
  }
}

/** "há 2 horas"; null before the first sync. */
export function syncedAgo(iso: string | null, language: string): string | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return null;
  return formatDistanceToNowStrict(t, {
    addSuffix: true,
    locale: language.startsWith('en') ? enUS : ptBR,
  });
}

/** A presentation of independent rows, not a ranking. Missing values go last either way. */
export function sortChannels(
  channels: YtPortfolioChannel[],
  col: YtChannelSortCol,
  dir: 'asc' | 'desc',
): YtPortfolioChannel[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...channels].sort((a, b) => {
    const va = sortValue(a, col);
    const vb = sortValue(b, col);
    if (va === null || vb === null) {
      if (va === vb) return 0;
      return va === null ? 1 : -1;
    }
    const cmp =
      typeof va === 'string' || typeof vb === 'string'
        ? String(va).localeCompare(String(vb), 'pt-BR')
        : va - vb;
    return cmp * sign;
  });
}
