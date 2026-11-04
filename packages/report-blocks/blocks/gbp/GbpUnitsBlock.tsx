import type { BlockProps } from '../../BlockRenderer';
import { fmtCount } from '../../format';
import { GbpCardHeader } from './GbpCardHeader';
import { fmtRating, fmtWindowStamp, googleWithData } from './format';

/** Comparar unidades: uma linha por unidade, na ordem do snapshot. Só com duas ou mais. */
export function GbpUnitsBlock({ snapshot }: BlockProps) {
  const google = googleWithData(snapshot);
  if (!google || google.unit_rows.length < 2) return null;

  return (
    <div className="rb-gbp-card rb-card rb-card--pad" style={{ overflowX: 'auto' }}>
      <GbpCardHeader
        title="Comparar unidades"
        stamp={fmtWindowStamp(google.window, snapshot.period.endExclusive)}
      />
      <table className="rb-gbp-table">
        <thead>
          <tr>
            <th>Unidade</th>
            <th className="rb-gbp-num">Visualizações</th>
            <th className="rb-gbp-num">Ligações</th>
            <th className="rb-gbp-num">Rotas</th>
            <th className="rb-gbp-num">Site</th>
            <th className="rb-gbp-num">Nota</th>
          </tr>
        </thead>
        <tbody>
          {google.unit_rows.map((u) => (
            <tr key={u.id}>
              <td>
                <span className="rb-gbp-unit-name">{u.title ?? 'Unidade sem nome'}</span>
                {u.status === 'revoked' ? (
                  <span className="rb-gbp-tag">Autorização expirada</span>
                ) : null}
              </td>
              <td className="rb-gbp-num">{fmtCount(u.views)}</td>
              <td className="rb-gbp-num">{fmtCount(u.calls)}</td>
              <td className="rb-gbp-num">{fmtCount(u.directions)}</td>
              <td className="rb-gbp-num">{fmtCount(u.website_clicks)}</td>
              <td className="rb-gbp-num">
                {u.rating === null
                  ? 'sem nota'
                  : `★ ${fmtRating(u.rating)}${u.reviews !== null ? ` (${fmtCount(u.reviews)})` : ''}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
