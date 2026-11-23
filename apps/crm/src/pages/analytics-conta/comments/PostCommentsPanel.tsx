import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
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
  type Categoria,
  type PostCommentsResponse,
} from '../../../services/instagramComments';
import { sanitizeUrl } from '../../../utils/security';
import { hasInstagramLink } from '@/components/instagram/InstagramLinkButton';
import { CommentFilters } from './CommentFilters';
import { CommentRow, type Moderation } from './CommentRow';
import { CommentsAnalysisView, countText } from './CommentsAnalysisView';
import { CommentThread } from './CommentThread';
import { countByTipo, tipoOf, tiposState, untypedCounts } from './commentTipos';
import { groupComments } from './groupComments';
import { ReconnectState, reconnectReason } from './ReconnectState';
import { useCommentModeration } from './useCommentModeration';

/** Server minimum for a post reading (`too_few_comments` below it). */
const MIN_COMMENTS = 5;

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

// Lista longa cansa: mostra os primeiros e libera mais a cada clique.
const COMMENTS_PAGE = 20;

function CommentsList({
  data,
  post,
  compact,
  moderation,
  refreshFailed,
  onRedo,
  redoing,
}: {
  data: PostCommentsResponse;
  post: PostAnalytics;
  compact: boolean;
  moderation: Moderation | null;
  refreshFailed: boolean;
  /** Redo the reading (the panel's `analyze`), from the legacy / failed notice. */
  onRedo: () => void;
  redoing: boolean;
}) {
  const { t } = useTranslation('analyticsComments');
  const locale = useIntlLocale();
  const [visible, setVisible] = useState(COMMENTS_PAGE);
  // Top-level ids whose replies are open; kept here so "Ver mais" doesn't close them.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const analysis = data.cached_analysis;
  const state = tiposState(analysis);
  const counts = countByTipo(data.comments, analysis);
  const [active, setActive] = useState<Categoria | null>(null);
  // The chosen type only applies while the reading has types and the list still holds one
  // of it (deleting the last one, or a redo that failed, falls back to the conversations).
  const tipo = active && state === 'ok' && counts[active] > 0 ? active : null;
  if (active !== null && tipo === null) {
    // Adjust-state-during-render: drop the stale choice so it never comes back on its own.
    setActive(null);
    setVisible(COMMENTS_PAGE);
  }
  const choose = (next: Categoria | null) => {
    setActive(next);
    setVisible(COMMENTS_PAGE);
  };

  let rows;
  let remaining;
  if (tipo) {
    // Flat list of that type, top-level or reply, in list order.
    const byId = new Map(data.comments.map((c) => [c.id, c]));
    const flat = data.comments.filter((c) => tipoOf(c, analysis) === tipo);
    remaining = Math.max(0, flat.length - visible);
    rows = flat.slice(0, visible).map((c) => {
      const parent = c.parent_id && c.parent_id !== c.id ? byId.get(c.parent_id) : undefined;
      const parentName = parent ? (parent.username || '').replace(/^@/, '') : '';
      return (
        <CommentRow
          key={c.id}
          c={c}
          moderation={moderation}
          tipo={tipo}
          inReplyTo={parentName || null}
        />
      );
    });
  } else {
    // Pages by top-level comment; a group always shows with all its replies.
    const shown = groupComments(data.comments).slice(0, visible);
    remaining = data.comments.length - shown.reduce((n, g) => n + 1 + g.replies.length, 0);
    rows = shown.map((group) => (
      <CommentThread
        key={group.comment.id}
        group={group}
        open={open.has(group.comment.id)}
        onToggle={() => toggle(group.comment.id)}
        moderation={moderation}
        permalink={post.permalink}
        tipoFor={(c) => tipoOf(c, analysis)}
      />
    ));
  }
  const untyped = tipo && analysis ? untypedCounts(data.comments, analysis) : null;
  const filters = data.comments.length > 0 && (
    <>
      <CommentFilters
        state={state}
        counts={counts}
        total={data.comments.length}
        active={tipo}
        onChange={choose}
        onRedo={onRedo}
        redoing={redoing}
      />
      {untyped && untyped.late > 0 && (
        <p className="igc-filters__note">
          {t('filter.lateArrivals', {
            count: untyped.late,
            n: untyped.late.toLocaleString(locale),
          })}
        </p>
      )}
      {untyped && untyped.unclassified > 0 && (
        <p className="igc-filters__note">
          {t('filter.unclassified', {
            count: untyped.unclassified,
            n: untyped.unclassified.toLocaleString(locale),
          })}
        </p>
      )}
    </>
  );
  const list =
    data.comments.length === 0 ? (
      <p className="igc-empty">{t('post.empty')}</p>
    ) : (
      <>
        <ul className="igc-comments" aria-label={t('common.comments')}>
          {rows}
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
  const refreshError = refreshFailed && (
    <p className="igc-error igc-comments__error" role="status">
      {t('moderation.refreshFailed')}
    </p>
  );
  const footer = data.comments.length > 0 && (
    <p className="igc-comments__foot">
      {data.truncated
        ? t('post.showingTruncated')
        : t('post.showing', { comments: countText(t, 'comment', data.comments.length, locale) })}
      {hasInstagramLink(post.permalink) && (
        <>
          {' · '}
          <a href={sanitizeUrl(post.permalink)} target="_blank" rel="noopener noreferrer">
            {t('post.openInstagram')}
          </a>
        </>
      )}
    </p>
  );

  if (compact) {
    return (
      <section className="igc-section">
        <h3 className="igc-eyebrow">{t('common.comments')}</h3>
        <div className="igc-card igc-card--flush">
          {refreshError}
          {filters}
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
      {refreshError}
      {filters}
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
  const { can } = useAuth();
  const canModerate = can('analytics', 'editar') === true;
  const postId = post.instagram_post_id;
  const queryKey = ['ig-post-comments', clientId, postId];
  const { pending, hide, remove } = useCommentModeration({ clientId, postId, queryKey });
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

  // A failed background reload keeps the list (see `refreshFailed` below); the error card
  // is only for a list that never loaded.
  if (!query.data) {
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
      <CommentsList
        key={postId}
        data={data}
        post={post}
        compact={compact}
        moderation={canModerate ? { compact, pending, hide, remove } : null}
        refreshFailed={query.error != null}
        onRedo={() => void analyze()}
        redoing={analyzing}
      />
    </div>
  );
}
