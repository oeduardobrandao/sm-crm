import type { BlockProps } from '../BlockRenderer';

export function AudienceAgeBlock({ snapshot }: BlockProps) {
  const rows = snapshot.audience?.top_age_ranges ?? [];
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.pct), 1);
  return (
    <div className="rb-panel rb-card rb-card--pad">
      <p
        className="rb-card-title"
        style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', fontWeight: 600 }}
      >
        Faixa etária
      </p>
      {rows.map((row) => (
        <div
          key={row.range}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0.3rem 0' }}
        >
          <span style={{ width: 52, fontSize: '0.78rem' }}>{row.range}</span>
          <div style={{ flex: 1, height: 8, background: 'rgba(0,0,0,0.06)', borderRadius: 4 }}>
            <div
              style={{
                width: `${(row.pct / max) * 100}%`,
                height: '100%',
                background: 'var(--rb-accent-line, var(--rb-accent))',
                borderRadius: 4,
              }}
            />
          </div>
          <span style={{ width: 40, textAlign: 'right', fontSize: '0.78rem' }}>
            {row.pct.toFixed(0)}%
          </span>
        </div>
      ))}
    </div>
  );
}
