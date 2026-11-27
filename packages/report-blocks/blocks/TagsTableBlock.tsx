import type { BlockProps } from '../BlockRenderer';
import { fmtCount, fmtPct } from '../format';
import { useReportLang, reportText } from '../i18n';

export function TagsTableBlock({ snapshot }: BlockProps) {
  const lang = useReportLang();
  const text = reportText(lang).tags;
  const rows = snapshot.tags_performance;
  if (rows.length === 0) return null;
  return (
    <div className="rb-card rb-card--pad" style={{ overflowX: 'auto' }}>
      <p
        className="rb-card-title"
        style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', fontWeight: 600 }}
      >
        {text.title}
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
        <thead>
          <tr style={{ textAlign: 'left', opacity: 0.6 }}>
            <th style={{ padding: '0.3rem 0' }}>{text.topic}</th>
            <th>{text.posts}</th>
            <th>{text.avgReach}</th>
            <th>{text.avgEngagement}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.tag} style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
              <td style={{ padding: '0.35rem 0', fontWeight: 600 }}>{row.tag}</td>
              <td>{fmtCount(row.count, lang)}</td>
              <td>{fmtCount(row.avg_reach, lang)}</td>
              <td>{fmtPct(row.avg_engagement, lang)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
