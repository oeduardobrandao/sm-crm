import type { BlockProps } from '../BlockRenderer';
import { useReportText } from '../i18n';

export function BestTimesBlock({ snapshot }: BlockProps) {
  const text = useReportText();
  const slots = snapshot.best_times;
  if (slots.length === 0) return null;
  const top = [...slots].sort((a, b) => b.avg_engagement - a.avg_engagement).slice(0, 3);
  return (
    <div className="rb-panel rb-card rb-card--pad">
      <p
        className="rb-card-title"
        style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', fontWeight: 600 }}
      >
        {text.bestTimes.title}
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
            {`${text.ordinal(i + 1)} ${text.weekday(slot.day)} · ${text.hour(slot.hour)}`}
          </span>
        ))}
      </div>
    </div>
  );
}
