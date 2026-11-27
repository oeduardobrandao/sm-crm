import type { BlockProps } from '../BlockRenderer';
import { fmtCount } from '../format';
import { useReportLang, reportText } from '../i18n';

const FORMAT_KEYS = ['reels', 'carousels', 'images'] as const;
type FormatKey = (typeof FORMAT_KEYS)[number];

export function FormatCardsBlock({ snapshot }: BlockProps) {
  const lang = useReportLang();
  const text = reportText(lang).formats;
  const entries = [...FORMAT_KEYS]
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
        <div key={key} className="rb-card rb-card--pad">
          <p className="rb-card-title" style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600 }}>
            {text.labels[key]}
            {key === leader.key ? (
              <span
                style={{
                  marginLeft: 8,
                  fontSize: '0.68rem',
                  color: 'var(--rb-accent-text, var(--rb-accent))',
                  border: '1px solid var(--rb-accent-line, var(--rb-accent))',
                  borderRadius: 999,
                  padding: '0.1rem 0.5rem',
                }}
              >
                {text.leader}
              </span>
            ) : null}
          </p>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.78rem', opacity: 0.75 }}>
            {hasViews
              ? text.withViews(fmtCount(data.count, lang), fmtCount(data.avg_views, lang))
              : text.withReach(fmtCount(data.count, lang), fmtCount(data.avg_reach, lang))}
          </p>
        </div>
      ))}
    </div>
  );
}
