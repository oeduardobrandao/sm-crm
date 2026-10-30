import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { PostThumb, SectionHead } from '../../analytics/phone/shared';
import type { YtVideoRow, YtVideoSort } from '../../../services/youtubeAnalytics';
import { sanitizeUrl } from '../../../utils/security';
import { EmptyLine, RetryLine, YouTubeCardFrame, type CardLoadState } from './YouTubeCardFrame';
import {
  dimmed,
  formatCount,
  formatDuration,
  formatPct,
  formatShortDate,
  formatThrough,
  formatSigned,
  videoUrl,
} from './youtubeTabFormat';

export interface YtVideoTableSort {
  col: YtVideoSort;
  dir: 'asc' | 'desc';
}

export const DEFAULT_VIDEO_SORT: YtVideoTableSort = { col: 'published_at', dir: 'desc' };

const DESKTOP_ROWS = 10;
const PHONE_ROWS = 5;

const sortValue = (v: YtVideoRow, col: YtVideoSort): number =>
  col === 'published_at' ? (v.publishedAt ? Date.parse(v.publishedAt) : -Infinity) : v[col];

/** Client-side order of the server's rows (the server already sorted by the column, desc). */
export function sortVideos(videos: YtVideoRow[], sort: YtVideoTableSort): YtVideoRow[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...videos].sort((a, b) => sign * (sortValue(a, sort.col) - sortValue(b, sort.col)));
}

const SORTABLE: Record<string, YtVideoSort> = {
  date: 'published_at',
  views: 'views',
  likes: 'likes',
};

