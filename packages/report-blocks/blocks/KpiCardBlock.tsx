import type { BlockProps } from '../BlockRenderer';
import type { KpiEntry, ReportKpiId } from '../types';
import { KPI_LABELS_PT } from '../types';
import { deltaPct, fmtCount, fmtPct, fmtPeriodStamp } from '../format';

// Fonte única em _shared/report-docs/kpis.ts (o bloco de metas da IA usa o
// MESMO mapa); reexport mantém os consumidores existentes.
export const KPI_LABELS: Record<ReportKpiId, string> = KPI_LABELS_PT;

// Tooltip só nos cards onde o número precisa de contexto extra (paridade com
// o app do Instagram, spec §4.3): `reach` porque é acumulado, não único; e
// `engagement_rate` porque a fórmula (contas engajadas ÷ alcance acumulado)
// não é óbvia olhando só o número. title = enhancement only -- o texto
// visível (label + estampa de período) já carrega a informação essencial.
const KPI_TOOLTIPS: Partial<Record<ReportKpiId, string>> = {
  reach:
    'Soma do alcance diário do mês. O app do Instagram mostra visitantes únicos, um número menor.',
  engagement_rate: 'Contas engajadas ÷ alcance acumulado · análise Mesaas',
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
  const periodStamp = fmtPeriodStamp(snapshot.period);
  return (
    <div className="rb-kpi rb-card rb-card--pad" title={KPI_TOOLTIPS[id]}>
      {periodStamp !== null ? (
        <p
          className="rb-kpi-period"
          style={{ margin: '0 0 0.3rem', fontSize: '0.68rem', opacity: 0.55 }}
        >
          {periodStamp}
        </p>
      ) : null}
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
      {entry.prev !== null ? (
        <p
          className="rb-kpi-prev"
          style={{ margin: '0.15rem 0 0', fontSize: '0.72rem', opacity: 0.6 }}
        >
          {`Anterior: ${fmtValue({ ...entry, value: entry.prev })}`}
        </p>
      ) : null}
    </div>
  );
}
