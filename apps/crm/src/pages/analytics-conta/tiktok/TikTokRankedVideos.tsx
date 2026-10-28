import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  ArrowUpDown,
  ChevronRight,
  Heart,
  MessageCircle,
  Share2,
  Trophy,
} from 'lucide-react';
import { InstagramPostCarousel } from '@/components/instagram/InstagramPostCarousel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useVidroShell } from '@/components/layout/PageToolbarContext';
import { sanitizeUrl } from '../../../utils/security';
import type { TikTokVideoAnalytics } from '../../../services/tiktokAnalytics';
import {
  filterByPostedRange,
  postedMs,
  rankByViews,
  sortNullsLast,
} from '../../analytics-tiktok/videoRanking';
import { formatCount, formatRate, formatVideoDate } from './tiktokTabFormat';

type Mode = 'best' | 'worst';
type OrderBy = 'views' | 'likes' | 'comments' | 'shares' | 'engagement' | 'date';
const ORDERS: { value: OrderBy; key: string }[] = [
  { value: 'views', key: 'drawer.sortViews' },
  { value: 'likes', key: 'drawer.sortLikes' },
  { value: 'comments', key: 'drawer.sortComments' },
  { value: 'shares', key: 'drawer.sortShares' },
  { value: 'engagement', key: 'drawer.sortEngagement' },
  { value: 'date', key: 'drawer.sortDate' },
];

const STRIP_SIZE = 5;

function orderValue(v: TikTokVideoAnalytics, orderBy: OrderBy): number | null {
  switch (orderBy) {
    case 'engagement':
      return v.engagement_rate;
    case 'date':
      return v.posted_at ? postedMs(v) : null;
    default:
      return v[orderBy];
  }
}

/** "Melhores vídeos" / "Precisam de atenção" strips and their "Ver mais" side sheet. */
export function TikTokRankedVideos({
  videos,
  period,
}: {
  videos: TikTokVideoAnalytics[];
  period: string;
}) {
  const { t, i18n } = useTranslation('analyticsTiktok');
  // best: every video by views; worst: older than 48h, fewest views first.
  const { best, worst } = useMemo(() => rankByViews(videos), [videos]);
  const [mode, setMode] = useState<Mode | null>(null);
  const [orderBy, setOrderBy] = useState<OrderBy>('views');
  const [asc, setAsc] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const open = (next: Mode) => {
    setMode(next);
    setOrderBy('views');
    setAsc(next === 'worst');
  };
  const close = () => {
    setMode(null);
    setDateFrom('');
    setDateTo('');
  };

  const source = mode === 'worst' ? worst : best;
  const listed = useMemo(
    () =>
      sortNullsLast(
        filterByPostedRange(source, dateFrom, dateTo),
        (v) => orderValue(v, orderBy),
        asc,
      ),
    [source, dateFrom, dateTo, asc, orderBy],
  );

  return (
    <>
      <Strip
        title={t('overview.topVideos')}
        description={t('clientTab.topVideosHint', { period })}
        icon={<Trophy className="h-5 w-5" style={{ color: 'var(--success)' }} />}
        videos={best}
        tone="best"
        onSeeMore={() => open('best')}
      />
      <Strip
        title={t('overview.bottomVideos')}
        description={t('overview.bottomVideosHint')}
        icon={<AlertTriangle className="h-5 w-5" style={{ color: 'var(--warning)' }} />}
        videos={worst}
        tone="worst"
        onSeeMore={() => open('worst')}
      />
      <VideosSheet
        mode={mode}
        onClose={close}
        videos={listed}
        total={source.length}
        orderBy={orderBy}
        setOrderBy={setOrderBy}
        asc={asc}
        setAsc={setAsc}
        dateFrom={dateFrom}
        setDateFrom={setDateFrom}
        dateTo={dateTo}
        setDateTo={setDateTo}
        language={i18n.language}
      />
    </>
  );
}

function Strip({
  title,
  description,
  icon,
  videos,
  tone,
  onSeeMore,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  videos: TikTokVideoAnalytics[];
  tone: Mode;
  onSeeMore: () => void;
}) {
  const { t } = useTranslation('analyticsTiktok');
  return (
    <InstagramPostCarousel
      title={title}
      description={description}
      ariaLabel={title}
      icon={icon}
      posts={videos.slice(0, STRIP_SIZE)}
      getKey={(v) => v.tiktok_video_id}
      renderPost={(v) => <VideoCard video={v} tone={tone} />}
      action={
        videos.length > STRIP_SIZE ? (
          <Button variant="ghost" size="sm" onClick={onSeeMore}>
            {t('overview.seeAll')} <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        ) : undefined
      }
    />
  );
}

