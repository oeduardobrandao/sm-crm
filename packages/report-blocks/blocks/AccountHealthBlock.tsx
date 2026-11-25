// Bloco "Saúde do Instagram" (spec 2026-11-25-ig-account-health-report-block §Bloco): mesmo
// conteúdo e copy do cartão da Analytics da conta, com o tema do relatório. Lê só o
// data_snapshot.instagram_health congelado; sem dado retorna null (Hub e PDF omitem, o editor
// mostra o placeholder pelo blockHasData). Cores de veredito fixas em styles.css (rb-health-*).
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import type { BlockProps } from '../BlockRenderer';
import { safeHttpsUrl } from '../format';
import { isRenderableSrc } from '../image';
import {
  HEALTH_METRIC_ORDER,
  HEALTH_METRIC_TITLES,
  HEALTH_NULL_REASONS,
  bandLabel,
  formatMetric,
  healthHasData,
  highlightLine,
  overallPercentile,
  readInstagramHealth,
  roundedSampleLabel,
  scoreHealthMetrics,
  verdictFor,
  type BenchmarkSource,
  type VerdictTone,
} from '../health';

const TITLE = 'Saúde do Instagram';
const QUESTION = 'Seu Instagram está indo bem?';
const SOURCE_MARK: Record<BenchmarkSource, string> = { mesaas: '*', mercado: '†' };
const SOURCE_BADGE: Record<BenchmarkSource, string> = { mesaas: 'Mesaas', mercado: 'Mercado' };

const ratioFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** "Até 31/07" a partir do effectiveEnd (ISO à meia-noite UTC; getters UTC). */
function stampFor(effectiveEnd: string | undefined): string | null {
  if (!effectiveEnd) return null;
  const d = new Date(effectiveEnd);
  if (Number.isNaN(d.getTime())) return null;
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `Até ${dd}/${mm}`;
}

function ToneIcon({ tone }: { tone: VerdictTone }) {
  if (tone === 'great' || tone === 'good') return <TrendingUp aria-hidden="true" />;
  if (tone === 'avg') return <Minus aria-hidden="true" />;
  return <TrendingDown aria-hidden="true" />;
}

/** Barra 0..100 com marca na mediana, preenchimento até o percentil e marcador redondo. */
function HealthBar({
  pct,
  tone,
  size,
  approx,
}: {
  pct: number;
  tone: VerdictTone;
  size: 'lg' | 'sm';
  approx: boolean;
}) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div
      role="img"
      aria-label={`À frente de ${approx ? 'cerca de ' : ''}${clamped}% das contas do seu tamanho`}
      className={`rb-health-bar rb-health-bar--${size} rb-health-tone-${tone}`}
    >
      <span className="rb-health-bar__fill" style={{ width: `${clamped}%` }} />
      <span className="rb-health-bar__tick" />
      <span className="rb-health-bar__dot" style={{ left: `${clamped}%` }} />
    </div>
  );
}

