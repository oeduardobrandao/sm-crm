import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { getSavedSuggestionIds } from '@/store/ideias';
import type {
  CommentAnalysis,
  Sentimento,
  StoredAnalysis,
} from '../../../services/instagramComments';
import { sanitizeUrl } from '../../../utils/security';
import { SuggestionIdeaButton } from './SuggestionIdeaButton';

export const SENTIMENTO_LABEL: Record<Sentimento, string> = {
  positivo: 'Majoritariamente positivo',
  misto: 'Misto',
  negativo: 'Majoritariamente negativo',
  polemico: 'Polêmico',
};

type Categoria = keyof CommentAnalysis['distribuicao'];

const CATEGORIAS: { key: Categoria; label: string }[] = [
  { key: 'apoio', label: 'Apoio' },
  { key: 'duvida', label: 'Dúvida' },
  { key: 'critica', label: 'Crítica' },
  { key: 'discussao', label: 'Discussão' },
  { key: 'spam', label: 'Spam' },
];

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;
}

/** Distribution bar + text legend (the colours never carry the meaning alone). */
function DistributionBar({ distribuicao }: { distribuicao: CommentAnalysis['distribuicao'] }) {
  const total = CATEGORIAS.reduce((s, c) => s + Math.max(0, distribuicao[c.key] || 0), 0);
  return (
    <div className="igc-dist">
      <div className="igc-dist__bar" aria-hidden="true">
        {total > 0 &&
          CATEGORIAS.map((c) => {
            const v = Math.max(0, distribuicao[c.key] || 0);
            if (v === 0) return null;
            return (
              <span
                key={c.key}
                className={`igc-dist__seg igc-cat--${c.key}`}
                style={{ width: `${(v / total) * 100}%` }}
              />
            );
          })}
      </div>
      <ul className="igc-dist__legend" aria-label="Distribuição dos comentários">
        {CATEGORIAS.map((c) => (
          <li key={c.key}>
            <span className={`igc-dist__dot igc-cat--${c.key}`} aria-hidden="true" />
            {`${c.label} ${Math.round(Math.max(0, distribuicao[c.key] || 0))}%`}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The result of a comments reading (post or account): new-comments notice, overall
 * sentiment chip, summary, distribution, themes, frequent questions and content ideas
 * with "Salvar como ideia". The header (title, counts, analysed when) is the caller's.
 */
export interface CommentsViewLabels {
  themes: string;
  questions: string;
  ideas: string;
}

const DEFAULT_LABELS: CommentsViewLabels = {
  themes: 'Temas',
  questions: 'Perguntas frequentes',
  ideas: 'Ideias de conteúdo',
};

export function CommentsAnalysisView({
  analysis,
  clienteId,
  sourceLabel,
  newComments,
  onRefresh,
  refreshing,
  postThumbs,
  compact = false,
  labels = DEFAULT_LABELS,
}: {
  analysis: StoredAnalysis;
  clienteId: number;
  sourceLabel: string;
  newComments: number;
  onRefresh: () => void;
  refreshing: boolean;
  /** Account reading: thumbnails of the posts a theme came from, by Graph media id. */
  postThumbs?: Record<string, string | null>;
  /** Phone: themes and questions behind "Ver temas e perguntas", full-width buttons. */
  compact?: boolean;
  /** Section headings (the account card words them differently). */
  labels?: CommentsViewLabels;
}) {
  const qc = useQueryClient();
  const [showDetails, setShowDetails] = useState(!compact);
  const { result } = analysis;
  const ideaIds = result.ideias.map((i) => i.id);
  const savedKey = ['ideias-sugestoes-salvas', ideaIds.join(',')];
  const savedQuery = useQuery({
    queryKey: savedKey,
    queryFn: () => getSavedSuggestionIds(ideaIds),
    enabled: ideaIds.length > 0,
  });
  const savedIds = savedQuery.data;

  const markSaved = (id: string) => {
    qc.setQueryData<Set<string>>(savedKey, (old) => new Set([...(old ?? []), id]));
    void qc.invalidateQueries({ queryKey: savedKey });
  };

  const details = (
    <div className="igc-analysis__cols">
      {result.temas.length > 0 && (
        <section className="igc-analysis__col">
          <h3 className="igc-eyebrow">{labels.themes}</h3>
          <ul className="igc-themes">
            {result.temas.map((t, i) => {
              const thumbs = postThumbs
                ? (t.post_ids ?? []).filter((id) => id in postThumbs).slice(0, 3)
                : [];
              return (
                <li key={`${t.tema}-${i}`} className="igc-theme">
                  <div className="igc-theme__body">
                    <span className="igc-theme__title">
                      <b>{t.tema}</b>
                      {` · ${Math.round(t.peso)}%`}
                    </span>
                    {t.exemplo && <span className="igc-theme__example">{t.exemplo}</span>}
                  </div>
                  {thumbs.length > 0 && (
                    <div className="igc-theme__thumbs" aria-hidden="true">
                      {thumbs.map((id) => {
                        const src = postThumbs?.[id];
                        return src ? (
                          <img key={id} src={sanitizeUrl(src)} alt="" loading="lazy" />
                        ) : (
                          <span key={id} className="igc-theme__thumb-empty" />
                        );
                      })}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {result.perguntas_frequentes.length > 0 && (
        <section className="igc-analysis__col">
          <h3 className="igc-eyebrow">{labels.questions}</h3>
          <ul className="igc-questions">
            {result.perguntas_frequentes.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );

  return (
    <div className={`igc-analysis${compact ? ' igc-analysis--compact' : ''}`}>
      {newComments > 0 && (
        <div className="igc-notice" role="status">
          <span className="igc-notice__text">
            {`${plural(newComments, 'comentário novo', 'comentários novos')} desde a análise`}
          </span>
          <Button variant="outline" className="igc-btn" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw aria-hidden="true" size={14} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Refazendo...' : 'Refazer análise'}
          </Button>
        </div>
      )}

      <span className={`igc-chip igc-chip--${result.sentimento_geral}`}>
        <span className="igc-chip__dot" aria-hidden="true" />
        {SENTIMENTO_LABEL[result.sentimento_geral] ?? result.sentimento_geral}
      </span>

      <p className="igc-analysis__summary">{result.resumo}</p>

      <DistributionBar distribuicao={result.distribuicao} />

      {(result.temas.length > 0 || result.perguntas_frequentes.length > 0) &&
        (compact && !showDetails ? (
          <Button
            variant="outline"
            className="igc-btn igc-btn--block"
            onClick={() => setShowDetails(true)}
          >
            Ver temas e perguntas
          </Button>
        ) : (
          details
        ))}

      {result.ideias.length > 0 && (
        <section className="igc-ideas">
          <h3 className="igc-eyebrow">{labels.ideas}</h3>
          <ul className="igc-ideas__list">
            {result.ideias.map((idea) => (
              <li key={idea.id} className="igc-idea">
                <div className="igc-idea__body">
                  <span className="igc-idea__title">{idea.titulo}</span>
                  {!compact && idea.descricao && (
                    <span className="igc-idea__desc">{idea.descricao}</span>
                  )}
                  {idea.motivo && <span className="igc-idea__why">Por quê: {idea.motivo}</span>}
                </div>
                <SuggestionIdeaButton
                  clienteId={clienteId}
                  idea={idea}
                  sourceLabel={sourceLabel}
                  saved={savedIds?.has(idea.id) ?? false}
                  onSaved={() => markSaved(idea.id)}
                  fullWidth={compact}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
