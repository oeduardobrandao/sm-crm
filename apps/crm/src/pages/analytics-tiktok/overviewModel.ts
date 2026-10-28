// What the TikTok overview page and its phone variant share: the numbers, the account sort,
// the video rankings and the "all videos" drawer state.
import { useCallback, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { enUS, ptBR } from 'date-fns/locale';
import type { TFunction } from 'i18next';
import type {
  TikTokPortfolio,
  TikTokPortfolioRow,
  TikTokPortfolioVideo,
} from '../../services/tiktokAnalytics';
import { filterByPostedRange, postedMs, rankByViews, sortNullsLast } from './videoRanking';

export type TFn = TFunction<'analyticsTiktok'>;

export interface SyncResult {
  success: number;
  failed: number;
  failedNames: string[];
}

export function syncSummary(t: TFn, r: SyncResult): string {
  const ok = t('overview.syncResult', { count: r.success });
  return r.failed > 0
    ? `${ok}, ${t('overview.syncFailedList', { count: r.failed, names: r.failedNames.join(', ') })}`
    : ok;
}

const DAY_MS = 86_400_000;

export const formatNumber = (n: number | null | undefined): string =>
  (n ?? 0).toLocaleString('pt-BR');

/** A rate in percent; null (no views) reads "—", never 0%. */
export const formatPct = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : `${v.toFixed(2).replace('.', ',')}%`;

export function formatDay(iso: string | null, language: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return language.startsWith('en')
    ? format(d, 'MMM d', { locale: enUS })
    : format(d, "d 'de' MMM", { locale: ptBR });
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function daysSince(iso: string | null): number | null {
  return iso ? Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS) : null;
}

/** No video for more than 7 days (fractional, like Instagram), or never (`null`). */
export function isSilent(row: TikTokPortfolioRow): boolean {
  if (!row.last_posted_at) return true;
  return (Date.now() - new Date(row.last_posted_at).getTime()) / DAY_MS > 7;
}

export function engagementVariant(rate: number | null): 'success' | 'warning' | 'neutral' {
  if (rate === null) return 'neutral';
  return rate >= 3 ? 'success' : rate >= 1 ? 'warning' : 'neutral';
}

// ─── Accounts ───────────────────────────────────────────────────────────

export type AccountSortCol =
  'client_name' | 'follower_count' | 'engagement_rate' | 'views' | 'posts_count' | 'last_posted_at';

export const ACCOUNT_SORT_COLS: AccountSortCol[] = [
  'client_name',
  'follower_count',
  'engagement_rate',
  'views',
  'posts_count',
  'last_posted_at',
];

export function sortAccounts(
  rows: TikTokPortfolioRow[],
  col: AccountSortCol,
  dir: 'asc' | 'desc',
): TikTokPortfolioRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (col === 'client_name') return a.client_name.localeCompare(b.client_name, 'pt-BR') * sign;
    const val = (r: TikTokPortfolioRow): number => {
      if (col === 'last_posted_at') return r.last_posted_at ? Date.parse(r.last_posted_at) : -1;
      return r[col] ?? -1;
    };
    return (val(a) - val(b)) * sign;
  });
}

export interface PortfolioTotals {
  accounts: number;
  followers: number | null;
  views: number | null;
  engagement_rate: number | null;
  posts_count: number;
}

const sumOrNull = (values: (number | null)[]): number | null => {
  const present = values.filter((v): v is number => v !== null);
  return present.length ? present.reduce((s, v) => s + v, 0) : null;
};

/**
 * The server totals when nobody is filtered out; otherwise recomputed from the visible rows.
 * Each row's rate is interactions / views, so weighting it by views gives the aggregate rate.
 */
export function totalsFor(
  rows: TikTokPortfolioRow[],
  all: TikTokPortfolio['totals'],
  filtered: boolean,
): PortfolioTotals {
  if (!filtered) return all;
  const weighted = rows.filter((r) => r.engagement_rate !== null && (r.views ?? 0) > 0);
  const viewsWeight = weighted.reduce((s, r) => s + (r.views ?? 0), 0);
  return {
    accounts: rows.length,
    followers: sumOrNull(rows.map((r) => r.follower_count)),
    views: sumOrNull(rows.map((r) => r.views)),
    engagement_rate: viewsWeight
      ? weighted.reduce((s, r) => s + (r.engagement_rate as number) * (r.views ?? 0), 0) /
        viewsWeight
      : null,
    posts_count: rows.reduce((s, r) => s + r.posts_count, 0),
  };
}

export interface SpecialtyStat {
  specialty: string | null;
  count: number;
  avgEngagement: number | null;
  avgFollowers: number;
}

