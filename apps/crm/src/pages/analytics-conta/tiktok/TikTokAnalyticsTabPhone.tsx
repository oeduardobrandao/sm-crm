import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNow } from 'date-fns';
import { enUS, ptBR } from 'date-fns/locale';
import { AlertTriangle, ArrowUpDown, Check, Lock, RefreshCw } from 'lucide-react';
import { PhoneNavBar } from '@/components/mobile/PhoneNavBar';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { ActionSheet } from '@/components/mobile/ActionSheet';
import { PageSkeleton } from '@/components/ui/skeletons';
import { Spinner } from '@/components/ui/spinner';
import {
  isTikTokFeatureDisabled,
  TikTokNotConnectedError,
  type AnalyticsRange,
  type TikTokAIResult,
  type TikTokOverview,
  type TikTokPostSort,
  type TikTokVideoAnalytics,
} from '../../../services/tiktokAnalytics';
import type { BestPostingTimes } from '../../../services/analytics';
import { sanitizeUrl } from '../../../utils/security';
import { Avatar, PostThumb, SectionHead } from '../../analytics/phone/shared';
import { RankedPostStrip } from '../../analytics/phone/RankedPostStrip';
import { AllPostsSheet, type AllPostsRow } from '../../analytics/phone/AllPostsSheet';
import { AIAnalysisPhone, useAIAnalysis } from '../../analytics/phone/AIAnalysisPhone';
import { PeriodSegmented } from '../../analytics/phone/PeriodControl';
import {
  BestTimesSection,
  FollowerGrowthCard,
  contaAIView,
  type BestTimesLabels,
} from '../phone/ContaSections';
import { rankByViews } from '../../analytics-tiktok/videoRanking';
import { TikTokKpiGrid } from './TikTokKpiGrid';
import { VIDEO_ORDERS, useVideoDrawer, type VideoOrderBy } from './TikTokRankedVideos';
import { sortVideos, type VideoTableSort } from './TikTokVideosTable';
import {
  BILLING_PATH,
  dimmed,
  formatCount,
  formatRate,
  formatVideoDate,
  lastMonthRange,
  periodTag,
} from './tiktokTabFormat';
import type { useTikTokTabData } from './useTikTokTabData';

const PRESET_DAYS = [7, 30, 90];
const MAX_CUSTOM_DAYS = 730;
const STRIP_SIZE = 5;
const COLLAPSED_ROWS = 5;

const SORT_KEYS: Record<TikTokPostSort, string> = {
  posted_at: 'table.date',
  views: 'table.views',
  likes: 'table.likes',
  comments: 'table.comments',
  shares: 'table.shares',
  engagement_rate: 'table.engagementShort',
};

/** Who the page is about, plus the shell's tab control (rendered under the identity). */
export interface TikTokPhoneFrame {
  nome: string;
  cor?: string | null;
  /** Photo candidates, best first (the shell's client photo, Instagram, TikTok). */
  photo: readonly (string | null | undefined)[];
  tabs: ReactNode;
}

export interface TikTokAnalyticsTabPhoneProps {
  clientId: number;
  frame: TikTokPhoneFrame;
  /** The desktop tab's queries: one data layer for both variants. */
  data: ReturnType<typeof useTikTokTabData>;
  range: AnalyticsRange;
  onRange: (range: AnalyticsRange) => void;
  sort: VideoTableSort;
  onSort: (sort: VideoTableSort) => void;
  syncing: boolean;
  onSync: () => void;
  /** The desktop tab's AI loader: capped days, every failure already translated. */
  loadAI: () => Promise<TikTokAIResult>;
}

const videoTitle = (v: TikTokVideoAnalytics, untitled: string) =>
  v.title || v.video_description || untitled;

