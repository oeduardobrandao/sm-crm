import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import i18n from 'i18next';
import { useTranslation } from 'react-i18next';
import { useDateFnsLocale } from '@mesaas/i18n';
import { AlertTriangle, ArrowUpDown, Check, RefreshCw } from 'lucide-react';
import { PhonePageHeader } from '@/components/mobile/PhonePageHeader';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { GroupedList, Cell } from '@/components/mobile/GroupedList';
import { ActionSheet } from '@/components/mobile/ActionSheet';
import { BarList } from '@/components/mobile/BarList';
import {
  getPortfolioAIAnalysis,
  type PortfolioAccount,
  type PortfolioTopPost,
} from '../../../services/analytics';
import { formatRate } from '../../../lib/ig-rates';
import {
  Avatar,
  PickerChip,
  SectionHead,
  fmtFixed,
  fmtNumber,
  fmtPct as formatPct,
  mediaTypeLabel,
} from './shared';
import { RankedPostStrip } from './RankedPostStrip';
import { AllPostsSheet, type AllPostsRow } from './AllPostsSheet';
import {
  AIAnalysisPhone,
  priorityTone,
  useAIAnalysis,
  type AITone,
  type AIAnalysisView,
} from './AIAnalysisPhone';

export type AccountSortCol =
  | 'client_name'
  | 'follower_count'
  | 'engagement_rate_avg'
  | 'impressions_28d'
  | 'reach_28d'
  | 'alcance_seg'
  | 'posts_last_30d'
  | 'website_clicks_28d'
  | 'last_post_at';

const SORT_COLS: AccountSortCol[] = [
  'client_name',
  'follower_count',
  'engagement_rate_avg',
  'impressions_28d',
  'reach_28d',
  'alcance_seg',
  'posts_last_30d',
  'website_clicks_28d',
  'last_post_at',
];

const sortLabel = (col: AccountSortCol): string => i18n.t(`analyticsPhone:sort.${col}`);

const ORDER_VALUES = [
  'views',
  'reach',
  'engagement',
  'likes',
  'comments',
  'saved',
  'share_rate',
  'like_rate',
  'save_rate',
  'comment_rate',
  'date',
] as const;
const orderOptions = () =>
  ORDER_VALUES.map((value) => ({
    value,
    label: i18n.t(`analyticsAccount:drawer.sort.${value}`),
  }));
const RATE_KEYS = ['share_rate', 'like_rate', 'save_rate', 'comment_rate'] as const;
type RateOrder = (typeof RATE_KEYS)[number];

const formatOptions = () =>
  (['IMAGE', 'VIDEO', 'CAROUSEL_ALBUM'] as const).map((value) => ({
    value,
    label: mediaTypeLabel(value),
  }));

const periodOptions = () =>
  [7, 28, 90].map((value) => ({
    value,
    label: i18n.t('analyticsAccount:filter.days', { count: value }),
  }));

function daysSince(iso: string | null): number | null {
  return iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null;
}

function sortValueLabel(a: PortfolioAccount, col: AccountSortCol): string {
  switch (col) {
    case 'engagement_rate_avg':
      return formatPct(a.engagement_rate_avg);
    case 'impressions_28d':
      return fmtNumber(a.impressions_28d);
    case 'reach_28d':
      return fmtNumber(a.reach_28d);
    case 'alcance_seg':
      return a.follower_count > 0
        ? `${fmtFixed((a.reach_28d / a.follower_count) * 100, 1)}%`
        : `${fmtFixed(0, 1)}%`;
    case 'posts_last_30d':
      return String(a.posts_last_30d);
    case 'website_clicks_28d':
      return fmtNumber(a.website_clicks_28d ?? 0);
    case 'last_post_at': {
      const d = daysSince(a.last_post_at);
      return d === null
        ? i18n.t('analyticsPhone:noPosts')
        : i18n.t('analyticsPhone:daysAgo', { days: d });
    }
    default:
      return fmtNumber(a.follower_count);
  }
}

