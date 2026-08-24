import type { BlockProps } from '../BlockRenderer';
import { fmtCount } from '../format';

const FORMAT_LABELS = { reels: 'Reels', carousels: 'Carrosséis', images: 'Imagens' } as const;
type FormatKey = keyof typeof FORMAT_LABELS;

export function FormatCardsBlock({ snapshot }: BlockProps) {
  const entries = (Object.keys(FORMAT_LABELS) as FormatKey[])
    .map((key) => ({ key, data: snapshot.content_breakdown[key] }))
    .filter((e): e is { key: FormatKey; data: NonNullable<typeof e.data> } =>
      Boolean(e.data && e.data.count > 0),
    );
  if (entries.length === 0) return null;

  // Formato líder decidido por visualizações médias (pedido 2026-08). Snapshot
  // antigo sem avg_views degrada para o critério anterior (alcance médio).
  const hasViews = entries.every((e) => typeof e.data.avg_views === 'number');
  const leader = entries.reduce((a, b) => {
    const metric = (d: (typeof a)['data']) => (hasViews ? d.avg_views : d.avg_reach);
    return metric(b.data) > metric(a.data) ? b : a;
  });
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${entries.length}, 1fr)`,
        gap: '0.75rem',
      }}
    >
      {entries.map(({ key, data }) => (
        <div
          key={key}
          style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: '1rem' }}
        >
          <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600 }}>
            {FORMAT_LABELS[key]}
            {key === leader.key ? (
              <span
                style={{
                  marginLeft: 8,
                  fontSize: '0.68rem',
                  color: 'var(--rb-accent)',
                  border: '1px solid var(--rb-accent)',
                  borderRadius: 999,
                  padding: '0.1rem 0.5rem',
                }}
              >
                Formato líder
              </span>
            ) : null}
          </p>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.78rem', opacity: 0.75 }}>
            {hasViews
              ? `${fmtCount(data.count)} publicações · média de ${fmtCount(data.avg_views)} visualizações`
              : `${fmtCount(data.count)} publicações · alcance médio ${fmtCount(data.avg_reach)}`}
          </p>
        </div>
      ))}
    </div>
  );
}
