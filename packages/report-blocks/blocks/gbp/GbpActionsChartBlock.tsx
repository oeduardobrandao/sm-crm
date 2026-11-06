import type { BlockProps } from '../../BlockRenderer';
import { fmtCount } from '../../format';
import { GbpCardHeader } from './GbpCardHeader';
import { fmtDayShort, fmtWindowStamp, googleWithData } from './format';

const W = 640;
const H = 170;
const PAD = 12;

// Mesmas cores da aba GMN (GbpActionsChart): legíveis em fundo claro e escuro e na impressão.
const SERIES = [
  { field: 'calls', label: 'Ligações', color: '#2563eb' },
  { field: 'directions', label: 'Rotas', color: '#d97706' },
  { field: 'websiteClicks', label: 'Site', color: '#16a34a' },
  { field: 'messages', label: 'Mensagens', color: '#7c3aed' },
] as const;

/** Ações por dia: barras empilhadas de ligações, rotas, site e mensagens. */
export function GbpActionsChartBlock({ snapshot }: BlockProps) {
  const google = googleWithData(snapshot);
  if (!google) return null;
  const days = google.daily;
  const dayTotal = (d: (typeof days)[number]) =>
    d.calls + d.directions + d.websiteClicks + d.messages;
  const max = Math.max(0, ...days.map(dayTotal));
  if (days.length === 0 || max <= 0) return null;

  const slot = (W - 2 * PAD) / days.length;
  const barW = Math.max(slot * 0.7, 1);
  const scale = (H - 2 * PAD) / max;
  const totals = SERIES.map((s) => days.reduce((sum, d) => sum + d[s.field], 0));

  return (
    <div className="rb-gbp-card rb-card rb-card--pad">
      <GbpCardHeader
        title="Ações por dia"
        stamp={fmtWindowStamp(google.window, snapshot.period.endExclusive)}
        sub="O que as pessoas fizeram depois de ver o perfil"
      />
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto' }}
        role="img"
        aria-label="Gráfico de barras empilhadas: ligações, rotas, cliques no site e mensagens por dia"
      >
        {days.map((d, i) => {
          const x = PAD + i * slot + (slot - barW) / 2;
          let y = H - PAD;
          return (
            <g key={d.date}>
              {SERIES.map((s) => {
                const h = d[s.field] * scale;
                if (h <= 0) return null;
                y -= h;
                return (
                  <rect
                    key={s.field}
                    x={x.toFixed(1)}
                    y={y.toFixed(1)}
                    width={barW.toFixed(1)}
                    height={h.toFixed(1)}
                    fill={s.color}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>
      <div className="rb-gbp-axis">
        <span>{fmtDayShort(days[0].date)}</span>
        {days.length > 1 ? <span>{fmtDayShort(days[days.length - 1].date)}</span> : null}
      </div>
      <ul className="rb-gbp-legend">
        {SERIES.map((s, i) => (
          <li key={s.field}>
            <span className="rb-gbp-swatch" style={{ background: s.color }} aria-hidden="true" />
            <span>{s.label}</span>
            <span className="rb-gbp-num">{fmtCount(totals[i])}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