export interface AnalyticsDrawerState {
  mode: 'best' | 'worst' | null;
  open: (mode: 'best' | 'worst') => void;
  close: () => void;
  posts: PortfolioTopPost[];
  /** Posts the open list draws from (all ranked, or the mature ones for "worst"). */
  total: number;
  orderBy: string;
  setOrderBy: (v: string) => void;
  asc: boolean;
  setAsc: (v: boolean) => void;
  format: string;
  setFormat: (v: string) => void;
  client: string;
  setClient: (v: string) => void;
  clients: string[];
  dateFrom: string;
  setDateFrom: (v: string) => void;
  dateTo: string;
  setDateTo: (v: string) => void;
}

export interface AnalyticsPhoneProps {
  /** Accounts after the cliente filter. */
  accounts: PortfolioAccount[];
  sortedAccounts: PortfolioAccount[];
  clientOptions: PortfolioAccount[];
  clienteFilter: string;
  onClienteFilter: (v: string) => void;
  days: number;
  onDays: (d: number) => void;
  syncing: boolean;
  canSync: boolean;
  onSync: () => void;
  syncResult: { success: number; failed: number; failedNames: string[] } | null;
  silentAccounts: PortfolioAccount[];
  /** The page's KPI grid; `StatCardGrid` renders it as the phone tile strip. */
  kpis: ReactNode;
  bestPosts: PortfolioTopPost[];
  worstPosts: PortfolioTopPost[];
  sortColumn: AccountSortCol;
  sortDirection: 'asc' | 'desc';
  onSortColumn: (c: AccountSortCol) => void;
  onToggleDirection: () => void;
  specialtyStats: {
    specialty: string;
    count: number;
    avgEngagement: number;
    avgFollowers: number;
  }[];
  drawer: AnalyticsDrawerState;
}