export function specialtyStatsFor(rows: TikTokPortfolioRow[]): SpecialtyStat[] {
  const groups = new Map<string | null, TikTokPortfolioRow[]>();
  for (const r of rows) {
    const key = r.especialidade || null;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([specialty, accs]) => {
      const rates = accs.map((a) => a.engagement_rate).filter((v): v is number => v !== null);
      const followers = accs.map((a) => a.follower_count ?? 0);
      return {
        specialty,
        count: accs.length,
        avgEngagement: rates.length ? rates.reduce((s, v) => s + v, 0) / rates.length : null,
        avgFollowers: Math.round(followers.reduce((s, v) => s + v, 0) / accs.length),
      };
    })
    .sort((a, b) => (b.avgEngagement ?? -1) - (a.avgEngagement ?? -1));
}

/** The row with the highest score; rows without one never lead. */
export function leaderOf<T>(rows: T[], score: (r: T) => number | null): T | undefined {
  let best: T | undefined;
  let bestScore = -Infinity;
  for (const r of rows) {
    const s = score(r);
    if (s !== null && s > bestScore) {
      best = r;
      bestScore = s;
    }
  }
  return best;
}

// ─── Videos ─────────────────────────────────────────────────────────────

/**
 * `top` / `bottom` are the server's strips (5 most viewed, 5 fewest among videos older than
 * 48h). `best` / `worst` are what the "Ver todos" sheets list: every video of the window by
 * views, and the ones posted more than 48h ago, fewest views first.
 */
export function rankVideos(portfolio: TikTokPortfolio): {
  top: TikTokPortfolioVideo[];
  bottom: TikTokPortfolioVideo[];
  best: TikTokPortfolioVideo[];
  worst: TikTokPortfolioVideo[];
} {
  return {
    top: portfolio.topVideos,
    bottom: portfolio.bottomVideos,
    ...rankByViews(portfolio.videos),
  };
}

export type VideoOrder = 'views' | 'likes' | 'engagement' | 'date';
export const VIDEO_ORDERS: VideoOrder[] = ['views', 'likes', 'engagement', 'date'];

export interface VideoDrawerState {
  mode: 'best' | 'worst' | null;
  open: (mode: 'best' | 'worst') => void;
  close: () => void;
  videos: TikTokPortfolioVideo[];
  /** Videos the open list draws from, before the filters. */
  total: number;
  orderBy: VideoOrder;
  setOrderBy: (v: VideoOrder) => void;
  asc: boolean;
  setAsc: (v: boolean) => void;
  /** client_id as a string, or 'all'. */
  client: string;
  setClient: (v: string) => void;
  clients: { id: string; name: string }[];
  dateFrom: string;
  setDateFrom: (v: string) => void;
  dateTo: string;
  setDateTo: (v: string) => void;
}

/** State and filtering of the "all videos" sheet, shared by the desktop and phone pages. */
export function useVideoDrawer(
  best: TikTokPortfolioVideo[],
  worst: TikTokPortfolioVideo[],
): VideoDrawerState {
  const [mode, setMode] = useState<'best' | 'worst' | null>(null);
  const [orderBy, setOrderBy] = useState<VideoOrder>('views');
  const [asc, setAsc] = useState(false);
  const [client, setClient] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const source = mode === 'worst' ? worst : best;

  const clients = useMemo(() => {
    const byId = new Map<string, string>();
    for (const v of best) byId.set(String(v.client_id), v.client_name);
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [best]);

  const videos = useMemo(() => {
    const byClient =
      client === 'all' ? source : source.filter((v) => String(v.client_id) === client);
    const key = (v: TikTokPortfolioVideo): number | null => {
      switch (orderBy) {
        case 'likes':
          return v.likes;
        case 'engagement':
          return v.engagement_rate;
        case 'date':
          return postedMs(v);
        default:
          return v.views;
      }
    };
    return sortNullsLast(filterByPostedRange(byClient, dateFrom, dateTo), key, asc);
  }, [source, client, dateFrom, dateTo, asc, orderBy]);

  const open = useCallback((next: 'best' | 'worst') => {
    setMode(next);
    setAsc(next === 'worst');
  }, []);
  const close = useCallback(() => {
    setMode(null);
    setOrderBy('views');
    setAsc(false);
    setClient('all');
    setDateFrom('');
    setDateTo('');
  }, []);

  return {
    mode,
    open,
    close,
    videos,
    total: source.length,
    orderBy,
    setOrderBy,
    asc,
    setAsc,
    client,
    setClient,
    clients,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
  };
}
