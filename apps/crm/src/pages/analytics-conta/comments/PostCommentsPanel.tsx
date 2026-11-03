import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNow, formatDistanceToNowStrict } from 'date-fns';
import type { Locale } from 'date-fns';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useDateFnsLocale, useIntlLocale } from '@mesaas/i18n';
import { Loader2, Sparkles } from 'lucide-react';
import type { PostAnalytics } from '../../../services/analytics';
import {
  analyzePostComments,
  commentsErrorMessage,
  getPostComments,
  type IgComment,
  type PostCommentsResponse,
} from '../../../services/instagramComments';
import { sanitizeUrl } from '../../../utils/security';
import { CommentsAnalysisView, countText } from './CommentsAnalysisView';
import { ReconnectState, reconnectReason } from './ReconnectState';

/** Server minimum for a post reading (`too_few_comments` below it). */
const MIN_COMMENTS = 5;

function relative(ts: string, locale: Locale): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  return formatDistanceToNowStrict(d, { addSuffix: true, locale });
}

function analyzedAgo(ts: string, locale: Locale): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  return formatDistanceToNow(d, { addSuffix: true, locale });
}

const POST_KINDS = ['VIDEO', 'CAROUSEL_ALBUM', 'IMAGE', 'STORY'];

/** "do Reels de 28 out": names the post in the origin line of a saved idea. */
export function postSourceLabel(post: PostAnalytics, t: TFunction, locale: Locale): string {
  const d = new Date(post.posted_at);
  const kind = t(
    POST_KINDS.includes(post.media_type) ? `post.kind${post.media_type}` : 'post.kindDefault',
  );
  if (isNaN(d.getTime())) return kind;
  return t('post.sourceWithDate', { kind, date: format(d, t('post.dateFormat'), { locale }) });
}

function CommentRow({ c }: { c: IgComment }) {
  const { t } = useTranslation('analyticsComments');
  const dfLocale = useDateFnsLocale();
  const locale = useIntlLocale();
  const name = (c.username || '').replace(/^@/, '');
  const initial = name.charAt(0).toUpperCase() || '?';
  const replies =
    c.replies_more || c.replies_count >= 25
      ? t('count.repliesMany')
      : c.replies_count > 0
        ? countText(t, 'reply', c.replies_count, locale)
        : null;
  const meta = [countText(t, 'like', c.like_count || 0, locale), replies]
    .filter(Boolean)
    .join(' · ');
  const when = relative(c.timestamp, dfLocale);
  return (
    <li className="igc-comment">
      <span className="igc-comment__avatar" aria-hidden="true">
        {initial}
      </span>
      <div className="igc-comment__body">
        <span className="igc-comment__head">
          <b>{name ? `@${name}` : t('post.unknownUser')}</b>
          {when && <span className="igc-comment__when">{` · ${when}`}</span>}
        </span>
        <span className="igc-comment__text">{c.text}</span>
        <span className="igc-comment__meta">{meta}</span>
      </div>
    </li>
  );
}

// Lista longa cansa: mostra os primeiros e libera mais a cada clique.
const COMMENTS_PAGE = 20;

function CommentsList({
  data,
  post,
  compact,
}: {
  data: PostCommentsResponse;
  post: PostAnalytics;
  compact: boolean;
}) {
  const { t } = useTranslation('analyticsComments');
  const locale = useIntlLocale();
  const [visible, setVisible] = useState(COMMENTS_PAGE);
  const remaining = data.comments.length - visible;
  const list =
    data.comments.length === 0 ? (
      <p className="igc-empty">{t('post.empty')}</p>
    ) : (
      <>
        <ul className="igc-comments" aria-label={t('common.comments')}>
          {data.comments.slice(0, visible).map((c) => (
            <CommentRow key={c.id} c={c} />
          ))}
        </ul>
        {remaining > 0 && (
          <Button
            variant="outline"
            className="igc-btn igc-comments__more"
            onClick={() => setVisible((v) => v + COMMENTS_PAGE)}
          >
            {t('post.seeMore', { n: remaining.toLocaleString(locale) })}
          </Button>
        )}
      </>
    );
  const footer = data.comments.length > 0 && (
    <p className="igc-comments__foot">
      {data.truncated
        ? t('post.showingTruncated')
        : t('post.showing', { comments: countText(t, 'comment', data.comments.length, locale) })}
      {' · '}
      <a href={sanitizeUrl(post.permalink)} target="_blank" rel="noopener noreferrer">
        {t('post.openInstagram')}
      </a>
    </p>
  );

  if (compact) {
    return (
      <section className="igc-section">
        <h3 className="igc-eyebrow">{t('common.comments')}</h3>
        <div className="igc-card igc-card--flush">
          {list}
          {footer}
        </div>
      </section>
    );
  }
  return (
    <section className="igc-card igc-card--flush igc-panel__list">
      <div className="igc-card__head">
        <h3 className="igc-card__title">{t('common.comments')}</h3>
      </div>
      {list}
      {footer}
    </section>
  );
}

