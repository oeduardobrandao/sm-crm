import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import {
  bandLabel,
  formatMetric,
  overallPercentile,
  percentileFromCuts,
  roundedSampleLabel,
  verdictFor,
  type BenchmarkSource,
  type HealthMetricKey,
  type PeerBenchmark,
  type VerdictTone,
} from '@mesaas/report-blocks/health';
import type { AccountHealth } from '@/services/analytics';
import { HealthBar } from './HealthBar';

interface AccountHealthCardProps {
  health: AccountHealth | null | undefined;
  isLoading: boolean;
  onOpenPost: (postId: string) => void;
  layout?: 'desktop' | 'phone';
}

const TITLE = 'Seu Instagram está indo bem?';

const METRIC_ORDER: HealthMetricKey[] = [
  'engagement_rate',
  'posts_30d',
  'reel_views',
  'reels_share',
];

const METRIC_TITLES: Record<HealthMetricKey, string> = {
  engagement_rate: 'Taxa de engajamento',
  posts_30d: 'Posts em 30 dias',
  reel_views: 'Visualizações nos reels',
  reels_share: 'Reels no seu feed',
};

const NULL_REASONS: Record<HealthMetricKey, string | null> = {
  engagement_rate: 'Precisa de pelo menos 3 posts nos últimos 90 dias.',
  posts_30d: null,
  reel_views: 'Precisa de pelo menos 3 reels nos últimos 90 dias.',
  reels_share: 'Precisa de pelo menos 3 posts nos últimos 90 dias.',
};

const SOURCE_MARK: Record<BenchmarkSource, string> = { mesaas: '*', mercado: '†' };
const SOURCE_BADGE: Record<BenchmarkSource, string> = { mesaas: 'Mesaas', mercado: 'Mercado' };

const ratioFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function highlightLine(key: HealthMetricKey, v: string, p: string): string {
  switch (key) {
    case 'engagement_rate':
      return `Seu engajamento é ${v} por post; em contas do seu tamanho é ${p}.`;
    case 'posts_30d':
      return `Você publicou ${v} ${v === '1' ? 'post' : 'posts'} em 30 dias; contas do seu tamanho publicam ${p}.`;
    case 'reel_views':
      return `Seus reels têm ${v} visualizações; em contas do seu tamanho, ${p}.`;
    case 'reels_share':
      return `Reels são ${v} do seu feed; em contas do seu tamanho, ${p}.`;
  }
}

function ToneIcon({ tone }: { tone: VerdictTone }) {
  if (tone === 'great' || tone === 'good') return <TrendingUp aria-hidden="true" />;
  if (tone === 'avg') return <Minus aria-hidden="true" />;
  return <TrendingDown aria-hidden="true" />;
}

interface ScoredMetric {
  key: HealthMetricKey;
  value: number;
  benchmark: PeerBenchmark;
  pct: number;
}

function HealthSkeleton({ layout }: { layout: 'desktop' | 'phone' }) {
  return (
    <article
      aria-label={TITLE}
      aria-busy="true"
      className={`ig-health ig-health-skeleton${layout === 'phone' ? ' ig-health--phone' : ''}`}
    >
      <Skeleton className="ig-health-skeleton__line" style={{ height: 14, width: '40%' }} />
      <Skeleton className="ig-health-skeleton__line" style={{ height: 40, width: '30%' }} />
      <Skeleton className="ig-health-skeleton__line" style={{ height: 10, width: '70%' }} />
      <Skeleton className="ig-health-skeleton__line" style={{ height: 90, width: '100%' }} />
    </article>
  );
}

