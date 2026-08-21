import type { BlockProps } from '../BlockRenderer';
import type { KpiEntry, ReportKpiId } from '../types';
import { deltaPct, fmtCount, fmtPct } from '../format';

export const KPI_LABELS: Record<ReportKpiId, string> = {
  followers_gained: 'Novos seguidores',
  followers_total: 'Seguidores totais',
  reach: 'Alcance',
  engagement_rate: 'Taxa de engajamento',
  saves: 'Salvamentos',
  posts_count: 'Publicações',
  profile_views: 'Visitas ao perfil',
  website_clicks: 'Cliques no link',
};

function kpiIdFromBlockType(type: string): ReportKpiId {
  return type.replace(/^kpi_/, '') as ReportKpiId;
}

function fmtValue(entry: KpiEntry): string {
  return entry.unit === 'pct' ? fmtPct(entry.value as number) : fmtCount(entry.value as number);
}

export function KpiCardBlock({ block, snapshot }: BlockProps) {
  const id = kpiIdFromBlockType(block.type);
  const entry = snapshot.kpis[id];
  if (!entry || entry.value === null) return null;

  const delta = entry.prev !== null ? deltaPct(entry.value, entry.prev) : null;
  return (
    <div
      className="rb-kpi"
      style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: '1rem' }}
    >
      <p style={{ margin: 0, fontSize: '0.78rem', opacity: 0.7 }}>{KPI_LABELS[id]}</p>
      <p style={{ margin: '0.2rem 0 0', fontSize: '1.5rem', fontWeight: 700 }}>{fmtValue(entry)}</p>
      {delta !== null ? (
        <p
          className="rb-kpi-delta"
          style={{
            margin: '0.2rem 0 0',
            fontSize: '0.78rem',
            fontWeight: 600,
            color: delta >= 0 ? '#0a7d43' : '#b3261e',
          }}
        >
          {`${delta >= 0 ? '+' : '-'}${Math.abs(delta).toFixed(1).replace('.', ',')}%`}
        </p>
      ) : null}
    </div>
  );
}
