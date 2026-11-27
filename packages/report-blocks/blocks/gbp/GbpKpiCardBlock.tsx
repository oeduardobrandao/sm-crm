import type { BlockProps } from '../../BlockRenderer';
import type { GbpKpiId, GbpReportKpiEntry } from '../../types';
import { deltaPct, fmtCount, fmtSignedPct } from '../../format';
import { daysInclusive, fmtRating, fmtWindowStamp, googleWithData } from './format';
import { useReportLang, reportText, type ReportLang } from '../../i18n';

/** Variação como a aba GMN mostra: nota em diferença absoluta ("+0,1"), avaliações novas em
 * diferença de contagem ("+5"), o resto em percentual. `null` quando não há comparação. */
function deltaText(
  id: GbpKpiId,
  value: number,
  prev: number,
  lang: ReportLang,
): { text: string; up: boolean } | null {
  if (id === 'avg_rating') {
    const d = Math.round((value - prev) * 10) / 10;
    return {
      text: `${d > 0 ? '+' : d < 0 ? '-' : ''}${fmtRating(Math.abs(d), lang)}`,
      up: d >= 0,
    };
  }
  if (id === 'new_reviews') {
    const d = value - prev;
    return {
      text: `${d > 0 ? '+' : d < 0 ? '-' : ''}${fmtCount(Math.abs(d), lang)}`,
      up: d >= 0,
    };
  }
  const pct = deltaPct(value, prev);
  if (pct === null) return null;
  return { text: fmtSignedPct(pct, lang), up: pct >= 0 };
}

function fmtValue(unit: GbpReportKpiEntry['unit'], n: number, lang: ReportLang): string {
  return unit === 'rating' ? fmtRating(n, lang) : fmtCount(n, lang);
}

/** Card de KPI do Google Meu Negócio: mesma marcação do KpiCardBlock, com a estampa da janela
 * da seção e a comparação com os N dias imediatamente anteriores (a da aba GMN). */
export function GbpKpiCardBlock({ block, snapshot }: BlockProps) {
  const lang = useReportLang();
  const text = reportText(lang);
  const google = googleWithData(snapshot);
  if (!google) return null;
  const id = block.type.slice('gbp_kpi_'.length) as GbpKpiId;
  const entry = google.kpis[id];
  if (!entry || entry.value === null) return null;

  const stamp = fmtWindowStamp(google.window, snapshot.period.endExclusive, lang);
  const delta = entry.prev !== null ? deltaText(id, entry.value, entry.prev, lang) : null;
  const prevDays = google.window
    ? daysInclusive(google.window.prevStart, google.window.prevEnd)
    : null;
  const prevLabel = prevDays !== null ? text.gbp.vsPrevious(prevDays) : text.previous;

  return (
    <div className="rb-kpi rb-gbp-kpi rb-card rb-card--pad" title={text.kpi.gbpTooltips[id]}>
      {stamp !== null ? (
        <p
          className="rb-kpi-period"
          style={{ margin: '0 0 0.3rem', fontSize: '0.68rem', opacity: 0.55 }}
        >
          {stamp}
        </p>
      ) : null}
      <p style={{ margin: 0, fontSize: '0.78rem', opacity: 0.7 }}>{text.kpi.gbpLabels[id]}</p>
      <p style={{ margin: '0.2rem 0 0', fontSize: '1.5rem', fontWeight: 700 }}>
        {fmtValue(entry.unit, entry.value, lang)}
      </p>
      {delta !== null ? (
        <p
          className="rb-kpi-delta"
          style={{
            margin: '0.2rem 0 0',
            fontSize: '0.78rem',
            fontWeight: 600,
            color: delta.up ? '#0a7d43' : '#b3261e',
          }}
        >
          {delta.text}
        </p>
      ) : null}
      {entry.prev !== null ? (
        <p
          className="rb-kpi-prev"
          style={{ margin: '0.15rem 0 0', fontSize: '0.72rem', opacity: 0.6 }}
        >
          {`${prevLabel}: ${fmtValue(entry.unit, entry.prev, lang)}`}
        </p>
      ) : null}
    </div>
  );
}
