import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { sanitizeUrl } from '../../../utils/security';
import type { TikTokPostSort, TikTokVideoAnalytics } from '../../../services/tiktokAnalytics';
import { sortNullsLast } from '../../analytics-tiktok/videoRanking';
import { formatCount, formatDuration, formatRate, formatVideoDate } from './tiktokTabFormat';

export interface VideoTableSort {
  col: TikTokPostSort;
  dir: 'asc' | 'desc';
}

const COLLAPSED_ROWS = 10;

const sortValue = (v: TikTokVideoAnalytics, col: TikTokPostSort): number | null =>
  col === 'posted_at' ? (v.posted_at ? Date.parse(v.posted_at) : null) : v[col];

/**
 * Sorted here as well as on the server: the server sorts descending only (and caps the list),
 * so the direction is applied client-side, with nulls last both ways.
 */
export const sortVideos = (videos: TikTokVideoAnalytics[], sort: VideoTableSort) =>
  sortNullsLast(videos, (v) => sortValue(v, sort.col), sort.dir === 'asc');

/** "Desempenho dos vídeos": every video of the window, sortable by its metric columns. */
export function TikTokVideosTable({
  videos,
  sort,
  onSort,
}: {
  videos: TikTokVideoAnalytics[];
  sort: VideoTableSort;
  onSort: (sort: VideoTableSort) => void;
}) {
  const { t, i18n } = useTranslation('analyticsTiktok');
  const [showAll, setShowAll] = useState(false);
  const sorted = useMemo(() => sortVideos(videos, sort), [videos, sort]);
  const visible = showAll ? sorted : sorted.slice(0, COLLAPSED_ROWS);

  const columns: { col: TikTokPostSort | null; label: string }[] = [
    { col: 'posted_at', label: t('table.date') },
    { col: null, label: t('table.cover') },
    { col: null, label: t('table.video') },
    { col: 'views', label: t('table.views') },
    { col: 'likes', label: t('table.likes') },
    { col: 'comments', label: t('table.comments') },
    { col: 'shares', label: t('table.shares') },
    { col: 'engagement_rate', label: t('table.engagement') },
    { col: null, label: t('table.duration') },
    { col: null, label: t('table.link') },
  ];

  const toggle = (col: TikTokPostSort) =>
    onSort(
      sort.col === col ? { col, dir: sort.dir === 'desc' ? 'asc' : 'desc' } : { col, dir: 'desc' },
    );

  return (
    <div className="card animate-up">
      <div className="dashboard-hub-card-header">
        <h3>{t('clientTab.tableTitle')}</h3>
      </div>
      {videos.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>{t('states.noVideos')}</p>
      ) : (
        <>
          <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
            <table className="data-table">
              <thead>
                <tr>
                  {columns.map(({ col, label }) => {
                    const active = col !== null && sort.col === col;
                    return (
                      <th
                        key={label}
                        aria-sort={
                          active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined
                        }
                      >
                        {col ? (
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
                  const title = v.title || v.video_description || t('table.untitled');
                  return (
                    <tr key={v.tiktok_video_id}>
                      <td data-label={t('table.date')}>
                        {formatVideoDate(v.posted_at, i18n.language)}
                      </td>
                      <td data-label={t('table.cover')}>
                        <span
                          style={{
                            display: 'block',
                            width: 40,
                            height: 52,
                            borderRadius: 6,
                            overflow: 'hidden',
                            background: 'linear-gradient(135deg, #0f172a, #334155)',
                          }}
                        >
                          {v.cover_image_url && (
                            <img
                              loading="lazy"
                              src={sanitizeUrl(v.cover_image_url)}
                              alt=""
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          )}
                        </span>
                      </td>
                      <td data-label={t('table.video')} style={{ maxWidth: 280 }}>
                        <span
                          title={title}
                          style={{
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}
                        >
                          {title}
                        </span>
                      </td>
                      <td data-label={t('table.views')}>{formatCount(v.views)}</td>
                      <td data-label={t('table.likes')}>{formatCount(v.likes)}</td>
                      <td data-label={t('table.comments')}>{formatCount(v.comments)}</td>
                      <td data-label={t('table.shares')}>{formatCount(v.shares)}</td>
                      <td data-label={t('table.engagement')}>{formatRate(v.engagement_rate)}</td>
                      <td data-label={t('table.duration')}>{formatDuration(v.duration)}</td>
                      <td data-label={t('table.link')}>
                        {v.share_url ? (
                          <a
                            href={sanitizeUrl(v.share_url)}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`${t('table.link')}: ${title}`}
                            title={t('table.link')}
                            className="inline-flex items-center"
                          >
                            <ExternalLink className="h-4 w-4" aria-hidden="true" />
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {sorted.length > COLLAPSED_ROWS && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '0.75rem' }}>
              <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
                {showAll
                  ? t('clientTab.showLess')
                  : t('clientTab.showAll', { count: sorted.length })}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
