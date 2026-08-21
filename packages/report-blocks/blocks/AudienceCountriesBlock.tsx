import type { BlockProps } from '../BlockRenderer';

export function AudienceCountriesBlock({ snapshot }: BlockProps) {
  const rows = snapshot.audience?.top_countries ?? [];
  if (rows.length === 0) return null;
  return (
    <div className="rb-panel" style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: '1rem' }}>
      <p style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', fontWeight: 600 }}>Países</p>
      {rows.map((row) => (
        <div key={row.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', margin: '0.25rem 0' }}>
          <span>{row.name}</span>
          <span style={{ fontWeight: 600 }}>{row.pct.toFixed(0)}%</span>
        </div>
      ))}
    </div>
  );
}
