import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import type { PostAnalytics } from '../../../services/analytics';
import {
  analyzeAccountComments,
  CommentsApiError,
  commentsErrorMessage,
  getAccountCommentsAnalysis,
  type AccountCommentsAnalysisResponse,
} from '../../../services/instagramComments';
import { CommentsAnalysisView, type CommentsViewLabels } from './CommentsAnalysisView';
import { ReconnectState, reconnectReason } from './ReconnectState';

/** Server minimum for an account reading (`too_few_comments` below it). */
const MIN_COMMENTS = 10;

const ACCOUNT_LABELS: CommentsViewLabels = {
  themes: 'Temas e de onde vieram',
  questions: 'Perguntas que mais se repetem',
  ideas: 'Ideias de conteúdo do mês',
};

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;
}

function analyzedAgo(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  return formatDistanceToNow(d, { addSuffix: true, locale: ptBR });
}

/**
 * "O que o público está dizendo": the last-30-days comments reading of the account, on
 * the Analytics da conta page (desktop and phone). Renders nothing and never queries
 * unless `feature_instagram_comments_ai` is on.
 */
export function AccountCommentsCard({
  clientId,
  posts,
  compact = false,
}: {
  clientId: number;
  posts: PostAnalytics[];
  compact?: boolean;
}) {
  const enabled = useWorkspaceLimits().features?.feature_instagram_comments_ai === true;
  const qc = useQueryClient();
  const queryKey = ['ig-account-comments-analysis', clientId];
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<unknown>(null);
  // The account reading can take ~45 s and spends one of the hourly analyses: hold a
  // silent deploy swap until it lands.
  useUnsavedWork(analyzing);

  const query = useQuery({
    queryKey,
    queryFn: () => getAccountCommentsAnalysis(clientId),
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const postThumbs = useMemo(() => {
    const m: Record<string, string | null> = {};
    for (const p of posts)
      if (p.instagram_post_id) m[p.instagram_post_id] = p.thumbnail_url ?? null;
    return m;
  }, [posts]);

  if (!enabled) return null;

  const reconnect = reconnectReason(query.error) ?? reconnectReason(analyzeError);
  if (reconnect) return <ReconnectState clientId={clientId} reason={reconnect} />;

  if (query.isLoading) {
    return (
      <section className="igc-card igc-state" role="status">
        <span className="igc-state__loading">
          <Loader2 aria-hidden="true" size={16} className="animate-spin" />
          Carregando comentários...
        </span>
      </section>
    );
  }

  if (query.error || !query.data) {
    return (
      <section className="igc-card igc-state">
        <p className="igc-state__text">{commentsErrorMessage(query.error)}</p>
        <Button variant="outline" className="igc-btn" onClick={() => void query.refetch()}>
          Tentar de novo
        </Button>
      </section>
    );
  }

  const { analysis, current_comments: current } = query.data;
  const newComments = analysis ? Math.max(0, current - analysis.comments_count_at_analysis) : 0;

  const analyze = async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const fresh = await analyzeAccountComments(clientId);
      qc.setQueryData<AccountCommentsAnalysisResponse>(queryKey, (old) =>
        old ? { ...old, analysis: fresh } : { analysis: fresh, current_comments: current },
      );
    } catch (e) {
      setAnalyzeError(e);
    } finally {
      setAnalyzing(false);
    }
  };

  let subtitle = 'Últimos 30 dias';
  if (analysis) {
    const m = analysis.posts_analyzed ?? 0;
    subtitle = [
      'Últimos 30 dias',
      m > 0
        ? `${plural(analysis.comments_analyzed, 'comentário', 'comentários')} em ${plural(m, 'post', 'posts')}`
        : plural(analysis.comments_analyzed, 'comentário', 'comentários'),
      analyzedAgo(analysis.analyzed_at) && `analisado ${analyzedAgo(analysis.analyzed_at)}`,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  const tooFewHint =
    analyzeError instanceof CommentsApiError && analyzeError.code === 'too_few_comments'
      ? `São necessários pelo menos ${MIN_COMMENTS} comentários nos últimos 30 dias para analisar.`
      : null;

  let body;
  if (analyzing && !analysis) {
    body = (
      <div className="igc-analyzing" role="status">
        <span className="igc-state__loading">
          <Loader2 aria-hidden="true" size={16} className="animate-spin" />
          {`Lendo ${plural(current, 'comentário', 'comentários')}...`}
        </span>
        <span className="igc-skeleton" />
        <span className="igc-skeleton igc-skeleton--short" />
      </div>
    );
  } else if (analysis) {
    body = (
      <CommentsAnalysisView
        analysis={analysis}
        clienteId={clientId}
        sourceLabel="dos últimos 30 dias"
        newComments={newComments}
        onRefresh={() => void analyze()}
        refreshing={analyzing}
        postThumbs={postThumbs}
        compact={compact}
        labels={ACCOUNT_LABELS}
      />
    );
  } else {
    body = (
      <div className="igc-empty-reading">
        <p className="igc-state__text">
          {current < MIN_COMMENTS
            ? `São necessários pelo menos ${MIN_COMMENTS} comentários nos últimos 30 dias para analisar. Há ${current.toLocaleString('pt-BR')}.`
            : 'Resuma o clima dos comentários dos últimos 30 dias e receba ideias de conteúdo.'}
        </p>
      </div>
    );
  }

  return (
    <section className="igc-card igc-account">
      <div className="igc-card__head">
        <Sparkles aria-hidden="true" size={16} className="igc-card__icon" />
        <div className="igc-account__titles">
          <h3 className="igc-card__title">O que o público está dizendo</h3>
          <span className="igc-account__sub">{subtitle}</span>
        </div>
        <Button
          variant={analysis ? 'outline' : 'default'}
          className={`igc-btn igc-account__action${compact ? ' igc-btn--block' : ''}`}
          disabled={analyzing}
          onClick={() => void analyze()}
        >
          {analyzing ? 'Analisando...' : analysis ? 'Atualizar análise' : 'Analisar'}
        </Button>
      </div>
      {body}
      {analyzeError != null && (
        <p className="igc-error" role="alert">
          {tooFewHint ?? commentsErrorMessage(analyzeError)}
        </p>
      )}
    </section>
  );
}
