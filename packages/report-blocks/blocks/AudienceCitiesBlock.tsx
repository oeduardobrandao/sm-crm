import type { BlockProps } from '../BlockRenderer';
import { useReportText } from '../i18n';

export function AudienceCitiesBlock({ snapshot }: BlockProps) {
  const title = useReportText().audience.cities;
  const rows = snapshot.audience?.top_cities ?? [];
  if (rows.length === 0) return null;
  return (
    <div className="rb-panel rb-card rb-card--pad">
      <p
        className="rb-card-title"
        style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', fontWeight: 600 }}
      >
        {title}
      </p>
      {rows.map((row) => (
        <div
          key={row.name}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '0.82rem',
            margin: '0.25rem 0',
          }}
        >
          <span>{row.name}</span>
          <span style={{ fontWeight: 600 }}>{row.pct.toFixed(0)}%</span>
        </div>
      ))}
    </div>
  );
}
