import type { BlockProps } from '../../BlockRenderer';
import type { GbpSurface } from '../../types';
import { fmtCount, fmtPct } from '../../format';
import { GbpCardHeader } from './GbpCardHeader';
import { fmtWindowStamp, googleWithData, plural } from './format';

const SURFACE_LABELS: Record<GbpSurface, string> = {
  mobile_search: 'Pesquisa Google no celular',
  mobile_maps: 'Google Maps no celular',
  desktop_search: 'Pesquisa Google no computador',
  desktop_maps: 'Google Maps no computador',
};

/** Onde viram o perfil: as quatro superfícies do Google, da maior para a menor. */
export function GbpSurfacesBlock({ snapshot }: BlockProps) {
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
        title="Onde viram o perfil"
        stamp={fmtWindowStamp(google.window, snapshot.period.endExclusive)}
        sub={`${fmtCount(total)} ${plural(total, 'visualização', 'visualizações')} no período`}
      />
      <div className="rb-gbp-rows">
        {rows.map((row) => (
          <div key={row.surface} className="rb-gbp-surface">
            <div className="rb-gbp-row-line">
              <span>{SURFACE_LABELS[row.surface]}</span>
              <span className="rb-gbp-num">{`${fmtCount(row.value)} · ${fmtPct(row.pct)}`}</span>
            </div>
            <div className="rb-gbp-track">
              <div className="rb-gbp-fill" style={{ width: `${(row.value / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
      <p className="rb-gbp-foot">
        {`${mobile}% pelo celular. Maps responde por ${maps}% das visualizações.`}
      </p>
    </div>
  );
}