/** /analytics below 768px (FAnalytics mockup). The page keeps every hook and number. */
export function AnalyticsPhone(props: AnalyticsPhoneProps) {
  const {
    accounts,
    sortedAccounts,
    clientOptions,
    clienteFilter,
    onClienteFilter,
    days,
    onDays,
    syncing,
    canSync,
    onSync,
    syncResult,
    silentAccounts,
    kpis,
    bestPosts,
    worstPosts,
    sortColumn,
    sortDirection,
    onSortColumn,
    onToggleDirection,
    specialtyStats,
    drawer,
  } = props;
  const { t } = useTranslation(['analyticsPhone', 'analyticsAccount']);
  const dateFnsLocale = useDateFnsLocale();
  const [sortOpen, setSortOpen] = useState(false);
  const sortButtonRef = useRef<HTMLButtonElement>(null);

  const clientLabel =
    clienteFilter === 'all'
      ? t('filter.all')
      : (clientOptions.find((a) => String(a.client_id) === clienteFilter)?.client_name ??
        t('filter.all'));

  const subtitle = (
    <>
      {t('accountsCount', { count: accounts.length })} ·{' '}
      {t('analyticsAccount:filter.days', { count: days })}
      {syncing && <span className="phone-an-subtitle-line">{t('sync.runningPhone')}</span>}
      {!syncing && syncResult && (
        <span
          role="status"
          className={`phone-an-subtitle-line ${syncResult.failed > 0 ? 'phone-an-tone--warn' : 'phone-an-tone--up'}`}
        >
          {t('sync.done', { count: syncResult.success })}
          {syncResult.failed > 0 &&
            t('sync.failed', {
              count: syncResult.failed,
              names: syncResult.failedNames.join(', '),
            })}
        </span>
      )}
    </>
  );

  const ai = useAIAnalysis(
    useCallback(async () => {
      const result = await getPortfolioAIAnalysis();
      if (!result || result.analysis.error) {
        throw new Error(AI_UNAVAILABLE);
      }
      return { ...result.analysis, generatedAt: result.generatedAt };
    }, []),
    useCallback(
      (e: unknown) =>
        e instanceof Error && e.message === AI_UNAVAILABLE ? t('ai.failed') : t('ai.error'),
      [t],
    ),
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const aiView = useMemo(() => portfolioAIView(ai.result), [ai.result, t]);

  const benchmarkAvg =
    accounts.length > 0
      ? accounts.reduce((s, a) => s + a.engagement_rate_avg, 0) / accounts.length
      : 0;

  const drawerRows: AllPostsRow[] = drawer.posts.map((post) => {
    const rateKey = (RATE_KEYS as readonly string[]).includes(drawer.orderBy)
      ? (drawer.orderBy as RateOrder)
      : null;
    return {
      key: post.id,
      href: post.permalink,
      thumbnailUrl: post.thumbnail_url,
      mediaType: post.media_type,
      title: post.client_name,
      meta: `${format(new Date(post.posted_at), t('analyticsAccount:phone.dateShort'), { locale: dateFnsLocale })} · ${mediaTypeLabel(post.media_type)}`,
      metrics: (
        <>
          <span>
            {t('analyticsAccount:phone.rowViews')} <strong>{fmtNumber(post.views)}</strong>
          </span>
          <span>
            {t('analyticsAccount:phone.rowEng')} <strong>{formatPct(post.engagement_rate)}</strong>
          </span>
          {rateKey && (
            <span>
              {t('rateSuffix', { rate: t(`rateShort.${rateKey}`) })}{' '}
              <strong>{formatRate(post.rates[rateKey])}</strong>
            </span>
          )}
          <span>
            {t('analyticsAccount:phone.rowLikes')} <strong>{fmtNumber(post.likes)}</strong>
          </span>
          <span>
            {t('analyticsAccount:phone.rowComments')} <strong>{fmtNumber(post.comments)}</strong>
          </span>
          <span>
            {t('analyticsAccount:phone.rowSaved')} <strong>{fmtNumber(post.saved)}</strong>
          </span>
        </>
      ),
    };
  });

  return (
    <div className="phone-kit phone-an">
      <PhonePageHeader
        title={t('title')}
        subtitle={subtitle}
        actions={
          <PhoneIconButton
            label={t('sync.all')}
            onClick={onSync}
            disabled={syncing || !canSync}
            aria-busy={syncing || undefined}
          >
            <RefreshCw aria-hidden="true" className={syncing ? 'phone-an-spin' : undefined} />
          </PhoneIconButton>
        }
      />

      <div className="phone-an-chips">
        <PickerChip<string>
          label={t('filter.client')}
          valueLabel={clientLabel}
          sheetTitle={t('filter.client')}
          options={clientOptions.map((a) => ({ value: String(a.client_id), label: a.client_name }))}
          value={clienteFilter === 'all' ? null : clienteFilter}
          onChange={(v) => onClienteFilter(v ?? 'all')}
          emptyOption={{ label: t('filter.allClients') }}
          searchable={clientOptions.length > 8}
        />
        <PickerChip<number>
          label={t('filter.period')}
          valueLabel={t('analyticsAccount:filter.days', { count: days })}
          options={periodOptions()}
          value={days}
          onChange={(v) => v !== null && onDays(v)}
        />
      </div>

      {silentAccounts.length > 0 && (
        <section className="phone-an-callout" aria-label={t('silent.title')} role="status">
          <div className="phone-an-callout__head">
            <AlertTriangle aria-hidden="true" />
            <h2 className="phone-an-callout__title">{t('silent.title')}</h2>
          </div>
          <p className="phone-an-callout__text">
            {t('silent.countText', { count: silentAccounts.length })}
          </p>
          <div className="phone-an-callout__chips">
            {silentAccounts.map((a) => {
              const d = daysSince(a.last_post_at);
              return (
                <Link
                  key={a.client_id}
                  to={`/analytics/${a.client_id}`}
                  className="phone-an-silent-chip"
                >
                  <Avatar initials={a.client_sigla} color={a.client_cor} />
                  {a.client_name}
                  <span className="phone-an-badge phone-an-badge--warn">
                    {d !== null ? t('daysSilent', { days: d }) : t('noPosts')}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {kpis}

      <RankedPostStrip
        title={t('rank.bestPhone')}
        help={t('rank.helpBest')}
        posts={bestPosts.slice(0, 5)}
        tone="best"
        titleOf={(p) => p.client_name}
        onSeeMore={bestPosts.length > 5 ? () => drawer.open('best') : undefined}
      />
      <RankedPostStrip
        title={t('rank.worstPhone')}
        help={t('rank.helpWorst')}
        posts={worstPosts.slice(0, 5)}
        tone="worst"
        titleOf={(p) => p.client_name}
        onSeeMore={worstPosts.length > 5 ? () => drawer.open('worst') : undefined}
      />

      {/* Wide touch screens: the account list next to the benchmarks (analyticsPhone.css). */}
      <div className="phone-an-pair phone-an-stack">
        <div className="phone-an-half phone-an-stack">
          <SectionHead
            large
            title={t('accounts.titlePhone')}
            trailing={
              accounts.length > 0 ? (
                <button
                  ref={sortButtonRef}
                  type="button"
                  className="phone-an-sort"
                  aria-haspopup="dialog"
                  aria-label={t('accounts.sortAria', {
                    col: sortLabel(sortColumn),
                    dir: sortDirection === 'asc' ? t('dir.asc') : t('dir.desc'),
                  })}
                  onClick={() => setSortOpen(true)}
                >
                  <ArrowUpDown aria-hidden="true" />
                  {sortLabel(sortColumn)}
                </button>
              ) : undefined
            }
          />
          {accounts.length === 0 ? (
            <p className="phone-an-empty">{t('accounts.empty')}</p>
          ) : (
            <GroupedList aria-label={t('accounts.titlePhone')}>
              {sortedAccounts.map((a) => {
                const d = daysSince(a.last_post_at);
                const silent = d === null || d > 7;
                const deltaIcon = a.follower_delta > 0 ? '↑' : a.follower_delta < 0 ? '↓' : '';
                return (
                  <Cell
                    key={a.client_id}
                    to={`/analytics/${a.client_id}`}
                    icon={
                      <Avatar
                        src={a.profile_picture_url}
                        initials={a.client_sigla}
                        color={a.client_cor}
                      />
                    }
                    label={a.client_name}
                    subtitle={
                      <>
                        {a.follower_delta !== 0 && (
                          <>
                            <span
                              className={
                                a.follower_delta > 0 ? 'phone-an-tone--up' : 'phone-an-tone--down'
                              }
                            >
                              {deltaIcon} {fmtNumber(Math.abs(a.follower_delta))}
                            </span>
                            {' · '}
                          </>
                        )}
                        {t('engLine', { pct: formatPct(a.engagement_rate_avg) })} ·{' '}
                        <span className={silent ? 'phone-an-tone--down' : undefined}>
                          {d === null ? t('noPosts') : t('daysAgo', { days: d })}
                        </span>
                      </>
                    }
                    value={
                      <span className="phone-an-row-value">{sortValueLabel(a, sortColumn)}</span>
                    }
                  />
                );
              })}
            </GroupedList>
          )}
        </div>
        {accounts.length >= 2 && (
          <div className="phone-an-half phone-an-stack">
            <BarList
              header={t('benchmark.titlePhone')}
              footer={t('benchmark.footer', { avg: formatPct(benchmarkAvg) })}
              items={[...accounts]
                .sort((a, b) => b.engagement_rate_avg - a.engagement_rate_avg)
                .map((a) => ({
                  key: String(a.client_id),
                  label: a.client_name,
                  value: a.engagement_rate_avg,
                  valueLabel: formatPct(a.engagement_rate_avg),
                  color:
                    a.engagement_rate_avg >= benchmarkAvg
                      ? 'var(--phone-an-up)'
                      : 'var(--phone-an-down)',
                }))}
            />

            {specialtyStats.length >= 2 && (
              <BarList
                header={t('benchmark.specialtyPhone')}
                items={specialtyStats.map((s) => ({
                  key: s.specialty,
                  label: s.specialty,
                  subtitle: t('benchmark.specialtyRow', {
                    count: s.count,
                    followers: fmtNumber(s.avgFollowers),
                  }),
                  value: s.avgEngagement,
                  valueLabel: formatPct(s.avgEngagement),
                }))}
              />
            )}
          </div>
        )}
      </div>

      {accounts.length >= 1 && (
        <AIAnalysisPhone
          title={t('ai.titlePhone')}
          view={aiView}
          loading={ai.loading}
          error={ai.error}
          emptyText={t('ai.promptPhone')}
          onGenerate={ai.generate}
        />
      )}

      <ActionSheet
        open={sortOpen}
        onOpenChange={setSortOpen}
        title={t('accounts.sortTitle')}
        returnFocusRef={sortButtonRef}
        actions={[
          ...SORT_COLS.map((col) => ({
            label: sortLabel(col),
            icon: sortColumn === col ? <Check /> : <span />,
            onSelect: () => onSortColumn(col),
          })),
          {
            label: sortDirection === 'asc' ? t('accounts.orderDesc') : t('accounts.orderAsc'),
            icon: <ArrowUpDown />,
            onSelect: onToggleDirection,
          },
        ]}
      />

      <AllPostsSheet
        open={drawer.mode !== null}
        onOpenChange={(open) => {
          if (!open) drawer.close();
        }}
        title={drawer.mode === 'worst' ? t('drawer.worstPhone') : t('drawer.allPostsPhone')}
        countLabel={t('drawer.count', { shown: drawer.posts.length, total: drawer.total })}
        note={
          (RATE_KEYS as readonly string[]).includes(drawer.orderBy) ? t('drawer.note') : undefined
        }
        rows={drawerRows}
        emptyText={t('analyticsAccount:drawer.empty')}
        filters={{
          orderOptions: orderOptions(),
          orderBy: drawer.orderBy,
          onOrderBy: drawer.setOrderBy,
          asc: drawer.asc,
          onAsc: drawer.setAsc,
          formatOptions: formatOptions(),
          format: drawer.format,
          onFormat: drawer.setFormat,
          clientOptions: drawer.clients.map((name) => ({ value: name, label: name })),
          client: drawer.client,
          onClient: drawer.setClient,
          dateFrom: drawer.dateFrom,
          dateTo: drawer.dateTo,
          onDateFrom: drawer.setDateFrom,
          onDateTo: drawer.setDateTo,
        }}
      />
    </div>
  );
}

// Thrown by the generate callback so the error handler can tell "the analysis came back
// with an error" from any other failure without comparing translated text.
const AI_UNAVAILABLE = 'ai_unavailable';

// Keys are the Portuguese status words the AI analysis returns (data, not UI copy).
const STATUS_TONE: Record<string, AITone> = {
  destaque: 'up',
  estável: 'info',
  atenção: 'warn',
};

// The AI payload is untyped JSON.
export function portfolioAIView(a: any): AIAnalysisView | null {
  if (!a) return null;
  return {
    score: a.portfolioHealth
      ? {
          value: a.portfolioHealth.score,
          label: i18n.t('analyticsPhone:ai.healthPhone'),
          summary: a.portfolioHealth.summary,
        }
      : undefined,
    ranking: Array.isArray(a.accountRanking)
      ? {
          title: i18n.t('analyticsPhone:ai.rankingPhone'),
          items: a.accountRanking.map((acc: any) => ({
            badge: String(acc.status ?? ''),
            tone: STATUS_TONE[acc.status] ?? 'down',
            title: String(acc.username ?? ''),
            detail: acc.keyMetric ? String(acc.keyMetric) : undefined,
          })),
        }
      : undefined,
    sections: [
      { title: i18n.t('analyticsPhone:ai.crossPhone'), text: a.crossAccountInsights },
      { title: i18n.t('analyticsPhone:ai.effortPhone'), text: a.resourceAllocation },
      { title: i18n.t('analyticsPhone:ai.digestPhone'), text: a.monthlyDigest },
    ],
    actions: Array.isArray(a.priorityActions)
      ? {
          title: i18n.t('analyticsPhone:ai.actionsPhone'),
          items: a.priorityActions.map((p: any) => ({
            badge: String(p.prioridade ?? ''),
            tone: priorityTone(p.prioridade),
            title: `${p.conta}: ${p.acao}`,
            detail: p.impacto ? String(p.impacto) : undefined,
          })),
        }
      : undefined,
    generatedAt: a.generatedAt,
  };
}