export function AccountHealthBlock({ snapshot }: BlockProps) {
  const health = readInstagramHealth(snapshot);
  if (!healthHasData(health)) return null;
  const band = health.band!;

  const scored = scoreHealthMetrics(health.metrics, health.benchmarks);
  const overall = overallPercentile(scored.map((m) => m.pct));
  if (overall == null) return null;

  const verdict = verdictFor(overall);
  const sources = new Set(scored.map((m) => m.benchmark.source));
  const mixed = sources.size > 1;
  const overallApprox = sources.size === 1 && sources.has('mercado');
  const n = scored.length;
  const summaryLead = n === 1 ? 'Pela métrica disponível' : `Somando as ${n} métricas`;

  // Maior percentil; empate fica com a primeira na ordem fixa.
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
  const scoredByKey = new Map(scored.map((m) => [m.key, m]));

  const best = health.best_post;
  const showBest = best != null && best.ratio >= 1;
  const permalink = showBest ? safeHttpsUrl(best.permalink) : null;
  const thumb = showBest && isRenderableSrc(best.thumbnail_url) ? best.thumbnail_url : null;
  const stamp = stampFor(snapshot.period.effectiveEnd);

  return (
    <section className="rb-health rb-card" aria-label={TITLE}>
      <div className="rb-health-head">
        <p className="rb-card-title rb-health-title">{TITLE}</p>
        {stamp ? <p className="rb-health-stamp">{stamp}</p> : null}
      </div>

      <div className="rb-health-top">
        <p className="rb-health-q">{QUESTION}</p>
        <div className={`rb-health-verdict rb-health-tone-${verdict.tone}`}>
          <ToneIcon tone={verdict.tone} />
          <span>{verdict.label}</span>
        </div>
        <div className="rb-health-top__bar">
          <HealthBar pct={overall} tone={verdict.tone} size="lg" approx={overallApprox} />
        </div>
        <p className="rb-health-sum">
          {`${summaryLead}, você está à frente de ${overallApprox ? 'cerca de ' : ''}${overall}% das contas do seu tamanho.`}
        </p>
        <p className="rb-health-line">{topLine}</p>
      </div>

      <div className="rb-health-grid">
        {HEALTH_METRIC_ORDER.map((key) => {
          const title = HEALTH_METRIC_TITLES[key];
          const value = health.metrics[key];
          if (value == null) {
            const reason = HEALTH_NULL_REASONS[key];
            return (
              <div key={key} className="rb-health-m">
                <p className="rb-health-m__t">
                  <span>{title}</span>
                </p>
                <p className="rb-health-m__empty">
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
              <div key={key} className="rb-health-m">
                <p className="rb-health-m__t">
                  <span>{title}</span>
                </p>
                <div className="rb-health-kv">
                  <div className="rb-health-kv__you">
                    Você: <b>{formatMetric(key, value)}</b>
                  </div>
                </div>
                <p className="rb-health-m__empty">
                  Ainda sem referência para contas do seu tamanho.
                </p>
              </div>
            );
          }

          const v = verdictFor(m.pct);
          const source = m.benchmark.source;
          const approx = source === 'mercado';
          return (
            <div key={key} className="rb-health-m">
              <p className="rb-health-m__t">
                <span>{title}</span>
                {mixed && <span className="rb-health-src">{SOURCE_BADGE[source]}</span>}
              </p>
              <div className={`rb-health-m__v rb-health-tone-${v.tone}`}>
                <ToneIcon tone={v.tone} />
                <span>{v.label}</span>
              </div>
              <HealthBar pct={m.pct} tone={v.tone} size="sm" approx={approx} />
              <p className="rb-health-m__ahead">
                {`À frente de ${approx ? 'cerca de ' : ''}${m.pct}% das contas do seu tamanho`}
              </p>
              <div className="rb-health-kv">
                <div className="rb-health-kv__you">
                  Você: <b>{formatMetric(key, value)}</b>
                </div>
                <div>
                  {`Contas do seu tamanho${SOURCE_MARK[source]}:`}{' '}
                  <b>{formatMetric(key, m.benchmark.cuts[49])}</b>
                </div>
              </div>
              {key === 'engagement_rate' && (
                <p className="rb-health-m__help">
                  Mediana de curtidas + comentários dos seus posts recentes ÷ seguidores.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="rb-health-foot">
        {sources.has('mesaas') && (
          <p className="rb-health-fine">
            {mesaasCount != null
              ? `*Comparado com ${roundedSampleLabel(mesaasCount)} contas do seu tamanho no Mesaas (${bandLabel(band)}).`
              : `*Comparado com contas do seu tamanho no Mesaas (${bandLabel(band)}).`}
          </p>
        )}
        {sources.has('mercado') && (
          <p className="rb-health-fine">{`†Estimativa de mercado para contas ${bandLabel(band)}, a partir de estudos públicos com métricas parecidas.`}</p>
        )}
        {showBest && (
          <div className="rb-health-best">
            {thumb ? <img className="rb-health-best__thumb" src={thumb} alt="" /> : null}
            <p>
              {`Seu melhor post do período teve ${ratioFormatter.format(best.ratio)}x o resultado normal da conta.`}
              {permalink ? (
                <>
                  {' '}
                  <a
                    className="rb-health-best__link"
                    href={permalink}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Ver no Instagram
                  </a>
                </>
              ) : null}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
