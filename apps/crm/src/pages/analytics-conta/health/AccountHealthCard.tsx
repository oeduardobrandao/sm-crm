import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import {
  HEALTH_METRIC_ORDER as METRIC_ORDER,
  HEALTH_METRIC_TITLES as METRIC_TITLES,
  HEALTH_NULL_REASONS as NULL_REASONS,
  overallPercentile,
  scoreHealthMetrics,
  type BenchmarkSource,
  type VerdictTone,
} from '@mesaas/report-blocks/health';
import type { AccountHealth } from '@/services/analytics';
import { HealthBar } from './HealthBar';
import {
  healthBandLabel,
  healthHighlight,
  healthMetricText,
  healthMetricTitle,
  healthNullReason,
  healthRatio,
  healthSampleLabel,
  healthVerdict,
} from './healthText';

interface AccountHealthCardProps {
  health: AccountHealth | null | undefined;
  isLoading: boolean;
  onOpenPost: (postId: string) => void;
  layout?: 'desktop' | 'phone';
}

const SOURCE_MARK: Record<BenchmarkSource, string> = { mesaas: '*', mercado: '†' };

function ToneIcon({ tone }: { tone: VerdictTone }) {
  if (tone === 'great' || tone === 'good') return <TrendingUp aria-hidden="true" />;
  if (tone === 'avg') return <Minus aria-hidden="true" />;
  return <TrendingDown aria-hidden="true" />;
}

function HealthSkeleton({ layout }: { layout: 'desktop' | 'phone' }) {
  const { t } = useTranslation('analyticsAccount');
  return (
    <article
      aria-label={t('health.title')}
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
  const { t } = useTranslation('analyticsAccount');
  const TITLE = t('health.title');
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  if (isLoading) return <HealthSkeleton layout={layout} />;
  if (!health) return null;

  const rootClass = `ig-health${layout === 'phone' ? ' ig-health--phone' : ''}`;

  // Benchmark malformado (diferente de 99 cortes) conta como sem referência.
  const scored = scoreHealthMetrics(health.metrics, health.benchmarks);

  const allNull = METRIC_ORDER.every((k) => health.metrics[k] == null);
  const overall = overallPercentile(scored.map((m) => m.pct));

  if (health.followers <= 0 || !health.band || allNull || overall == null) {
    return (
      <article aria-label={TITLE} className={rootClass}>
        <div className="ig-health-empty">
          <h2 className="ig-health-q">{TITLE}</h2>
          <h3 className="ig-health-empty__title">{t('health.notEnough')}</h3>
          <p>{t('health.notEnoughBody')}</p>
        </div>
      </article>
    );
  }

  const band = health.band;
  const verdict = healthVerdict(overall);
  const sources = new Set(scored.map((m) => m.benchmark.source));
  const mixed = sources.size > 1;
  const overallApprox = sources.size === 1 && sources.has('mercado');
  const n = scored.length;
  const summaryLead = n === 1 ? t('health.leadOne') : t('health.leadMany', { n });

  // Maior percentil; empate fica com a primeira na ordem fixa (reduce mantém a anterior).
  const top = scored.reduce((best, m) => (m.pct > best.pct ? m : best));
  const topLine = healthHighlight(
    top.key,
    healthMetricText(top.key, top.value),
    healthMetricText(top.key, top.benchmark.cuts[49]),
  );

  const mesaasSamples = scored
    .filter((m) => m.benchmark.source === 'mesaas' && m.benchmark.sample_size != null)
    .map((m) => m.benchmark.sample_size as number);
  const mesaasCount = mesaasSamples.length > 0 ? Math.min(...mesaasSamples) : null;

  const best = health.bestPost;
  const scoredByKey = new Map(scored.map((m) => [m.key, m]));

  return (
    <article
      aria-label={TITLE}
      className={`${rootClass}${expanded ? '' : ' ig-health--collapsed'}`}
    >
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
          {t('health.summary', {
            lead: summaryLead,
            approx: overallApprox ? t('health.approx') : '',
            pct: overall,
          })}
        </p>
        <p className="ig-health-line">{topLine}</p>
        <button
          type="button"
          className="ig-health-more"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? t('health.seeLess') : t('health.seeMore')}
          <ChevronDown aria-hidden="true" className={expanded ? 'is-open' : undefined} />
        </button>
      </div>

      {expanded && (
        <div id={detailsId} className="ig-health-details">
          <div className="ig-health-grid">
            {METRIC_ORDER.map((key) => {
              const title = healthMetricTitle(key, METRIC_TITLES[key]);
              const value = health.metrics[key];
              if (value == null) {
                const reason = healthNullReason(key, NULL_REASONS[key]);
                return (
                  <div key={key} className="ig-health-m">
                    <h3 className="ig-health-m__t">
                      <span>{title}</span>
                    </h3>
                    <p className="ig-health-m__empty">
                      <span>{t('health.noDataEnough')}</span>
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
                        {t('health.you')} <b>{healthMetricText(key, value)}</b>
                      </div>
                    </div>
                    <p className="ig-health-m__empty">{t('health.noReference')}</p>
                  </div>
                );
              }

              const v = healthVerdict(m.pct);
              const source = m.benchmark.source;
              const approx = source === 'mercado';
              return (
                <div key={key} className="ig-health-m">
                  <h3 className="ig-health-m__t">
                    <span>{title}</span>
                    {mixed && <span className="ig-health-src">{t(`health.source.${source}`)}</span>}
                  </h3>
                  <div className={`ig-health-m__v ig-health-tone-${v.tone}`}>
                    <ToneIcon tone={v.tone} />
                    <span>{v.label}</span>
                  </div>
                  <HealthBar pct={m.pct} tone={v.tone} size="sm" approx={approx} />
                  <p className="ig-health-m__ahead">
                    {t('health.ahead', { approx: approx ? t('health.approx') : '', pct: m.pct })}
                  </p>
                  <div className="ig-health-kv">
                    <div className="ig-health-kv__you">
                      {t('health.you')} <b>{healthMetricText(key, value)}</b>
                    </div>
                    <div>
                      {t('health.peers', { mark: SOURCE_MARK[source] })}{' '}
                      <b>{healthMetricText(key, m.benchmark.cuts[49])}</b>
                    </div>
                  </div>
                  {key === 'engagement_rate' && (
                    <p className="ig-health-m__help">{t('health.engagementHelp')}</p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="ig-health-foot">
            {sources.has('mesaas') && (
              <p className="ig-health-fine">
                {mesaasCount != null
                  ? t('health.fineMesaasCount', {
                      sample: healthSampleLabel(mesaasCount),
                      band: healthBandLabel(band),
                    })
                  : t('health.fineMesaas', { band: healthBandLabel(band) })}
              </p>
            )}
            {sources.has('mercado') && (
              <p className="ig-health-fine">
                {t('health.fineMarket', { band: healthBandLabel(band) })}
              </p>
            )}
            {best && best.ratio >= 1 && (
              <p className="ig-health-best">
                {t('health.bestPost', { ratio: healthRatio(best.ratio) })}{' '}
                <button
                  type="button"
                  className="ig-health-best__link"
                  onClick={() => onOpenPost(best.id)}
                >
                  {t('health.viewPost')}
                </button>
              </p>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
