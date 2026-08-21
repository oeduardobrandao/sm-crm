import type { BlockProps } from '../BlockRenderer';

export function BestTimesBlock({ snapshot }: BlockProps) {
  const slots = snapshot.best_times;
  if (slots.length === 0) return null;
  const top = [...slots].sort((a, b) => b.avg_engagement - a.avg_engagement).slice(0, 3);
  return (
    <div
      className="rb-panel"
      style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: '1rem' }}
    >
      <p style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', fontWeight: 600 }}>
        Melhores horários para publicar
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {top.map((slot, i) => (
          <span
            key={`${slot.day}-${slot.hour}`}
            style={{
              fontSize: '0.8rem',
              borderRadius: 999,
              padding: '0.3rem 0.75rem',
              background: i === 0 ? 'var(--rb-accent)' : 'rgba(0,0,0,0.05)',
              color: i === 0 ? 'var(--rb-accent-fg)' : 'inherit',
              fontWeight: 600,
            }}
          >
            {`${i + 1}º ${slot.day} · ${slot.hour}h`}
          </span>
        ))}
      </div>
    </div>
  );
}
