import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowUpDown, Check, RefreshCw } from 'lucide-react';
import { PhonePageHeader } from '@/components/mobile/PhonePageHeader';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { GroupedList, Cell } from '@/components/mobile/GroupedList';
import { ActionSheet } from '@/components/mobile/ActionSheet';
import { BarList } from '@/components/mobile/BarList';
import type { TikTokPortfolioRow, TikTokPortfolioVideo } from '../../../services/tiktokAnalytics';
import { Avatar, PickerChip, SectionHead, fmtNumber } from '../../analytics/phone/shared';
import { RankedPostStrip } from '../../analytics/phone/RankedPostStrip';
import { AllPostsSheet, type AllPostsRow } from '../../analytics/phone/AllPostsSheet';
import { AIAnalysisPhone, useAIAnalysis } from '../../analytics/phone/AIAnalysisPhone';
import { portfolioAIView } from '../../analytics/phone/AnalyticsPhone';
import type { PortfolioAILoader } from '../../analytics/AnalyticsPage';
import {
  ACCOUNT_SORT_COLS,
  VIDEO_ORDERS,
  daysSince,
  formatDay,
  formatNumber,
  formatPct,
  initialsOf,
  isSilent,
  syncSummary,
  type AccountSortCol,
  type SpecialtyStat,
  type SyncResult,
  type VideoDrawerState,
} from '../overviewModel';

const PERIODS = [7, 28, 90];

const SORT_KEY: Record<AccountSortCol, string> = {
  client_name: 'table.client',
  follower_count: 'table.followers',
  engagement_rate: 'table.engagementShort',
  views: 'table.views',
  posts_count: 'table.posts',
  last_posted_at: 'table.lastPost',
};

const ORDER_KEY = {
  views: 'drawer.sortViews',
  likes: 'drawer.sortLikes',
  engagement: 'drawer.sortEngagement',
  date: 'drawer.sortDate',
} as const;

export interface TikTokOverviewPhoneProps {
  /** Accounts after the client filter. */
  accounts: TikTokPortfolioRow[];
  sortedAccounts: TikTokPortfolioRow[];
  clientOptions: TikTokPortfolioRow[];
  clienteFilter: string;
  onClienteFilter: (v: string) => void;
  days: number;
  onDays: (d: number) => void;
  syncing: boolean;
  canSync: boolean;
  onSync: () => void;
  syncResult: SyncResult | null;
  silentAccounts: TikTokPortfolioRow[];
  /** The page's KPI grid; `StatCardGrid` renders it as the phone tile strip. */
  kpis: ReactNode;
  /** The strips (top 5, bottom 5). */
  bestVideos: TikTokPortfolioVideo[];
  worstVideos: TikTokPortfolioVideo[];
  /** Videos behind each "Ver todos" sheet. */
  bestTotal: number;
  worstTotal: number;
  sortColumn: AccountSortCol;
  sortDirection: 'asc' | 'desc';
  onSortColumn: (c: AccountSortCol) => void;
  onToggleDirection: () => void;
  specialtyStats: SpecialtyStat[];
  drawer: VideoDrawerState;
  aiLoader: PortfolioAILoader;
}

function sortValueLabel(a: TikTokPortfolioRow, col: AccountSortCol, never: string): string {
  switch (col) {
    case 'engagement_rate':
      return formatPct(a.engagement_rate);
    case 'views':
      return fmtNumber(a.views);
    case 'posts_count':
      return String(a.posts_count);
    case 'last_posted_at': {
      const d = daysSince(a.last_posted_at);
      return d === null ? never : `${d}d`;
    }
    default:
      return fmtNumber(a.follower_count);
  }
}

/** The ranked-strip card wants a post-shaped object; a TikTok video maps onto it. */
function asRanked(v: TikTokPortfolioVideo) {
  return {
    id: `${v.client_id}:${v.tiktok_video_id}`,
    permalink: v.share_url ?? '',
    thumbnail_url: v.cover_image_url,
    media_type: 'TIKTOK',
    // The portfolio only lists videos posted inside its window, so this is always set.
    posted_at: v.posted_at ?? new Date(0).toISOString(),
    views: v.views ?? 0,
    engagement_rate: v.engagement_rate,
    client_name: v.client_name,
  };
}