/** `/analytics/:id/tiktok` below 768px (mockup phone artboard). */
export function TikTokAnalyticsTabPhone(props: TikTokAnalyticsTabPhoneProps) {
  const { t } = useTranslation('analyticsTiktok');
  const { clientId, frame, data, range, onRange, syncing, onSync } = props;
  const { overview } = data;
  const redesSociais = `/clientes/${clientId}/redes-sociais`;

  if (overview.isPending) {
    return (
      <Frame frame={frame}>
        <PageSkeleton body="report" header={false} />
      </Frame>
    );
  }

  if (overview.isError && !overview.data) {
    const err = overview.error;
    if (err instanceof TikTokNotConnectedError) {
      return (
        <Frame frame={frame}>
          <StateBlock
            title={t('states.notConnectedTitle')}
            body={t('states.notConnectedBody')}
            action={
              <Link to={redesSociais} className="phone-an-link-button">
                {t('states.connectAction')}
              </Link>
            }
          />
        </Frame>
      );
    }
    if (isTikTokFeatureDisabled(err)) {
      return (
        <Frame frame={frame}>
          <StateBlock
            title={t('states.locked')}
            action={
              <Link to={BILLING_PATH} className="phone-an-link-button">
                {t('states.lockedAction')}
              </Link>
            }
          />
        </Frame>
      );
    }
    // The period may be what failed (a long custom window), so it stays changeable.
    return (
      <Frame frame={frame}>
        <PhonePeriod range={range} onRange={onRange} />
        <StateBlock
          title={t('states.error')}
          action={
            <button
              type="button"
              className="phone-an-link-button"
              onClick={() => overview.refetch()}
            >
              {t('states.retry')}
            </button>
          }
        />
      </Frame>
    );
  }

  const account = overview.data!.account;
  return (
    <Frame frame={frame} account={account} syncing={syncing} onSync={onSync}>
      <PhoneBody {...props} overviewData={overview.data!} />
    </Frame>
  );
}

