import { useId, useState } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { sanitizeUrl } from '../../../utils/security';
import { SectionHead, fmtNumber, mediaTypeLabel } from './shared';

/** What a ranked-post card needs; both analytics pages' post types fit it. */
export interface RankedPostLike {
  id: string | number;
  permalink: string;
  thumbnail_url?: string | null;
  media_type: string;
  posted_at: string;
  views: number;
  engagement_rate: number;
}

const formatEng = (v: number) => `${v.toFixed(1).replace('.', ',')}%`;

/** One post of a "Melhores posts" / "Precisam de atenção" strip (FAnalytics mockup). */
export function RankedPostCard({
  post,
  title,
  tone,
}: {
  post: RankedPostLike;
  /** First line: the client (portfolio) or the caption (one account). */
  title: string;
  tone: 'best' | 'worst';
}) {
  const [failed, setFailed] = useState(false);
  const type = mediaTypeLabel(post.media_type);
  const date = format(new Date(post.posted_at), "d 'de' MMM", { locale: ptBR });
  return (
    <a
      href={sanitizeUrl(post.permalink)}
      target="_blank"
      rel="noopener noreferrer"
      className="phone-an-post-card"
      aria-label={`${type} de ${title}, ${fmtNumber(post.views)} visualizações, abrir no Instagram`}
    >
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
          {title} · {date}
        </span>
        <span className="phone-an-post-card__nums">
          <strong className={tone === 'best' ? 'phone-an-tone--up' : 'phone-an-tone--down'}>
            {fmtNumber(post.views)}
          </strong>
          <span>{formatEng(post.engagement_rate)}</span>
        </span>
      </span>
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
}: {
  title: string;
  help: string;
  posts: P[];
  tone: 'best' | 'worst';
  titleOf: (post: P) => string;
  /** Omit when everything already fits in the strip. */
  onSeeMore?: () => void;
}) {
  const headingId = useId();
  if (posts.length === 0) return null;
  return (
    <section aria-labelledby={headingId}>
      <SectionHead
        large
        id={headingId}
        title={title}
        trailing={
          onSeeMore ? (
            <button type="button" className="phone-an-link-button" onClick={onSeeMore}>
              Ver mais
            </button>
          ) : undefined
        }
      />
      <div className="phone-an-strip">
        {posts.map((post) => (
          <RankedPostCard key={post.id} post={post} title={titleOf(post)} tone={tone} />
        ))}
      </div>
      <p className="phone-an-footnote">{help}</p>
    </section>
  );
}