const statRow = { display: 'flex', justifyContent: 'space-between' } as const;
const statLabel = { fontSize: '0.7rem', color: 'var(--text-muted)' } as const;
const statValue = { fontSize: '0.7rem', fontWeight: 700, fontFamily: 'var(--font-mono)' } as const;
const iconStat = {
  display: 'flex',
  alignItems: 'center',
  gap: 3,
  fontSize: '0.65rem',
  color: 'var(--text-muted)',
} as const;
const iconStatValue = { fontFamily: 'var(--font-mono)', color: 'var(--text-main)' } as const;

function Cover({ url, style }: { url: string | null; style: CSSProperties }) {
  return (
    <span
      style={{
        display: 'block',
        overflow: 'hidden',
        background: 'linear-gradient(135deg, #0f172a, #334155)',
        ...style,
      }}
    >
      {url && (
        <img
          src={sanitizeUrl(url)}
          alt=""
          loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      )}
    </span>
  );
}

/** A video with a link opens it on TikTok; one the API gave no link for still shows its numbers. */
function VideoLink({
  video,
  className,
  style,
  children,
}: {
  video: TikTokVideoAnalytics;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return video.share_url ? (
    <a
      href={sanitizeUrl(video.share_url)}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      style={{ textDecoration: 'none', color: 'inherit', ...style }}
    >
      {children}
    </a>
  ) : (
    <div className={className} style={style}>
      {children}
    </div>
  );
}

function VideoCard({ video, tone }: { video: TikTokVideoAnalytics; tone: Mode }) {
  const { t, i18n } = useTranslation('analyticsTiktok');
  return (
    <VideoLink video={video} className="analytics-post-card" style={{ minWidth: 180 }}>
      <Cover url={video.cover_image_url} style={{ aspectRatio: '3/4', width: '100%' }} />
      <div style={{ padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        <span
          style={{
            minHeight: 34,
            fontSize: '0.72rem',
            fontWeight: 600,
            color: 'var(--text-muted)',
            lineHeight: 1.35,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {video.title || video.video_description || t('table.untitled')}
        </span>
        <span style={{ fontSize: '0.65rem', color: 'var(--text-light)' }}>
          {formatVideoDate(video.posted_at, i18n.language)}
        </span>
        <div style={statRow}>
          <span style={statLabel}>{t('table.views')}</span>
          <span
            style={{
              ...statValue,
              color: tone === 'best' ? 'var(--success)' : 'var(--danger-text)',
            }}
          >
            {formatCount(video.views)}
          </span>
        </div>
        <div style={statRow}>
          <span style={statLabel}>{t('table.engagementShort')}</span>
          <span style={statValue}>{formatRate(video.engagement_rate)}</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: 2, flexWrap: 'wrap' }}>
          <span style={iconStat} title={t('table.likes')}>
            <Heart className="h-3 w-3" aria-hidden="true" />
            <strong style={iconStatValue}>{formatCount(video.likes)}</strong>
          </span>
          <span style={iconStat} title={t('table.comments')}>
            <MessageCircle className="h-3 w-3" aria-hidden="true" />
            <strong style={iconStatValue}>{formatCount(video.comments)}</strong>
          </span>
          <span style={iconStat} title={t('table.shares')}>
            <Share2 className="h-3 w-3" aria-hidden="true" />
            <strong style={iconStatValue}>{formatCount(video.shares)}</strong>
          </span>
        </div>
      </div>
    </VideoLink>
  );
}

function VideosSheet(props: {
  mode: Mode | null;
  onClose: () => void;
  videos: TikTokVideoAnalytics[];
  total: number;
  orderBy: OrderBy;
  setOrderBy: (v: OrderBy) => void;
  asc: boolean;
  setAsc: (v: boolean) => void;
  dateFrom: string;
  setDateFrom: (v: string) => void;
  dateTo: string;
  setDateTo: (v: string) => void;
  language: string;
}) {
  const { t } = useTranslation('analyticsTiktok');
  const vidroShell = useVidroShell();
  const best = props.mode !== 'worst';
  const selectStyle = {
    height: 36,
    borderRadius: 8,
    border: '1px solid var(--border-color)',
    background: vidroShell ? undefined : 'var(--card-bg)',
    color: 'var(--text-main)',
    padding: '0 0.6rem',
    fontSize: '0.85rem',
  } as const;
  return (
    <Sheet
      open={props.mode !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <SheetContent side="right" className="!w-full !max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {best ? (
              <Trophy className="h-5 w-5" style={{ color: 'var(--success)' }} />
            ) : (
              <AlertTriangle className="h-5 w-5" style={{ color: 'var(--warning)' }} />
            )}
            {best ? t('drawer.titleBest') : t('drawer.titleWorst')}
          </SheetTitle>
          <SheetDescription>
            {t('drawer.count', { shown: props.videos.length, total: props.total })}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-3 grid gap-2 border-b border-border pb-3">
          <div className="grid grid-cols-[minmax(0,1fr)_2.25rem] items-center gap-2">
            <select
              value={props.orderBy}
              onChange={(e) => props.setOrderBy(e.target.value as OrderBy)}
              aria-label={t('table.sortBy')}
              className="drawer-select"
              style={selectStyle}
            >
              {ORDERS.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(o.key)}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              size="icon"
              onClick={() => props.setAsc(!props.asc)}
              className="mb-0 h-9 w-9 shrink-0 rounded-lg"
              title={props.asc ? t('table.sortAsc') : t('table.sortDesc')}
              aria-label={props.asc ? t('table.sortAsc') : t('table.sortDesc')}
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
            <Input
              type="date"
              aria-label={t('table.date')}
              value={props.dateFrom}
              onChange={(e) => props.setDateFrom(e.target.value)}
              className="h-9 rounded-lg font-mono text-sm"
            />
            <span className="text-sm text-muted-foreground">{t('drawer.until')}</span>
            <Input
              type="date"
              aria-label={`${t('table.date')} (${t('drawer.until')})`}
              value={props.dateTo}
              onChange={(e) => props.setDateTo(e.target.value)}
              className="h-9 rounded-lg font-mono text-sm"
            />
          </div>
          {(props.dateFrom || props.dateTo) && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  props.setDateFrom('');
                  props.setDateTo('');
                }}
                className="text-xs font-medium text-destructive"
              >
                {t('drawer.clearDates')}
              </button>
            </div>
          )}
        </div>

        <div
          style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.75rem' }}
        >
          {props.videos.length === 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t('drawer.empty')}</p>
          )}
          {props.videos.map((v, i) => (
            <VideoRow key={v.tiktok_video_id} video={v} rank={i + 1} language={props.language} />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function VideoRow({
  video,
  rank,
  language,
}: {
  video: TikTokVideoAnalytics;
  rank: number;
  language: string;
}) {
  const { t } = useTranslation('analyticsTiktok');
  const vidroShell = useVidroShell();
  return (
    <VideoLink
      video={video}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '0.6rem 0.75rem',
        borderRadius: 12,
        border: '1px solid var(--border-color)',
        background: vidroShell ? undefined : 'var(--card-bg)',
      }}
    >
      <span
        style={{
          fontSize: '0.75rem',
          fontWeight: 700,
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-muted)',
          minWidth: 24,
          textAlign: 'center',
        }}
      >
        {rank}
      </span>
      <Cover
        url={video.cover_image_url}
        style={{ width: 48, height: 48, borderRadius: 8, flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span
            style={{
              fontSize: '0.8rem',
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {video.title || video.video_description || t('table.untitled')}
          </span>
          <span style={{ fontSize: '0.65rem', color: 'var(--text-light)', flexShrink: 0 }}>
            {formatVideoDate(video.posted_at, language)}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            gap: '0.75rem',
            fontSize: '0.7rem',
            color: 'var(--text-muted)',
            marginTop: 2,
            flexWrap: 'wrap',
          }}
        >
          <span>
            {t('table.views')} <strong style={iconStatValue}>{formatCount(video.views)}</strong>
          </span>
          <span>
            {t('table.engagementShort')}{' '}
            <strong style={iconStatValue}>{formatRate(video.engagement_rate)}</strong>
          </span>
          <span style={iconStat} title={t('table.likes')}>
            <Heart className="h-3 w-3" aria-hidden="true" />
            <strong style={iconStatValue}>{formatCount(video.likes)}</strong>
          </span>
          <span style={iconStat} title={t('table.comments')}>
            <MessageCircle className="h-3 w-3" aria-hidden="true" />
            <strong style={iconStatValue}>{formatCount(video.comments)}</strong>
          </span>
          <span style={iconStat} title={t('table.shares')}>
            <Share2 className="h-3 w-3" aria-hidden="true" />
            <strong style={iconStatValue}>{formatCount(video.shares)}</strong>
          </span>
        </div>
      </div>
    </VideoLink>
  );
}
