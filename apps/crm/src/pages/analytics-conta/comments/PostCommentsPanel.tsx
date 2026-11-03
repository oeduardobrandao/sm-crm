import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNow, formatDistanceToNowStrict } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Loader2, Sparkles } from 'lucide-react';
import type { PostAnalytics } from '../../../services/analytics';
import {
  analyzePostComments,
  CommentsApiError,
  commentsErrorMessage,
  getPostComments,
  type IgComment,
  type PostCommentsResponse,
} from '../../../services/instagramComments';
import { sanitizeUrl } from '../../../utils/security';
import { mediaTypeLabel } from '../../analytics/phone/shared';
import { CommentsAnalysisView } from './CommentsAnalysisView';

/** Server minimum for a post reading (`too_few_comments` below it). */
const MIN_COMMENTS = 5;

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;
}

function relative(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  return formatDistanceToNowStrict(d, { addSuffix: true, locale: ptBR });
}

/** Errors only a reconnection fixes: the comments scope is missing (409) or the
 *  Instagram token expired (401 `TOKEN_EXPIRED`). Any other 401 (the user's own session)
 *  falls through to the generic message. */
function reconnectReason(e: unknown): 'scope' | 'expired' | null {
  if (!(e instanceof CommentsApiError)) return null;
  if (e.code === 'missing_comments_scope') return 'scope';
  if (e.status === 401 && e.code === 'TOKEN_EXPIRED') return 'expired';
  return null;
}

function analyzedAgo(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  return formatDistanceToNow(d, { addSuffix: true, locale: ptBR });
}

/** "Reels de 28 out": names the post in the origin line of a saved idea. */
export function postSourceLabel(post: PostAnalytics): string {
  const d = new Date(post.posted_at);
  const when = isNaN(d.getTime()) ? '' : ` de ${format(d, 'd MMM', { locale: ptBR })}`;
  return `${mediaTypeLabel(post.media_type)}${when}`;
}

function CommentRow({ c }: { c: IgComment }) {
  const name = (c.username || '').replace(/^@/, '');
  const initial = name.charAt(0).toUpperCase() || '?';
  const replies =
    c.replies_more || c.replies_count >= 25
      ? '25+ respostas'
      : c.replies_count > 0
        ? plural(c.replies_count, 'resposta', 'respostas')
        : null;
  const meta = [plural(c.like_count || 0, 'curtida', 'curtidas'), replies]
    .filter(Boolean)
    .join(' · ');
  const when = relative(c.timestamp);
  return (
    <li className="igc-comment">
      <span className="igc-comment__avatar" aria-hidden="true">
        {initial}
      </span>
      <div className="igc-comment__body">
        <span className="igc-comment__head">
          <b>{name ? `@${name}` : 'Usuário do Instagram'}</b>
          {when && <span className="igc-comment__when">{` · ${when}`}</span>}
        </span>
        <span className="igc-comment__text">{c.text}</span>
        <span className="igc-comment__meta">{meta}</span>
      </div>
    </li>
  );
}

function CommentsList({
  data,
  post,
  compact,
}: {
  data: PostCommentsResponse;
  post: PostAnalytics;
  compact: boolean;
}) {
  const list =
    data.comments.length === 0 ? (
      <p className="igc-empty">Este post ainda não tem comentários.</p>
    ) : (
      <ul className="igc-comments" aria-label="Comentários">
        {data.comments.map((c) => (
          <CommentRow key={c.id} c={c} />
        ))}
      </ul>
    );
  const footer = data.comments.length > 0 && (
    <p className="igc-comments__foot">
      {data.truncated
        ? 'Mostrando os 200 mais recentes'
        : `Mostrando ${plural(data.comments.length, 'comentário', 'comentários')}`}
      {' · '}
      <a href={sanitizeUrl(post.permalink)} target="_blank" rel="noopener noreferrer">
        Abrir no Instagram
      </a>
    </p>
  );

  if (compact) {
    return (
      <section className="igc-section">
        <h3 className="igc-eyebrow">Comentários</h3>
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
        <h3 className="igc-card__title">Comentários</h3>
        <span className="igc-card__meta">Mais recentes</span>
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
  const navigate = useNavigate();
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

  if (reconnect) {
    return (
      <div className="igc-card igc-state">
        <h3 className="igc-eyebrow">
          {reconnect === 'expired' ? 'Conexão expirada' : 'Sem permissão de comentários'}
        </h3>
        <p className="igc-state__text">
          {reconnect === 'expired'
            ? 'A conexão com o Instagram expirou. Reconecte para ver os comentários.'
            : 'Para ver os comentários, reconecte o Instagram deste cliente e aceite a permissão de comentários.'}
        </p>
        <Button
          variant="outline"
          className="igc-btn"
          onClick={() => navigate(`/clientes/${clientId}/redes-sociais`)}
        >
          Reconectar Instagram
        </Button>
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="igc-card igc-state" role="status">
        <span className="igc-state__loading">
          <Loader2 aria-hidden="true" size={16} className="animate-spin" />
          Carregando comentários...
        </span>
      </div>
    );
  }

  if (query.error || !query.data) {
    return (
      <div className="igc-card igc-state">
        <p className="igc-state__text">{commentsErrorMessage(query.error)}</p>
        <Button variant="outline" className="igc-btn" onClick={() => void query.refetch()}>
          Tentar de novo
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
          {`Lendo ${plural(total, 'comentário', 'comentários')}...`}
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
        sourceLabel={postSourceLabel(post)}
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
            ? `São precisos pelo menos ${MIN_COMMENTS} comentários para analisar. Este post tem ${data.total_fetched.toLocaleString('pt-BR')}.`
            : `Resuma o clima ${total === 1 ? 'do comentário' : `dos ${total.toLocaleString('pt-BR')} comentários`} e receba ideias de conteúdo.`}
        </p>
        <Button
          className={`igc-btn${compact ? ' igc-btn--block' : ''}`}
          disabled={tooFew}
          onClick={() => void analyze()}
        >
          Analisar comentários
        </Button>
      </div>
    );
  }

  const reading = (
    <section className="igc-card igc-panel__reading">
      <div className="igc-card__head">
        <Sparkles aria-hidden="true" size={16} className="igc-card__icon" />
        <h3 className="igc-card__title">Leitura dos comentários</h3>
        {analysis && (
          <span className="igc-card__meta">
            {[
              plural(analysis.comments_analyzed, 'comentário analisado', 'comentários analisados'),
              analyzedAgo(analysis.analyzed_at),
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
      </div>
      {readingBody}
      {analyzeError != null && (
        <p className="igc-error" role="alert">
          {commentsErrorMessage(analyzeError)}
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