/**
 * The "Comentários" tab of a post (desktop expanded row, phone post sheet): the AI
 * reading on top (or the button to make one) and the live comment list. Mounted only
 * with `feature_instagram_comments_ai` on and the tab open, so it never fetches otherwise.
 */
export function PostCommentsPanel({
  clientId,
  post,
  compact = false,
}: {
  clientId: number;
  post: PostAnalytics;
  compact?: boolean;
}) {
  const { t } = useTranslation('analyticsComments');
  const dfLocale = useDateFnsLocale();
  const locale = useIntlLocale();
  const qc = useQueryClient();
  const postId = post.instagram_post_id;
  const queryKey = ['ig-post-comments', clientId, postId];
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<unknown>(null);
  // A reading can take up to ~50 s and costs one of the hourly analyses: hold a silent
  // deploy swap until it lands.
  useUnsavedWork(analyzing);

  const query = useQuery({
    queryKey,
    queryFn: () => getPostComments(clientId, postId),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const reconnect = reconnectReason(query.error) ?? reconnectReason(analyzeError);

  if (reconnect) return <ReconnectState clientId={clientId} reason={reconnect} />;

  if (query.isLoading) {
    return (
      <div className="igc-card igc-state" role="status">
        <span className="igc-state__loading">
          <Loader2 aria-hidden="true" size={16} className="animate-spin" />
          {t('common.loading')}
        </span>
      </div>
    );
  }

  if (query.error || !query.data) {
    return (
      <div className="igc-card igc-state">
        <p className="igc-state__text">{commentsErrorMessage(query.error, t)}</p>
        <Button variant="outline" className="igc-btn" onClick={() => void query.refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    );
  }

  const data = query.data;
  const analysis = data.cached_analysis;
  const total = Math.max(post.comments || 0, data.total_fetched || 0);
  const newComments = analysis ? Math.max(0, total - analysis.comments_count_at_analysis) : 0;

  const analyze = async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const fresh = await analyzePostComments(clientId, postId);
      qc.setQueryData<PostCommentsResponse>(queryKey, (old) =>
        old ? { ...old, cached_analysis: fresh } : old,
      );
    } catch (e) {
      setAnalyzeError(e);
    } finally {
      setAnalyzing(false);
    }
  };

  let readingBody;
  if (analyzing && !analysis) {
    readingBody = (
      <div className="igc-analyzing" role="status">
        <span className="igc-state__loading">
          <Loader2 aria-hidden="true" size={16} className="animate-spin" />
          {t('common.reading', { count: total, n: total.toLocaleString(locale) })}
        </span>
        <span className="igc-skeleton" />
        <span className="igc-skeleton igc-skeleton--short" />
      </div>
    );
  } else if (analysis) {
    readingBody = (
      <CommentsAnalysisView
        analysis={analysis}
        clienteId={clientId}
        sourceLabel={postSourceLabel(post, t, dfLocale)}
        newComments={newComments}
        onRefresh={() => void analyze()}
        refreshing={analyzing}
        compact={compact}
      />
    );
  } else {
    const tooFew = data.total_fetched < MIN_COMMENTS;
    readingBody = (
      <div className="igc-empty-reading">
        <p className="igc-state__text">
          {tooFew
            ? t('post.tooFew', {
                min: MIN_COMMENTS,
                current: data.total_fetched.toLocaleString(locale),
              })
            : t('post.prompt', { count: total, n: total.toLocaleString(locale) })}
        </p>
        <Button
          className={`igc-btn${compact ? ' igc-btn--block' : ''}`}
          disabled={tooFew}
          onClick={() => void analyze()}
        >
          {t('post.analyze')}
        </Button>
      </div>
    );
  }

  const reading = (
    <section className="igc-card igc-panel__reading">
      <div className="igc-card__head">
        <Sparkles aria-hidden="true" size={16} className="igc-card__icon" />
        <h3 className="igc-card__title">{t('post.readingTitle')}</h3>
        {analysis && (
          <span className="igc-card__meta">
            {[
              countText(t, 'commentAnalyzed', analysis.comments_analyzed, locale),
              analyzedAgo(analysis.analyzed_at, dfLocale),
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
      </div>
      {readingBody}
      {analyzeError != null && (
        <p className="igc-error" role="alert">
          {commentsErrorMessage(analyzeError, t)}
        </p>
      )}
    </section>
  );

  return (
    <div className={`igc-panel${compact ? ' igc-panel--compact' : ''}`}>
      {reading}
      <CommentsList data={data} post={post} compact={compact} />
    </div>
  );
}
