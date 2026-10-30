import { useTranslation } from 'react-i18next';
import type { YtVideoRow } from '../../../services/youtubeAnalytics';
import { sanitizeUrl } from '../../../utils/security';
import { EmptyLine, YouTubeCardFrame, type CardLoadState } from './YouTubeCardFrame';
import { formatCompact, formatPct, videoUrl } from './youtubeTabFormat';

const TOP_SIZE = 5;

/** A 9:16 cover (or a dark placeholder) with an optional rank pill. */
export function ShortCover({ url, rank }: { url: string | null; rank?: string }) {
  return (
    <span
      style={{
        position: 'relative',
        display: 'block',
        aspectRatio: '9 / 16',
        width: '100%',
        borderRadius: 10,
        overflow: 'hidden',
        background: 'linear-gradient(135deg, #0f172a, #334155)',
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
      {rank && (
        <span
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            padding: '2px 8px',
            borderRadius: 999,
            background: 'rgba(0,0,0,0.65)',
            color: '#fff',
            fontSize: '0.7rem',
            fontWeight: 700,
          }}
        >
          {rank}
        </span>
      )}
    </span>
  );
}

/** "Shorts em destaque": the window's 5 most-viewed Shorts, each opening on YouTube. */
export function YouTubeTopShorts({
  shorts,
  lagThrough,
  state,
  phone,
}: {
  shorts: YtVideoRow[];
  /** videosThrough when it lags the channel's dataThrough. */
  lagThrough?: string | null;
  state: CardLoadState;
  phone?: boolean;
}) {
  const { t } = useTranslation('analyticsYoutube');
  const top = shorts.slice(0, TOP_SIZE);

  return (
    <YouTubeCardFrame
      phone={phone}
      title={t('topShorts.title')}
      lagThrough={lagThrough}
      sub={t('topShorts.sub')}
      state={state}
    >
      {top.length === 0 ? (
        <EmptyLine>{t('topShorts.empty')}</EmptyLine>
      ) : (
        <ol
          style={
            phone
              ? {
                  display: 'flex',
                  gap: '0.75rem',
                  overflowX: 'auto',
                  listStyle: 'none',
                  margin: 0,
                  padding: '0 0 0.25rem',
                }
              : {
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                  gap: '1rem',
                  listStyle: 'none',
                  margin: 0,
                  padding: 0,
                }
          }
        >
          {top.map((v, i) => {
            const title = v.title || t('videos.untitled');
            const views = formatCompact(v.views);
            return (
              <li key={v.videoId} style={phone ? { flex: '0 0 130px' } : undefined}>
                <a
                  href={sanitizeUrl(videoUrl(v))}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.4rem',
                    color: 'inherit',
                    textDecoration: 'none',
                  }}
                >
                  <ShortCover url={v.thumbnailUrl} rank={t('topShorts.rank', { n: i + 1 })} />
                  <strong
                    style={{
                      fontSize: '0.8rem',
                      lineHeight: 1.35,
                      overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                    }}
                  >
                    {title}
                  </strong>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {v.avgViewPct === null
                      ? t('topShorts.metaViews', { views })
                      : t('topShorts.meta', { views, pct: formatPct(v.avgViewPct) })}
                  </span>
                </a>
              </li>
            );
          })}
        </ol>
      )}
    </YouTubeCardFrame>
  );
}
