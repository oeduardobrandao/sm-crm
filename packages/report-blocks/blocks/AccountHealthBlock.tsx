// Bloco "Saúde do Instagram" (spec 2026-11-25-ig-account-health-report-block §Bloco): mesmo
// conteúdo e copy do cartão da Analytics da conta, com o tema do relatório. Lê só o
// data_snapshot.instagram_health congelado; sem dado retorna null (Hub e PDF omitem, o editor
// mostra o placeholder pelo blockHasData). Cores de veredito fixas em styles.css (rb-health-*).
import { useState } from 'react';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import type { BlockProps } from '../BlockRenderer';
import { safeHttpsUrl } from '../format';
import { isRenderableSrc } from '../image';
import { intlLocale, reportText, useReportLang, type ReportLang } from '../i18n';
import {
  HEALTH_METRIC_ORDER,
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

const SOURCE_MARK: Record<BenchmarkSource, string> = { mesaas: '*', mercado: '†' };

function fmtRatio(n: number, lang: ReportLang): string {
  return new Intl.NumberFormat(intlLocale(lang), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(n);
}

/** "Até 31/07" / "Through 07/31" a partir do effectiveEnd (ISO à meia-noite UTC; getters UTC). */
function stampFor(effectiveEnd: string | undefined, lang: ReportLang): string | null {
  if (!effectiveEnd) return null;
  const d = new Date(effectiveEnd);
  if (Number.isNaN(d.getTime())) return null;
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return reportText(lang).health.stamp(dd, mm);
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
  const text = reportText(useReportLang()).health;
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div
      role="img"
      aria-label={text.ahead(approx ? text.approx : '', clamped)}
      className={`rb-health-bar rb-health-bar--${size} rb-health-tone-${tone}`}
    >
      <span className="rb-health-bar__fill" style={{ width: `${clamped}%` }} />
      <span className="rb-health-bar__tick" />
      <span className="rb-health-bar__dot" style={{ left: `${clamped}%` }} />
    </div>
  );
}

/** Miniatura do melhor post; some se a URL falhar (cache que deu 404). */
function BestPostThumb({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <img className="rb-health-best__thumb" src={src} alt="" onError={() => setFailed(true)} />;
}

export function AccountHealthBlock({ snapshot }: BlockProps) {
  const lang = useReportLang();
  const text = reportText(lang).health;
  const health = readInstagramHealth(snapshot);
  if (!healthHasData(health)) return null;
  const band = health.band!;

  const scored = scoreHealthMetrics(health.metrics, health.benchmarks);
  const overall = overallPercentile(scored.map((m) => m.pct));
  if (overall == null) return null;

  const verdict = verdictFor(overall, lang);
  const sources = new Set(scored.map((m) => m.benchmark.source));
  const mixed = sources.size > 1;
  const overallApprox = sources.size === 1 && sources.has('mercado');
  const n = scored.length;
  const summaryLead = n === 1 ? text.leadOne : text.leadMany(n);

  // Maior percentil; empate fica com a primeira na ordem fixa.
  const top = scored.reduce((best, m) => (m.pct > best.pct ? m : best));
  const topLine = highlightLine(
    top.key,
    formatMetric(top.key, top.value, lang),
    formatMetric(top.key, top.benchmark.cuts[49], lang),
    lang,
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
  const stamp = stampFor(snapshot.period.effectiveEnd, lang);

  return (
    <section className="rb-health rb-card" aria-label={text.title}>
      <div className="rb-health-head">
        <p className="rb-card-title rb-health-title">{text.title}</p>
        {stamp ? <p className="rb-health-stamp">{stamp}</p> : null}
      </div>

      <div className="rb-health-top">
        <p className="rb-health-q">{text.question}</p>
        <div className={`rb-health-verdict rb-health-tone-${verdict.tone}`}>
          <ToneIcon tone={verdict.tone} />
          <span>{verdict.label}</span>
        </div>
        <div className="rb-health-top__bar">
          <HealthBar pct={overall} tone={verdict.tone} size="lg" approx={overallApprox} />
        </div>
        <p className="rb-health-sum">
          {text.summary(summaryLead, overallApprox ? text.approx : '', overall)}
        </p>
        <p className="rb-health-line">{topLine}</p>
      </div>

      <div className="rb-health-grid">
        {HEALTH_METRIC_ORDER.map((key) => {
          const title = text.metricTitles[key];
          const value = health.metrics[key];
          if (value == null) {
            const reason = text.nullReasons[key];
            return (
              <div key={key} className="rb-health-m">
                <p className="rb-health-m__t">
                  <span>{title}</span>
                </p>
                <p className="rb-health-m__empty">
                  <span>{text.noData}</span>
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
                    {text.you} <b>{formatMetric(key, value, lang)}</b>
                  </div>
                </div>
                <p className="rb-health-m__empty">{text.noReference}</p>
              </div>
            );
          }

          const v = verdictFor(m.pct, lang);
          const source = m.benchmark.source;
          const approx = source === 'mercado';
          return (
            <div key={key} className="rb-health-m">
              <p className="rb-health-m__t">
                <span>{title}</span>
                {mixed && <span className="rb-health-src">{text.sourceBadge[source]}</span>}
              </p>
              <div className={`rb-health-m__v rb-health-tone-${v.tone}`}>
                <ToneIcon tone={v.tone} />
                <span>{v.label}</span>
              </div>
              <HealthBar pct={m.pct} tone={v.tone} size="sm" approx={approx} />
              <p className="rb-health-m__ahead">{text.ahead(approx ? text.approx : '', m.pct)}</p>
              <div className="rb-health-kv">
                <div className="rb-health-kv__you">
                  {text.you} <b>{formatMetric(key, value, lang)}</b>
                </div>
                <div>
                  {text.peers(SOURCE_MARK[source])}{' '}
                  <b>{formatMetric(key, m.benchmark.cuts[49], lang)}</b>
                </div>
              </div>
              {key === 'engagement_rate' && (
                <p className="rb-health-m__help">{text.engagementHelp}</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="rb-health-foot">
        {sources.has('mesaas') && (
          <p className="rb-health-fine">
            {mesaasCount != null
              ? text.fineMesaasCount(roundedSampleLabel(mesaasCount, lang), bandLabel(band, lang))
              : text.fineMesaas(bandLabel(band, lang))}
          </p>
        )}
        {sources.has('mercado') && (
          <p className="rb-health-fine">{text.fineMarket(bandLabel(band, lang))}</p>
        )}
        {showBest && (
          <div className="rb-health-best">
            {thumb ? <BestPostThumb key={thumb} src={thumb} /> : null}
            <p>
              {text.bestPost(fmtRatio(best.ratio, lang))}
              {permalink ? (
                <>
                  {' '}
                  <a
                    className="rb-health-best__link"
                    href={permalink}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {text.viewOnInstagram}
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