export function AccountHealthCard({
  health,
  isLoading,
  onOpenPost,
  layout = 'desktop',
}: AccountHealthCardProps) {
  if (isLoading) return <HealthSkeleton layout={layout} />;
  if (!health) return null;

  const rootClass = `ig-health${layout === 'phone' ? ' ig-health--phone' : ''}`;

  const scored: ScoredMetric[] = [];
  for (const key of METRIC_ORDER) {
    const value = health.metrics[key];
    const benchmark = health.benchmarks[key];
    // Benchmark malformado (diferente de 99 cortes) conta como sem referência.
    if (value == null || !benchmark || benchmark.cuts.length !== 99) continue;
    scored.push({ key, value, benchmark, pct: percentileFromCuts(value, benchmark.cuts) });
  }

  const allNull = METRIC_ORDER.every((k) => health.metrics[k] == null);
  const overall = overallPercentile(scored.map((m) => m.pct));

  if (health.followers <= 0 || !health.band || allNull || overall == null) {
    return (
      <article aria-label={TITLE} className={rootClass}>
        <div className="ig-health-empty">
          <h2 className="ig-health-q">{TITLE}</h2>
          <h3 className="ig-health-empty__title">Ainda não dá para comparar</h3>
          <p>
            Publique alguns posts e sincronize. A comparação aparece quando a conta tiver posts de
            feed nos últimos 90 dias.
          </p>
        </div>
      </article>
    );
  }

  const band = health.band;
  const verdict = verdictFor(overall);
  const sources = new Set(scored.map((m) => m.benchmark.source));
  const mixed = sources.size > 1;
  const overallApprox = sources.size === 1 && sources.has('mercado');
  const n = scored.length;
  const summaryLead = n === 1 ? 'Pela métrica disponível' : `Somando as ${n} métricas`;

  // Maior percentil; empate fica com a primeira na ordem fixa (reduce mantém a anterior).
  const top = scored.reduce((best, m) => (m.pct > best.pct ? m : best));
  const topLine = highlightLine(
    top.key,
    formatMetric(top.key, top.value),
    formatMetric(top.key, top.benchmark.cuts[49]),
  );

  const mesaasSamples = scored
    .filter((m) => m.benchmark.source === 'mesaas' && m.benchmark.sample_size != null)
    .map((m) => m.benchmark.sample_size as number);
  const mesaasCount = mesaasSamples.length > 0 ? Math.min(...mesaasSamples) : null;

  const best = health.bestPost;
  const scoredByKey = new Map(scored.map((m) => [m.key, m]));

  return (
    <article aria-label={TITLE} className={rootClass}>
      <div className="ig-health-top">
        <h2 className="ig-health-q">{TITLE}</h2>
        <div className={`ig-health-verdict ig-health-tone-${verdict.tone}`}>
          <ToneIcon tone={verdict.tone} />
          <span>{verdict.label}</span>
        </div>
        <div className="ig-health-top__bar">
          <HealthBar pct={overall} tone={verdict.tone} approx={overallApprox} />
        </div>
        <p className="ig-health-sum">
          {`${summaryLead}, você está à frente de ${overallApprox ? 'cerca de ' : ''}${overall}% das contas do seu tamanho.`}
        </p>
        <p className="ig-health-line">{topLine}</p>
      </div>

      <div className="ig-health-grid">
        {METRIC_ORDER.map((key) => {
          const title = METRIC_TITLES[key];
          const value = health.metrics[key];
          if (value == null) {
            const reason = NULL_REASONS[key];
            return (
              <div key={key} className="ig-health-m">
                <h3 className="ig-health-m__t">
                  <span>{title}</span>
                </h3>
                <p className="ig-health-m__empty">
                  <span>Sem dados suficientes.</span>
                  {reason && (
                    <>
                      {' '}
                      <span>{reason}</span>
                    </>
                  )}
                </p>
              </div>
            );
          }

          const m = scoredByKey.get(key);
          if (!m) {
            return (
              <div key={key} className="ig-health-m">
                <h3 className="ig-health-m__t">
                  <span>{title}</span>
                </h3>
                <div className="ig-health-kv">
                  <div className="ig-health-kv__you">
                    Você: <b>{formatMetric(key, value)}</b>
                  </div>
                </div>
                <p className="ig-health-m__empty">
                  Ainda sem referência para contas do seu tamanho.
                </p>
              </div>
            );
          }

          const v = verdictFor(m.pct);
          const source = m.benchmark.source;
          const approx = source === 'mercado';
          return (
            <div key={key} className="ig-health-m">
              <h3 className="ig-health-m__t">
                <span>{title}</span>
                {mixed && <span className="ig-health-src">{SOURCE_BADGE[source]}</span>}
              </h3>
              <div className={`ig-health-m__v ig-health-tone-${v.tone}`}>
                <ToneIcon tone={v.tone} />
                <span>{v.label}</span>
              </div>
              <HealthBar pct={m.pct} tone={v.tone} size="sm" approx={approx} />
              <p className="ig-health-m__ahead">
                {`À frente de ${approx ? 'cerca de ' : ''}${m.pct}% das contas do seu tamanho`}
              </p>
              <div className="ig-health-kv">
                <div className="ig-health-kv__you">
                  Você: <b>{formatMetric(key, value)}</b>
                </div>
                <div>
                  {`Contas do seu tamanho${SOURCE_MARK[source]}:`}{' '}
                  <b>{formatMetric(key, m.benchmark.cuts[49])}</b>
                </div>
              </div>
              {key === 'engagement_rate' && (
                <p className="ig-health-m__help">
                  Mediana de curtidas + comentários dos seus posts recentes ÷ seguidores.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="ig-health-foot">
        {sources.has('mesaas') && (
          <p className="ig-health-fine">
            {mesaasCount != null
              ? `*Comparado com ${roundedSampleLabel(mesaasCount)} contas do seu tamanho no Mesaas (${bandLabel(band)}).`
              : `*Comparado com contas do seu tamanho no Mesaas (${bandLabel(band)}).`}
          </p>
        )}
        {sources.has('mercado') && (
          <p className="ig-health-fine">{`†Estimativa de mercado para contas ${bandLabel(band)}, a partir de estudos públicos com métricas parecidas.`}</p>
        )}
        {best && best.ratio >= 1 && (
          <p className="ig-health-best">
            {`Seu melhor post dos últimos 30 dias teve ${ratioFormatter.format(best.ratio)}x o resultado normal da sua conta.`}{' '}
            <button
              type="button"
              className="ig-health-best__link"
              onClick={() => onOpenPost(best.id)}
            >
              Ver o post
            </button>
          </p>
        )}
      </div>
    </article>
  );
}