/** Nav bar (back, sync), the identity heading, the shell's tabs, then the tab's content. */
function Frame({
  frame,
  account,
  syncing,
  onSync,
  children,
}: {
  frame: TikTokPhoneFrame;
  account?: TikTokOverview['account'];
  syncing?: boolean;
  onSync?: () => void;
  children: ReactNode;
}) {
  const { t, i18n } = useTranslation('analyticsTiktok');
  const dateLocale = i18n.language.startsWith('en') ? enUS : ptBR;
  const handle = account?.username ?? account?.display_name ?? '';
  const name = frame.nome;
  return (
    <div className="phone-kit phone-an">
      <PhoneNavBar
        fallbackTo="/analytics"
        backLabel="Voltar"
        trailing={
          onSync ? (
            <PhoneIconButton
              label={t('overview.sync')}
              onClick={onSync}
              disabled={syncing}
              aria-busy={syncing || undefined}
            >
              <RefreshCw aria-hidden="true" className={syncing ? 'phone-an-spin' : undefined} />
            </PhoneIconButton>
          ) : undefined
        }
      />

      <div className="phone-an-identity">
        <Avatar
          src={[...frame.photo, account?.avatar_url]}
          initials={name.slice(0, 2).toUpperCase()}
          color={frame.cor}
          large
        />
        <div className="phone-an-identity__text">
          <h1 className="phone-an-identity__name">{name}</h1>
          {account && (
            <p className="phone-an-identity__meta">
              {account.username ? (
                <a
                  href={sanitizeUrl(
                    `https://www.tiktok.com/@${encodeURIComponent(account.username)}`,
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  @{account.username}
                </a>
              ) : (
                handle
              )}
              <span className="phone-an-tone--muted">
                {' · '}
                {account.last_synced_at
                  ? t('clientTab.syncedAgo', {
                      time: formatDistanceToNow(new Date(account.last_synced_at), {
                        locale: dateLocale,
                      }),
                    })
                  : t('overview.neverSynced')}
              </span>
            </p>
          )}
        </div>
      </div>

      {frame.tabs}
      {children}
    </div>
  );
}

function StateBlock({ title, body, action }: { title: string; body?: string; action: ReactNode }) {
  return (
    <section className="phone-an-empty">
      <h2>{title}</h2>
      {body && <p>{body}</p>}
      {action}
    </section>
  );
}

/** 7d / 30d / 90d / Último mês, plus Personalizado (1-730 days). */
function PhonePeriod({
  range,
  onRange,
}: {
  range: AnalyticsRange;
  onRange: (range: AnalyticsRange) => void;
}) {
  const { t, i18n } = useTranslation('analyticsTiktok');
  const isMonth = !('days' in range);
  const days = 'days' in range ? range.days : null;
  const isPreset = days !== null && PRESET_DAYS.includes(days);
  return (
    <>
      <PeriodSegmented
        aria-label={t('overview.period')}
        presets={[
          ...PRESET_DAYS.map((d) => ({
            value: String(d),
            label: periodTag({ days: d }, i18n.language),
          })),
          { value: 'month', label: t('overview.lastMonth') },
        ]}
        value={isMonth ? 'month' : isPreset ? String(days) : null}
        onChange={(v) => onRange(v === 'month' ? lastMonthRange() : { days: parseInt(v, 10) })}
        custom={{
          days: !isMonth && !isPreset ? days : null,
          min: 1,
          max: MAX_CUSTOM_DAYS,
          onApply: (d) => onRange({ days: d }),
        }}
      />
      {isMonth && (
        <p className="phone-an-period__custom">
          {t('overview.lastMonth')}: {periodTag(range, i18n.language)}
        </p>
      )}
    </>
  );
}

/** The ranked strip wants a post-shaped card; a TikTok video maps onto it. */
const asRanked = (v: TikTokVideoAnalytics, untitled: string) => ({
  id: v.tiktok_video_id,
  permalink: v.share_url ?? '',
  thumbnail_url: v.cover_image_url,
  media_type: 'TIKTOK',
  posted_at: v.posted_at,
  views: v.views,
  engagement_rate: v.engagement_rate,
  title: videoTitle(v, untitled),
});

function PhoneBody({
  data,
  range,
  onRange,
  sort,
  onSort,
  loadAI,
  overviewData,
  clientId,
}: TikTokAnalyticsTabPhoneProps & { overviewData: TikTokOverview }) {
  const { t, i18n } = useTranslation('analyticsTiktok');
  const { overview, history, posts, bestTimes, bestTimesLocked, aiLocked } = data;
  const account = overviewData.account;
  const period = periodTag(range, i18n.language);
  const untitled = t('table.untitled');
  const videos = useMemo(() => posts.data ?? [], [posts.data]);
  // A failed read is not an empty one: it says so and offers a retry.
  const postsFailed = posts.isError && !posts.data;

  const [sortOpen, setSortOpen] = useState(false);
  const sortButtonRef = useRef<HTMLButtonElement>(null);
  const [showAll, setShowAll] = useState(false);
  const sorted = useMemo(() => sortVideos(videos, sort), [videos, sort]);
  const visible = showAll ? sorted : sorted.slice(0, COLLAPSED_ROWS);

  // Ranked strips and their "Ver todos" sheet (same rules as desktop).
  const { best, worst } = useMemo(() => rankByViews(videos), [videos]);
  const drawer = useVideoDrawer(best, worst);
  const drawerRows: AllPostsRow[] = drawer.listed.map((v) => ({
    key: v.tiktok_video_id,
    href: v.share_url ?? '',
    thumbnailUrl: v.cover_image_url,
    mediaType: 'TIKTOK',
    title: videoTitle(v, untitled),
    meta: formatVideoDate(v.posted_at, i18n.language),
    metrics: <VideoMetrics video={v} />,
  }));

  const ai = useAIAnalysis(
    useCallback(async () => {
      const result = await loadAI();
      return { ...result.analysis, generatedAt: result.generatedAt };
    }, [loadAI]),
    useCallback((e: unknown) => (e instanceof Error && e.message) || t('ai.error'), [t]),
  );
  const aiView = useMemo(
    () =>
      contaAIView(ai.result, {
        topPerformer: t('ai.topVideo'),
        worstPerformer: t('ai.worstVideo'),
        captionDiagnostic: t('ai.titleDiagnostic'),
      }),
    [ai.result, t],
  );

  const sortLabel = t(SORT_KEYS[sort.col]);
  const redesSociais = `/clientes/${clientId}/redes-sociais`;

  return (
    <>
      {account.authorization_status === 'expired' && (
        <section className="phone-an-callout" role="status" aria-label={t('states.expiredTitle')}>
          <div className="phone-an-callout__head">
            <AlertTriangle aria-hidden="true" />
            <h2 className="phone-an-callout__title">{t('states.expiredTitle')}</h2>
          </div>
          <p className="phone-an-callout__text">{t('states.expiredBody')}</p>
          <Link to={redesSociais} className="phone-an-link-button">
            {t('states.connectAction')}
          </Link>
        </section>
      )}

      <PhonePeriod range={range} onRange={onRange} />

      <div style={dimmed(overview.isPlaceholderData)} aria-busy={overview.isPlaceholderData}>
        <TikTokKpiGrid kpis={overviewData.kpis} period={period} />
      </div>

      {posts.isPending ? (
        <LoadingBlock />
      ) : postsFailed ? null : (
        <div style={dimmed(posts.isPlaceholderData)} aria-busy={posts.isPlaceholderData}>
          <RankedPostStrip
            title={t('overview.topVideos')}
            help={t('clientTab.topVideosHint', { period })}
            posts={best.slice(0, STRIP_SIZE).map((v) => asRanked(v, untitled))}
            tone="best"
            titleOf={(p) => p.title}
            typeLabel={t('drawer.badge')}
            openLabel={t('drawer.openLabel')}
            seeMoreLabel={t('overview.seeAll')}
            onSeeMore={best.length > STRIP_SIZE ? () => drawer.open('best') : undefined}
          />
          <RankedPostStrip
            title={t('overview.bottomVideos')}
            help={t('overview.bottomVideosHint')}
            posts={worst.slice(0, STRIP_SIZE).map((v) => asRanked(v, untitled))}
            tone="worst"
            titleOf={(p) => p.title}
            typeLabel={t('drawer.badge')}
            openLabel={t('drawer.openLabel')}
            seeMoreLabel={t('overview.seeAll')}
            onSeeMore={worst.length > STRIP_SIZE ? () => drawer.open('worst') : undefined}
          />
        </div>
      )}

      {history.isPending ? (
        <CardShell title={t('followers.title')}>
          <LoadingBlock />
        </CardShell>
      ) : history.isError && !history.data ? (
        <CardShell title={t('followers.title')}>
          <RetryLine onRetry={() => history.refetch()} />
        </CardShell>
      ) : (
        <FollowerGrowthCard
          history={history.data ?? []}
          title={t('followers.title')}
          emptyText={t('followers.empty')}
        />
      )}

      <SectionHead
        large
        title={t('clientTab.tableTitle')}
        trailing={
          videos.length > 0 ? (
            <button
              ref={sortButtonRef}
              type="button"
              className="phone-an-sort"
              aria-haspopup="dialog"
              aria-label={`${t('table.sortBy')}: ${sortLabel}, ${sort.dir === 'asc' ? t('table.sortAsc') : t('table.sortDesc')}`}
              onClick={() => setSortOpen(true)}
            >
              <ArrowUpDown aria-hidden="true" />
              {sortLabel}
            </button>
          ) : undefined
        }
      />
      {posts.isPending ? (
        <LoadingBlock />
      ) : postsFailed ? (
        <RetryLine onRetry={() => posts.refetch()} />
      ) : videos.length === 0 ? (
        <p className="phone-an-empty">{t('states.noVideos')}</p>
      ) : (
        <div style={dimmed(posts.isPlaceholderData)} aria-busy={posts.isPlaceholderData}>
          <GroupedList aria-label={t('clientTab.tableTitle')}>
            {visible.map((v) => (
              <VideoRow key={v.tiktok_video_id} video={v} sortCol={sort.col} />
            ))}
            {sorted.length > COLLAPSED_ROWS && (
              <Cell
                label={
                  showAll
                    ? t('clientTab.showLess')
                    : t('clientTab.showAll', { count: sorted.length })
                }
                onClick={() => setShowAll(!showAll)}
                aria-expanded={showAll}
              />
            )}
          </GroupedList>
        </div>
      )}

      <BestTimesPhone
        locked={bestTimesLocked}
        loading={bestTimes.isPending && !bestTimesLocked}
        data={bestTimes.data ?? null}
        onRetry={bestTimes.isError && !bestTimes.data ? () => bestTimes.refetch() : null}
      />

      {aiLocked ? (
        <GroupedList header={t('ai.title')} footer={t('ai.locked')}>
          <Cell icon={<Lock />} label={t('states.lockedAction')} to={BILLING_PATH} />
        </GroupedList>
      ) : (
        <AIAnalysisPhone
          title={t('ai.title')}
          view={aiView}
          loading={ai.loading}
          error={ai.error}
          emptyText={t('ai.accountEmpty')}
          onGenerate={ai.generate}
        />
      )}

      <ActionSheet
        open={sortOpen}
        onOpenChange={setSortOpen}
        title={t('table.sortBy')}
        returnFocusRef={sortButtonRef}
        actions={[
          ...(Object.keys(SORT_KEYS) as TikTokPostSort[]).map((col) => ({
            label: t(SORT_KEYS[col]),
            icon: sort.col === col ? <Check /> : <span />,
            onSelect: () => onSort({ col, dir: sort.col === col ? sort.dir : 'desc' }),
          })),
          {
            label: sort.dir === 'asc' ? t('table.sortToDesc') : t('table.sortToAsc'),
            icon: <ArrowUpDown />,
            onSelect: () => onSort({ col: sort.col, dir: sort.dir === 'asc' ? 'desc' : 'asc' }),
          },
        ]}
      />

      <AllPostsSheet
        open={drawer.mode !== null}
        onOpenChange={(open) => {
          if (!open) drawer.close();
        }}
        title={drawer.mode === 'worst' ? t('drawer.titleWorst') : t('drawer.titleBest')}
        countLabel={t('drawer.count', {
          shown: drawer.listed.length,
          total: drawer.source.length,
        })}
        rows={drawerRows}
        emptyText={t('drawer.empty')}
        filters={{
          orderOptions: VIDEO_ORDERS.map((o) => ({ value: o.value, label: t(o.key) })),
          orderBy: drawer.orderBy,
          onOrderBy: (v) => drawer.setOrderBy(v as VideoOrderBy),
          asc: drawer.asc,
          onAsc: drawer.setAsc,
          dateFrom: drawer.dateFrom,
          dateTo: drawer.dateTo,
          onDateFrom: drawer.setDateFrom,
          onDateTo: drawer.setDateTo,
        }}
      />
    </>
  );
}

/** The sorted metric of a row (views while sorted by date). */
function rowValue(v: TikTokVideoAnalytics, col: TikTokPostSort): string {
  if (col === 'engagement_rate') return formatRate(v.engagement_rate);
  if (col === 'posted_at') return formatCount(v.views);
  return formatCount(v[col]);
}

/** One video: opens it on TikTok, or shows its numbers when the API gave no link. */
function VideoRow({ video, sortCol }: { video: TikTokVideoAnalytics; sortCol: TikTokPostSort }) {
  const { t, i18n } = useTranslation('analyticsTiktok');
  const content = (
    <>
      <PostThumb url={video.cover_image_url} mediaType="TIKTOK" />
      <span className="phone-cell__body">
        <span className="phone-cell__text">
          <span className="phone-cell__label">{videoTitle(video, t('table.untitled'))}</span>
          <span className="phone-cell__subtitle">
            {formatVideoDate(video.posted_at, i18n.language)} ·{' '}
            {t('table.engAbbrev', { value: formatRate(video.engagement_rate) })}
          </span>
        </span>
        <span className="phone-cell__value">
          <span className="phone-an-row-value">{rowValue(video, sortCol)}</span>
        </span>
      </span>
    </>
  );
  return (
    <li className="phone-cell">
      {video.share_url ? (
        <a
          href={sanitizeUrl(video.share_url)}
          target="_blank"
          rel="noopener noreferrer"
          className="phone-cell__main"
        >
          {content}
        </a>
      ) : (
        <div className="phone-cell__main">{content}</div>
      )}
    </li>
  );
}

function VideoMetrics({ video }: { video: TikTokVideoAnalytics }) {
  const { t } = useTranslation('analyticsTiktok');
  return (
    <>
      <span>
        {t('table.views')} <strong>{formatCount(video.views)}</strong>
      </span>
      <span>
        {t('table.engagementShort')} <strong>{formatRate(video.engagement_rate)}</strong>
      </span>
      <span>
        {t('table.likes')} <strong>{formatCount(video.likes)}</strong>
      </span>
      <span>
        {t('table.comments')} <strong>{formatCount(video.comments)}</strong>
      </span>
      <span>
        {t('table.shares')} <strong>{formatCount(video.shares)}</strong>
      </span>
    </>
  );
}

function CardShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="phone-an-card" aria-label={title}>
      <div className="phone-an-card__top">
        <h2 className="phone-group__header">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function LoadingBlock() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '1.5rem 0' }}>
      <Spinner />
    </div>
  );
}

