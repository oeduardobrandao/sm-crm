import type { BlockProps } from '../../BlockRenderer';
import type { GbpSurface } from '../../types';
import { fmtCount, fmtPct } from '../../format';
import { GbpCardHeader } from './GbpCardHeader';
import { fmtWindowStamp, googleWithData } from './format';
import { useReportLang, reportText } from '../../i18n';

/** Onde viram o perfil: as quatro superfícies do Google, da maior para a menor. */
export function GbpSurfacesBlock({ snapshot }: BlockProps) {
  const lang = useReportLang();
  const text = reportText(lang).gbp.surfaces;
  const google = googleWithData(snapshot);
  if (!google) return null;
  const total = google.surfaces.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) return null;

  const rows = [...google.surfaces].sort((a, b) => b.value - a.value);
  const valueOf = (s: GbpSurface) => google.surfaces.find((r) => r.surface === s)?.value ?? 0;
  const mobile = Math.round(((valueOf('mobile_search') + valueOf('mobile_maps')) / total) * 100);
  const maps = Math.round(((valueOf('mobile_maps') + valueOf('desktop_maps')) / total) * 100);
  const max = Math.max(...rows.map((r) => r.value), 1);

  return (
    <div className="rb-gbp-card rb-card rb-card--pad">
      <GbpCardHeader
        title={text.title}
        stamp={fmtWindowStamp(google.window, snapshot.period.endExclusive, lang)}
        sub={text.sub(fmtCount(total, lang), total)}
      />
      <div className="rb-gbp-rows">
        {rows.map((row) => (
          <div key={row.surface} className="rb-gbp-surface">
            <div className="rb-gbp-row-line">
              <span>{text.labels[row.surface]}</span>
              <span className="rb-gbp-num">{`${fmtCount(row.value, lang)} · ${fmtPct(row.pct, lang)}`}</span>
            </div>
            <div className="rb-gbp-track">
              <div className="rb-gbp-fill" style={{ width: `${(row.value / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
      <p className="rb-gbp-foot">{text.foot(mobile, maps)}</p>
    </div>
  );
}
