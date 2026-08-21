import type { BlockProps } from '../BlockRenderer';
import { fmtCount } from '../format';

export function TagsTableBlock({ snapshot }: BlockProps) {
  const rows = snapshot.tags_performance;
  if (rows.length === 0) return null;
  return (
    <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: '1rem', overflowX: 'auto' }}>
      <p style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', fontWeight: 600 }}>Performance por tópico</p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
        <thead>
          <tr style={{ textAlign: 'left', opacity: 0.6 }}>
            <th style={{ padding: '0.3rem 0' }}>Tópico</th>
            <th>Posts</th>
            <th>Alcance médio</th>
            <th>Engajamento médio</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.tag} style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
              <td style={{ padding: '0.35rem 0', fontWeight: 600 }}>{row.tag}</td>
              <td>{fmtCount(row.count)}</td>
              <td>{fmtCount(row.avg_reach)}</td>
              <td>{fmtCount(row.avg_engagement)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