/** "Vídeos": videos published in the window, with their current numbers and a YouTube link. */
export function YouTubeVideosTable({
  videos,
  sort,
  onSort,
  lagThrough,
  state,
  phone,
}: {
  videos: YtVideoRow[];
  sort: YtVideoTableSort;
  onSort: (sort: YtVideoTableSort) => void;
  /** videosThrough when it lags the channel's dataThrough. */
  lagThrough?: string | null;
  state: CardLoadState;
  phone?: boolean;
}) {
  const { t, i18n } = useTranslation('analyticsYoutube');
  const [showAll, setShowAll] = useState(false);
  const sorted = useMemo(() => sortVideos(videos, sort), [videos, sort]);
  const limit = phone ? PHONE_ROWS : DESKTOP_ROWS;
  const visible = showAll ? sorted : sorted.slice(0, limit);
  const titleOf = (v: YtVideoRow) => v.title || t('videos.untitled');

  if (phone) {
    return (
      <section aria-label={t('videos.title')}>
        <SectionHead large title={t('videos.title')} />
        <p className="phone-an-tone--muted" style={{ fontSize: '0.8rem', margin: '0 0 0.5rem' }}>
          {t('videos.sub')}
        </p>
        {lagThrough && (
          <p className="phone-an-tone--muted" style={{ fontSize: '0.75rem', margin: '0 0 0.5rem' }}>
            {t('lag', { date: formatThrough(lagThrough, i18n.language) })}
          </p>
        )}
        {state.loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '1.5rem 0' }}>
            <Spinner />
          </div>
        ) : state.onRetry ? (
          <RetryLine phone onRetry={state.onRetry} />
        ) : videos.length === 0 ? (
          <p className="phone-an-empty">{t('videos.empty')}</p>
        ) : (
          <div style={dimmed(!!state.stale)} aria-busy={state.stale || undefined}>
            <GroupedList aria-label={t('videos.title')}>
              {visible.map((v) => (
                <li key={v.videoId} className="phone-cell">
                  <a
                    href={sanitizeUrl(videoUrl(v))}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="phone-cell__main"
                  >
                    <PostThumb url={v.thumbnailUrl} mediaType="VIDEO" />
                    <span className="phone-cell__body">
                      <span className="phone-cell__text">
                        <span className="phone-cell__label">{titleOf(v)}</span>
                        <span className="phone-cell__subtitle">
                          {v.isShort ? t('videos.short') : t('videos.long')} ·{' '}
                          {formatShortDate(v.publishedAt, i18n.language)} ·{' '}
                          {formatPct(v.avgViewPct)}
                        </span>
                      </span>
                      <span className="phone-cell__value">
                        <span className="phone-an-row-value">{formatCount(v.views)}</span>
                      </span>
                    </span>
                  </a>
                </li>
              ))}
              {sorted.length > limit && (
                <Cell
                  label={
                    showAll ? t('videos.showLess') : t('videos.showAll', { count: sorted.length })
                  }
                  onClick={() => setShowAll(!showAll)}
                  aria-expanded={showAll}
                />
              )}
            </GroupedList>
          </div>
        )}
      </section>
    );
  }

  const columns: { key: string; label: string; srOnly?: boolean }[] = [
    { key: 'video', label: t('videos.video') },
    { key: 'type', label: t('videos.type') },
    { key: 'date', label: t('videos.date') },
    { key: 'views', label: t('videos.views') },
    { key: 'engaged', label: t('videos.engaged') },
    { key: 'avgDuration', label: t('videos.avgDuration') },
    { key: 'avgPct', label: t('videos.avgPct') },
    { key: 'likes', label: t('videos.likes') },
    { key: 'comments', label: t('videos.comments') },
    { key: 'subscribers', label: t('videos.subscribers') },
    { key: 'link', label: t('videos.link'), srOnly: true },
  ];
  const toggle = (col: YtVideoSort) =>
    onSort(
      sort.col === col ? { col, dir: sort.dir === 'desc' ? 'asc' : 'desc' } : { col, dir: 'desc' },
    );

  return (
    <YouTubeCardFrame
      title={t('videos.title')}
      sub={t('videos.sub')}
      lagThrough={lagThrough}
      state={state}
    >
      {videos.length === 0 ? (
        <EmptyLine>{t('videos.empty')}</EmptyLine>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  {columns.map(({ key, label, srOnly }) => {
                    const col = SORTABLE[key];
                    const active = !!col && sort.col === col;
                    return (
                      <th
                        key={key}
                        aria-sort={
                          active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined
                        }
                      >
                        {srOnly ? (
                          <span className="sr-only">{label}</span>
                        ) : col ? (
                          <button
                            type="button"
                            onClick={() => toggle(col)}
                            style={{
                              background: 'none',
                              border: 0,
                              padding: 0,
                              font: 'inherit',
                              color: 'inherit',
                              cursor: 'pointer',
                            }}
                          >
                            {label}
                            {active && (sort.dir === 'asc' ? ' ↑' : ' ↓')}
                          </button>
                        ) : (
                          label
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {visible.map((v) => {
                  const title = titleOf(v);
                  return (
                    <tr key={v.videoId}>
                      <td data-label={t('videos.video')}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          <VideoThumb video={v} />
                          <strong
                            title={title}
                            style={{
                              maxWidth: 240,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {title}
                          </strong>
                        </span>
                      </td>
                      <td data-label={t('videos.type')}>
                        <Badge size="sm" variant={v.isShort ? 'danger' : 'info'}>
                          {v.isShort ? t('videos.short') : t('videos.long')}
                        </Badge>
                      </td>
                      <td data-label={t('videos.date')}>
                        {formatShortDate(v.publishedAt, i18n.language)}
                      </td>
                      <td data-label={t('videos.views')}>{formatCount(v.views)}</td>
                      <td data-label={t('videos.engaged')}>{formatCount(v.engagedViews)}</td>
                      <td data-label={t('videos.avgDuration')}>
                        {formatDuration(v.avgViewDurationS)}
                      </td>
                      <td data-label={t('videos.avgPct')}>{formatPct(v.avgViewPct)}</td>
                      <td data-label={t('videos.likes')}>{formatCount(v.likes)}</td>
                      <td data-label={t('videos.comments')}>{formatCount(v.comments)}</td>
                      <td data-label={t('videos.subscribers')}>
                        {formatSigned(v.subscribersGained)}
                      </td>
                      <td data-label={t('videos.link')}>
                        <a
                          href={sanitizeUrl(videoUrl(v))}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`${t('videos.open')}: ${title}`}
                          style={{ whiteSpace: 'nowrap' }}
                        >
                          {t('videos.open')}
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {sorted.length > DESKTOP_ROWS && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '0.75rem' }}>
              <Button variant="ghost" size="sm" onClick={() => setShowAll((s) => !s)}>
                {showAll ? t('videos.showLess') : t('videos.showAll', { count: sorted.length })}
              </Button>
            </div>
          )}
        </>
      )}
    </YouTubeCardFrame>
  );
}

/** Portrait for a Short, landscape for a long video (mockup 3). */
function VideoThumb({ video }: { video: YtVideoRow }) {
  const size = video.isShort ? { width: 30, height: 52 } : { width: 64, height: 36 };
  return (
    <span
      style={{
        ...size,
        flexShrink: 0,
        display: 'block',
        borderRadius: 6,
        overflow: 'hidden',
        background: 'linear-gradient(135deg, #0f172a, #334155)',
      }}
    >
      {video.thumbnailUrl && (
        <img
          loading="lazy"
          src={sanitizeUrl(video.thumbnailUrl)}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      )}
    </span>
  );
}
