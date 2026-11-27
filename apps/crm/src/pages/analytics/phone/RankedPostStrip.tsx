import { useId, useState } from 'react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useDateFnsLocale } from '@mesaas/i18n';
import { InstagramLinkButton } from '@/components/instagram/InstagramLinkButton';
import { sanitizeUrl } from '../../../utils/security';
import { SectionHead, fmtFixed, fmtNumber, mediaTypeLabel } from './shared';

/** What a ranked-post card needs; both analytics pages' post types fit it. */
export interface RankedPostLike {
  id: string | number;
  /** Empty when the platform gave no link: the card then shows its numbers without one. */
  permalink: string | null;
  thumbnail_url?: string | null;
  media_type: string;
  /** Null where the platform has no date: the card leaves it out. */
  posted_at: string | null;
  /** Null where the platform has no count: the card reads "—", never 0. */
  views: number | null;
  /** Percent; null where the platform has no rate to show. */
  engagement_rate: number | null;
}

const formatEng = (v: number | null) => (v === null ? '—' : `${fmtFixed(v, 1)}%`);
const formatViews = (v: number | null) => (v === null ? '—' : fmtNumber(v));

/**
 * One post of a "Melhores posts" / "Precisam de atenção" strip (FAnalytics mockup). With
 * `onSelect` the card is a button and the Instagram link a chip next to it; without it, the
 * whole card links out.
 */
export function RankedPostCard<P extends RankedPostLike>({
  post,
  title,
  tone,
  typeLabel,
  openLabel,
  onSelect,
}: {
  post: P;
  /** First line: the client (portfolio) or the caption (one account). */
  title: string;
  tone: 'best' | 'worst';
  /** Chip over the cover; defaults to the Instagram format of `media_type`. */
  typeLabel?: string;
  /** Tail of the link's accessible name. */
  openLabel?: string;
  /** Opens the post in the page instead of linking out. */
  onSelect?: (post: P) => void;
}) {
  const { t } = useTranslation(['analyticsPhone', 'analyticsAccount']);
  const dateFnsLocale = useDateFnsLocale();
  const [failed, setFailed] = useState(false);
  const type = typeLabel ?? mediaTypeLabel(post.media_type);
  const date = post.posted_at
    ? format(new Date(post.posted_at), t('analyticsAccount:phone.dateShort'), {
        locale: dateFnsLocale,
      })
    : null;
  const body = (
    <>
      <span className="phone-an-post-card__media">
        {post.thumbnail_url && !failed && (
          <img
            src={sanitizeUrl(post.thumbnail_url)}
            alt=""
            loading="lazy"
            onError={() => setFailed(true)}
          />
        )}
        <span className="phone-an-post-card__type">{type}</span>
      </span>
      <span className="phone-an-post-card__body">
        <span className="phone-an-post-card__meta">
          {title}
          {date && ` · ${date}`}
        </span>
        <span className="phone-an-post-card__nums">
          <strong className={tone === 'best' ? 'phone-an-tone--up' : 'phone-an-tone--down'}>
            {formatViews(post.views)}
          </strong>
          <span>{formatEng(post.engagement_rate)}</span>
        </span>
      </span>
    </>
  );
  const label = t('analyticsPhone:rank.cardLabel', {
    type,
    title,
    views: formatViews(post.views),
  });
  if (onSelect) {
    return (
      <div className="phone-an-post-card-wrap">
        <button
          type="button"
          className="phone-an-post-card"
          aria-label={label}
          onClick={() => onSelect(post)}
        >
          {body}
        </button>
        <InstagramLinkButton
          permalink={post.permalink}
          size={32}
          className="phone-an-post-card__ig"
        />
      </div>
    );
  }
  if (!post.permalink) return <div className="phone-an-post-card">{body}</div>;
  return (
    <a
      href={sanitizeUrl(post.permalink)}
      target="_blank"
      rel="noopener noreferrer"
      className="phone-an-post-card"
      aria-label={`${label}, ${openLabel ?? t('analyticsPhone:rank.openInstagram')}`}
    >
      {body}
    </a>
  );
}

/**
 * A titled horizontal strip of ranked posts with "Ver mais" and the explanation that is a
 * hover tooltip on desktop as a visible footer.
 */
export function RankedPostStrip<P extends RankedPostLike>({
  title,
  help,
  posts,
  tone,
  titleOf,
  onSeeMore,
  seeMoreLabel,
  typeLabel,
  openLabel,
  onSelect,
}: {
  title: string;
  help: string;
  posts: P[];
  tone: 'best' | 'worst';
  titleOf: (post: P) => string;
  /** Omit when everything already fits in the strip. */
  onSeeMore?: () => void;
  seeMoreLabel?: string;
  typeLabel?: string;
  openLabel?: string;
  /** Opens a post in the page; without it each card links to the platform. */
  onSelect?: (post: P) => void;
}) {
  const { t } = useTranslation('analyticsAccount');
  const headingId = useId();
  if (posts.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="phone-an-half">
      <SectionHead
        large
        id={headingId}
        title={title}
        trailing={
          onSeeMore ? (
            <button type="button" className="phone-an-link-button" onClick={onSeeMore}>
              {seeMoreLabel ?? t('page.seeMore')}
            </button>
          ) : undefined
        }
      />
      <div className="phone-an-strip">
        {posts.map((post) => (
          <RankedPostCard
            key={post.id}
            post={post}
            title={titleOf(post)}
            tone={tone}
            typeLabel={typeLabel}
            openLabel={openLabel}
            onSelect={onSelect}
          />
        ))}
      </div>
      <p className="phone-an-footnote">{help}</p>
    </section>
  );
}
