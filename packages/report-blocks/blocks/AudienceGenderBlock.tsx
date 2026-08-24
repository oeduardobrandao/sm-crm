import type { BlockProps } from '../BlockRenderer';

export function AudienceGenderBlock({ snapshot }: BlockProps) {
  const g = snapshot.audience?.gender_split;
  if (!g) return null;
  const female = Math.round(g.female);
  const male = Math.round(g.male);
  // Donut simples: dois arcos via stroke-dasharray sobre circunferência 100.
  const r = 15.9155;
  return (
    <div className="rb-panel rb-card rb-card--pad">
      <p
        className="rb-card-title"
        style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', fontWeight: 600 }}
      >
        Gênero
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <svg
          viewBox="0 0 42 42"
          style={{ width: 96, height: 96 }}
          role="img"
          aria-label="Distribuição por gênero"
        >
          <circle cx="21" cy="21" r={r} fill="none" stroke="rgba(0,0,0,0.1)" strokeWidth="6" />
          <circle
            cx="21"
            cy="21"
            r={r}
            fill="none"
            stroke="var(--rb-accent)"
            strokeWidth="6"
            strokeDasharray={`${female} ${100 - female}`}
            strokeDashoffset="25"
          />
        </svg>
        <div style={{ fontSize: '0.85rem' }}>
          <p style={{ margin: 0 }}>
            <strong>{female}%</strong> Feminino
          </p>
          <p style={{ margin: '0.25rem 0 0' }}>
            <strong>{male}%</strong> Masculino
          </p>
        </div>
      </div>
    </div>
  );
}
