import type { BlockProps } from '../../BlockRenderer';
import { fmtCount } from '../../format';
import { GbpCardHeader } from './GbpCardHeader';
import { fmtRating, fmtWindowStamp, googleWithData } from './format';
import { useReportLang, reportText } from '../../i18n';

/** Comparar unidades: uma linha por unidade, na ordem do snapshot. Só com duas ou mais. */
export function GbpUnitsBlock({ snapshot }: BlockProps) {
  const lang = useReportLang();
  const text = reportText(lang).gbp.units;
  const google = googleWithData(snapshot);
  if (!google || google.unit_rows.length < 2) return null;

  return (
    <div className="rb-gbp-card rb-card rb-card--pad" style={{ overflowX: 'auto' }}>
      <GbpCardHeader
        title={text.title}
        stamp={fmtWindowStamp(google.window, snapshot.period.endExclusive, lang)}
      />
      <table className="rb-gbp-table">
        <thead>
          <tr>
            <th>{text.unit}</th>
            <th className="rb-gbp-num">{text.views}</th>
            <th className="rb-gbp-num">{text.calls}</th>
            <th className="rb-gbp-num">{text.directions}</th>
            <th className="rb-gbp-num">{text.website}</th>
            <th className="rb-gbp-num">{text.rating}</th>
          </tr>
        </thead>
        <tbody>
          {google.unit_rows.map((u) => (
            <tr key={u.id}>
              <td>
                <span className="rb-gbp-unit-name">{u.title ?? text.unnamed}</span>
                {u.status === 'revoked' ? <span className="rb-gbp-tag">{text.revoked}</span> : null}
              </td>
              <td className="rb-gbp-num">{fmtCount(u.views, lang)}</td>
              <td className="rb-gbp-num">{fmtCount(u.calls, lang)}</td>
              <td className="rb-gbp-num">{fmtCount(u.directions, lang)}</td>
              <td className="rb-gbp-num">{fmtCount(u.website_clicks, lang)}</td>
              <td className="rb-gbp-num">
                {u.rating === null
                  ? text.noRating
                  : `★ ${fmtRating(u.rating, lang)}${u.reviews !== null ? ` (${fmtCount(u.reviews, lang)})` : ''}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