/** Inline "couldn't load" with a retry. */
function RetryLine({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation('analyticsTiktok');
  return (
    <section className="phone-an-empty">
      <p>{t('states.error')}</p>
      <button type="button" className="phone-an-link-button" onClick={onRetry}>
        {t('states.retry')}
      </button>
    </section>
  );
}

/** Melhor horário para postar: the Instagram phone heatmap and slots, in TikTok wording. */
function BestTimesPhone({
  locked,
  loading,
  data,
  onRetry,
}: {
  locked: boolean;
  loading: boolean;
  data: BestPostingTimes | null;
  /** Set when the read failed (not a plan lock). */
  onRetry: (() => void) | null;
}) {
  const { t } = useTranslation('analyticsTiktok');
  const labels = useMemo<BestTimesLabels>(() => {
    const videos = (count: number) => t('bestTimes.postCount', { count });
    return {
      empty: t('bestTimes.empty'),
      tapHint: t('bestTimes.tapHint'),
      header: t('bestTimes.heatmapHeader'),
      footer: (hours) => t('bestTimes.heatmapFooter', { hours }),
      heatmapAria: t('bestTimes.heatmapAria'),
      emptySlot: (day, hour) => t('bestTimes.slotEmpty', { day, hour }),
      cellAria: (day, hour, value, count) =>
        t('bestTimes.cellAria', { day, hour, rate: formatRate(value), videos: videos(count) }),
      readout: (day, from, to, value, count) =>
        t('bestTimes.cellReadout', {
          day,
          from,
          to,
          rate: formatRate(value),
          videos: videos(count),
        }),
      recommended: t('clientTab.recommendedSlots'),
      slotLabel: (day, hour) => t('clientTab.slotWhen', { day, hour }),
      slotValue: (value, count) =>
        t('bestTimes.slotValue', { rate: formatRate(value), videos: videos(count) }),
    };
  }, [t]);

  const title = t('bestTimes.title');
  return (
    <section aria-label={title}>
      <SectionHead large title={title} />
      {locked ? (
        <GroupedList aria-label={title} footer={t('bestTimes.locked')}>
          <Cell icon={<Lock />} label={t('states.lockedAction')} to={BILLING_PATH} />
        </GroupedList>
      ) : loading ? (
        <LoadingBlock />
      ) : onRetry ? (
        <RetryLine onRetry={onRetry} />
      ) : (
        <BestTimesSection data={data} labels={labels} />
      )}
    </section>
  );
}
