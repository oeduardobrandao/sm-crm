import type { BlockProps } from '../../BlockRenderer';
import { fmtCount } from '../../format';
import { GbpCardHeader } from './GbpCardHeader';
import { fmtMonthYear, googleWithData } from './format';

const MAX_ROWS = 10;

/** O que buscaram no Google: os termos que mostraram o perfil no mês indicado. Abaixo do
 * limiar do Google o número vem como "menos de N". */
export function GbpKeywordsBlock({ snapshot }: BlockProps) {
  const google = googleWithData(snapshot);
  if (!google) return null;
  const rows = google.keywords.rows.slice(0, MAX_ROWS);
  if (rows.length === 0) return null;

  return (
    <div className="rb-gbp-card rb-card rb-card--pad">
      <GbpCardHeader
        title="O que buscaram no Google"
        stamp={google.keywords.month ? fmtMonthYear(google.keywords.month) : null}
        sub="Termos que mostraram o perfil"
      />
      <table className="rb-gbp-table">
        <thead>
          <tr>
            <th>Busca</th>
            <th className="rb-gbp-num">Pessoas</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.keyword}>
              <td>{row.keyword}</td>
              <td className="rb-gbp-num">
                {row.value !== null
                  ? fmtCount(row.value)
                  : row.threshold !== null
                    ? `menos de ${fmtCount(row.threshold)}`
                    : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="rb-gbp-foot">O Google só mostra o número exato acima de 15 pessoas por mês.</p>
    </div>
  );
}