/** /analytics/tiktok below 768px. The page keeps every hook and number. */
export function TikTokOverviewPhone(props: TikTokOverviewPhoneProps) {
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
    bestVideos,
    worstVideos,
    bestTotal,
    worstTotal,
    sortColumn,
    sortDirection,
    onSortColumn,
    onToggleDirection,
    specialtyStats,
    drawer,
    aiLoader,
  } = props;
  const { t, i18n } = useTranslation('analyticsTiktok');
  const [sortOpen, setSortOpen] = useState(false);
  const sortButtonRef = useRef<HTMLButtonElement>(null);

  const clientLabel =
    clienteFilter === 'all'
      ? t('overview.allClients')
      : (clientOptions.find((a) => String(a.client_id) === clienteFilter)?.client_name ??
        t('overview.allClients'));

  const subtitle = (
    <>
      {t('overview.accountCount', { count: accounts.length })} ·{' '}
      {t('overview.periodDays', { count: days })}
      {syncing && <span className="phone-an-subtitle-line">{t('overview.syncing')}</span>}
      {!syncing && syncResult && (
        <span
          role="status"
          className={`phone-an-subtitle-line ${syncResult.failed > 0 ? 'phone-an-tone--warn' : 'phone-an-tone--up'}`}
        >
          {syncSummary(t, syncResult)}
        </span>
      )}
    </>
  );

  const ai = useAIAnalysis(
    useCallback(async () => {
      const result = await aiLoader();
      if (!result || result.analysis.error) throw new Error('generation_failed');
      return { ...result.analysis, generatedAt: result.generatedAt };
    }, [aiLoader]),
    useCallback(() => t('ai.error'), [t]),
  );
  const aiView = useMemo(() => portfolioAIView(ai.result), [ai.result]);

  // Rate averages ignore accounts with no views: a missing rate is not a zero.
  const rated = accounts.filter((a) => a.engagement_rate !== null);
  const benchmarkAvg = rated.length
    ? rated.reduce((s, a) => s + (a.engagement_rate as number), 0) / rated.length
    : 0;

  const drawerRows: AllPostsRow[] = drawer.videos.map((v) => ({
    key: `${v.client_id}:${v.tiktok_video_id}`,
    href: v.share_url ?? '',
    thumbnailUrl: v.cover_image_url,
    mediaType: 'TIKTOK',
    title: v.client_name,
    meta: formatDay(v.posted_at, i18n.language),
    metrics: (
      <>
        <span>
          {t('table.views')} <strong>{fmtNumber(v.views)}</strong>
        </span>
        <span>
          {t('table.engagementShort')} <strong>{formatPct(v.engagement_rate)}</strong>
        </span>
        <span>
          {t('table.likes')} <strong>{fmtNumber(v.likes)}</strong>
        </span>
      </>
    ),
  }));

  const sortLabel = t(SORT_KEY[sortColumn]);

  return (
    <div className="phone-kit phone-an">
      <PhonePageHeader
        title={t('overview.title')}
        subtitle={subtitle}
        actions={
          <PhoneIconButton
            label={t('overview.syncAll')}
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
          label={t('overview.clientFilter')}
          valueLabel={clientLabel}
          sheetTitle={t('overview.clientFilter')}
          options={clientOptions.map((a) => ({ value: String(a.client_id), label: a.client_name }))}
          value={clienteFilter === 'all' ? null : clienteFilter}
          onChange={(v) => onClienteFilter(v ?? 'all')}
          emptyOption={{ label: t('overview.allClients') }}
          searchable={clientOptions.length > 8}
        />
        <PickerChip<number>
          label={t('overview.period')}
          valueLabel={t('overview.periodDays', { count: days })}
          options={PERIODS.map((p) => ({
            value: p,
            label: t('overview.periodDays', { count: p }),
          }))}
          value={days}
          onChange={(v) => v !== null && onDays(v)}
        />
      </div>

      {silentAccounts.length > 0 && (
        <section
          className="phone-an-callout"
          aria-label={t('overview.silentAccounts')}
          role="status"
        >
          <div className="phone-an-callout__head">
            <AlertTriangle aria-hidden="true" />
            <h2 className="phone-an-callout__title">{t('overview.silentAccounts')}</h2>
          </div>
          <p className="phone-an-callout__text">
            {t('overview.silentCount', { count: silentAccounts.length })}
          </p>
          <div className="phone-an-callout__chips">
            {silentAccounts.map((a) => {
              const d = daysSince(a.last_posted_at);
              return (
                <Link
                  key={a.client_id}
                  to={`/analytics/${a.client_id}/tiktok`}
                  className="phone-an-silent-chip"
                >
                  <Avatar src={a.avatar_url} initials={initialsOf(a.client_name)} />
                  {a.client_name}
                  <span className="phone-an-badge phone-an-badge--warn">
                    {d !== null
                      ? t('overview.silentDays', { count: d })
                      : t('overview.silentNever')}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {kpis}

      <RankedPostStrip
        title={t('overview.topVideos')}
        help={t('overview.topVideosHint')}
        posts={bestVideos.slice(0, 5).map(asRanked)}
        tone="best"
        titleOf={(p) => p.client_name}
        typeLabel={t('drawer.badge')}
        openLabel={t('drawer.openLabel')}
        seeMoreLabel={t('overview.seeAll')}
        onSeeMore={bestTotal > 5 ? () => drawer.open('best') : undefined}
      />
      <RankedPostStrip
        title={t('overview.bottomVideos')}
        help={t('overview.bottomVideosHint')}
        posts={worstVideos.slice(0, 5).map(asRanked)}
        tone="worst"
        titleOf={(p) => p.client_name}
        typeLabel={t('drawer.badge')}
        openLabel={t('drawer.openLabel')}
        seeMoreLabel={t('overview.seeAll')}
        onSeeMore={worstTotal > 5 ? () => drawer.open('worst') : undefined}
      />

      <SectionHead
        large
        title={t('overview.allAccounts')}
        trailing={
          accounts.length > 0 ? (
            <button
              ref={sortButtonRef}
              type="button"
              className="phone-an-sort"
              aria-haspopup="dialog"
              aria-label={`${t('table.sortAccounts')}: ${sortLabel}, ${sortDirection === 'asc' ? t('table.sortAsc') : t('table.sortDesc')}`}
              onClick={() => setSortOpen(true)}
            >
              <ArrowUpDown aria-hidden="true" />
              {sortLabel}
            </button>
          ) : undefined
        }
      />
      {accounts.length === 0 ? (
        <section className="phone-an-empty">
          <h2>{t('overview.emptyTitle')}</h2>
          <p>{t('overview.emptyBody')}</p>
          <Link to="/clientes" className="phone-an-link-button">
            {t('overview.emptyAction')}
          </Link>
        </section>
      ) : (
        <GroupedList aria-label={t('overview.allAccounts')}>
          {sortedAccounts.map((a) => {
            const d = daysSince(a.last_posted_at);
            const silent = isSilent(a);
            const gained = a.followers_gained ?? 0;
            return (
              <Cell
                key={a.client_id}
                to={`/analytics/${a.client_id}/tiktok`}
                icon={<Avatar src={a.avatar_url} initials={initialsOf(a.client_name)} />}
                label={a.client_name}
                subtitle={
                  <>
                    {gained !== 0 && (
                      <>
                        <span className={gained > 0 ? 'phone-an-tone--up' : 'phone-an-tone--down'}>
                          {gained > 0 ? '↑' : '↓'} {fmtNumber(Math.abs(gained))}
                        </span>
                        {' · '}
                      </>
                    )}
                    {t('table.engAbbrev', { value: formatPct(a.engagement_rate) })} ·{' '}
                    <span className={silent ? 'phone-an-tone--down' : undefined}>
                      {d === null ? t('table.never') : t('table.daysAgo', { count: d })}
                    </span>
                  </>
                }
                value={
                  <span className="phone-an-row-value">
                    {sortValueLabel(a, sortColumn, t('table.never'))}
                  </span>
                }
              />
            );
          })}
        </GroupedList>
      )}

      {rated.length >= 2 && (
        <BarList
          header={t('overview.benchmark')}
          footer={t('overview.benchmarkAvg', { value: formatPct(benchmarkAvg) })}
          items={[...rated]
            .sort((a, b) => (b.engagement_rate as number) - (a.engagement_rate as number))
            .map((a) => ({
              key: String(a.client_id),
              label: a.client_name,
              value: a.engagement_rate as number,
              valueLabel: formatPct(a.engagement_rate),
              color:
                (a.engagement_rate as number) >= benchmarkAvg
                  ? 'var(--phone-an-up)'
                  : 'var(--phone-an-down)',
            }))}
        />
      )}

      {accounts.length >= 2 && specialtyStats.length >= 2 && (
        <BarList
          header={t('overview.bySpecialty')}
          items={specialtyStats.map((s) => ({
            key: s.specialty ?? '__none',
            label: s.specialty ?? t('overview.noSpecialty'),
            subtitle: `${t('overview.accountCount', { count: s.count })} · ${t('overview.avgFollowers', { value: formatNumber(s.avgFollowers) })}`,
            value: s.avgEngagement ?? 0,
            valueLabel: formatPct(s.avgEngagement),
          }))}
        />
      )}

      {accounts.length >= 1 && (
        <AIAnalysisPhone
          title={t('ai.title')}
          view={aiView}
          loading={ai.loading}
          error={ai.error}
          emptyText={t('ai.portfolioEmpty')}
          onGenerate={ai.generate}
        />
      )}

      <ActionSheet
        open={sortOpen}
        onOpenChange={setSortOpen}
        title={t('table.sortAccounts')}
        returnFocusRef={sortButtonRef}
        actions={[
          ...ACCOUNT_SORT_COLS.map((col) => ({
            label: t(SORT_KEY[col]),
            icon: sortColumn === col ? <Check /> : <span />,
            onSelect: () => onSortColumn(col),
          })),
          {
            label: sortDirection === 'asc' ? t('table.sortToDesc') : t('table.sortToAsc'),
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
        title={drawer.mode === 'worst' ? t('drawer.titleWorst') : t('drawer.titleBest')}
        countLabel={t('drawer.count', { shown: drawer.videos.length, total: drawer.total })}
        rows={drawerRows}
        emptyText={t('drawer.empty')}
        filters={{
          orderOptions: VIDEO_ORDERS.map((o) => ({ value: o, label: t(ORDER_KEY[o]) })),
          orderBy: drawer.orderBy,
          onOrderBy: (v) => drawer.setOrderBy(v as (typeof VIDEO_ORDERS)[number]),
          asc: drawer.asc,
          onAsc: drawer.setAsc,
          clientOptions: drawer.clients.map((c) => ({ value: c.id, label: c.name })),
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
