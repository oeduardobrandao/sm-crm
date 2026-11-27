import type { BlockProps } from '../../BlockRenderer';
import { fmtCount } from '../../format';
import { GbpCardHeader } from './GbpCardHeader';
import { fmtMonthYear, googleWithData } from './format';
import { useReportLang, reportText } from '../../i18n';

const MAX_ROWS = 10;

/** O que buscaram no Google: os termos que mostraram o perfil no mês indicado. Abaixo do
 * limiar do Google o número vem como "menos de N". */
export function GbpKeywordsBlock({ snapshot }: BlockProps) {
  const lang = useReportLang();
  const text = reportText(lang).gbp.keywords;
  const google = googleWithData(snapshot);
  if (!google) return null;
  const rows = google.keywords.rows.slice(0, MAX_ROWS);
  if (rows.length === 0) return null;

  return (
    <div className="rb-gbp-card rb-card rb-card--pad">
      <GbpCardHeader
        title={text.title}
        stamp={google.keywords.month ? fmtMonthYear(google.keywords.month, lang) : null}
        sub={text.sub}
      />
      <table className="rb-gbp-table">
        <thead>
          <tr>
            <th>{text.search}</th>
            <th className="rb-gbp-num">{text.people}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.keyword}>
              <td>{row.keyword}</td>
              <td className="rb-gbp-num">
                {row.value !== null
                  ? fmtCount(row.value, lang)
                  : row.threshold !== null
                    ? text.lessThan(fmtCount(row.threshold, lang))
                    : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="rb-gbp-foot">{text.foot}</p>
    </div>
  );
}
