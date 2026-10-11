import { useCallback, useState } from 'react';
import { Zap } from 'lucide-react';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { cn } from '@/lib/utils';
import { BulletTextPhone, TextCell } from './shared';

export type AITone = 'up' | 'info' | 'warn' | 'down';

/**
 * One AI analysis in a shape both analytics pages map onto: the portfolio analysis
 * (portfolioHealth, accountRanking, priorityActions...) and the account analysis
 * (healthScore, performanceMap, actionPlan...).
 */
export interface AIAnalysisView {
  score?: { value: number; label: string; summary?: string };
  facts?: { label: string; value: string }[];
  ranking?: {
    title: string;
    items: { badge: string; tone: AITone; title: string; detail?: string }[];
  };
  sections: { title: string; text: unknown }[];
  actions?: {
    title: string;
    items: { badge: string; tone: AITone; title: string; detail?: string }[];
  };
  generatedAt?: string;
}

/**
 * Generation state for an AI analysis. Lives in the phone page, not in the section, so a
 * result survives the section's sheet closing and opening again.
 */
export function useAIAnalysis<T>(
  fetcher: () => Promise<T | null>,
  errorOf: (e: unknown) => string,
) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<T | null>(null);
  const [error, setError] = useState('');
  const generate = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const next = await fetcher();
      if (next === null) return;
      setResult(next);
    } catch (e) {
      setError(errorOf(e));
    } finally {
      setLoading(false);
    }
  }, [fetcher, errorOf]);
  return { loading, result, error, setError, generate };
}

export const priorityTone = (p: string): AITone =>
  p === 'alta' ? 'down' : p === 'media' ? 'warn' : 'up';

const scoreTone = (score: number): AITone => (score >= 70 ? 'up' : score >= 40 ? 'warn' : 'down');

/** Phone renderer of an AI analysis: the generate row, then the result as grouped cards. */
export function AIAnalysisPhone({
  title,
  view,
  loading,
  error,
  emptyText,
  onGenerate,
}: {
  title: string;
  view: AIAnalysisView | null;
  loading: boolean;
  error: string;
  emptyText: string;
  onGenerate: () => void;
}) {
  return (
    <div className="phone-an-ai">
      <GroupedList
        header={title}
        footer={
          error ? (
            <span className="phone-an-tone--down">{error}</span>
          ) : !view ? (
            emptyText
          ) : undefined
        }
      >
        <Cell
          icon={<Zap />}
          label={loading ? 'Gerando análise…' : view ? 'Gerar nova análise IA' : 'Gerar Análise IA'}
          disabled={loading}
          aria-busy={loading || undefined}
          onClick={onGenerate}
        />
      </GroupedList>

      {view && (
        <>
          {view.score && (
            <GroupedList aria-label={view.score.label}>
              <li className="phone-cell">
                <div className="phone-an-score">
                  <span
                    className={cn(
                      'phone-an-score__value',
                      `phone-an-tone--${scoreTone(view.score.value)}`,
                    )}
                  >
                    {view.score.value}
                  </span>
                  <span>
                    <span className="phone-an-score__label">{view.score.label}</span>
                    {view.score.summary && (
                      <p className="phone-an-score__summary">{view.score.summary}</p>
                    )}
                  </span>
                </div>
              </li>
              {view.facts?.map((f) => (
                <Cell key={f.label} label={f.label} value={f.value} />
              ))}
            </GroupedList>
          )}

          {view.ranking && view.ranking.items.length > 0 && (
            <GroupedList header={view.ranking.title}>
              {view.ranking.items.map((item, i) => (
                <AIItem key={i} {...item} />
              ))}
            </GroupedList>
          )}

          {view.sections.some((s) => s.text) && (
            <GroupedList aria-label="Análise">
              {view.sections
                .filter((s) => s.text)
                .map((s) => (
                  <TextCell key={s.title} title={s.title}>
                    <BulletTextPhone text={s.text} />
                  </TextCell>
                ))}
            </GroupedList>
          )}

          {view.actions && view.actions.items.length > 0 && (
            <GroupedList
              header={view.actions.title}
              footer={
                view.generatedAt
                  ? `Gerado em ${new Date(view.generatedAt).toLocaleString('pt-BR', {
                      timeZone: 'America/Sao_Paulo',
                    })}`
                  : undefined
              }
            >
              {view.actions.items.map((item, i) => (
                <AIItem key={i} {...item} />
              ))}
            </GroupedList>
          )}
          {(!view.actions || view.actions.items.length === 0) && view.generatedAt && (
            <p className="phone-an-footnote">
              Gerado em{' '}
              {new Date(view.generatedAt).toLocaleString('pt-BR', {
                timeZone: 'America/Sao_Paulo',
              })}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function AIItem({
  badge,
  tone,
  title,
  detail,
}: {
  badge: string;
  tone: AITone;
  title: string;
  detail?: string;
}) {
  return (
    <li className="phone-cell">
      <div className="phone-an-item">
        <span className={`phone-an-badge phone-an-badge--${tone}`}>{badge}</span>
        <span className="phone-an-item__body">
          {title}
          {detail && <span className="phone-an-item__detail">{detail}</span>}
        </span>
      </div>
    </li>
  );
}
